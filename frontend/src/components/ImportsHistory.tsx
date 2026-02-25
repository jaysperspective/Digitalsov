/**
 * ImportsHistory — shows all imported documents and lets the user
 * assign an account label and type (checking / savings / credit card).
 */

import { useEffect, useState } from "react";
import { deleteImport, listImports, patchImportLabel } from "../api/client";
import type { ImportRecord } from "../types";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit Card" },
];

const TYPE_COLORS: Record<string, string> = {
  checking: "#3b82f6",
  savings:  "#22c55e",
  credit:   "#f97316",
};

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>—</span>;
  const label = ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "0.6875rem",
        fontWeight: 600,
        padding: "0.15rem 0.5rem",
        borderRadius: 9999,
        background: (TYPE_COLORS[type] ?? "#64748b") + "22",
        color: TYPE_COLORS[type] ?? "#94a3b8",
        border: `1px solid ${(TYPE_COLORS[type] ?? "#64748b")}44`,
      }}
    >
      {label}
    </span>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Row with inline editing ────────────────────────────────────────────────────

function ImportRow({
  record,
  onUpdated,
  onDeleted,
  isLast,
}: {
  record: ImportRecord;
  onUpdated: (updated: ImportRecord) => void;
  onDeleted: (id: number) => void;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [label, setLabel] = useState(record.account_label ?? "");
  const [type, setType] = useState(record.account_type ?? "");
  const [notes, setNotes] = useState(record.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const updated = await patchImportLabel(record.id, {
        account_label: label.trim() || null,
        account_type: type || null,
        notes: notes.trim() || null,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setLabel(record.account_label ?? "");
    setType(record.account_type ?? "");
    setNotes(record.notes ?? "");
    setEditing(false);
    setErr(null);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setErr(null);
    try {
      await deleteImport(record.id);
      onDeleted(record.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <tr style={{ borderBottom: isLast ? "none" : "1px solid var(--border)" }}>
      {/* Filename */}
      <td style={{ padding: "0.625rem 0.75rem", color: "var(--text-secondary)", fontSize: "0.8125rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {record.filename}
      </td>

      {/* Account label */}
      <td style={{ padding: "0.625rem 0.75rem" }}>
        {editing ? (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Checking ·1654"
            style={{ fontSize: "0.8125rem", padding: "0.2rem 0.5rem", width: 160 }}
            autoFocus
          />
        ) : (
          <span style={{ fontSize: "0.8125rem", color: record.account_label ? "var(--text-primary)" : "var(--text-muted)" }}>
            {record.account_label ?? "—"}
          </span>
        )}
      </td>

      {/* Account type */}
      <td style={{ padding: "0.625rem 0.75rem" }}>
        {editing ? (
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ fontSize: "0.8125rem", padding: "0.2rem 0.5rem" }}
          >
            <option value="">None</option>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        ) : (
          <TypeBadge type={record.account_type} />
        )}
      </td>

      {/* Notes */}
      <td style={{ padding: "0.625rem 0.75rem", maxWidth: 180 }}>
        {editing ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes…"
            rows={2}
            style={{ fontSize: "0.8125rem", padding: "0.2rem 0.5rem", width: "100%", resize: "vertical" }}
          />
        ) : record.notes ? (
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", maxWidth: 160 }} title={record.notes}>
            {record.notes}
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>—</span>
        )}
      </td>

      {/* Date imported */}
      <td style={{ padding: "0.625rem 0.75rem", fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
        {fmtDate(record.created_at)}
      </td>

      {/* Transaction count */}
      <td style={{ padding: "0.625rem 0.75rem", fontSize: "0.8125rem", color: "var(--text-secondary)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
        {record.transaction_count.toLocaleString()}
      </td>

      {/* Actions */}
      <td style={{ padding: "0.625rem 0.75rem", textAlign: "right", whiteSpace: "nowrap" }}>
        {confirmDelete ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--red)", marginRight: "0.25rem" }}>
              Delete {record.transaction_count} transactions?
            </span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.625rem", background: "var(--red)", color: "#fff", border: "none" }}
            >
              {deleting ? "…" : "Confirm"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
            >
              Cancel
            </button>
          </span>
        ) : editing ? (
          <span style={{ display: "inline-flex", gap: "0.375rem" }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.625rem", background: "var(--accent)", color: "#fff", border: "none" }}
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
            >
              Cancel
            </button>
          </span>
        ) : (
          <span style={{ display: "inline-flex", gap: "0.375rem" }}>
            <button
              onClick={() => setEditing(true)}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.625rem" }}
            >
              Edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "var(--red)", border: "1px solid var(--red-border)", background: "transparent" }}
            >
              Delete
            </button>
          </span>
        )}
        {err && <p style={{ color: "var(--red)", fontSize: "0.7rem", marginTop: 2 }}>{err}</p>}
      </td>
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const ALL_TYPES = [
  { value: "", label: "All" },
  ...ACCOUNT_TYPES,
  { value: "__none__", label: "Untagged" },
];

export default function ImportsHistory({ refreshKey }: { refreshKey: number }) {
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("");

  useEffect(() => {
    setLoading(true);
    listImports()
      .then(setRecords)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const handleUpdated = (updated: ImportRecord) => {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleDeleted = (id: number) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const filtered = records.filter((r) => {
    if (!filterType) return true;
    if (filterType === "__none__") return !r.account_type;
    return r.account_type === filterType;
  });

  if (loading) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", padding: "1rem 0" }}>
        Loading imports…
      </p>
    );
  }

  if (error) {
    return <p style={{ color: "var(--red)", fontSize: "0.8125rem" }}>{error}</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {/* Header + filter */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)" }}>
          Imported Documents
        </p>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {records.length} file{records.length !== 1 ? "s" : ""}
        </span>
        <div style={{ flex: 1 }} />
        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {ALL_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilterType(t.value)}
              style={{
                fontSize: "0.75rem",
                padding: "0.2rem 0.625rem",
                background: filterType === t.value ? "var(--accent)" : "transparent",
                color: filterType === t.value ? "#fff" : "var(--text-secondary)",
                border: `1px solid ${filterType === t.value ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", padding: "1rem 0" }}>
          {records.length === 0 ? "No files imported yet." : "No files match this filter."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["File", "Account Label", "Type", "Notes", "Imported", "Transactions", ""].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "0.5rem 0.75rem",
                      textAlign: h === "Transactions" || h === "" ? "right" : "left",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--text-muted)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <ImportRow
                  key={r.id}
                  record={r}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                  isLast={i === filtered.length - 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
