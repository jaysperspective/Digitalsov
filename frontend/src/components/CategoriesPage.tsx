import { useEffect, useState } from "react";
import { createCategory, deleteCategory, fetchTransactions, updateCategory } from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { CategoryCreate, Transaction } from "../types";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
  "#94a3b8", "#78716c", "#0ea5e9", "#a3e635",
];

const PRESET_ICONS = [
  "🛒", "🍔", "🚗", "✈️", "🏥", "💊", "🎬", "🎵",
  "📱", "💻", "🏠", "⚡", "💧", "🏋️", "📚", "🐾",
  "💰", "📌", "🔧", "🎁", "☕", "🍺", "👗", "💈",
];

interface FormState {
  name: string;
  color: string;
  icon: string;
  monthly_budget: string;  // empty string = no budget, otherwise dollar string
  tax_deductible: boolean;
}

const EMPTY_FORM: FormState = { name: "", color: "#94a3b8", icon: "📌", monthly_budget: "", tax_deductible: false };

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginTop: "0.375rem" }}>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            background: c,
            border: value === c ? "2px solid #fff" : "2px solid transparent",
            outline: value === c ? `2px solid ${c}` : "none",
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (i: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.375rem" }}>
      {PRESET_ICONS.map((icon) => (
        <button
          key={icon}
          type="button"
          onClick={() => onChange(icon)}
          style={{
            width: "30px",
            height: "30px",
            fontSize: "1rem",
            borderRadius: "6px",
            border: value === icon ? "2px solid var(--accent)" : "1px solid var(--border)",
            background: value === icon ? "var(--accent-muted)" : "transparent",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

interface InlineFormProps {
  initial?: FormState;
  onSave: (f: FormState) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function InlineForm({ initial = EMPTY_FORM, onSave, onCancel, saving }: InlineFormProps) {
  const [form, setForm] = useState<FormState>(initial);

  const set = (key: keyof FormState) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({ ...form, name: form.name.trim() });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div>
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
            Name
          </label>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
            placeholder="e.g. Groceries"
            style={{ width: "100%" }}
          />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block" }}>
            Color
          </label>
          <ColorPicker value={form.color} onChange={set("color")} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block" }}>
            Icon
          </label>
          <IconPicker value={form.icon} onChange={set("icon")} />
        </div>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
              Monthly Budget $
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.monthly_budget}
              onChange={(e) => set("monthly_budget")(e.target.value)}
              placeholder="optional"
              style={{ width: "120px" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1.25rem" }}>
            <input
              type="checkbox"
              id="tax_deductible_chk"
              checked={form.tax_deductible}
              onChange={(e) => setForm((f) => ({ ...f, tax_deductible: e.target.checked }))}
            />
            <label htmlFor="tax_deductible_chk" style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", cursor: "pointer" }}>
              Tax deductible
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" disabled={saving || !form.name.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onCancel} style={{ background: "transparent", border: "1px solid var(--border)" }}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function CategoryDrilldown({ categoryId, categoryName }: { categoryId: number; categoryName: string }) {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransactions({ category_id: categoryId, limit: 500, offset: 0 })
      .then((r) => { setTxns(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [categoryId]);

  if (loading) return <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", padding: "0.75rem 0" }}>Loading…</p>;
  if (txns.length === 0) return <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", padding: "0.75rem 0" }}>No transactions in {categoryName}.</p>;

  const sum = txns.reduce((s, t) => s + t.amount, 0);

  return (
    <div style={{ maxHeight: "320px", overflowY: "auto" }}>
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.625rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
        <span>Showing {txns.length}{total > txns.length ? ` of ${total}` : ""} transactions</span>
        <span style={{ color: sum >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
          Total: {fmtUSD(sum)}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", color: "var(--text-muted)", fontWeight: 600, paddingBottom: "0.375rem", borderBottom: "1px solid var(--border)" }}>Date</th>
            <th style={{ textAlign: "left", color: "var(--text-muted)", fontWeight: 600, paddingBottom: "0.375rem", borderBottom: "1px solid var(--border)" }}>Description</th>
            <th style={{ textAlign: "right", color: "var(--text-muted)", fontWeight: 600, paddingBottom: "0.375rem", borderBottom: "1px solid var(--border)" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {txns.map((t) => (
            <tr key={t.id}>
              <td style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", whiteSpace: "nowrap", padding: "0.3rem 0.75rem 0.3rem 0", borderBottom: "1px solid var(--border)" }}>
                {t.posted_date}
              </td>
              <td style={{ color: "var(--text-secondary)", maxWidth: "380px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0.3rem 0.75rem 0.3rem 0", borderBottom: "1px solid var(--border)" }}
                title={t.description_raw}>
                {t.merchant || t.description_raw}
              </td>
              <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, whiteSpace: "nowrap", padding: "0.3rem 0 0.3rem 0", borderBottom: "1px solid var(--border)", color: t.amount >= 0 ? "var(--green)" : "var(--red)" }}>
                {t.amount >= 0 ? "+" : ""}{fmtUSD(t.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CategoriesPage() {
  const { categories, refreshCategories } = useFinance();
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const handleAdd = async (form: FormState) => {
    setSaving(true);
    try {
      const budgetDollars = parseFloat(form.monthly_budget);
      const payload: CategoryCreate = {
        name: form.name,
        color: form.color,
        icon: form.icon,
        monthly_budget: form.monthly_budget && !isNaN(budgetDollars) ? Math.round(budgetDollars * 100) : null,
        tax_deductible: form.tax_deductible,
      };
      await createCategory(payload);
      setShowAddForm(false);
      await refreshCategories();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (id: number, form: FormState) => {
    setSaving(true);
    try {
      const budgetDollars = parseFloat(form.monthly_budget);
      const payload: CategoryCreate = {
        name: form.name,
        color: form.color,
        icon: form.icon,
        monthly_budget: form.monthly_budget && !isNaN(budgetDollars) ? Math.round(budgetDollars * 100) : null,
        tax_deductible: form.tax_deductible,
      };
      await updateCategory(id, payload);
      setEditId(null);
      await refreshCategories();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setSaving(true);
    try {
      await deleteCategory(id);
      setDeleteConfirm(null);
      await refreshCategories();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.8125rem" }}>
          {categories.length} categories
        </span>
        <div style={{ flexGrow: 1 }} />
        <button onClick={() => { setShowAddForm(true); setEditId(null); }} disabled={showAddForm}>
          + Add Category
        </button>
      </div>

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
            NEW CATEGORY
          </p>
          <InlineForm
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            saving={saving}
          />
        </div>
      )}

      <table>
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>Budget</th>
              <th style={{ textAlign: "right" }}>Transactions</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                  No categories yet.
                </td>
              </tr>
            ) : (
              categories.map((cat) => (
                <>
                  <tr
                    key={cat.id}
                    onClick={() => {
                      if (editId === cat.id || deleteConfirm === cat.id) return;
                      setExpandedId((prev) => (prev === cat.id ? null : cat.id));
                    }}
                    style={{ cursor: cat.transaction_count > 0 ? "pointer" : "default" }}
                  >
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", width: "0.75rem", textAlign: "center", flexShrink: 0 }}>
                          {cat.transaction_count > 0 ? (expandedId === cat.id ? "▾" : "▸") : ""}
                        </span>
                        <span
                          style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            background: cat.color,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: "1rem" }}>{cat.icon}</span>
                        <span style={{ fontWeight: 500 }}>{cat.name}</span>
                        {cat.is_default && (
                          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", background: "var(--surface-raised)", border: "1px solid var(--border)", padding: "0 0.35rem", borderRadius: "4px" }}>
                            default
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      {cat.monthly_budget != null ? (
                        <span>
                          ${(cat.monthly_budget / 100).toFixed(0)}/mo
                          {cat.tax_deductible && <span style={{ marginLeft: "0.25rem", color: "var(--green)", fontSize: "0.65rem" }}>✓ deductible</span>}
                        </span>
                      ) : cat.tax_deductible ? (
                        <span style={{ color: "var(--green)", fontSize: "0.65rem" }}>✓ deductible</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--text-secondary)", fontSize: "0.8125rem" }}>
                      {cat.transaction_count.toLocaleString()}
                    </td>
                    <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: "0.375rem", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => { setEditId(cat.id); setShowAddForm(false); setExpandedId(null); }}
                          style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                        >
                          Edit
                        </button>
                        {deleteConfirm === cat.id ? (
                          <>
                            <button
                              onClick={() => handleDelete(cat.id)}
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
                            onClick={() => setDeleteConfirm(cat.id)}
                            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "var(--text-muted)" }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === cat.id && (
                    <tr key={`expand-${cat.id}`}>
                      <td
                        colSpan={3}
                        style={{
                          background: "rgba(255,255,255,0.02)",
                          padding: "0.75rem 1rem 0.75rem 2.5rem",
                          borderTop: "none",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <CategoryDrilldown categoryId={cat.id} categoryName={cat.name} />
                      </td>
                    </tr>
                  )}
                  {editId === cat.id && (
                    <tr key={`edit-${cat.id}`}>
                      <td
                        colSpan={3}
                        style={{
                          background: "var(--surface-raised)",
                          padding: "1rem",
                          borderTop: "none",
                        }}
                      >
                        <InlineForm
                          initial={{
                            name: cat.name,
                            color: cat.color,
                            icon: cat.icon,
                            monthly_budget: cat.monthly_budget != null ? String(cat.monthly_budget / 100) : "",
                            tax_deductible: cat.tax_deductible,
                          }}
                          onSave={(f) => handleEdit(cat.id, f)}
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
