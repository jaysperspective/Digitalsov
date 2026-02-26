import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchTransactions, getCategories, getCandlestick, getNetWorth, getPeriodSummary, getRecurring, patchTransactionCategory } from "../api/client";
import type { CandleData, Category, NetWorthReport, PeriodSummary, RecurringGroup, Transaction } from "../types";
import CandlestickChart from "./CandlestickChart";

// ── Types ──────────────────────────────────────────────────────────────────────

type ViewMode = "year" | "month" | "week";

// ── Date helpers ───────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentYearAnchor(): string {
  return String(new Date().getFullYear());
}

function currentMonthAnchor(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentWeekAnchor(): string {
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
}

function getDateRange(
  mode: ViewMode,
  anchor: string
): { from: string; to: string; candlePeriod: "day" | "month" } {
  if (mode === "year") {
    return { from: `${anchor}-01-01`, to: `${anchor}-12-31`, candlePeriod: "month" };
  }
  if (mode === "month") {
    const [y, m] = anchor.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return {
      from: `${anchor}-01`,
      to: `${anchor}-${String(last).padStart(2, "0")}`,
      candlePeriod: "day",
    };
  }
  // week
  const start = new Date(anchor + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { from: anchor, to: end.toISOString().slice(0, 10), candlePeriod: "day" };
}

function navigate(mode: ViewMode, anchor: string, dir: 1 | -1): string {
  if (mode === "year") return String(parseInt(anchor) + dir);
  if (mode === "month") {
    let [y, m] = anchor.split("-").map(Number);
    m += dir;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const d = new Date(anchor + "T00:00:00");
  d.setDate(d.getDate() + dir * 7);
  return d.toISOString().slice(0, 10);
}

function anchorLabel(mode: ViewMode, anchor: string, to: string): string {
  if (mode === "year") return anchor;
  if (mode === "month") {
    const [y, m] = anchor.split("-").map(Number);
    return new Date(y, m - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  }
  const s = new Date(anchor + "T00:00:00");
  const e = new Date(to + "T00:00:00");
  const fmt = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}, ${e.getFullYear()}`;
}

function isAtOrAfterToday(mode: ViewMode, anchor: string): boolean {
  const today = todayISO();
  if (mode === "year") return anchor >= today.slice(0, 4);
  if (mode === "month") return anchor >= today.slice(0, 7);
  return anchor >= today.slice(0, 10);
}

function getPrevDateRange(mode: ViewMode, anchor: string): { from: string; to: string } {
  const prev = navigate(mode, anchor, -1);
  const range = getDateRange(mode, prev);
  return { from: range.from, to: range.to };
}

function aggregateToWeekly(daily: CandleData[]): CandleData[] {
  if (daily.length === 0) return [];
  const weekMap = new Map<string, CandleData[]>();
  for (const d of daily) {
    const date = new Date(d.period + "T00:00:00");
    const day = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    const key = monday.toISOString().slice(0, 10);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(d);
  }
  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, candles]) => ({
      period: weekStart,
      open: candles[0].open,
      close: candles[candles.length - 1].close,
      high: Math.max(...candles.map((c) => c.high)),
      low: Math.min(...candles.map((c) => c.low)),
      volume: candles.reduce((sum, c) => sum + c.volume, 0),
    }));
}

function fmtDay(yyyymmdd: string): string {
  return yyyymmdd.slice(5); // MM-DD
}

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return (curr - prev) / Math.abs(prev) * 100;
}

// ── Delta badge ────────────────────────────────────────────────────────────────

function Delta({ value }: { value: number }) {
  return (
    <span
      style={{
        fontSize: "0.68rem",
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        padding: "0.1rem 0.35rem",
        borderRadius: "2px",
        background: value >= 0 ? "var(--green-bg)" : "var(--red-bg)",
        border: `1px solid ${value >= 0 ? "var(--green-border)" : "var(--red-border)"}`,
        color: value >= 0 ? "var(--green)" : "var(--red)",
        whiteSpace: "nowrap",
      }}
    >
      {value >= 0 ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  sub,
  delta,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
  delta?: number | null;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "0.875rem 1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <p style={{ fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>
          {label}
        </p>
        {delta != null && <Delta value={delta} />}
      </div>
      <p style={{ fontSize: "1.75rem", fontWeight: 700, color: color ?? "var(--text)", fontFamily: "var(--font-mono)", lineHeight: 1.1, marginBottom: "0.3rem" }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{sub}</p>}
    </div>
  );
}

// ── Tooltip components ─────────────────────────────────────────────────────────

function DollarTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0.5rem 0.75rem", fontSize: "0.8125rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary)" }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: ${fmtUSD(p.value)}
        </p>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { category_color: string } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0.5rem 0.75rem", fontSize: "0.8125rem" }}>
      <p style={{ color: p.payload.category_color, fontWeight: 600 }}>{p.name}</p>
      <p style={{ color: "var(--text-secondary)" }}>${fmtUSD(p.value)}</p>
    </div>
  );
}

// ── Transaction table ──────────────────────────────────────────────────────────

type SortKey = "date" | "description" | "amount";
type SortDir = "asc" | "desc";

function sortTxns(txns: Transaction[], key: SortKey, dir: SortDir): Transaction[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...txns].sort((a, b) => {
    let cmp = 0;
    if (key === "date") cmp = a.posted_date.localeCompare(b.posted_date);
    else if (key === "description") cmp = a.description_raw.localeCompare(b.description_raw);
    else if (key === "amount") cmp = a.amount_cents - b.amount_cents;
    return cmp * factor;
  });
}

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      style={{
        cursor: "pointer",
        userSelect: "none",
        textAlign: align,
        whiteSpace: "nowrap",
        color: active ? "var(--text)" : "var(--text-secondary)",
      }}
    >
      {label}{" "}
      <span style={{ opacity: active ? 1 : 0.4 }}>{active && dir === "asc" ? "↑" : "↓"}</span>
    </th>
  );
}

// ── Inline category edit cell ─────────────────────────────────────────────────

function CategoryEditCell({
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
      // keep editing open on error
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
        style={{ fontSize: "0.75rem", padding: "0.1rem 0.3rem", maxWidth: "150px", background: "var(--surface-raised)", color: "var(--text)", border: "1px solid var(--border-strong)", borderRadius: "4px" }}
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
      onClick={() => setEditing(true)}
      title="Click to change category"
      style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
    >
      {tx.category_name && tx.category_color ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.2rem",
            padding: "0.1rem 0.4rem",
            borderRadius: "9999px",
            fontSize: "0.68rem",
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
        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>— <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>assign</span></span>
      )}
    </span>
  );
}

// ── Transaction table ─────────────────────────────────────────────────────────

function DashboardTransactionTable({
  txns,
  total,
  categories,
  onUpdated,
}: {
  txns: Transaction[];
  total: number;
  categories: Category[];
  onUpdated: (updated: Transaction) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = useMemo(() => sortTxns(txns, sortKey, sortDir), [txns, sortKey, sortDir]);

  return (
    <div
      style={{
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1rem 1.25rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-secondary)" }}>
          Transactions
        </p>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
          {total > txns.length ? `showing ${txns.length} of ${total}` : `${total} total`}
        </span>
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: "auto" }}>Click a category to edit</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <SortHeader label="Date" sortKey="date" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Description" sortKey="description" current={sortKey} dir={sortDir} onClick={handleSort} />
              <th style={{ color: "var(--text-secondary)" }}>Category</th>
              <SortHeader label="Amount" sortKey="amount" current={sortKey} dir={sortDir} onClick={handleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((tx) => (
              <tr key={tx.id}>
                <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                  {tx.posted_date}
                </td>
                <td
                  style={{ maxWidth: "320px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}
                  title={tx.description_raw}
                >
                  {tx.description_raw}
                </td>
                <td>
                  <CategoryEditCell tx={tx} categories={categories} onUpdated={onUpdated} />
                </td>
                <td
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    color: tx.amount < 0 ? "var(--red)" : "var(--green)",
                  }}
                >
                  {tx.amount < 0 ? "-" : "+"}${fmtUSD(Math.abs(tx.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DashboardPage({ refreshKey }: { refreshKey: number }) {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState<string>(currentMonthAnchor);
  const [chartGranularity, setChartGranularity] = useState<"month" | "week" | "day">("day");

  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<PeriodSummary | null>(null);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorthReport | null>(null);
  const [netWorthOpen, setNetWorthOpen] = useState(false);
  const [recurring, setRecurring] = useState<RecurringGroup[]>([]);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [expandedRecurring, setExpandedRecurring] = useState<Set<string>>(new Set());

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {});
  }, [refreshKey]);

  const { from, to } = getDateRange(viewMode, anchor);
  const { from: prevFrom, to: prevTo } = getPrevDateRange(viewMode, anchor);
  const apiCandlePeriod: "day" | "month" = chartGranularity === "month" ? "month" : "day";

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getPeriodSummary(from, to),
      getPeriodSummary(prevFrom, prevTo),
      getCandlestick(from, to, apiCandlePeriod),
      fetchTransactions({ limit: 500, offset: 0, from_date: from, to_date: to }),
    ])
      .then(([s, ps, rawCandles, t]) => {
        setSummary(s);
        setPrevSummary(ps);
        setCandles(chartGranularity === "week" ? aggregateToWeekly(rawCandles) : rawCandles);
        setTxns(t.items);
        setTxTotal(t.total);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [from, to, prevFrom, prevTo, apiCandlePeriod, chartGranularity, refreshKey]);

  useEffect(() => {
    if (viewMode === "year") {
      getNetWorth().then(setNetWorth).catch(() => {});
      getRecurring().then(setRecurring).catch(() => {});
    }
  }, [viewMode, refreshKey]);

  // Switch view mode and reset anchor to current period
  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    setChartGranularity(mode === "year" ? "month" : "day");
    if (mode === "year") setAnchor(currentYearAnchor());
    else if (mode === "month") setAnchor(currentMonthAnchor());
    else setAnchor(currentWeekAnchor());
  };

  const pieData = useMemo(() => {
    if (!summary) return [];
    return summary.by_category
      .filter((c) => c.total < 0)
      .map((c) => ({
        name: c.category_name ?? "Uncategorized",
        value: Math.abs(c.total),
        category_color: c.category_color,
        category_icon: c.category_icon,
      }));
  }, [summary]);

  const showDailyChart = viewMode !== "year" && summary && summary.by_day.length > 0;

  const handleTxUpdated = (updated: Transaction) => {
    setTxns((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* ── View mode + navigation ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
        {/* View mode toggle */}
        <div
          style={{
            display: "flex",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          {(["year", "month", "week"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => handleViewMode(mode)}
              style={{
                fontSize: "0.8125rem",
                padding: "0.3rem 0.875rem",
                background: viewMode === mode ? "var(--accent)" : "transparent",
                color: viewMode === mode ? "#fff" : "var(--text-secondary)",
                border: "none",
                fontWeight: viewMode === mode ? 600 : 400,
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <button
          onClick={() => setAnchor((a) => navigate(viewMode, a, -1))}
          style={{ fontSize: "0.8125rem", padding: "0.3rem 0.625rem" }}
        >
          ←
        </button>

        <span
          style={{
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--text-primary)",
            minWidth: 180,
            textAlign: "center",
          }}
        >
          {anchorLabel(viewMode, anchor, to)}
        </span>

        <button
          onClick={() => setAnchor((a) => navigate(viewMode, a, 1))}
          disabled={isAtOrAfterToday(viewMode, anchor)}
          style={{ fontSize: "0.8125rem", padding: "0.3rem 0.625rem" }}
        >
          →
        </button>

        {loading && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "0.25rem" }}>
            Loading…
          </span>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "0.8125rem" }}>{error}</p>
      )}

      {/* ── Stat cards ── */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
          <StatCard
            label="Total Spent"
            value={`$${fmtUSD(Math.abs(summary.total_expenses))}`}
            color="var(--red)"
            delta={prevSummary ? pctChange(Math.abs(summary.total_expenses), Math.abs(prevSummary.total_expenses)) : null}
            sub={prevSummary ? `vs $${fmtUSD(Math.abs(prevSummary.total_expenses))} last period` : undefined}
          />
          <StatCard
            label="Total Income"
            value={`$${fmtUSD(summary.total_income)}`}
            color="var(--green)"
            delta={prevSummary ? pctChange(summary.total_income, prevSummary.total_income) : null}
            sub={prevSummary ? `vs $${fmtUSD(prevSummary.total_income)} last period` : undefined}
          />
          <StatCard
            label="Net"
            value={`${summary.net >= 0 ? "+" : ""}$${fmtUSD(summary.net)}`}
            color={summary.net >= 0 ? "var(--green)" : "var(--red)"}
            delta={prevSummary && prevSummary.net !== 0 ? pctChange(summary.net, prevSummary.net) : null}
            sub={prevSummary ? `vs ${prevSummary.net >= 0 ? "+" : ""}$${fmtUSD(prevSummary.net)} last period` : undefined}
          />
          <StatCard
            label="Transactions"
            value={String(summary.transaction_count)}
            delta={prevSummary && prevSummary.transaction_count > 0 ? pctChange(summary.transaction_count, prevSummary.transaction_count) : null}
            sub={prevSummary ? `vs ${prevSummary.transaction_count} last period` : undefined}
          />
        </div>
      )}

      {/* ── Candlestick chart ── */}
      {candles.length > 0 && (() => {
        const granLabel = chartGranularity === "month" ? "Monthly" : chartGranularity === "week" ? "Weekly" : "Daily";
        const chartTitle = viewMode === "year"
          ? `${anchor} — ${granLabel} Balance Trend`
          : viewMode === "week"
          ? `Weekly Balance — ${granLabel} Candles`
          : `${anchorLabel("month", anchor, to)} — ${granLabel} Balance Trend`;
        const chartPeriodType: "day" | "month" = chartGranularity === "month" ? "month" : "day";
        const granOptions: ("month" | "week" | "day")[] =
          viewMode === "year" ? ["month", "week", "day"] :
          viewMode === "month" ? ["week", "day"] : ["day"];
        return (
          <div
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "1rem 1.25rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)" }}>
                {chartTitle}
              </p>
              {granOptions.length > 1 && (
                <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                  {granOptions.map((g) => (
                    <button
                      key={g}
                      onClick={() => setChartGranularity(g)}
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.2rem 0.625rem",
                        background: chartGranularity === g ? "var(--accent)" : "transparent",
                        color: chartGranularity === g ? "#fff" : "var(--text-muted)",
                        border: "none",
                        fontWeight: chartGranularity === g ? 600 : 400,
                        cursor: "pointer",
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "0.04em",
                        transition: "background 0.15s, color 0.15s",
                      }}
                    >
                      {g === "month" ? "MO" : g === "week" ? "WK" : "DY"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <CandlestickChart data={candles} height={260} periodType={chartPeriodType} />
          </div>
        );
      })()}

      {/* ── Pie + daily bar charts ── */}
      {summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: showDailyChart ? "1fr 1fr" : "1fr",
            gap: "1.25rem",
          }}
        >
          {/* Spending by category */}
          <div
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "1rem 1.25rem",
            }}
          >
            <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              Spending by Category
            </p>
            {pieData.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", textAlign: "center", padding: "3rem 0" }}>
                No expense data
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="45%"
                    innerRadius={70}
                    outerRadius={120}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.category_color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend
                    formatter={(value) => (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Daily activity bar chart (month / week only) */}
          {showDailyChart && (
            <div
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "1rem 1.25rem",
              }}
            >
              <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                Daily Activity
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={summary.by_day} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDay}
                    tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${v}`}
                    width={52}
                  />
                  <Tooltip content={<DollarTooltip />} />
                  <Bar dataKey="expenses" name="Expenses" fill="var(--red)" radius={[2, 2, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="income" name="Income" fill="var(--green)" radius={[2, 2, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── Budget tracking (month view only) ── */}
      {viewMode === "month" && summary && (() => {
        const budgetedCats = categories.filter((c) => c.monthly_budget != null);
        if (budgetedCats.length === 0) return null;
        return (
          <div style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1rem 1.25rem" }}>
            <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              Budget Tracking
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              {budgetedCats.map((cat) => {
                const spent = summary.by_category.find((c) => c.category_id === cat.id);
                const spentAbs = spent ? Math.abs(spent.total) : 0;
                const budget = cat.monthly_budget! / 100;
                const pct = Math.min((spentAbs / budget) * 100, 100);
                const overBudget = spentAbs > budget;
                return (
                  <div key={cat.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", marginBottom: "0.2rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>{cat.icon} {cat.name}</span>
                      <span style={{ color: overBudget ? "var(--red)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                        ${fmtUSD(spentAbs)} / ${fmtUSD(budget)} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div style={{ height: "4px", background: "var(--surface-raised)", borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: overBudget ? "var(--red)" : "var(--accent)", borderRadius: "2px", transition: "width 0.3s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Transaction list ── */}
      {txns.length > 0 && (
        <DashboardTransactionTable txns={txns} total={txTotal} categories={categories} onUpdated={handleTxUpdated} />
      )}

      {/* ── Recurring transactions (year view only) ── */}
      {viewMode === "year" && recurring.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <button
            onClick={() => setRecurringOpen((v) => !v)}
            style={{
              width: "100%", textAlign: "left", background: "transparent", border: "none",
              borderBottom: recurringOpen ? "1px solid var(--border)" : "none",
              padding: "0.625rem 1rem", display: "flex", alignItems: "center", gap: "0.5rem",
              cursor: "pointer", color: "var(--text-muted)",
              fontFamily: "var(--font-mono)", fontSize: "0.7rem", fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.08em",
            }}
          >
            {recurringOpen ? "▼" : "▶"} RECURRING TRANSACTIONS ({recurring.length})
          </button>
          {recurringOpen && (
            <div style={{ padding: "0.75rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              {recurring.map((g) => {
                const expanded = expandedRecurring.has(g.merchant_key);
                return (
                  <div key={g.merchant_key} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 0.875rem", background: "var(--surface-raised)", cursor: "pointer" }}
                      onClick={() => setExpandedRecurring((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.merchant_key)) next.delete(g.merchant_key);
                        else next.add(g.merchant_key);
                        return next;
                      })}
                    >
                      <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)", flex: 1 }}>{g.merchant}</span>
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "9999px", background: "rgba(99,102,241,0.12)", color: "var(--accent)", border: "1px solid rgba(99,102,241,0.3)" }}>
                        {g.pattern}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: g.avg_amount < 0 ? "var(--red)" : "var(--green)", fontFamily: "var(--font-mono)" }}>
                        avg ${fmtUSD(Math.abs(g.avg_amount))}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{g.count}×</span>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{expanded ? "▾" : "▸"}</span>
                    </div>
                    {expanded && (
                      <div style={{ padding: "0.5rem 0.875rem" }}>
                        {g.transactions.slice(0, 6).map((t) => (
                          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", padding: "0.2rem 0", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{t.posted_date}</span>
                            <span style={{ color: t.amount < 0 ? "var(--red)" : "var(--green)", fontFamily: "var(--font-mono)" }}>${fmtUSD(Math.abs(t.amount))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Net worth (year view only) ── */}
      {viewMode === "year" && netWorth && netWorth.accounts.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <button
            onClick={() => setNetWorthOpen((v) => !v)}
            style={{
              width: "100%", textAlign: "left", background: "transparent", border: "none",
              borderBottom: netWorthOpen ? "1px solid var(--border)" : "none",
              padding: "0.625rem 1rem", display: "flex", alignItems: "center", gap: "0.5rem",
              cursor: "pointer", color: "var(--text-muted)",
              fontFamily: "var(--font-mono)", fontSize: "0.7rem", fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.08em",
            }}
          >
            {netWorthOpen ? "▼" : "▶"} NET FLOW BY ACCOUNT
          </button>
          {netWorthOpen && (
            <div style={{ padding: "0.75rem 1.25rem" }}>
              <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", color: "var(--text-muted)", paddingBottom: "0.375rem", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Account</th>
                    <th style={{ textAlign: "left", color: "var(--text-muted)", paddingBottom: "0.375rem", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Type</th>
                    <th style={{ textAlign: "right", color: "var(--text-muted)", paddingBottom: "0.375rem", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Net Flow</th>
                  </tr>
                </thead>
                <tbody>
                  {netWorth.accounts.map((a, i) => (
                    <tr key={i}>
                      <td style={{ padding: "0.375rem 0", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>{a.label}</td>
                      <td style={{ padding: "0.375rem 0", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>{a.type ?? "—"}</td>
                      <td style={{ padding: "0.375rem 0", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: a.total_net >= 0 ? "var(--green)" : "var(--red)", borderBottom: "1px solid var(--border)" }}>
                        {a.total_net >= 0 ? "+" : ""}${fmtUSD(a.total_net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
