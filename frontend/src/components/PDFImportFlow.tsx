/**
 * PDFImportFlow — 4-step PDF import:
 *   1. Upload  → drag/drop PDF → POST /imports/pdf/preview
 *   2. Extract → spinner while backend tries table extraction
 *   3a. Map    → tables found: same column-mapping UI as CSV wizard
 *   3b. Manual → no tables found: paste-as-CSV OR switch to CSV import
 *   4. Done    → success summary
 */

import { DragEvent, useRef, useState } from "react";
import { importCSVWithMapping, importPDFWithMapping, previewCSV, previewPDF } from "../api/client";
import type { ColumnMappingInput, ImportResult, PDFPreviewSuccess, PreviewResponse } from "../types";
import {
  DoneStep,
  MappingForm,
  MappingStep,
  StepIndicator,
  autoDetect,
  validate,
} from "./ImportWizard";

// ── Types ─────────────────────────────────────────────────────────────────────

type PDFStep =
  | "upload"
  | "extracting"
  | "mapping"       // tables found → column mapping
  | "needs_manual"  // no tables found → paste / switch to CSV
  | "parsing_paste" // parsing pasted text
  | "paste_mapping" // pasted text parsed → column mapping
  | "importing"
  | "done";

interface PDFState {
  step: PDFStep;
  file?: File;
  pages?: number;
  pdfPreview?: PDFPreviewSuccess;          // extraction succeeded
  csvPreview?: PreviewResponse;            // from pasted text or pdf-as-csv
  pasteFile?: File;                        // synthetic file from pasted text
  failReason?: string;                     // extraction failure message
  result?: ImportResult;
  error?: string;
}

// ── Step labels for the indicator ─────────────────────────────────────────────

const PDF_STEPS = ["Upload", "Extract", "Map Columns", "Done"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a PreviewResponse from a successful PDF extraction so MappingStep can
 *  consume it without knowing the source was PDF. */
function pdfPreviewToCSVShape(p: PDFPreviewSuccess): PreviewResponse {
  return {
    filename: p.filename,
    headers: p.headers,
    rows: p.rows,
    total_rows_previewed: p.rows.length,
    total_rows: p.total_rows,
  };
}

function buildMapping(mapping: MappingForm): ColumnMappingInput {
  return {
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
}

// ── Upload drop zone ──────────────────────────────────────────────────────────

function PDFDropZone({
  onFile,
  loading,
  error,
}: {
  onFile: (f: File) => void;
  loading: boolean;
  error?: string;
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
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
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
          accept=".pdf,.txt"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        {loading ? (
          <p style={{ color: "var(--text-secondary)" }}>Extracting transactions…</p>
        ) : (
          <>
            {/* Document icon */}
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "block", margin: "0 auto 0.75rem" }}
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="15" y2="17" />
              <polyline points="9 9 10 9" />
            </svg>
            <p style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
              Drop a bank statement here, or click to browse
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
              Accepted: .pdf · .txt — transactions are extracted automatically
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

// ── Needs-manual step ─────────────────────────────────────────────────────────

function NeedsManualStep({
  filename,
  pages,
  reason,
  onBack,
  onSwitchToCSV,
  onParsePaste,
}: {
  filename: string;
  pages: number;
  reason: string;
  onBack: () => void;
  onSwitchToCSV: () => void;
  onParsePaste: (text: string) => void;
}) {
  const [pasteText, setPasteText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const handleParse = () => {
    setParseError(null);
    const lines = pasteText.trim().split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      setParseError("Need at least a header row and one data row.");
      return;
    }
    onParsePaste(pasteText.trim());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Failure notice */}
      <div
        style={{
          padding: "1rem 1.25rem",
          background: "var(--surface-raised)",
          border: "1px solid #f9731644",
          borderLeft: "4px solid #f97316",
          borderRadius: "var(--radius)",
        }}
      >
        <p style={{ fontWeight: 600, color: "#f97316", marginBottom: "0.4rem", fontSize: "0.875rem" }}>
          Could not extract tables from this PDF
        </p>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
          {reason}
        </p>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          <strong>{filename}</strong>
          {pages > 0 && ` · ${pages} page${pages !== 1 ? "s" : ""}`}
        </p>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
          Common causes: scanned/image-only PDF · encrypted file ·
          non-standard layout that uses whitespace instead of ruled tables
        </p>
      </div>

      {/* Option 1: paste as CSV */}
      <div
        style={{
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "1rem 1.25rem",
        }}
      >
        <p style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
          Option 1 — Paste transactions as CSV
        </p>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "0.625rem" }}>
          Copy the transaction data from your bank's website or another source and paste it below.
          Comma, tab, or semicolon-separated formats are accepted.
        </p>
        <textarea
          rows={8}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={`Date,Description,Amount\n2026-01-15,AMAZON.COM,-42.99\n2026-01-16,STARBUCKS,-5.50`}
          style={{
            width: "100%",
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            padding: "0.625rem",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "var(--text)",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        {parseError && (
          <p style={{ color: "var(--red)", fontSize: "0.75rem", marginTop: "0.375rem" }}>
            {parseError}
          </p>
        )}
        <button
          onClick={handleParse}
          disabled={!pasteText.trim()}
          style={{ marginTop: "0.625rem", padding: "0.375rem 1rem" }}
        >
          Parse &amp; Map Columns →
        </button>
      </div>

      {/* Option 2: switch to CSV upload */}
      <div
        style={{
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "1rem 1.25rem",
        }}
      >
        <p style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "0.625rem" }}>
          Option 2 — Upload a CSV export instead
        </p>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "0.625rem" }}>
          Most banks offer a CSV or Excel download in their online portal
          (look for "Download transactions" or "Export").
        </p>
        <button
          onClick={onSwitchToCSV}
          style={{ padding: "0.375rem 1rem", background: "var(--accent)", color: "#fff", border: "none" }}
        >
          Switch to CSV Import
        </button>
      </div>

      <div>
        <button onClick={onBack} style={{ fontSize: "0.8125rem", padding: "0.25rem 0.75rem" }}>
          ← Try another PDF
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  onImportComplete: (result: ImportResult) => void;
  onSwitchToCSV: () => void;
}

