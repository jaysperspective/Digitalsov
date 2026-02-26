import { useState } from "react";
import { getPeriodComparison } from "../api/client";
import type { PeriodComparison, TransactionFilters } from "../types";

interface Props {
  onNavigateToTransactions?: (filters: TransactionFilters) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDelta(n: number): string {
  return (n >= 0 ? "+" : "") + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function deltaColor(n: number, invert = false): string {
  if (n === 0) return "var(--text-secondary)";
  const positive = invert ? n < 0 : n > 0;
  return positive ? "var(--green)" : "var(--red)";
}

function pctStr(p: number | null): string {
  if (p === null) return "—";
  return (p >= 0 ? "+" : "") + p.toFixed(1) + "%";
}

// ── Date math presets ─────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function applyPreset(preset: string): { fromA: string; toA: string; fromB: string; toB: string } {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth(); // 0-indexed

  if (preset === "this-vs-last") {
    const firstThisMonth = new Date(yr, mo, 1);
    const lastThisMonth = new Date(yr, mo + 1, 0);
    const firstLastMonth = new Date(yr, mo - 1, 1);
    const lastLastMonth = new Date(yr, mo, 0);
    return {
      fromA: toYMD(firstLastMonth),
      toA: toYMD(lastLastMonth),
      fromB: toYMD(firstThisMonth),
      toB: toYMD(lastThisMonth),
    };
  }
  if (preset === "30d-vs-prior") {
    const today = new Date();
    const d30ago = new Date(today); d30ago.setDate(d30ago.getDate() - 30);
    const d60ago = new Date(today); d60ago.setDate(d60ago.getDate() - 60);
    const d31ago = new Date(today); d31ago.setDate(d31ago.getDate() - 31);
    return {
      fromA: toYMD(d60ago),
      toA: toYMD(d31ago),
      fromB: toYMD(d30ago),
      toB: toYMD(today),
    };
  }
  if (preset === "ytd-vs-prior-ytd") {
    const jan1 = new Date(yr, 0, 1);
    const jan1prior = new Date(yr - 1, 0, 1);
    const sameDay = new Date(yr - 1, mo, now.getDate());
    return {
      fromA: toYMD(jan1prior),
      toA: toYMD(sameDay),
      fromB: toYMD(jan1),
      toB: toYMD(now),
    };
  }
  return { fromA: "", toA: "", fromB: "", toB: "" };
}

// ── Delta bar ─────────────────────────────────────────────────────────────────

function DeltaBar({ a, b }: { a: number; b: number }) {
  const max = Math.max(Math.abs(a), Math.abs(b), 0.01);
  const aPct = Math.abs(a / max) * 100;
  const bPct = Math.abs(b / max) * 100;
  return (
    <div style={{ display: "flex", gap: "2px", alignItems: "center", minWidth: "80px" }}>
      <div style={{ width: `${aPct}%`, maxWidth: "50%", height: "6px", background: "var(--text-muted)", borderRadius: "1px", opacity: 0.5 }} />
      <div style={{ width: `${bPct}%`, maxWidth: "50%", height: "6px", background: "var(--accent)", borderRadius: "1px" }} />
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ComparePage({ onNavigateToTransactions }: Props) {
  const [fromA, setFromA] = useState("");
  const [toA, setToA] = useState("");
  const [fromB, setFromB] = useState("");
  const [toB, setToB] = useState("");
  const [result, setResult] = useState<PeriodComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePreset(preset: string) {
    const p = applyPreset(preset);
    setFromA(p.fromA); setToA(p.toA);
    setFromB(p.fromB); setToB(p.toB);
  }

  async function handleCompare() {
    if (!fromA || !toA || !fromB || !toB) {
      setError("All four date fields are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getPeriodComparison({ fromA, toA, fromB, toB });
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  }

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

  return (
    <div>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem", ...mono }}>Period Comparison</h2>

      {/* ── Date inputs ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        {/* Period A */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0.875rem" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: "0.5rem", ...mono }}>
            PERIOD A (baseline)
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="date" value={fromA} onChange={(e) => setFromA(e.target.value)} style={{ fontSize: "0.8125rem", flex: 1 }} />
            <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>–</span>
            <input type="date" value={toA} onChange={(e) => setToA(e.target.value)} style={{ fontSize: "0.8125rem", flex: 1 }} />
          </div>
        </div>

        {/* Period B */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0.875rem" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--accent)", letterSpacing: "0.08em", marginBottom: "0.5rem", ...mono }}>
            PERIOD B (comparison)
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="date" value={fromB} onChange={(e) => setFromB(e.target.value)} style={{ fontSize: "0.8125rem", flex: 1 }} />
            <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>–</span>
            <input type="date" value={toB} onChange={(e) => setToB(e.target.value)} style={{ fontSize: "0.8125rem", flex: 1 }} />
          </div>
        </div>
      </div>

      {/* Presets + Compare button */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem", alignItems: "center" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Presets:</span>
        {[
          { id: "this-vs-last", label: "This Month vs Last Month" },
          { id: "30d-vs-prior", label: "Last 30 vs Prior 30" },
          { id: "ytd-vs-prior-ytd", label: "YTD vs Prior YTD" },
        ].map((p) => (
          <button
            key={p.id}
            onClick={() => handlePreset(p.id)}
            style={{
              fontSize: "0.75rem",
              padding: "0.2rem 0.6rem",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            {p.label}
          </button>
        ))}
        <div style={{ flexGrow: 1 }} />
        <button
          onClick={handleCompare}
          disabled={loading}
          style={{
            fontSize: "0.8125rem",
            padding: "0.375rem 1rem",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            fontWeight: 600,
          }}
        >
          {loading ? "Comparing…" : "Compare →"}
        </button>
      </div>

      {error && <p style={{ color: "var(--red)", fontSize: "0.8125rem", marginBottom: "1rem" }}>{error}</p>}

      {result && (
        <>
          {result.notes.length > 0 && (
            <div style={{ marginBottom: "1rem", padding: "0.625rem 0.875rem", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "var(--radius)", fontSize: "0.8125rem", color: "#f59e0b" }}>
              {result.notes.map((n, i) => <div key={i}>{n}</div>)}
            </div>
          )}

          {/* ── Summary cards ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
            {[
              { label: "Income", a: result.totals.incomeA, b: result.totals.incomeB, delta: result.totals.incomeDelta, invert: false },
              { label: "Expenses", a: result.totals.expenseA, b: result.totals.expenseB, delta: result.totals.expenseDelta, invert: true },
              { label: "Net", a: result.totals.netA, b: result.totals.netB, delta: result.totals.netDelta, invert: false },
              { label: "Transactions", a: result.totals.txCountA, b: result.totals.txCountB, delta: result.totals.txCountDelta, invert: false, count: true },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "0.875rem",
                  background: "var(--surface-raised)",
                }}
              >
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "0.375rem", ...mono }}>
                  {card.label.toUpperCase()}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>
                  A: <span style={{ color: "var(--text-secondary)", ...mono }}>
                    {card.count ? String(card.a) : `$${fmt(card.a as number)}`}
                  </span>
                </div>
                <div style={{ fontSize: "0.8125rem", fontWeight: 700, ...mono, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
                  B: {card.count ? String(card.b) : `$${fmt(card.b as number)}`}
                </div>
                <div style={{ fontSize: "0.8125rem", fontWeight: 700, ...mono, color: deltaColor(card.delta as number, card.invert) }}>
                  {card.count
                    ? (card.delta as number) >= 0 ? `+${card.delta}` : String(card.delta)
                    : fmtDelta(card.delta as number)}
                </div>
              </div>
            ))}
          </div>

          {/* ── Category deltas ── */}
          {result.categoryDeltas.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.625rem", ...mono }}>Category Deltas</h3>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th style={{ textAlign: "right" }}>Period A</th>
                      <th style={{ textAlign: "right" }}>Period B</th>
                      <th style={{ textAlign: "right" }}>Delta</th>
                      <th style={{ textAlign: "right" }}>%</th>
                      <th>Bar</th>
                      {onNavigateToTransactions && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {result.categoryDeltas.map((row, i) => (
                      <tr key={i}>
                        <td>{row.category_name ?? "Uncategorized"}</td>
                        <td style={{ textAlign: "right", ...mono, color: "var(--text-secondary)" }}>{row.a_total < 0 ? "-" : "+"}{fmt(row.a_total)}</td>
                        <td style={{ textAlign: "right", ...mono }}>{row.b_total < 0 ? "-" : "+"}{fmt(row.b_total)}</td>
                        <td style={{ textAlign: "right", ...mono, color: deltaColor(row.delta, row.delta < 0) }}>
                          {fmtDelta(row.delta)}
                        </td>
                        <td style={{ textAlign: "right", ...mono, color: "var(--text-muted)", fontSize: "0.75rem" }}>
                          {pctStr(row.pct_change)}
                        </td>
                        <td><DeltaBar a={row.a_total} b={row.b_total} /></td>
                        {onNavigateToTransactions && (
                          <td>
                            {row.category_id != null && (
                              <button
                                onClick={() => onNavigateToTransactions({ category_id: row.category_id, from_date: fromB, to_date: toB })}
                                style={{ fontSize: "0.7rem", padding: "0.1rem 0.35rem", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
                              >
                                View ↗
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Merchant deltas ── */}
          {result.merchantDeltas.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.625rem", ...mono }}>Top Merchant Changes</h3>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Merchant</th>
                      <th style={{ textAlign: "right" }}>Period A</th>
                      <th style={{ textAlign: "right" }}>Period B</th>
                      <th style={{ textAlign: "right" }}>Delta</th>
                      <th style={{ textAlign: "right" }}>%</th>
                      {onNavigateToTransactions && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {result.merchantDeltas.map((row, i) => (
                      <tr key={i}>
                        <td style={{ color: "var(--text-secondary)" }}>{row.merchant}</td>
                        <td style={{ textAlign: "right", ...mono, color: "var(--text-muted)", fontSize: "0.75rem" }}>{row.a_total < 0 ? "-" : "+"}{fmt(row.a_total)}</td>
                        <td style={{ textAlign: "right", ...mono }}>{row.b_total < 0 ? "-" : "+"}{fmt(row.b_total)}</td>
                        <td style={{ textAlign: "right", ...mono, color: deltaColor(row.delta, row.delta < 0) }}>{fmtDelta(row.delta)}</td>
                        <td style={{ textAlign: "right", ...mono, color: "var(--text-muted)", fontSize: "0.75rem" }}>{pctStr(row.pct_change)}</td>
                        {onNavigateToTransactions && (
                          <td>
                            <button
                              onClick={() => onNavigateToTransactions({ merchant_search: row.merchant, from_date: fromB, to_date: toB })}
                              style={{ fontSize: "0.7rem", padding: "0.1rem 0.35rem", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
                            >
                              View ↗
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Recurring changes ── */}
          {(result.recurringChanges.new.length > 0 || result.recurringChanges.stopped.length > 0 || result.recurringChanges.changed.length > 0) && (
            <div>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.625rem", ...mono }}>Recurring Changes</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                {/* New */}
                <div style={{ border: "1px solid rgba(34,197,94,0.3)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--green)", letterSpacing: "0.08em", marginBottom: "0.5rem", ...mono }}>
                    NEW ({result.recurringChanges.new.length})
                  </div>
                  {result.recurringChanges.new.length === 0
                    ? <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>None</div>
                    : result.recurringChanges.new.map((r, i) => (
                      <div key={i} style={{ fontSize: "0.75rem", marginBottom: "0.3rem" }}>
                        <span style={{ color: "var(--text-secondary)" }}>{r.merchant}</span>
                        <span style={{ ...mono, color: "var(--text-muted)", marginLeft: "0.375rem" }}>${fmt(r.amount)}</span>
                        {r.cadence && <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginLeft: "0.25rem" }}>· {r.cadence}</span>}
                      </div>
                    ))}
                </div>

                {/* Stopped */}
                <div style={{ border: "1px solid rgba(248,73,96,0.3)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--red)", letterSpacing: "0.08em", marginBottom: "0.5rem", ...mono }}>
                    STOPPED ({result.recurringChanges.stopped.length})
                  </div>
                  {result.recurringChanges.stopped.length === 0
                    ? <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>None</div>
                    : result.recurringChanges.stopped.map((r, i) => (
                      <div key={i} style={{ fontSize: "0.75rem", marginBottom: "0.3rem" }}>
                        <span style={{ color: "var(--text-secondary)" }}>{r.merchant}</span>
                        <span style={{ ...mono, color: "var(--text-muted)", marginLeft: "0.375rem" }}>${fmt(r.amount)}</span>
                        {r.cadence && <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginLeft: "0.25rem" }}>· {r.cadence}</span>}
                      </div>
                    ))}
                </div>

                {/* Changed */}
                <div style={{ border: "1px solid rgba(245,158,11,0.3)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em", marginBottom: "0.5rem", ...mono }}>
                    AMOUNT CHANGED ({result.recurringChanges.changed.length})
                  </div>
                  {result.recurringChanges.changed.length === 0
                    ? <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>None</div>
                    : result.recurringChanges.changed.map((r, i) => (
                      <div key={i} style={{ fontSize: "0.75rem", marginBottom: "0.375rem" }}>
                        <div style={{ color: "var(--text-secondary)" }}>{r.merchant}</div>
                        <div style={{ ...mono, fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          ${fmt(r.amountA)} → ${fmt(r.amountB)}
                          <span style={{ color: deltaColor(r.delta, r.delta < 0), marginLeft: "0.375rem" }}>{fmtDelta(r.delta)}</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
