/**
 * PayPalImportFlow — single-step PayPal CSV import.
 *
 * PayPal's CSV export has a fixed, well-known column layout so no column
 * mapping wizard is needed.  The user just drops the file and it imports.
 *
 * Steps: upload → importing → done
 */

import { DragEvent, useRef, useState } from "react";
import { importPayPalCSV } from "../api/client";
import type { ImportResult } from "../types";

type Step = "upload" | "importing" | "done";

interface State {
  step: Step;
  file?: File;
  result?: ImportResult;
  error?: string;
}

interface Props {
  onImportComplete: (result: ImportResult) => void;
}

export default function PayPalImportFlow({ onImportComplete }: Props) {
  const [state, setState] = useState<State>({ step: "upload" });
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── File selection ─────────────────────────────────────────────────────────

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setState((s) => ({ ...s, error: "Please select a .csv file exported from PayPal." }));
      return;
    }
    doImport(file);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave() {
    setDragging(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  async function doImport(file: File) {
    setState({ step: "importing", file });
    try {
      const result = await importPayPalCSV(file);
      setState({ step: "done", file, result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ step: "upload", error: msg });
    }
  }

  function reset() {
    setState({ step: "upload" });
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (state.step === "done" && state.result) {
    const r = state.result;
    return (
      <div style={{ maxWidth: 480 }}>
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--text-muted)",
            marginBottom: "1rem",
          }}
        >
          PayPal Import — Done
        </p>

        <div
          style={{
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.25)",
            borderRadius: "var(--radius)",
            padding: "1.25rem 1.5rem",
            marginBottom: "1rem",
          }}
        >
          <p style={{ fontWeight: 600, color: "#22c55e", marginBottom: "0.5rem" }}>
            Import complete
          </p>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text)" }}>{r.inserted}</strong> transactions inserted
            &nbsp;·&nbsp;
            <strong style={{ color: "var(--text-muted)" }}>{r.skipped}</strong> skipped (duplicates
            or non-purchase rows)
          </p>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.375rem" }}>
            {r.filename}
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => onImportComplete(r)}
            style={{
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "0.5rem 1.25rem",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Go to Dashboard
          </button>
          <button
            onClick={reset}
            style={{
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "0.5rem 1.25rem",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Import another
          </button>
        </div>
      </div>
    );
  }

  if (state.step === "importing") {
    return (
      <div style={{ maxWidth: 480 }}>
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--text-muted)",
            marginBottom: "1rem",
          }}
        >
          PayPal Import
        </p>
        <div
          style={{
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius)",
            padding: "2.5rem",
            textAlign: "center",
            color: "var(--text-muted)",
          }}
        >
          <p style={{ marginBottom: "0.5rem" }}>Importing {state.file?.name}…</p>
          <p style={{ fontSize: "0.8125rem" }}>
            Filtering to completed payments and deduplicating…
          </p>
        </div>
      </div>
    );
  }

  // upload step
  return (
    <div style={{ maxWidth: 480 }}>
      <p
        style={{
          fontSize: "0.6875rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--text-muted)",
          marginBottom: "0.5rem",
        }}
      >
        PayPal CSV Import
      </p>
      <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
        Export your activity from PayPal → Activity → Statements → Download, then drop the .csv
        file below. No column mapping needed — PayPal's format is detected automatically.
        Duplicate rows across overlapping exports are skipped automatically.
      </p>

      {state.error && (
        <p
          style={{
            background: "var(--red-bg)",
            border: "1px solid var(--red-border)",
            color: "var(--red)",
            fontSize: "0.8125rem",
            padding: "0.625rem 0.875rem",
            borderRadius: "var(--radius)",
            marginBottom: "1rem",
          }}
        >
          {state.error}
        </p>
      )}

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
          borderRadius: "var(--radius)",
          padding: "2.5rem",
          textAlign: "center",
          cursor: "pointer",
          transition: "border-color 0.15s",
          background: dragging ? "rgba(99,102,241,0.04)" : "transparent",
        }}
      >
        <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🅿️</p>
        <p style={{ fontWeight: 500, marginBottom: "0.25rem" }}>Drop your PayPal CSV here</p>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          or click to browse
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
