import { useState } from "react";
import { createTag, deleteTag, updateTag } from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { Tag } from "../types";

const PRESET_COLORS = [
  "#6366f1", "#22d3ee", "#f59e0b", "#f87171", "#4ade80",
  "#a855f7", "#fb923c", "#34d399", "#60a5fa", "#e879f9",
];

function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "10px",
        height: "10px",
        borderRadius: "50%",
        background: color ?? "var(--text-muted)",
        border: "1px solid rgba(255,255,255,0.15)",
        flexShrink: 0,
      }}
    />
  );
}

function TagRow({
  tag,
  onUpdated,
  onDeleted,
}: {
  tag: Tag;
  onUpdated: (updated: Tag) => void;
  onDeleted: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<string>(tag.color ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const updated = await updateTag(tag.id, { name: name.trim(), color: color || null });
      onUpdated(updated);
      setEditing(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete tag "${tag.name}"? This will remove it from all transactions.`)) return;
    setDeleting(true);
    try {
      await deleteTag(tag.id);
      onDeleted(tag.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to delete");
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={3}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ fontSize: "0.8125rem", padding: "0.25rem 0.375rem", width: "160px" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
              <input
                type="color"
                value={color || "#6366f1"}
                onChange={(e) => setColor(e.target.value)}
                style={{ width: "28px", height: "24px", padding: "0", border: "1px solid var(--border)", cursor: "pointer" }}
              />
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    background: c,
                    border: color === c ? "2px solid var(--text-primary)" : "1px solid transparent",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", background: "var(--accent)", color: "#fff", border: "none" }}
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setName(tag.name); setColor(tag.color ?? ""); }}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              Cancel
            </button>
            {err && <span style={{ fontSize: "0.7rem", color: "var(--red)" }}>{err}</span>}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <ColorDot color={tag.color} />
          <span
            style={{
              padding: "0.1rem 0.5rem",
              borderRadius: "9999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: (tag.color ?? "#94a3b8") + "22",
              color: tag.color ?? "var(--text-secondary)",
              border: `1px solid ${(tag.color ?? "#94a3b8")}44`,
            }}
          >
            {tag.name}
          </span>
        </span>
      </td>
      <td style={{ color: "var(--text-muted)", fontSize: "0.75rem", ...mono }}>{tag.color ?? "—"}</td>
      <td>
        <div style={{ display: "flex", gap: "0.375rem" }}>
          <button
            onClick={() => setEditing(true)}
            style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", background: "transparent", border: "1px solid rgba(248,73,96,0.3)", color: "var(--red)" }}
          >
            {deleting ? "…" : "Delete"}
          </button>
        </div>
        {err && <span style={{ fontSize: "0.7rem", color: "var(--red)", display: "block", marginTop: "0.2rem" }}>{err}</span>}
      </td>
    </tr>
  );
}

export default function TagsPage() {
  const { tags, refreshTags } = useFinance();

  // New tag form
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateErr(null);
    try {
      await createTag({ name, color: newColor || null });
      setNewName("");
      await refreshTags();
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem", ...mono }}>Tags</h2>

      {/* Create form */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0.875rem",
          marginBottom: "1.25rem",
          background: "var(--surface-raised)",
        }}
      >
        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: "0.5rem", ...mono }}>
          NEW TAG
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Tag name…"
            style={{ fontSize: "0.8125rem", padding: "0.25rem 0.375rem", width: "180px" }}
          />
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            style={{ width: "32px", height: "28px", padding: "0", border: "1px solid var(--border)", cursor: "pointer" }}
          />
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  background: c,
                  border: newColor === c ? "2px solid var(--text-primary)" : "1px solid transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            style={{ fontSize: "0.8125rem", padding: "0.25rem 0.75rem", background: "var(--accent)", color: "#fff", border: "none", fontWeight: 600 }}
          >
            {creating ? "Adding…" : "+ Add Tag"}
          </button>
        </div>
        {createErr && <p style={{ fontSize: "0.75rem", color: "var(--red)", marginTop: "0.375rem" }}>{createErr}</p>}
      </div>

      {/* Tag list */}
      {tags.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          No tags yet. Create one above to start tagging transactions.
        </div>
      )}
      {tags.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Tag</th>
                <th>Color</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  onUpdated={() => refreshTags()}
                  onDeleted={() => refreshTags()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
