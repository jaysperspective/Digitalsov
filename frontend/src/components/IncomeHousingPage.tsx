import { useEffect, useMemo, useState } from "react";
import { getIncomeHousing } from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { IncomeHousingReport, IncomeHousingTransaction, TrackedGroup } from "../types";

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_TOGGLES = "ihp_toggles";
const LS_EXCLUDED = "ihp_excluded";

function loadToggles(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(LS_TOGGLES) ?? "{}"); } catch { return {}; }
}
function saveToggles(v: Record<string, boolean>) {
  localStorage.setItem(LS_TOGGLES, JSON.stringify(v));
}
function loadExcluded(): Record<string, number[]> {
  try { return JSON.parse(localStorage.getItem(LS_EXCLUDED) ?? "{}"); } catch { return {}; }
}
function saveExcluded(v: Record<string, number[]>) {
  localStorage.setItem(LS_EXCLUDED, JSON.stringify(v));
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtAbs(n: number) {
  return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtSigned(n: number) {
  return (n >= 0 ? "+" : "-") + fmtAbs(n);
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, color, bg, border, dimmed,
}: {
  label: string; value: string; sub: string;
  color: string; bg: string; border: string; dimmed?: boolean;
}) {
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: "var(--radius)",
      padding: "1rem 1.25rem",
      opacity: dimmed ? 0.45 : 1,
      transition: "opacity 0.2s",
    }}>
      <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color, marginBottom: "0.375rem" }}>
        {label}
      </p>
      <p style={{ fontSize: "1.375rem", fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{sub}</p>
    </div>
  );
}

// ── Group section ─────────────────────────────────────────────────────────────

