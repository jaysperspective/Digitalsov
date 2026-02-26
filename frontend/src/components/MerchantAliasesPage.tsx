import { useState } from "react";
import {
  createMerchantAlias,
  deleteMerchantAlias,
  rebuildCanonicalMerchants,
  updateMerchantAlias,
} from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { MerchantAlias } from "../types";

export default function MerchantAliasesPage() {
  const { merchantAliases: aliases, refreshAliases, bump } = useFinance();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Add form
  const [newAlias, setNewAlias] = useState("");
  const [newCanonical, setNewCanonical] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<number | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editCanonical, setEditCanonical] = useState("");
  const [saving, setSaving] = useState(false);

  // Rebuild state
  const [rebuilding, setRebuilding] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleAdd = async () => {
    const alias = newAlias.trim();
    const canonical = newCanonical.trim();
    if (!alias || !canonical) return;
    setAdding(true);
    try {
      await createMerchantAlias({ alias, canonical });
      setNewAlias("");
      setNewCanonical("");
      showToast("Alias added.");
      await refreshAliases();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (alias: MerchantAlias) => {
    setEditId(alias.id);
    setEditAlias(alias.alias);
    setEditCanonical(alias.canonical);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditAlias("");
    setEditCanonical("");
  };

  const handleSave = async () => {
    if (editId === null) return;
    const alias = editAlias.trim();
    const canonical = editCanonical.trim();
    if (!alias || !canonical) return;
    setSaving(true);
    try {
      await updateMerchantAlias(editId, { alias, canonical });
      cancelEdit();
      showToast("Alias updated.");
      await refreshAliases();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMerchantAlias(id);
      showToast("Alias deleted.");
      await refreshAliases();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const result = await rebuildCanonicalMerchants();
      showToast(`Rebuilt: ${result.updated} of ${result.total} transactions updated.`);
      await refreshAliases();
      bump();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to rebuild");
    } finally {
      setRebuilding(false);
    }
  };

  const tdStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    fontSize: "0.8125rem",
    borderTop: "1px solid var(--border)",
    verticalAlign: "middle",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            background: "var(--green)",
            color: "#fff",
            padding: "0.5rem 1rem",
            borderRadius: "var(--radius)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            alignSelf: "flex-start",
          }}
        >
          {toast}
        </div>
      )}

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text)", margin: 0 }}>
            Merchant Aliases
          </h2>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Map raw merchant names to canonical display names for better grouping and AI queries.
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            style={{
              fontSize: "0.8125rem",
              padding: "0.3rem 0.875rem",
              background: "var(--surface-raised)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {rebuilding ? "Rebuilding…" : "⟳ Rebuild canonical merchants"}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "0.8125rem" }}>{error}</p>
      )}

      {/* Add form */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-end",
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0.875rem 1rem",
        }}
      >
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Alias (raw)
          </label>
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            placeholder="e.g. AMZN"
            style={{ fontSize: "0.875rem", padding: "0.3rem 0.5rem", width: "100%" }}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
        </div>
        <div style={{ alignSelf: "center", fontSize: "1rem", color: "var(--text-muted)", paddingBottom: "0.1rem" }}>→</div>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Canonical name
          </label>
          <input
            value={newCanonical}
            onChange={(e) => setNewCanonical(e.target.value)}
            placeholder="e.g. Amazon"
            style={{ fontSize: "0.875rem", padding: "0.3rem 0.5rem", width: "100%" }}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={adding || !newAlias.trim() || !newCanonical.trim()}
          style={{
            background: "var(--accent)",
            color: "#fff",
            borderColor: "transparent",
            padding: "0.3rem 1rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
          }}
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </div>

      {/* Alias table */}
      {aliases.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            color: "var(--text-muted)",
            padding: "3rem",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
          }}
        >
          No aliases yet. Add one above to start canonicalizing merchant names.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>
                  Alias (raw)
                </th>
                <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>
                  Canonical name
                </th>
                <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>
                  Created
                </th>
                <th style={{ padding: "0.375rem 0.75rem" }} />
              </tr>
            </thead>
            <tbody>
              {aliases.map((a) =>
                editId === a.id ? (
                  <tr key={a.id}>
                    <td style={tdStyle}>
                      <input
                        value={editAlias}
                        onChange={(e) => setEditAlias(e.target.value)}
                        style={{ fontSize: "0.875rem", padding: "0.2rem 0.4rem", width: "100%" }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={editCanonical}
                        onChange={(e) => setEditCanonical(e.target.value)}
                        style={{ fontSize: "0.875rem", padding: "0.2rem 0.4rem", width: "100%" }}
                      />
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)", fontSize: "0.75rem" }}>
                      {new Date(a.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.625rem",
                          background: "var(--accent)",
                          color: "#fff",
                          border: "none",
                          marginRight: "0.375rem",
                        }}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={cancelEdit}
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.625rem",
                          background: "transparent",
                          color: "var(--text-muted)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={a.id}>
                    <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                      {a.alias}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text)" }}>
                      {a.canonical}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)", fontSize: "0.75rem" }}>
                      {new Date(a.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => startEdit(a)}
                        title="Edit"
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.5rem",
                          background: "transparent",
                          color: "var(--text-muted)",
                          border: "1px solid var(--border)",
                          marginRight: "0.375rem",
                        }}
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
                        title="Delete"
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.5rem",
                          background: "transparent",
                          color: "var(--red)",
                          border: "1px solid var(--red)44",
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
