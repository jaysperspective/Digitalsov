import { useCallback, useEffect, useRef, useState } from "react";
import { exportTransactionsCsv, fetchTransactions, getCategories, patchTransactionCategory } from "../api/client";
import type { Category, Transaction, TransactionListResponse } from "../types";

interface Props {
  refreshKey: number;
  filterImportId?: number | null;
}

const PAGE_SIZE = 50;

function fmt(amount: number): string {
  return Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Provenance tooltip ────────────────────────────────────────────────────────

function provenanceTitle(tx: Transaction): string | undefined {
  if (tx.category_source === "rule" && tx.category_rule_pattern) {
    const mt = tx.category_rule_match_type ?? "contains";
    const pri = tx.category_rule_priority ?? 50;
    return `Auto-categorized by rule\nPattern: "${tx.category_rule_pattern}"\nMatch: ${mt} · Priority: ${pri}`;
  }
  if (tx.category_source === "manual") return "Manually categorized";
  return undefined;
}

function ProvenanceDot({ source }: { source: string | null }) {
  if (!source) return null;
  const isRule = source === "rule";
  return (
    <span
      title={isRule ? "Categorized by rule" : "Manually categorized"}
      style={{
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: isRule ? "#3b82f6" : "var(--text-secondary)",
        flexShrink: 0,
        marginLeft: "3px",
        verticalAlign: "middle",
      }}
    />
  );
}

// ── Category cell with inline edit ───────────────────────────────────────────

function CategoryCell({
  tx,
  categories,
  onUpdated,
}: {
  tx: Transaction;
  categories: Category[];
  onUpdated: (updated: Transaction) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const newId = val === "" ? null : Number(val);
    setSaving(true);
    try {
      const updated = await patchTransactionCategory(tx.id, newId);
      onUpdated(updated);
    } catch {
      // leave editing open on error
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <select
        ref={selectRef}
        defaultValue={tx.category_id ?? ""}
        onChange={handleChange}
        onBlur={() => setEditing(false)}
        disabled={saving}
        style={{ fontSize: "0.75rem", padding: "0.1rem 0.25rem", maxWidth: "140px" }}
      >
        <option value="">— none —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon} {c.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}
      onClick={() => setEditing(true)}
      title={provenanceTitle(tx) ?? "Click to change category"}
    >
      {tx.category_name && tx.category_color && tx.category_icon ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
            padding: "0.1rem 0.5rem",
            borderRadius: "9999px",
            fontSize: "0.7rem",
            fontWeight: 600,
            background: tx.category_color + "22",
            color: tx.category_color,
            border: `1px solid ${tx.category_color}44`,
            whiteSpace: "nowrap",
          }}
        >
          {tx.category_icon} {tx.category_name}
        </span>
      ) : (
        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>—</span>
      )}
      <ProvenanceDot source={tx.category_source} />
    </span>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function TransactionList({ refreshKey, filterImportId = null }: Props) {
  const [data, setData] = useState<TransactionListResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [categories, setCategories] = useState<Category[]>([]);
  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(null);
  const [filterUncategorized, setFilterUncategorized] = useState(false);

  // Load categories for filter dropdown and inline edit
  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => {/* non-critical */});
  }, [refreshKey]);

  // Reset to first page when any filter changes
  useEffect(() => {
    setOffset(0);
  }, [filterImportId, refreshKey, filterCategoryId, filterUncategorized]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTransactions({
        limit: PAGE_SIZE,
        offset,
        import_id: filterImportId,
        category_id: filterUncategorized ? null : filterCategoryId,
        uncategorized: filterUncategorized,
      });
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [offset, filterImportId, filterCategoryId, filterUncategorized, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  // Update a single transaction in local state after inline edit
  const handleUpdated = (updated: Transaction) => {
    setData((prev) =>
      prev
        ? { ...prev, items: prev.items.map((t) => (t.id === updated.id ? updated : t)) }
        : prev
    );
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.625rem",
          marginBottom: "0.75rem",
        }}
      >
        <span style={{ color: "var(--text-secondary)", fontSize: "0.8125rem", marginRight: "auto" }}>
          {data != null ? `${data.total.toLocaleString()} transactions` : ""}
        </span>

        {/* Category filter */}
        <select
          value={filterCategoryId ?? ""}
          onChange={(e) => {
            setFilterCategoryId(e.target.value === "" ? null : Number(e.target.value));
            setFilterUncategorized(false);
          }}
          disabled={filterUncategorized}
          style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem" }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>

        {/* Uncategorized toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8125rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={filterUncategorized}
            onChange={(e) => {
              setFilterUncategorized(e.target.checked);
              if (e.target.checked) setFilterCategoryId(null);
            }}
          />
          Uncategorized only
        </label>

        <button onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>

        <a
          href={exportTransactionsCsv({
            import_id: filterImportId,
            category_id: filterUncategorized ? null : filterCategoryId,
            uncategorized: filterUncategorized,
          })}
          download="transactions_export.csv"
          style={{
            fontSize: "0.8125rem",
            padding: "0.375rem 0.875rem",
            background: "var(--accent)",
            color: "#fff",
            borderRadius: "var(--radius)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
          }}
        >
          ↓ Export CSV
        </a>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#3b82f6" }} />
          Rule-assigned
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--text-secondary)" }} />
          Manual
        </span>
        <span style={{ color: "var(--text-muted)" }}>Click any category to edit</span>
      </div>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
          {error}
        </p>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Merchant</th>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>CCY</th>
              <th>Import</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.items.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    color: "var(--text-muted)",
                    padding: "3rem",
                  }}
                >
                  {loading ? "Loading…" : "No transactions yet — import a CSV above."}
                </td>
              </tr>
            ) : (
              data.items.map((tx: Transaction) => {
                const isTransfer = tx.transaction_type === "transfer";
                return (
                <tr
                  key={tx.id}
                  style={{ opacity: isTransfer ? 0.45 : 1 }}
                >
                  <td style={{ whiteSpace: "nowrap" }}>{tx.posted_date}</td>
                  <td
                    style={{
                      maxWidth: "260px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={tx.note ? `${tx.description_raw}\n📝 ${tx.note}` : tx.description_raw}
                  >
                    {tx.description_raw}
                    {tx.note && (
                      <span style={{ marginLeft: "0.375rem", fontSize: "0.65rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                        📝
                      </span>
                    )}
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>
                    {tx.merchant ?? "—"}
                  </td>
                  <td>
                    <CategoryCell
                      tx={tx}
                      categories={categories}
                      onUpdated={handleUpdated}
                    />
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      color: tx.amount < 0 ? "var(--red)" : "var(--green)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tx.amount < 0 ? "-" : "+"}
                    {fmt(tx.amount)}
                    {isTransfer && (
                      <span style={{ marginLeft: "0.35rem", fontSize: "0.6rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.08)", border: "1px solid var(--border)", borderRadius: "4px", padding: "0 0.3rem", verticalAlign: "middle" }}>
                        excluded
                      </span>
                    )}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{tx.currency}</td>
                  <td style={{ color: "var(--text-muted)" }}>#{tx.import_id}</td>
                </tr>
              );})
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            marginTop: "1rem",
          }}
        >
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
          >
            ← Prev
          </button>
          <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", padding: "0 0.25rem" }}>
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={currentPage >= totalPages}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
