import { useEffect, useRef, useState } from "react";
import {
  createRule,
  deleteTransaction,
  fetchTransactions,
  patchTransactionCategory,
  patchTransactionNote,
} from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { Transaction } from "../types";

const PAGE_SIZE = 100;

type SortKey = "date_desc" | "date_asc" | "amount_asc" | "amount_desc";
type ViewMode = "rows" | "grouped";

function fmtUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// ── Inline note editor ────────────────────────────────────────────────────────

function NoteCell({
  tx,
  onSaved,
}: {
  tx: Transaction;
  onSaved: (updated: Transaction) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(tx.note ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await patchTransactionNote(tx.id, val.trim() || null);
      onSaved(updated);
      setEditing(false);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") { setVal(tx.note ?? ""); setEditing(false); }
          }}
          autoFocus
          style={{ fontSize: "0.75rem", padding: "0.15rem 0.4rem", width: "180px" }}
          placeholder="Add note…"
        />
        <button onClick={save} disabled={saving} style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}>
          {saving ? "…" : "✓"}
        </button>
        <button onClick={() => { setVal(tx.note ?? ""); setEditing(false); }} style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", background: "transparent", border: "1px solid var(--border)" }}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit note"
      style={{
        fontSize: "0.75rem",
        color: tx.note ? "var(--text-secondary)" : "var(--text-muted)",
        cursor: "pointer",
        fontStyle: tx.note ? "normal" : "italic",
        borderBottom: "1px dashed var(--border)",
        paddingBottom: "1px",
      }}
    >
      {tx.note || "add note"}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UncategorizedPage() {
  const { refreshKey, categories } = useFinance();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("amount_asc");
  const [offset, setOffset] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("rows");

  // Selection for bulk assign
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCatId, setBulkCatId] = useState<string>("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // Per-row quick-assign dropdown open
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [openGroupDropdown, setOpenGroupDropdown] = useState<string | null>(null);

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  // Save-as-rule toast
  const [ruleToast, setRuleToast] = useState<{ merchant: string; catId: number } | null>(null);
  const [ruleSaving, setRuleSaving] = useState(false);

  // Focused row index for keyboard nav
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") {
        setOpenDropdown(null);
        setFocusedIdx(null);
        return;
      }
      if (e.key === "j") {
        setFocusedIdx((prev) => prev == null ? 0 : Math.min(prev + 1, filtered.length - 1));
        return;
      }
      if (e.key === "k") {
        setFocusedIdx((prev) => prev == null ? 0 : Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "a") {
        toggleAll();
        return;
      }
      if (focusedIdx != null && filtered[focusedIdx]) {
        const t = filtered[focusedIdx];
        if (e.key === "c") { setOpenDropdown((prev) => prev === t.id ? null : t.id); }
        if (e.key === "d") { setDeleteConfirm(t.id); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const load = (o = 0) => {
    setLoading(true);
    setError(null);
    fetchTransactions({ uncategorized: true, limit: PAGE_SIZE, offset: o })
      .then((r) => { setTxns(r.items); setTotal(r.total); setOffset(o); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(0);
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter + sort client-side (on the current page)
  const filtered = txns
    .filter((t) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        t.description_raw.toLowerCase().includes(q) ||
        (t.merchant ?? "").toLowerCase().includes(q) ||
        (t.note ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      switch (sort) {
        case "date_asc": return a.posted_date.localeCompare(b.posted_date);
        case "date_desc": return b.posted_date.localeCompare(a.posted_date);
        case "amount_asc": return a.amount - b.amount;
        case "amount_desc": return b.amount - a.amount;
      }
    });

  const totalFiltered = filtered.reduce((s, t) => s + t.amount, 0);

  // Toggle selection
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((t) => t.id)));
    }
  };

  // Bulk assign
  const handleBulkAssign = async () => {
    if (!bulkCatId || selected.size === 0) return;
    setBulkSaving(true);
    try {
      await Promise.all(
        [...selected].map((id) => patchTransactionCategory(id, Number(bulkCatId)))
      );
      setSelected(new Set());
      setBulkCatId("");
      load(offset);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk assign failed");
    } finally {
      setBulkSaving(false);
    }
  };

  // Quick single-row assign
  const handleQuickAssign = async (txId: number, catId: number) => {
    const tx = txns.find((t) => t.id === txId);
    try {
      await patchTransactionCategory(txId, catId);
      setOpenDropdown(null);
      load(offset);
      // offer save-as-rule if merchant exists
      if (tx?.merchant) {
        setRuleToast({ merchant: tx.merchant, catId });
      }
    } catch {
      /* ignore */
    }
  };

  const handleSaveAsRule = async () => {
    if (!ruleToast) return;
    setRuleSaving(true);
    try {
      await createRule({
        pattern: ruleToast.merchant,
        match_type: "contains",
        category_id: ruleToast.catId,
        priority: 50,
        is_active: true,
      });
      setRuleToast(null);
    } catch {
      /* ignore */
    } finally {
      setRuleSaving(false);
    }
  };

  // Bulk assign for a merchant group
  const handleGroupAssign = async (merchant: string, catId: number) => {
    const group = txns.filter((t) => t.merchant === merchant);
    try {
      await Promise.all(group.map((t) => patchTransactionCategory(t.id, catId)));
      setOpenGroupDropdown(null);
      load(offset);
      setRuleToast({ merchant, catId });
    } catch {
      /* ignore */
    }
  };

  // Delete
  const handleDelete = async (txId: number) => {
    setDeleteSaving(true);
    try {
      await deleteTransaction(txId);
      setDeleteConfirm(null);
      setSelected((prev) => { const next = new Set(prev); next.delete(txId); return next; });
      load(offset);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleteSaving(false);
    }
  };

  // Update a single tx in place (for note saves)
  const updateTx = (updated: Transaction) =>
    setTxns((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

  const nonTransferCats = categories.filter((c) => c.name !== "Transfer");

  return (
    <div>
      {/* ── Toolbar ── */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.625rem",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
          <strong style={{ color: "var(--text-primary)" }}>{total.toLocaleString()}</strong> uncategorized
        </span>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description / merchant / note…"
          style={{ width: "260px", fontSize: "0.8125rem" }}
        />

        {/* View mode toggle */}
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          {(["rows", "grouped"] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                fontSize: "0.75rem",
                padding: "0.2rem 0.625rem",
                background: viewMode === m ? "var(--accent)" : "transparent",
                color: viewMode === m ? "#fff" : "var(--text-secondary)",
                border: "none",
                fontWeight: viewMode === m ? 600 : 400,
              }}
            >
              {m === "rows" ? "Rows" : "Grouped"}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={{ fontSize: "0.8125rem", padding: "0.3rem 0.5rem" }}
        >
          <option value="amount_asc">Sort: Most negative first</option>
          <option value="amount_desc">Sort: Highest first</option>
          <option value="date_desc">Sort: Newest first</option>
          <option value="date_asc">Sort: Oldest first</option>
        </select>

        <div style={{ flexGrow: 1 }} />

        {/* Pagination */}
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <button
          disabled={offset === 0}
          onClick={() => load(offset - PAGE_SIZE)}
          style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
        >
          ← Prev
        </button>
        <button
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => load(offset + PAGE_SIZE)}
          style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
        >
          Next →
        </button>
      </div>

      {/* ── Bulk assign bar ── */}
      {selected.size > 0 && (
        <div
          style={{
            display: "flex",
            gap: "0.625rem",
            alignItems: "center",
            background: "var(--surface-raised)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius)",
            padding: "0.625rem 1rem",
            marginBottom: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--accent)" }}>
            {selected.size} selected
          </span>
          <select
            value={bulkCatId}
            onChange={(e) => setBulkCatId(e.target.value)}
            style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem" }}
          >
            <option value="">— assign category —</option>
            {nonTransferCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleBulkAssign}
            disabled={!bulkCatId || bulkSaving}
            style={{ fontSize: "0.8125rem", padding: "0.25rem 0.75rem" }}
          >
            {bulkSaving ? "Saving…" : "Assign"}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{ fontSize: "0.8125rem", padding: "0.25rem 0.75rem", background: "transparent", border: "1px solid var(--border)" }}
          >
            Clear
          </button>

          <div style={{ flexGrow: 1 }} />
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Selection total:{" "}
            <strong style={{ color: totalFiltered < 0 ? "var(--red)" : "var(--green)" }}>
              {fmtUSD([...selected].reduce((s, id) => {
                const t = txns.find((x) => x.id === id);
                return s + (t?.amount ?? 0);
              }, 0))}
            </strong>
          </span>
        </div>
      )}

      {error && (
        <p style={{ color: "var(--red)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{error}</p>
      )}

      {/* ── Save-as-rule toast ── */}
      {ruleToast && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 1rem", background: "var(--accent-light)", border: "1px solid var(--accent)", borderRadius: "var(--radius)", marginBottom: "0.75rem", fontSize: "0.8125rem" }}>
          <span style={{ color: "var(--text-secondary)", flex: 1 }}>
            Create rule for <strong>"{ruleToast.merchant}"</strong>?
          </span>
          <button
            onClick={handleSaveAsRule}
            disabled={ruleSaving}
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.75rem", background: "var(--accent)", color: "#fff", border: "none" }}
          >
            {ruleSaving ? "Saving…" : "Create rule"}
          </button>
          <button
            onClick={() => setRuleToast(null)}
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", background: "transparent", border: "1px solid var(--border)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          {search ? "No results match your search." : "All transactions are categorized!"}
        </div>
      ) : viewMode === "grouped" ? (
        // ── Grouped view ──
        (() => {
          const groups = new Map<string, Transaction[]>();
          const noMerchant: Transaction[] = [];
          for (const t of filtered) {
            if (t.merchant) {
              if (!groups.has(t.merchant)) groups.set(t.merchant, []);
              groups.get(t.merchant)!.push(t);
            } else {
              noMerchant.push(t);
            }
          }
          const sortedGroups = [...groups.entries()].sort((a, b) => {
            const sumA = a[1].reduce((s, t) => s + t.amount, 0);
            const sumB = b[1].reduce((s, t) => s + t.amount, 0);
            return sumA - sumB;
          });
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {sortedGroups.map(([merchant, group]) => {
                const total = group.reduce((s, t) => s + t.amount, 0);
                const minDate = group.map((t) => t.posted_date).sort()[0];
                const maxDate = group.map((t) => t.posted_date).sort().reverse()[0];
                return (
                  <div key={merchant} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "visible" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 0.875rem", background: "var(--surface-raised)" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-secondary)", flex: 1 }}>{merchant}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{group.length} txns · {minDate} – {maxDate}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: total < 0 ? "var(--red)" : "var(--green)", fontSize: "0.8125rem" }}>
                        {total >= 0 ? "+" : ""}{fmtUSD(total)}
                      </span>
                      {/* Assign all dropdown */}
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={() => setOpenGroupDropdown(openGroupDropdown === merchant ? null : merchant)}
                          style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }}
                        >
                          Assign all ▾
                        </button>
                        {openGroupDropdown === merchant && (
                          <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 200, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", minWidth: "200px", maxHeight: "260px", overflowY: "auto", boxShadow: "var(--shadow-sm)" }}>
                            {nonTransferCats.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => handleGroupAssign(merchant, c.id)}
                                style={{ display: "block", width: "100%", textAlign: "left", padding: "0.4rem 0.75rem", fontSize: "0.8125rem", background: "transparent", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", color: "var(--text-secondary)" }}
                              >
                                <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: c.color, marginRight: "0.5rem" }} />
                                {c.icon} {c.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ padding: "0.375rem 0.875rem" }}>
                      {group.map((t) => (
                        <div key={t.id} style={{ display: "flex", gap: "0.75rem", padding: "0.25rem 0", fontSize: "0.75rem", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t.posted_date}</span>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description_raw}</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: t.amount < 0 ? "var(--red)" : "var(--green)", whiteSpace: "nowrap" }}>
                            {t.amount >= 0 ? "+" : ""}{fmtUSD(t.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {noMerchant.length > 0 && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", padding: "0.5rem" }}>
                  + {noMerchant.length} transaction(s) with no merchant
                </div>
              )}
            </div>
          );
        })()
      ) : (
        <>
          {/* ── Table ── */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                <th style={{ width: "32px", padding: "0.375rem" }}>
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length;
                    }}
                    onChange={toggleAll}
                  />
                </th>
                <th style={{ textAlign: "left", color: "var(--text-muted)", fontWeight: 600, paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>Date</th>
                <th style={{ textAlign: "left", color: "var(--text-muted)", fontWeight: 600, paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>Description</th>
                <th style={{ textAlign: "left", color: "var(--text-muted)", fontWeight: 600, paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>Note</th>
                <th style={{ textAlign: "right", color: "var(--text-muted)", fontWeight: 600, paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>Amount</th>
                <th style={{ textAlign: "right", color: "var(--text-muted)", fontWeight: 600, paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>Assign / Delete</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, idx) => (
                <tr
                  key={t.id}
                  style={{
                    background: focusedIdx === idx
                      ? "rgba(99,102,241,0.12)"
                      : selected.has(t.id)
                      ? "rgba(99,102,241,0.07)"
                      : "transparent",
                    outline: focusedIdx === idx ? "1px solid var(--accent)" : "none",
                    outlineOffset: "-1px",
                    opacity: t.transaction_type === "transfer" ? 0.5 : 1,
                  }}
                >
                  <td style={{ padding: "0.35rem", textAlign: "center", borderBottom: "1px solid var(--border)" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggle(t.id)}
                    />
                  </td>
                  <td style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", whiteSpace: "nowrap", padding: "0.35rem 0.75rem 0.35rem 0", borderBottom: "1px solid var(--border)" }}>
                    {t.posted_date}
                  </td>
                  <td style={{ maxWidth: "320px", padding: "0.35rem 0.75rem 0.35rem 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={t.description_raw}>
                      {t.merchant || t.description_raw}
                    </div>
                    {t.merchant && (
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.description_raw}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "0.35rem 0.75rem 0.35rem 0", borderBottom: "1px solid var(--border)" }}>
                    <NoteCell tx={t} onSaved={updateTx} />
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, whiteSpace: "nowrap", padding: "0.35rem 0 0.35rem 0.5rem", borderBottom: "1px solid var(--border)", color: t.amount >= 0 ? "var(--green)" : "var(--red)" }}>
                    {t.amount >= 0 ? "+" : ""}{fmtUSD(t.amount)}
                  </td>
                  <td style={{ textAlign: "right", padding: "0.35rem 0 0.35rem 0.5rem", borderBottom: "1px solid var(--border)", position: "relative" }}>
                    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end", alignItems: "center" }}>
                      {/* Quick-assign dropdown */}
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={() => setOpenDropdown(openDropdown === t.id ? null : t.id)}
                          style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }}
                        >
                          Categorize ▾
                        </button>
                        {openDropdown === t.id && (
                          <div
                            style={{
                              position: "absolute",
                              right: 0,
                              top: "100%",
                              zIndex: 100,
                              background: "var(--surface)",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius)",
                              boxShadow: "var(--shadow-sm)",
                              minWidth: "200px",
                              maxHeight: "260px",
                              overflowY: "auto",
                            }}
                          >
                            {nonTransferCats.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => handleQuickAssign(t.id, c.id)}
                                style={{
                                  display: "block",
                                  width: "100%",
                                  textAlign: "left",
                                  padding: "0.4rem 0.75rem",
                                  fontSize: "0.8125rem",
                                  background: "transparent",
                                  border: "none",
                                  borderBottom: "1px solid var(--border)",
                                  cursor: "pointer",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: c.color, marginRight: "0.5rem" }} />
                                {c.icon} {c.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Delete */}
                      {deleteConfirm === t.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(t.id)}
                            disabled={deleteSaving}
                            style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", color: "var(--red)", borderColor: "var(--red)" }}
                          >
                            {deleteSaving ? "…" : "Confirm"}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", background: "transparent", border: "1px solid var(--border)" }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(t.id)}
                          style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem", color: "var(--text-muted)", background: "transparent", border: "1px solid var(--border)" }}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── Footer summary ── */}
          <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            <span>{filtered.length} shown</span>
            <span>
              Page total:{" "}
              <strong style={{ color: totalFiltered < 0 ? "var(--red)" : "var(--green)" }}>
                {fmtUSD(totalFiltered)}
              </strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
