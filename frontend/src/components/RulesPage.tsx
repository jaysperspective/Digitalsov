import { useState } from "react";
import {
  applyRules,
  createRule,
  deleteRule,
  updateRule,
} from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { ApplyRulesResponse, Category, MatchType, RuleCreate } from "../types";

const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  contains: "Contains",
  exact: "Exact",
  regex: "Regex",
};

interface RuleFormState {
  pattern: string;
  match_type: MatchType;
  category_id: number | "";
  priority: number;
  is_active: boolean;
}

const EMPTY_FORM: RuleFormState = {
  pattern: "",
  match_type: "contains",
  category_id: "",
  priority: 50,
  is_active: true,
};

interface RuleFormProps {
  initial?: RuleFormState;
  categories: Category[];
  onSave: (f: RuleFormState) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function RuleForm({ initial = EMPTY_FORM, categories, onSave, onCancel, saving }: RuleFormProps) {
  const [form, setForm] = useState<RuleFormState>(initial);

  const set = <K extends keyof RuleFormState>(key: K) =>
    (val: RuleFormState[K]) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.pattern.trim() || form.category_id === "") return;
    onSave({ ...form, pattern: form.pattern.trim() });
  };

  const isValid = form.pattern.trim() !== "" && form.category_id !== "";

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
            Pattern
          </label>
          <input
            autoFocus
            value={form.pattern}
            onChange={(e) => set("pattern")(e.target.value)}
            placeholder="e.g. amazon, ^AMZN, whole foods"
            style={{ width: "100%" }}
          />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
            Match Type
          </label>
          <select
            value={form.match_type}
            onChange={(e) => set("match_type")(e.target.value as MatchType)}
            style={{ width: "100%" }}
          >
            <option value="contains">Contains</option>
            <option value="exact">Exact</option>
            <option value="regex">Regex</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
            Category
          </label>
          <select
            value={form.category_id}
            onChange={(e) => set("category_id")(e.target.value === "" ? "" : Number(e.target.value))}
            style={{ width: "100%" }}
          >
            <option value="">— Select —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
            Priority (higher = checked first)
          </label>
          <input
            type="number"
            min={0}
            max={999}
            value={form.priority}
            onChange={(e) => set("priority")(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "0.375rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set("is_active")(e.target.checked)}
            />
            Active
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button type="submit" disabled={saving || !isValid}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} style={{ background: "transparent", border: "1px solid var(--border)" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function RulesPage() {
  const { categories, rules, refreshRules, bump } = useFinance();
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyRulesResponse | null>(null);
  const [applying, setApplying] = useState(false);

  const toPayload = (form: RuleFormState): RuleCreate => ({
    pattern: form.pattern,
    match_type: form.match_type,
    category_id: form.category_id as number,
    priority: form.priority,
    is_active: form.is_active,
  });

  const handleAdd = async (form: RuleFormState) => {
    setSaving(true);
    try {
      await createRule(toPayload(form));
      setShowAddForm(false);
      await refreshRules();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (id: number, form: RuleFormState) => {
    setSaving(true);
    try {
      await updateRule(id, toPayload(form));
      setEditId(null);
      await refreshRules();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setSaving(true);
    try {
      await deleteRule(id);
      setDeleteConfirm(null);
      await refreshRules();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setApplyResult(null);
    setError(null);
    try {
      const res = await applyRules();
      setApplyResult(res);
      await refreshRules();
      bump();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to apply rules");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.8125rem" }}>
          {rules.length} rules
        </span>
        <div style={{ flexGrow: 1 }} />
        <button
          onClick={handleApply}
          disabled={applying}
          style={{ background: "var(--accent)", color: "#fff", borderColor: "transparent" }}
        >
          {applying ? "Applying…" : "Apply All Rules"}
        </button>
        <button onClick={() => { setShowAddForm(true); setEditId(null); }} disabled={showAddForm}>
          + Add Rule
        </button>
      </div>

      {applyResult && (
        <div
          style={{
            background: "var(--green-bg, #052e16)",
            border: "1px solid var(--green-border, #166534)",
            borderRadius: "var(--radius)",
            padding: "0.625rem 1rem",
            fontSize: "0.8125rem",
            color: "var(--green, #86efac)",
            marginBottom: "0.75rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Rules applied — <strong>{applyResult.updated}</strong> updated, <strong>{applyResult.unchanged}</strong> unchanged (
            {applyResult.total} total)
          </span>
          <button
            onClick={() => setApplyResult(null)}
            style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: "1rem" }}
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <p style={{ color: "var(--red)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{error}</p>
      )}

      {showAddForm && (
        <div
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            NEW RULE
          </p>
          <RuleForm
            categories={categories}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            saving={saving}
          />
        </div>
      )}

      <table>
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Type</th>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>Priority</th>
              <th>Active</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                  No rules yet.
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <>
                  <tr key={rule.id} style={{ opacity: rule.is_active ? 1 : 0.5 }}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>
                      {rule.pattern}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          background: "var(--surface-raised)",
                          border: "1px solid var(--border)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {MATCH_TYPE_LABELS[rule.match_type as MatchType]}
                      </span>
                    </td>
                    <td>
                      {rule.category_name && rule.category_color && rule.category_icon ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "0.1rem 0.5rem",
                            borderRadius: "9999px",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            background: rule.category_color + "22",
                            color: rule.category_color,
                            border: `1px solid ${rule.category_color}44`,
                          }}
                        >
                          {rule.category_icon} {rule.category_name}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--text-secondary)", fontSize: "0.8125rem" }}>
                      {rule.priority}
                    </td>
                    <td>
                      <span style={{ color: rule.is_active ? "var(--green)" : "var(--text-muted)", fontSize: "0.75rem" }}>
                        {rule.is_active ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: "0.375rem", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => { setEditId(rule.id); setShowAddForm(false); }}
                          style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                        >
                          Edit
                        </button>
                        {deleteConfirm === rule.id ? (
                          <>
                            <button
                              onClick={() => handleDelete(rule.id)}
                              disabled={saving}
                              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "var(--red)", borderColor: "var(--red)" }}
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(rule.id)}
                            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "var(--text-muted)" }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editId === rule.id && (
                    <tr key={`edit-${rule.id}`}>
                      <td
                        colSpan={6}
                        style={{ background: "var(--surface-raised)", padding: "1rem", borderTop: "none" }}
                      >
                        <RuleForm
                          initial={{
                            pattern: rule.pattern,
                            match_type: rule.match_type as MatchType,
                            category_id: rule.category_id,
                            priority: rule.priority,
                            is_active: rule.is_active,
                          }}
                          categories={categories}
                          onSave={(f) => handleEdit(rule.id, f)}
                          onCancel={() => setEditId(null)}
                          saving={saving}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
      </table>
    </div>
  );
}
