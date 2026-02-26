import { useEffect, useState } from "react";
import { applyRuleSuggestion, getRuleSuggestions } from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { Category, RuleSuggestion, TransactionFilters } from "../types";

interface Props {
  onNavigateToTransactions?: (filters: TransactionFilters) => void;
}

function ConfidenceBadge({ confidence, source }: { confidence: number; source: string }) {
  const color =
    confidence >= 80 ? "var(--green)"
    : confidence >= 60 ? "#f59e0b"
    : "var(--text-muted)";
  return (
    <span
      style={{
        fontSize: "0.65rem",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        padding: "0.1rem 0.4rem",
        borderRadius: "2px",
        background: color + "22",
        color,
        border: `1px solid ${color}44`,
        whiteSpace: "nowrap",
      }}
    >
      {confidence}% · {source === "manual_consistency" ? "MANUAL" : "VOLUME"}
    </span>
  );
}

function SuggestionCard({
  s,
  categories,
  onApplied,
  onViewAffected,
}: {
  s: RuleSuggestion;
  categories: Category[];
  onApplied: (merchant: string, updatedCount: number) => void;
  onViewAffected?: (filters: TransactionFilters) => void;
}) {
  const [selectedCatId, setSelectedCatId] = useState<number | null>(s.category_id);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

  async function handleApply() {
    if (selectedCatId === null) {
      setErr("Select a category first.");
      return;
    }
    setApplying(true);
    setErr(null);
    try {
      const res = await applyRuleSuggestion({
        merchant: s.merchant,
        match_type: s.match_type,
        pattern: s.pattern,
        category_id: selectedCatId,
        priority: 60,
      });
      // Immediately notify parent — it will remove this card from the list
      onApplied(s.merchant, res.updated_transactions_count);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
      setApplying(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "0.875rem",
        background: "var(--surface-raised)",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "0.875rem", flexGrow: 1 }}>
          {s.merchant}
        </span>
        <ConfidenceBadge confidence={s.confidence} source={s.source} />
      </div>

      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", ...mono }}>
        pattern: <span style={{ color: "var(--text-secondary)" }}>{s.pattern}</span>
        {" · "}type: {s.match_type}
        {" · "}
        {s.count} tx · ${s.total_spend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
      </div>

      {s.sample_descriptions.length > 0 && (
        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", borderLeft: "2px solid var(--border)", paddingLeft: "0.5rem" }}>
          {s.sample_descriptions.map((d, i) => <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d}</div>)}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.25rem" }}>
        <select
          value={selectedCatId ?? ""}
          onChange={(e) => setSelectedCatId(e.target.value === "" ? null : Number(e.target.value))}
          style={{ fontSize: "0.75rem", padding: "0.2rem 0.375rem", flexGrow: 1, maxWidth: "220px" }}
        >
          <option value="">{s.category_name ? `${s.category_name} (current)` : "— select category —"}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </select>

        {onViewAffected && (
          <button
            onClick={() => onViewAffected({ merchant_search: s.merchant })}
            style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
          >
            View affected ↗
          </button>
        )}

        <button
          onClick={handleApply}
          disabled={applying || selectedCatId === null}
          style={{
            fontSize: "0.7rem",
            padding: "0.2rem 0.6rem",
            background: selectedCatId !== null ? "var(--accent)" : "var(--surface)",
            color: selectedCatId !== null ? "#fff" : "var(--text-muted)",
            border: "none",
            fontWeight: 600,
            cursor: selectedCatId !== null ? "pointer" : "default",
          }}
        >
          {applying ? "Creating…" : "Create Rule"}
        </button>
      </div>

      {err && <span style={{ fontSize: "0.7rem", color: "var(--red)" }}>{err}</span>}
    </div>
  );
}

export default function RuleSuggestionsPanel({ onNavigateToTransactions }: Props) {
  const { categories, refreshRules, bump } = useFinance();
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const sg = await getRuleSuggestions();
      setSuggestions(sg.suggestions);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApplied(merchant: string, updatedCount: number) {
    // Optimistically remove this suggestion immediately
    setSuggestions((prev) => prev.filter((s) => s.merchant !== merchant));
    // Show a local toast
    setToast(`Rule created for "${merchant}". ${updatedCount} transaction(s) categorized.`);
    setTimeout(() => setToast(null), 3000);
    // Refresh rules in context + bump transactions
    await refreshRules();
    bump();
  }

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, ...mono }}>Rule Suggestions</h2>
        {!loading && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{suggestions.length} found</span>
        )}
        <div style={{ flexGrow: 1 }} />
        <button onClick={load} disabled={loading} style={{ fontSize: "0.75rem" }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {toast && (
        <div style={{
          marginBottom: "0.875rem",
          padding: "0.5rem 0.75rem",
          background: "rgba(0,217,126,0.08)",
          border: "1px solid rgba(0,217,126,0.25)",
          borderRadius: "var(--radius)",
          fontSize: "0.8125rem",
          color: "var(--green)",
        }}>
          ✓ {toast}
        </div>
      )}

      {error && <p style={{ color: "var(--red)", fontSize: "0.875rem" }}>{error}</p>}

      {!loading && suggestions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          {toast ? "Processing…" : "No suggestions — all merchants are well-categorized."}
        </div>
      ) : (
        <>
          {!loading && (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.875rem" }}>
              Sorted by: manual-consistent rules first, then by transaction volume. Select a category and click "Create Rule" to auto-categorize matching transactions.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {suggestions.map((s, i) => (
              <SuggestionCard
                key={`${s.merchant}-${i}`}
                s={s}
                categories={categories}
                onApplied={handleApplied}
                onViewAffected={onNavigateToTransactions}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
