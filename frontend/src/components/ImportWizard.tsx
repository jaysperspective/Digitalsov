/**
 * ImportWizard — 3-step CSV import flow:
 *   1. Upload   → drag-drop or file picker, sent to /imports/preview
 *   2. Map      → user assigns CSV headers to canonical fields
 *   3. Done     → show inserted / skipped counts, offer reset
 */

import { DragEvent, Fragment, useRef, useState } from "react";
import { importCSVWithMapping, previewCSV } from "../api/client";
import type { ColumnMappingInput, ImportResult, PreviewResponse } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Step = "upload" | "mapping" | "importing" | "done";

interface WizardState {
  step: Step;
  file?: File;
  preview?: PreviewResponse;
  result?: ImportResult;
  error?: string;
}

export interface MappingForm {
  posted_date: string;
  description_raw: string;
  amount_type: "single" | "split";
  amount: string;
  debit: string;
  credit: string;
  currency: string;
  merchant: string; // "" = auto-extract
}

// ─────────────────────────────────────────────────────────────────────────────
// Column auto-detection heuristics
// ─────────────────────────────────────────────────────────────────────────────

export function autoDetect(headers: string[]): MappingForm {
  const lc = headers.map((h) => h.toLowerCase());

  const find = (...terms: string[]): string =>
    headers[lc.findIndex((h) => terms.some((t) => h.includes(t)))] ?? "";

  const debit = find("debit", "withdrawal", "out");
  const credit = find("credit", "deposit", "inflow");
  const amount = find("amount", "amt", "sum", "total");

  return {
    posted_date: find("date", "posted", "trans"),
    description_raw: find("desc", "payee", "memo", "narr", "detail", "note"),
    amount_type: (debit || credit) && !amount ? "split" : "single",
    amount,
    debit,
    credit,
    currency: find("currency", "ccy", "curr"),
    merchant: find("merchant"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export function validate(m: MappingForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!m.posted_date) e.posted_date = "Required";
  if (!m.description_raw) e.description_raw = "Required";
  if (m.amount_type === "single" && !m.amount) e.amount = "Required";
  if (m.amount_type === "split" && !m.debit && !m.credit)
    e.debit = "At least one of Debit or Credit is required";
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column colour coding  (field → header background in preview table)
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_COLORS: Record<string, string> = {
  posted_date: "#dbeafe",     // blue-100
  description_raw: "#ede9fe", // violet-100
  amount: "#fee2e2",          // red-100
  debit: "#fee2e2",           // red-100
  credit: "#d1fae5",          // green-100
  currency: "#fef9c3",        // yellow-100
  merchant: "#ffedd5",        // orange-100
};

function headerColor(header: string, m: MappingForm): string | undefined {
  for (const [field, color] of Object.entries(FIELD_COLORS)) {
    if (m[field as keyof MappingForm] === header) return color;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

export function StepIndicator({
  current,
  steps = ["Upload", "Map Columns", "Done"],
}: {
  current: number;
  steps?: readonly string[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "1.5rem" }}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <Fragment key={n}>
            {i > 0 && (
              <div
                style={{
                  flex: 1,
                  height: "2px",
                  background: n <= current ? "var(--accent)" : "var(--border)",
                  margin: "0 0.5rem",
                }}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  border: `2px solid ${done ? "var(--green)" : active ? "var(--accent)" : "var(--border-strong)"}`,
                  background: done ? "var(--green)" : active ? "var(--accent)" : "transparent",
                  color: done || active ? "#fff" : "var(--text-muted)",
                }}
              >
                {done ? "✓" : n}
              </div>
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--text)" : "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  headers,
  onChange,
  required,
  noneLabel = "— not mapped —",
  error,
  color,
}: {
  label: string;
  value: string;
  headers: string[];
  onChange: (v: string) => void;
  required?: boolean;
  noneLabel?: string;
  error?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px 1fr",
        alignItems: "start",
        gap: "0.5rem",
        marginBottom: "0.5rem",
      }}
    >
      <label
        style={{
          fontSize: "0.8125rem",
          color: "var(--text-secondary)",
          paddingTop: "0.375rem",
          textAlign: "right",
        }}
      >
        {label}
        {required && <span style={{ color: "var(--red)", marginLeft: "2px" }}>*</span>}
      </label>
      <div>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            maxWidth: "260px",
            borderColor: error ? "var(--red)" : color ? color : undefined,
            borderWidth: color && value ? "2px" : undefined,
            boxShadow: color && value ? `0 0 0 1px ${color}` : undefined,
          }}
        >
          <option value="">{noneLabel}</option>
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        {error && (
          <p style={{ color: "var(--red)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function PreviewTable({
  preview,
  mapping,
}: {
  preview: PreviewResponse;
  mapping: MappingForm;
}) {
  const { headers, rows } = preview;
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "6px" }}>
      <table style={{ minWidth: "max-content" }}>
        <thead>
          <tr>
            {headers.map((h) => {
              const bg = headerColor(h, mapping);
              return (
                <th
                  key={h}
                  style={{
                    background: bg ?? "#f9fafb",
                    fontSize: "0.6875rem",
                    whiteSpace: "nowrap",
                    position: "relative",
                  }}
                >
                  {h}
                  {bg && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.5625rem",
                        fontWeight: 400,
                        color: "var(--text-secondary)",
                        textTransform: "none",
                        letterSpacing: 0,
                      }}
                    >
                      {Object.entries(FIELD_COLORS)
                        .filter(([, c]) => c === bg)
                        .map(([f]) => f.replace("_", " "))
                        .join(" / ")}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {headers.map((h) => {
                const bg = headerColor(h, mapping);
                return (
                  <td
                    key={h}
                    style={{
                      background: bg ? `${bg}66` : undefined,
                      maxWidth: "200px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row[h]}
                  >
                    {row[h] || <span style={{ color: "var(--text-muted)" }}>—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step views
// ─────────────────────────────────────────────────────────────────────────────

function UploadStep({
  onFile,
  error,
  loading,
}: {
  onFile: (f: File) => void;
  error?: string;
  loading: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => ref.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && ref.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border-strong)"}`,
          borderRadius: "var(--radius)",
          padding: "3rem 2rem",
          textAlign: "center",
          cursor: loading ? "wait" : "pointer",
          background: dragging ? "var(--accent-light)" : "var(--bg)",
          transition: "border-color 0.15s, background 0.15s",
          userSelect: "none",
        }}
      >
        <input
          ref={ref}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />

        {loading ? (
          <p style={{ color: "var(--text-secondary)" }}>Parsing CSV…</p>
        ) : (
          <>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "block", margin: "0 auto 0.75rem" }}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
              Drop a CSV file here, or click to browse
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
              Accepted: .csv — your file stays local, nothing is sent until you confirm
            </p>
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem 1rem",
            background: "var(--red-bg)",
            border: "1px solid var(--red-border)",
            borderRadius: "6px",
            fontSize: "0.8125rem",
            color: "var(--red)",
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

export function MappingStep({
  preview,
  mapping,
  setMapping,
  loading,
  error,
  onBack,
  onSubmit,
  mapLabel = "Map columns → fields",
}: {
  preview: PreviewResponse;
  mapping: MappingForm;
  setMapping: React.Dispatch<React.SetStateAction<MappingForm>>;
  loading: boolean;
  error?: string;
  onBack: () => void;
  onSubmit: () => void;
  mapLabel?: string;
}) {
  const [touched, setTouched] = useState(false);
  const errors = touched ? validate(mapping) : {};

  const set = (field: keyof MappingForm) => (val: string) =>
    setMapping((prev) => ({ ...prev, [field]: val }));

  const canSubmit = Object.keys(validate(mapping)).length === 0;

  const handleSubmit = () => {
    setTouched(true);
    if (canSubmit) onSubmit();
  };

  return (
    <div>
      {/* File info bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.625rem 0.875rem",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          marginBottom: "1.25rem",
          fontSize: "0.8125rem",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span style={{ fontWeight: 500, color: "var(--text)" }}>{preview.filename}</span>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span style={{ color: "var(--text-secondary)" }}>
          {preview.total_rows.toLocaleString()} rows
          {preview.total_rows > preview.total_rows_previewed &&
            ` (showing first ${preview.total_rows_previewed})`}
        </span>
        <button
          onClick={onBack}
          style={{ marginLeft: "auto", fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
        >
          Change file
        </button>
      </div>

      <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
        {/* ── Mapping form ─────────────────────────────────────────────── */}
        <div style={{ flex: "0 0 auto", minWidth: "360px" }}>
          <p
            style={{
              fontSize: "0.6875rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-muted)",
              marginBottom: "0.875rem",
            }}
          >
            {mapLabel}
          </p>

          <ColumnSelect
            label="Date"
            required
            value={mapping.posted_date}
            headers={preview.headers}
            onChange={set("posted_date")}
            error={errors.posted_date}
            color={FIELD_COLORS.posted_date}
          />
          <ColumnSelect
            label="Description"
            required
            value={mapping.description_raw}
            headers={preview.headers}
            onChange={set("description_raw")}
            error={errors.description_raw}
            color={FIELD_COLORS.description_raw}
          />

          {/* Amount type toggle */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "150px 1fr",
              gap: "0.5rem",
              marginBottom: "0.75rem",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-secondary)",
                textAlign: "right",
              }}
            >
              Amount format
            </span>
            <div style={{ display: "flex", gap: "1rem" }}>
              {(["single", "split"] as const).map((t) => (
                <label
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    fontSize: "0.8125rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="amount_type"
                    value={t}
                    checked={mapping.amount_type === t}
                    onChange={() => set("amount_type")(t)}
                  />
                  {t === "single" ? "Single column" : "Debit / Credit split"}
                </label>
              ))}
            </div>
          </div>

          {mapping.amount_type === "single" ? (
            <ColumnSelect
              label="Amount"
              required
              value={mapping.amount}
              headers={preview.headers}
              onChange={set("amount")}
              error={errors.amount}
              color={FIELD_COLORS.amount}
            />
          ) : (
            <>
              <ColumnSelect
                label="Debit (outflow)"
                value={mapping.debit}
                headers={preview.headers}
                onChange={set("debit")}
                error={errors.debit}
                color={FIELD_COLORS.debit}
              />
              <ColumnSelect
                label="Credit (inflow)"
                value={mapping.credit}
                headers={preview.headers}
                onChange={set("credit")}
                color={FIELD_COLORS.credit}
              />
            </>
          )}

          {/* Divider */}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              margin: "0.875rem 0",
            }}
          />

          <ColumnSelect
            label="Currency"
            value={mapping.currency}
            headers={preview.headers}
            onChange={set("currency")}
            noneLabel="Default USD"
            color={FIELD_COLORS.currency}
          />
          <ColumnSelect
            label="Merchant"
            value={mapping.merchant}
            headers={preview.headers}
            onChange={set("merchant")}
            noneLabel="Auto-extract from description"
            color={FIELD_COLORS.merchant}
          />
        </div>

        {/* ── Legend ───────────────────────────────────────────────────── */}
        <div style={{ flex: "1 1 auto" }}>
          <p
            style={{
              fontSize: "0.6875rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-muted)",
              marginBottom: "0.875rem",
            }}
          >
            Column colour legend
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {Object.entries(FIELD_COLORS).map(([field, color]) => (
              <span
                key={field}
                style={{
                  padding: "0.25rem 0.625rem",
                  background: color,
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  color: "var(--text-secondary)",
                }}
              >
                {field.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Preview table ─────────────────────────────────────────────── */}
      <div style={{ marginTop: "1.25rem" }}>
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
            marginBottom: "0.5rem",
          }}
        >
          Data preview
        </p>
        <PreviewTable preview={preview} mapping={mapping} />
      </div>

      {/* ── Error + footer ────────────────────────────────────────────── */}
      {error && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1rem",
            background: "var(--red-bg)",
            border: "1px solid var(--red-border)",
            borderRadius: "6px",
            fontSize: "0.8125rem",
            color: "var(--red)",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "0.625rem",
          marginTop: "1.25rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <button onClick={onBack} disabled={loading}>
          ← Back
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            background: canSubmit || touched ? "var(--accent)" : "var(--border-strong)",
            color: canSubmit || touched ? "#fff" : "var(--text-muted)",
            border: "none",
            padding: "0.375rem 1.25rem",
            fontWeight: 600,
          }}
        >
          {loading ? "Importing…" : "Import →"}
        </button>
      </div>
    </div>
  );
}

export function DoneStep({
  result,
  onReset,
}: {
  result: ImportResult;
  onReset: () => void;
}) {
  return (
    <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
      <div
        style={{
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          background: "var(--green-bg)",
          border: "2px solid var(--green-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 1rem",
          fontSize: "1.5rem",
        }}
      >
        ✓
      </div>
      <p style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.375rem" }}>
        Import complete
      </p>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.8125rem", marginBottom: "0.25rem" }}>
        <strong style={{ color: "var(--green)" }}>{result.inserted}</strong> rows inserted
        {result.skipped > 0 && (
          <span style={{ color: "var(--text-muted)" }}>
            {" "}· {result.skipped} skipped (duplicates or blank)
          </span>
        )}
      </p>
      <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "1.5rem" }}>
        Import #{result.id} · {result.filename}
      </p>
      <button
        onClick={onReset}
        style={{
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          padding: "0.5rem 1.5rem",
          fontWeight: 600,
          borderRadius: "6px",
        }}
      >
        Import another file
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  onImportComplete: (result: ImportResult) => void;
}

export default function ImportWizard({ onImportComplete }: Props) {
  const [state, setState] = useState<WizardState>({ step: "upload" });
  const [mapping, setMapping] = useState<MappingForm>({
    posted_date: "",
    description_raw: "",
    amount_type: "single",
    amount: "",
    debit: "",
    credit: "",
    currency: "",
    merchant: "",
  });

  const stepNum =
    state.step === "upload" ? 1
    : state.step === "done" ? 3
    : 2;

  // ── Step 1 → Step 2: upload and preview ─────────────────────────────────
  const handleFile = async (file: File) => {
    setState({ step: "upload", error: undefined });
    // Show loading state inline
    setState({ step: "upload", error: undefined, file });

    try {
      const preview = await previewCSV(file);
      if (!preview.headers.length) throw new Error("CSV appears to be empty or has no headers.");
      const detected = autoDetect(preview.headers);
      setMapping(detected);
      setState({ step: "mapping", file, preview });
    } catch (e: unknown) {
      setState({
        step: "upload",
        error: e instanceof Error ? e.message : "Could not parse CSV.",
      });
    }
  };

  // ── Step 2 → Step 3: submit mapping ─────────────────────────────────────
  const handleSubmit = async () => {
    if (!state.file) return;

    setState((s) => ({ ...s, step: "importing", error: undefined }));

    // Build the ColumnMappingInput (omit empty optional fields)
    const m: ColumnMappingInput = {
      posted_date: mapping.posted_date,
      description_raw: mapping.description_raw,
      amount_type: mapping.amount_type,
      ...(mapping.amount_type === "single"
        ? { amount: mapping.amount }
        : {
            ...(mapping.debit ? { debit: mapping.debit } : {}),
            ...(mapping.credit ? { credit: mapping.credit } : {}),
          }),
      ...(mapping.currency ? { currency: mapping.currency } : {}),
      ...(mapping.merchant ? { merchant: mapping.merchant } : {}),
    };

    try {
      const result = await importCSVWithMapping(state.file, m);
      setState((s) => ({ ...s, step: "done", result }));
      onImportComplete(result);
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        step: "mapping",
        error: e instanceof Error ? e.message : "Import failed.",
      }));
    }
  };

  return (
    <div>
      <StepIndicator current={stepNum} />

      {(state.step === "upload" || !state.step) && (
        <UploadStep
          onFile={handleFile}
          error={state.error}
          loading={!!state.file && state.step === "upload"}
        />
      )}

      {(state.step === "mapping" || state.step === "importing") &&
        state.preview && (
          <MappingStep
            preview={state.preview}
            mapping={mapping}
            setMapping={setMapping}
            loading={state.step === "importing"}
            error={state.error}
            onBack={() => setState({ step: "upload" })}
            onSubmit={handleSubmit}
          />
        )}

      {state.step === "done" && state.result && (
        <DoneStep
          result={state.result}
          onReset={() =>
            setState({
              step: "upload",
              file: undefined,
              preview: undefined,
              result: undefined,
            })
          }
        />
      )}
    </div>
  );
}
