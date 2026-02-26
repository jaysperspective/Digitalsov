import { useCallback, useEffect, useRef, useState } from "react";
import { createMerchantAlias, exportTransactionsCsv, fetchTransactions, patchTransactionCategory, setTransactionTags } from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { Category, Tag, Transaction, TransactionFilters, TransactionListResponse } from "../types";

interface Props {
  filterImportId?: number | null;
  initialFilters?: TransactionFilters | null;
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

// ── Tag pills + inline picker ─────────────────────────────────────────────────

function TagPills({
  tx,
  allTags,
  onUpdated,
}: {
  tx: Transaction;
  allTags: Tag[];
  onUpdated: (txId: number, tags: Tag[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentIds = new Set((tx.tags ?? []).map((t) => t.id));

  async function toggle(tagId: number) {
    const next = currentIds.has(tagId)
      ? [...currentIds].filter((id) => id !== tagId)
      : [...currentIds, tagId];
    setSaving(true);
    try {
      const updated = await setTransactionTags(tx.id, next);
      onUpdated(tx.id, updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem", alignItems: "center" }}>
      {(tx.tags ?? []).map((t) => (
        <span
          key={t.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.2rem",
            padding: "0.05rem 0.4rem",
            borderRadius: "9999px",
            fontSize: "0.65rem",
            fontWeight: 600,
            background: (t.color ?? "#94a3b8") + "22",
            color: t.color ?? "var(--text-secondary)",
            border: `1px solid ${(t.color ?? "#94a3b8")}44`,
            whiteSpace: "nowrap",
          }}
        >
          {t.name}
        </span>
      ))}
      {allTags.length > 0 && (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={saving}
          title="Add/remove tags"
          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: "0.6rem", padding: "0.05rem 0.25rem", cursor: "pointer", lineHeight: 1 }}
        >
          {saving ? "…" : "⊕"}
        </button>
      )}
      {open && (
        <div
          style={{
            marginTop: "0.25rem",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "0.375rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.2rem",
            minWidth: "120px",
          }}
        >
          {allTags.map((t) => (
            <label
              key={t.id}
              style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", cursor: "pointer", padding: "0.15rem 0.25rem" }}
            >
              <input
                type="checkbox"
                checked={currentIds.has(t.id)}
                onChange={() => toggle(t.id)}
                style={{ accentColor: t.color ?? "var(--accent)" }}
              />
              <span
                style={{
                  display: "inline-block",
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: t.color ?? "var(--text-muted)",
                  flexShrink: 0,
                }}
              />
              {t.name}
            </label>
          ))}
          <button
            onClick={() => setOpen(false)}
            style={{ fontSize: "0.65rem", marginTop: "0.25rem", padding: "0.1rem", background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ── Merchant cell with quick-alias ────────────────────────────────────────────

function MerchantCell({ tx, onAliased }: { tx: Transaction; onAliased: (canonical: string) => void }) {
  const [aliasOpen, setAliasOpen] = useState(false);
  const [aliasInput, setAliasInput] = useState(tx.merchant ?? "");
  const [canonicalInput, setCanonicalInput] = useState(tx.merchant_canonical ?? tx.merchant ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const displayName = tx.merchant_canonical ?? tx.merchant;
  const hasAlias = tx.merchant_canonical && tx.merchant_canonical !== tx.merchant;

  const handleSubmit = async () => {
    if (!aliasInput.trim() || !canonicalInput.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await createMerchantAlias({ alias: aliasInput.trim(), canonical: canonicalInput.trim() });
      onAliased(canonicalInput.trim());
      setAliasOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
        <span style={{ color: "var(--text-secondary)" }} title={hasAlias ? `Raw: ${tx.merchant}` : undefined}>
          {displayName ?? "—"}
        </span>
        {tx.merchant && (
          <button
            onClick={() => {
              setAliasInput(tx.merchant ?? "");
              setCanonicalInput(tx.merchant_canonical ?? tx.merchant ?? "");
              setAliasOpen((v) => !v);
            }}
            title="Add/edit alias for this merchant"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "0.65rem",
              cursor: "pointer",
              padding: "0 0.15rem",
              lineHeight: 1,
              opacity: 0.6,
            }}
          >
            ✎
          </button>
        )}
      </div>
      {hasAlias && (
        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "0.1rem" }}>
          {tx.merchant}
        </div>
      )}
      {aliasOpen && (
        <div
          style={{
            marginTop: "0.375rem",
            padding: "0.5rem",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",
          }}
        >
          <input
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            placeholder="alias"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.3rem" }}
          />
          <input
            value={canonicalInput}
            onChange={(e) => setCanonicalInput(e.target.value)}
            placeholder="canonical name"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.3rem" }}
          />
          <div style={{ display: "flex", gap: "0.25rem" }}>
            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem", background: "var(--accent)", color: "#fff", border: "none" }}
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              onClick={() => setAliasOpen(false)}
              style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              Cancel
            </button>
          </div>
          {err && <span style={{ fontSize: "0.7rem", color: "var(--red)" }}>{err}</span>}
        </div>
      )}
    </div>
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

export default function TransactionList({ filterImportId = null, initialFilters = null }: Props) {
  const { refreshKey, categories, tags: allTags } = useFinance();
  const [data, setData] = useState<TransactionListResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state — seeded from initialFilters on mount (component is key-remounted by App)
  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(() => initialFilters?.category_id ?? null);
  const [filterUncategorized, setFilterUncategorized] = useState(() => initialFilters?.uncategorized ?? false);
  const [filterFromDate, setFilterFromDate] = useState<string>(() => initialFilters?.from_date ?? "");
  const [filterToDate, setFilterToDate] = useState<string>(() => initialFilters?.to_date ?? "");
  const [filterMerchant, setFilterMerchant] = useState<string>(() => initialFilters?.merchant_search ?? "");
  const [filterTagId, setFilterTagId] = useState<number | null>(null);

  // Reset to first page when any filter changes
  useEffect(() => {
    setOffset(0);
  }, [filterImportId, refreshKey, filterCategoryId, filterUncategorized, filterFromDate, filterToDate, filterMerchant, filterTagId]);

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
        from_date: filterFromDate || null,
        to_date: filterToDate || null,
        merchant_search: filterMerchant || null,
        tag_id: filterTagId,
        include_tags: true,
      });
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [offset, filterImportId, filterCategoryId, filterUncategorized, filterFromDate, filterToDate, filterMerchant, filterTagId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Update tags in local state after inline picker change
  const handleTagsUpdated = (txId: number, tags: Tag[]) => {
    setData((prev) =>
      prev
        ? { ...prev, items: prev.items.map((t) => (t.id === txId ? { ...t, tags } : t)) }
        : prev
    );
  };

  // Update merchant_canonical in local state after quick-alias
  const handleAliased = (txId: number, canonical: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((t) =>
              t.id === txId ? { ...t, merchant_canonical: canonical } : t
            ),
          }
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

        {/* Date range */}
        <input
          type="date"
          value={filterFromDate}
          onChange={(e) => setFilterFromDate(e.target.value)}
          title="From date"
          style={{ fontSize: "0.8125rem", padding: "0.25rem 0.375rem" }}
        />
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>–</span>
        <input
          type="date"
          value={filterToDate}
          onChange={(e) => setFilterToDate(e.target.value)}
          title="To date"
          style={{ fontSize: "0.8125rem", padding: "0.25rem 0.375rem" }}
        />

        {/* Merchant search */}
        <input
          type="text"
          value={filterMerchant}
          onChange={(e) => setFilterMerchant(e.target.value)}
          placeholder="Merchant…"
          style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem", width: "120px" }}
        />

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

        {/* Tag filter */}
        {allTags.length > 0 && (
          <select
            value={filterTagId ?? ""}
            onChange={(e) => setFilterTagId(e.target.value === "" ? null : Number(e.target.value))}
            style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem" }}
          >
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}

        <button onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>

        <a
          href={exportTransactionsCsv({
            import_id: filterImportId,
            category_id: filterUncategorized ? null : filterCategoryId,
            uncategorized: filterUncategorized,
            from_date: filterFromDate || null,
            to_date: filterToDate || null,
            merchant_search: filterMerchant || null,
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
              {allTags.length > 0 && <th>Tags</th>}
            </tr>
          </thead>
          <tbody>
            {!data || data.items.length === 0 ? (
              <tr>
                <td
                  colSpan={allTags.length > 0 ? 8 : 7}
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
                  <td>
                    <MerchantCell
                      tx={tx}
                      onAliased={(canonical) => handleAliased(tx.id, canonical)}
                    />
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
                  {allTags.length > 0 && (
                    <td style={{ minWidth: "100px" }}>
                      <TagPills tx={tx} allTags={allTags} onUpdated={handleTagsUpdated} />
                    </td>
                  )}
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