export default function PDFImportFlow({ onImportComplete, onSwitchToCSV }: Props) {
  const [state, setState] = useState<PDFState>({ step: "upload" });
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
    state.step === "upload" || state.step === "extracting" ? 1
    : state.step === "needs_manual" || state.step === "parsing_paste" ? 2
    : state.step === "mapping" || state.step === "paste_mapping" || state.step === "importing" ? 3
    : 4;

  // ── Step 1: upload PDF and attempt extraction ─────────────────────────────
  const handleFile = async (file: File) => {
    setState({ step: "extracting", file });
    try {
      const result = await previewPDF(file);
      if (result.status === "preview") {
        const detected = autoDetect(result.headers);
        setMapping(detected);
        setState({ step: "mapping", file, pages: result.pages, pdfPreview: result });
      } else {
        setState({
          step: "needs_manual",
          file,
          pages: result.pages,
          failReason: result.reason,
        });
      }
    } catch (e: unknown) {
      setState({
        step: "upload",
        error: e instanceof Error ? e.message : "Could not contact the server.",
      });
    }
  };

  // ── Paste path: parse pasted text as CSV ─────────────────────────────────
  const handleParsePaste = async (text: string) => {
    setState((s) => ({ ...s, step: "parsing_paste", error: undefined }));
    const blob = new Blob([text], { type: "text/csv" });
    const syntheticFile = new File([blob], "pasted-transactions.csv", { type: "text/csv" });
    try {
      const preview = await previewCSV(syntheticFile);
      if (!preview.headers.length) throw new Error("No headers found in pasted text.");
      const detected = autoDetect(preview.headers);
      setMapping(detected);
      setState((s) => ({ ...s, step: "paste_mapping", csvPreview: preview, pasteFile: syntheticFile }));
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        step: "needs_manual",
        error: e instanceof Error ? e.message : "Could not parse the pasted text as CSV.",
      }));
    }
  };

  // ── Submit mapping (PDF path) ─────────────────────────────────────────────
  const handleSubmitPDF = async () => {
    if (!state.file || !state.pdfPreview) return;
    if (Object.keys(validate(mapping)).length > 0) return;
    setState((s) => ({ ...s, step: "importing", error: undefined }));
    try {
      const result = await importPDFWithMapping(state.file, buildMapping(mapping));
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

  // ── Submit mapping (paste path) ───────────────────────────────────────────
  const handleSubmitPaste = async () => {
    if (!state.pasteFile) return;
    if (Object.keys(validate(mapping)).length > 0) return;
    setState((s) => ({ ...s, step: "importing", error: undefined }));
    try {
      const result = await importCSVWithMapping(state.pasteFile, buildMapping(mapping));
      setState((s) => ({ ...s, step: "done", result }));
      onImportComplete(result);
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        step: "paste_mapping",
        error: e instanceof Error ? e.message : "Import failed.",
      }));
    }
  };

  const reset = () => {
    setState({ step: "upload" });
    setMapping({ posted_date: "", description_raw: "", amount_type: "single", amount: "", debit: "", credit: "", currency: "", merchant: "" });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <StepIndicator current={stepNum} steps={PDF_STEPS} />

      {/* Step 1: upload / extracting */}
      {(state.step === "upload" || state.step === "extracting") && (
        <PDFDropZone
          onFile={handleFile}
          loading={state.step === "extracting"}
          error={state.error}
        />
      )}

      {/* Step 2: needs manual */}
      {(state.step === "needs_manual" || state.step === "parsing_paste") &&
        state.file && (
          <NeedsManualStep
            filename={state.file.name}
            pages={state.pages ?? 0}
            reason={state.failReason ?? "Table extraction returned no data."}
            onBack={reset}
            onSwitchToCSV={onSwitchToCSV}
            onParsePaste={handleParsePaste}
          />
        )}

      {/* Step 3a: PDF mapping */}
      {(state.step === "mapping" || (state.step === "importing" && state.pdfPreview)) &&
        state.pdfPreview && (
          <MappingStep
            preview={pdfPreviewToCSVShape(state.pdfPreview)}
            mapping={mapping}
            setMapping={setMapping}
            loading={state.step === "importing"}
            error={state.error}
            mapLabel={`Map PDF columns → fields  ·  ${state.pages} page${state.pages !== 1 ? "s" : ""}  ·  ${state.pdfPreview.total_rows} rows extracted`}
            onBack={reset}
            onSubmit={handleSubmitPDF}
          />
        )}

      {/* Step 3b: paste mapping */}
      {(state.step === "paste_mapping" || (state.step === "importing" && state.csvPreview)) &&
        state.csvPreview && (
          <MappingStep
            preview={state.csvPreview}
            mapping={mapping}
            setMapping={setMapping}
            loading={state.step === "importing"}
            error={state.error}
            mapLabel="Map pasted CSV columns → fields"
            onBack={() => setState((s) => ({ ...s, step: "needs_manual" }))}
            onSubmit={handleSubmitPaste}
          />
        )}

      {/* Step 4: done */}
      {state.step === "done" && state.result && (
        <DoneStep result={state.result} onReset={reset} />
      )}
    </div>
  );
}
