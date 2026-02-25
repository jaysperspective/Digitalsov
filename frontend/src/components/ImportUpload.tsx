import { DragEvent, useRef, useState } from "react";
import { uploadCSV } from "../api/client";
import type { ImportResult } from "../types";

interface Props {
  onImportComplete: (result: ImportResult) => void;
}

const SOURCE_TYPES = [
  { value: "generic", label: "Generic (auto-detect)" },
  { value: "chase", label: "Chase" },
  { value: "bofa", label: "Bank of America" },
  { value: "amex", label: "American Express" },
];

export default function ImportUpload({ onImportComplete }: Props) {
  const [dragging, setDragging] = useState(false);
  const [sourceType, setSourceType] = useState("generic");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await uploadCSV(file, sourceType);
      setResult(res);
      onImportComplete(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
      // Reset input so the same file can be re-uploaded
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div>
      {/* Source type selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <label
          htmlFor="source-type"
          style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", flexShrink: 0 }}
        >
          Bank format:
        </label>
        <select
          id="source-type"
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
        >
          {SOURCE_TYPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border-strong)"}`,
          borderRadius: "var(--radius)",
          padding: "2.5rem 1.5rem",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? "var(--accent-light)" : "var(--bg)",
          transition: "border-color 0.15s, background 0.15s",
          userSelect: "none",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {loading ? (
          <p style={{ color: "var(--text-secondary)" }}>Importing…</p>
        ) : (
          <>
            <p style={{ fontWeight: 500 }}>Drop a CSV here, or click to browse</p>
            <p style={{ color: "var(--text-muted)", marginTop: "0.25rem", fontSize: "0.75rem" }}>
              Accepts .csv files exported from your bank
            </p>
          </>
        )}
      </div>

      {/* Error banner */}
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

      {/* Success banner */}
      {result && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem 1rem",
            background: "var(--green-bg)",
            border: "1px solid var(--green-border)",
            borderRadius: "6px",
            fontSize: "0.8125rem",
            color: "var(--green)",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}
        >
          <span>
            <strong>{result.filename}</strong>
            <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
              Import #{result.id} · {result.source_type}
            </span>
          </span>
          <span>
            <strong>{result.inserted}</strong> rows inserted
            {result.skipped > 0 && (
              <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                · {result.skipped} skipped (duplicates / blank rows)
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