function GroupSection({
  group,
  enabled,
  excludedIds,
  onToggleGroup,
  onRemoveTx,
  onRestoreTx,
}: {
  group: TrackedGroup;
  enabled: boolean;
  excludedIds: number[];
  onToggleGroup: () => void;
  onRemoveTx: (id: number) => void;
  onRestoreTx: (id: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);

  const visible = group.transactions.filter((t) => !excludedIds.includes(t.id));
  const excluded = group.transactions.filter((t) => excludedIds.includes(t.id));
  const effectiveTotal = visible.reduce((s, t) => s + t.amount, 0);

  function TxRow({ tx, removed }: { tx: IncomeHousingTransaction; removed: boolean }) {
    return (
      <tr style={{ borderBottom: "1px solid var(--border)", opacity: removed ? 0.45 : 1 }}>
        <td style={{ padding: "0.4rem 0.625rem", color: "var(--text-muted)", whiteSpace: "nowrap", fontSize: "0.8125rem" }}>
          {tx.posted_date}
        </td>
        <td style={{ padding: "0.4rem 0.625rem", color: "var(--text-primary)", fontSize: "0.8125rem" }}>
          {tx.description_norm || tx.description_raw}
        </td>
        <td style={{
          padding: "0.4rem 0.625rem",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: removed ? "var(--text-muted)" : group.color,
          fontWeight: 600,
          fontSize: "0.8125rem",
          textDecoration: removed ? "line-through" : "none",
        }}>
          {fmtSigned(tx.amount)}
        </td>
        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", whiteSpace: "nowrap" }}>
          {removed ? (
            <button
              onClick={() => onRestoreTx(tx.id)}
              title="Restore transaction"
              style={{
                fontSize: "0.7rem",
                padding: "0.15rem 0.5rem",
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Restore
            </button>
          ) : (
            <button
              onClick={() => onRemoveTx(tx.id)}
              title="Remove from this group"
              style={{
                fontSize: "0.75rem",
                padding: "0.15rem 0.4rem",
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div style={{
      border: `1px solid ${enabled ? group.border : "var(--border)"}`,
      borderRadius: "var(--radius)",
      overflow: "hidden",
      marginBottom: "0.875rem",
      opacity: enabled ? 1 : 0.55,
      transition: "opacity 0.2s, border-color 0.2s",
    }}>
      {/* Header row — entire row collapses/expands on click */}
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.75rem 1rem",
          background: enabled ? group.bg : "var(--surface)",
          borderBottom: open ? `1px solid ${enabled ? group.border : "var(--border)"}` : "none",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {/* Toggle switch — stopPropagation so it doesn't also collapse */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleGroup(); }}
          title={enabled ? "Disable group" : "Enable group"}
          style={{
            width: "32px",
            height: "18px",
            borderRadius: "9px",
            background: enabled ? group.color : "var(--border)",
            border: "none",
            cursor: "pointer",
            position: "relative",
            flexShrink: 0,
            transition: "background 0.2s",
          }}
        >
          <span style={{
            position: "absolute",
            top: "2px",
            left: enabled ? "16px" : "2px",
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
          }} />
        </button>

        {/* Icon + label */}
        <span style={{ fontSize: "0.9rem" }}>{group.icon}</span>
        <span style={{ fontSize: "0.875rem", fontWeight: 600, color: enabled ? group.color : "var(--text-muted)", flex: 1 }}>
          {group.label}
          {excludedIds.length > 0 && (
            <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "var(--text-muted)", background: "var(--border)", borderRadius: "9999px", padding: "0.1rem 0.45rem" }}>
              {excludedIds.length} removed
            </span>
          )}
        </span>

        {/* Totals */}
        <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: enabled ? group.color : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {group.positive ? "+" : ""}{fmtAbs(effectiveTotal)}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", minWidth: "52px", textAlign: "right" }}>
          {visible.length} txns
        </span>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginLeft: "0.25rem" }}>
          {open ? "▲" : "▼"}
        </span>
      </div>

      {/* Body */}
      {open && (
        <div style={{ background: "var(--surface)", padding: "0.75rem 1rem" }}>
          {visible.length === 0 && excluded.length === 0 && (
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>No transactions found.</p>
          )}

          {visible.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.625rem", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", whiteSpace: "nowrap" }}>Date</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.625rem", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>Description</th>
                    <th style={{ textAlign: "right", padding: "0.35rem 0.625rem", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>Amount</th>
                    <th style={{ width: "60px" }} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((tx) => <TxRow key={tx.id} tx={tx} removed={false} />)}
                </tbody>
              </table>
            </div>
          )}

          {/* Excluded transactions (collapsible) */}
          {excluded.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <button
                onClick={() => setShowExcluded((s) => !s)}
                style={{ fontSize: "0.75rem", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0.1rem 0" }}
              >
                {showExcluded ? "▲" : "▶"} {excluded.length} removed transaction{excluded.length !== 1 ? "s" : ""} (click to {showExcluded ? "hide" : "show"})
              </button>
              {showExcluded && (
                <div style={{ overflowX: "auto", marginTop: "0.375rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {excluded.map((tx) => <TxRow key={tx.id} tx={tx} removed={true} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function IncomeHousingPage() {
  const { refreshKey } = useFinance();
  const currentYear = new Date().getFullYear().toString();
  const [year, setYear] = useState<string>(currentYear);
  const [report, setReport] = useState<IncomeHousingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persisted state
  const [toggles, setToggles] = useState<Record<string, boolean>>(loadToggles);
  const [excluded, setExcluded] = useState<Record<string, number[]>>(loadExcluded);

  const yearOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "", label: "All time" }];
    for (let y = Number(currentYear); y >= Number(currentYear) - 5; y--) {
      opts.push({ value: String(y), label: String(y) });
    }
    return opts;
  }, [currentYear]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getIncomeHousing(year || undefined)
      .then(setReport)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, refreshKey]);

  // Defaults: all groups enabled unless explicitly disabled
  function isEnabled(key: string) {
    return toggles[key] !== false;
  }

  function handleToggle(key: string) {
    const next = { ...toggles, [key]: !isEnabled(key) };
    setToggles(next);
    saveToggles(next);
  }

  function handleRemove(groupKey: string, txId: number) {
    const next = { ...excluded, [groupKey]: [...(excluded[groupKey] ?? []), txId] };
    setExcluded(next);
    saveExcluded(next);
  }

  function handleRestore(groupKey: string, txId: number) {
    const next = { ...excluded, [groupKey]: (excluded[groupKey] ?? []).filter((id) => id !== txId) };
    setExcluded(next);
    saveExcluded(next);
  }

  // ── Derived summary (respects toggles + exclusions) ───────────────────────

  const summary = useMemo(() => {
    if (!report) return null;

    let totalIncome = 0;
    let totalExpenses = 0;

    for (const g of report.groups) {
      if (!isEnabled(g.key)) continue;
      const exIds = excluded[g.key] ?? [];
      const effectiveTotal = g.transactions
        .filter((t) => !exIds.includes(t.id))
        .reduce((s, t) => s + t.amount, 0);
      if (g.positive) totalIncome += effectiveTotal;
      else totalExpenses += effectiveTotal; // already negative
    }

    return {
      totalIncome,
      totalExpenses: Math.abs(totalExpenses),
      net: totalIncome + totalExpenses,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, toggles, excluded]);

  const expenseGroups = report?.groups.filter((g) => !g.positive) ?? [];
  const enabledExpenseGroups = expenseGroups.filter((g) => isEnabled(g.key));

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <label style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontWeight: 600 }}>Year:</label>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{
            fontSize: "0.8125rem",
            padding: "0.25rem 0.625rem",
            background: "var(--surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            cursor: "pointer",
          }}
        >
          {yearOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Reset button — only show if there are any disabled groups or excluded txns */}
        {(Object.values(toggles).some((v) => v === false) || Object.values(excluded).some((arr) => arr.length > 0)) && (
          <button
            onClick={() => {
              setToggles({});
              setExcluded({});
              saveToggles({});
              saveExcluded({});
            }}
            style={{
              fontSize: "0.75rem",
              padding: "0.25rem 0.75rem",
              background: "transparent",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              cursor: "pointer",
            }}
          >
            Reset all
          </button>
        )}
      </div>

      {loading && <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Loading…</p>}
      {error && <p style={{ fontSize: "0.875rem", color: "#ef4444" }}>{error}</p>}

      {report && summary && !loading && (
        <>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.875rem", marginBottom: "1.75rem" }}>
            <SummaryCard
              label="Total Income"
              value={`+${fmtAbs(summary.totalIncome)}`}
              sub={`${report.groups.filter((g) => g.positive && isEnabled(g.key)).length} source${report.groups.filter((g) => g.positive && isEnabled(g.key)).length !== 1 ? "s" : ""} active`}
              color="var(--green)"
              bg="var(--green-bg)"
              border="var(--green-border)"
            />
            <SummaryCard
              label="Total Tracked Expenses"
              value={fmtAbs(summary.totalExpenses)}
              sub={`${enabledExpenseGroups.length} of ${expenseGroups.length} categories active`}
              color="var(--red)"
              bg="var(--red-bg)"
              border="var(--red-border)"
            />
            <SummaryCard
              label="Net"
              value={fmtSigned(summary.net)}
              sub="income minus tracked expenses"
              color={summary.net >= 0 ? "var(--green)" : "var(--red)"}
              bg={summary.net >= 0 ? "var(--green-bg)" : "var(--red-bg)"}
              border={summary.net >= 0 ? "var(--green-border)" : "var(--red-border)"}
            />
          </div>

          {/* Expense breakdown bar */}
          {enabledExpenseGroups.length > 0 && summary.totalExpenses > 0 && (
            <div style={{ marginBottom: "1.75rem" }}>
              <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                Expense Breakdown
              </p>
              <div style={{ display: "flex", height: "10px", borderRadius: "5px", overflow: "hidden", gap: "2px" }}>
                {enabledExpenseGroups.map((g) => {
                  const exIds = excluded[g.key] ?? [];
                  const eff = Math.abs(g.transactions.filter((t) => !exIds.includes(t.id)).reduce((s, t) => s + t.amount, 0));
                  const pct = summary.totalExpenses > 0 ? (eff / summary.totalExpenses) * 100 : 0;
                  return (
                    <div
                      key={g.key}
                      title={`${g.label}: ${fmtAbs(eff)} (${pct.toFixed(1)}%)`}
                      style={{ background: g.color, width: `${pct}%`, minWidth: pct > 0.5 ? "4px" : "0", transition: "width 0.3s" }}
                    />
                  );
                })}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem" }}>
                {enabledExpenseGroups.map((g) => {
                  const exIds = excluded[g.key] ?? [];
                  const eff = Math.abs(g.transactions.filter((t) => !exIds.includes(t.id)).reduce((s, t) => s + t.amount, 0));
                  const pct = summary.totalExpenses > 0 ? (eff / summary.totalExpenses) * 100 : 0;
                  return (
                    <span key={g.key} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: g.color, flexShrink: 0 }} />
                      {g.icon} {g.label} — {fmtAbs(eff)} ({pct.toFixed(0)}%)
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Group sections */}
          {report.groups.map((group) => (
            <GroupSection
              key={group.key}
              group={group}
              enabled={isEnabled(group.key)}
              excludedIds={excluded[group.key] ?? []}
              onToggleGroup={() => handleToggle(group.key)}
              onRemoveTx={(id) => handleRemove(group.key, id)}
              onRestoreTx={(id) => handleRestore(group.key, id)}
            />
          ))}
        </>
      )}
    </div>
  );
}
