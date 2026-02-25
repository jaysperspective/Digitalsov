/**
 * TaxSummaryPage — annual tax / financial year summary.
 *
 * Pulls from:
 *   - /reports/income-housing?year=YYYY  (tracked income + fixed expenses)
 *   - /reports/category-breakdown?from=YYYY-01&to=YYYY-12  (full expense breakdown)
 *
 * Provides a CSV download via /reports/tax-export?year=YYYY.
 */

import { useEffect, useState } from "react";
import { getCategories, getCategoryBreakdown, getIncomeHousing, getPeriodSummary, taxExportURL } from "../api/client";
import type { Category, CategoryBreakdown, IncomeHousingReport, PeriodSummary } from "../types";

interface Props {
  refreshKey?: number;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => String(CURRENT_YEAR - i));

export default function TaxSummaryPage({ refreshKey }: Props) {
  const [year, setYear] = useState(String(CURRENT_YEAR - 1)); // default: last year
  const [ihp, setIhp] = useState<IncomeHousingReport | null>(null);
  const [breakdown, setBreakdown] = useState<CategoryBreakdown | null>(null);
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null);
  const [categoryMap, setCategoryMap] = useState<Map<number, Category>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories().then((cats) => {
      setCategoryMap(new Map(cats.map((c) => [c.id, c])));
    }).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIhp(null);
    setBreakdown(null);
    setPeriodSummary(null);

    Promise.all([
      getIncomeHousing(year),
      getCategoryBreakdown(`${year}-01`, `${year}-12`),
      getPeriodSummary(`${year}-01-01`, `${year}-12-31`),
    ])
      .then(([ihpData, bdData, psData]) => {
        if (!cancelled) {
          setIhp(ihpData);
          setBreakdown(bdData);
          setPeriodSummary(psData);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [year, refreshKey]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  // Top-level totals come from period_summary (Transfer-excluded, same as Dashboard)
  const totalIncome = periodSummary?.total_income ?? 0;
  const totalExpenses = periodSummary?.total_expenses ?? 0;
  const net = periodSummary?.net ?? 0;

  // Per-category breakdown (excludes Transfer-type rows but keeps Transfer category)
  const expenseCategories = breakdown?.categories.filter((c) => c.total < 0)
    .filter((c) => c.category_name !== "Transfer") // hide transfer from breakdown too
    .sort((a, b) => a.total - b.total) ?? [];

  // Tracked income groups (positive)
  const incomeGroups = ihp?.groups.filter((g) => g.positive) ?? [];
  const expenseGroups = ihp?.groups.filter((g) => !g.positive) ?? [];

  // Any positive-amount transactions not covered by tracked income groups
  const trackedIncomeTotal = incomeGroups.reduce((s, g) => s + g.total, 0);
  const untrackedIncome = Math.round((totalIncome - trackedIncomeTotal) * 100) / 100;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Toolbar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: "0.375rem" }}>
          {YEARS.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              style={{
                fontSize: "0.8125rem",
                padding: "0.25rem 0.75rem",
                background: year === y ? "var(--accent)" : "transparent",
                color: year === y ? "#fff" : "var(--text-secondary)",
                border: `1px solid ${year === y ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--radius)",
                fontWeight: year === y ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {y}
            </button>
          ))}
        </div>

        <div style={{ flexGrow: 1 }} />

        <a
          href={taxExportURL(year)}
          download={`transactions_${year}.csv`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.8125rem",
            padding: "0.375rem 1rem",
            background: "var(--accent)",
            color: "#fff",
            borderRadius: "var(--radius)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          ↓ Download {year} CSV
        </a>
      </div>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "0.875rem", marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {loading && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Loading {year} data…</p>
      )}

      {!loading && breakdown && ihp && periodSummary && (
        <>
          {/* ── Top summary cards ── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.75rem",
              marginBottom: "1.75rem",
            }}
          >
            {[
              { label: "Total Income", value: totalIncome, color: "var(--green)" },
              { label: "Total Expenses", value: totalExpenses, color: "var(--red)" },
              { label: "Net", value: net, color: net >= 0 ? "#22c55e" : "#f87171" },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                style={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "1rem 1.25rem",
                }}
              >
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                  {label}
                </p>
                <p style={{ fontSize: "1.375rem", fontWeight: 700, color }}>{fmt(value)}</p>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
            {/* ── Left: Tracked income sources ── */}
            <div>
              <Section title="Income Sources">
                {incomeGroups.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>No income groups tracked.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                    <thead>
                      <tr>
                        <Th>Source</Th>
                        <Th right>Transactions</Th>
                        <Th right>Total</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeGroups.map((g) => (
                        <tr key={g.key}>
                          <Td>
                            <span style={{ marginRight: "0.375rem" }}>{g.icon}</span>
                            {g.label}
                          </Td>
                          <Td right>{g.count}</Td>
                          <Td right style={{ color: "var(--green)", fontWeight: 600 }}>
                            {fmt(g.total)}
                          </Td>
                        </tr>
                      ))}
                      {untrackedIncome > 0.01 && (
                        <tr>
                          <Td style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                            ⋯ Other (investments, refunds, untracked)
                          </Td>
                          <Td right style={{ color: "var(--text-muted)" }}>—</Td>
                          <Td right style={{ color: "var(--green)", fontWeight: 600 }}>
                            {fmt(untrackedIncome)}
                          </Td>
                        </tr>
                      )}
                      <tr style={{ borderTop: "1px solid var(--border)" }}>
                        <Td style={{ fontWeight: 700 }}>Total</Td>
                        <Td right style={{ fontWeight: 700 }}>—</Td>
                        <Td right style={{ color: "var(--green)", fontWeight: 700 }}>
                          {fmt(totalIncome)}
                        </Td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </Section>

              {/* ── Tracked fixed expenses ── */}
              <Section title="Fixed Expenses" style={{ marginTop: "1.25rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr>
                      <Th>Category</Th>
                      <Th right>Transactions</Th>
                      <Th right>Total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseGroups.map((g) => (
                      <tr key={g.key}>
                        <Td>
                          <span style={{ marginRight: "0.375rem" }}>{g.icon}</span>
                          {g.label}
                        </Td>
                        <Td right>{g.count}</Td>
                        <Td right style={{ color: "var(--red)", fontWeight: 600 }}>
                          {fmt(g.total)}
                        </Td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "1px solid var(--border)" }}>
                      <Td style={{ fontWeight: 700 }}>Total</Td>
                      <Td right style={{ fontWeight: 700 }}>
                        {expenseGroups.reduce((s, g) => s + g.count, 0)}
                      </Td>
                      <Td right style={{ color: "var(--red)", fontWeight: 700 }}>
                        {fmt(expenseGroups.reduce((s, g) => s + g.total, 0))}
                      </Td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            </div>

            {/* ── Right: Full category breakdown ── */}
            <div>
              <Section title="All Expenses by Category">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr>
                      <Th>Category</Th>
                      <Th right>Txns</Th>
                      <Th right>Total</Th>
                      <Th right>% of Exp.</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseCategories.map((c) => {
                      const pct = totalExpenses !== 0
                        ? Math.abs(c.total / totalExpenses) * 100
                        : 0;
                      const catMeta = c.category_id != null ? categoryMap.get(c.category_id) : undefined;
                      const isDeductible = catMeta?.tax_deductible ?? false;
                      return (
                        <tr key={c.category_id ?? "uncat"}>
                          <Td>
                            <span
                              style={{
                                display: "inline-block",
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: c.category_color || "#94a3b8",
                                marginRight: "0.375rem",
                              }}
                            />
                            {c.category_name || "Uncategorized"}
                            {isDeductible && (
                              <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", fontWeight: 600, color: "var(--green)", background: "var(--green-bg)", border: "1px solid var(--green-border)", borderRadius: "9999px", padding: "0.05rem 0.35rem" }}>
                                ✓ deductible
                              </span>
                            )}
                          </Td>
                          <Td right>{c.count}</Td>
                          <Td right style={{ color: "var(--red)" }}>{fmt(c.total)}</Td>
                          <Td right style={{ color: "var(--text-muted)" }}>
                            {pct.toFixed(1)}%
                          </Td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: "1px solid var(--border)" }}>
                      <Td style={{ fontWeight: 700 }}>Total</Td>
                      <Td right style={{ fontWeight: 700 }}>
                        {expenseCategories.reduce((s, c) => s + c.count, 0)}
                      </Td>
                      <Td right style={{ color: "var(--red)", fontWeight: 700 }}>
                        {fmt(totalExpenses)}
                      </Td>
                      <Td right />
                    </tr>
                    {(() => {
                      const deductibleCats = expenseCategories.filter((c) => {
                        const m = c.category_id != null ? categoryMap.get(c.category_id) : undefined;
                        return m?.tax_deductible;
                      });
                      if (deductibleCats.length === 0) return null;
                      const deductibleTotal = deductibleCats.reduce((s, c) => s + c.total, 0);
                      return (
                        <tr style={{ borderTop: "1px solid var(--green-border)", background: "var(--green-bg)" }}>
                          <Td style={{ fontWeight: 700, color: "var(--green)" }}>Potentially Deductible Total</Td>
                          <Td right style={{ fontWeight: 700, color: "var(--green)" }}>
                            {deductibleCats.reduce((s, c) => s + c.count, 0)}
                          </Td>
                          <Td right style={{ color: "var(--green)", fontWeight: 700 }}>
                            {fmt(deductibleTotal)}
                          </Td>
                          <Td right />
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Mini layout components ─────────────────────────────────────────────────────

function Section({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          padding: "0.625rem 1rem",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-raised)",
        }}
      >
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
          }}
        >
          {title}
        </p>
      </div>
      <div style={{ padding: "0.75rem 1rem" }}>{children}</div>
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{
        textAlign: right ? "right" : "left",
        fontSize: "0.6875rem",
        fontWeight: 600,
        color: "var(--text-muted)",
        paddingBottom: "0.5rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  style,
}: {
  children?: React.ReactNode;
  right?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        textAlign: right ? "right" : "left",
        padding: "0.375rem 0",
        borderBottom: "1px solid var(--border)",
        color: "var(--text-secondary)",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
