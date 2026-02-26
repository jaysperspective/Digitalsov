import { useEffect, useState } from "react";
import { getDataHealth } from "../api/client";
import { useFinance } from "../context/FinanceContext";
import type { DataHealthReport, TransactionFilters } from "../types";

interface Props {
  onNavigate?: (tab: string, section?: string, filters?: TransactionFilters) => void;
}

function HealthCard({
  label,
  count,
  status,
  actionLabel,
  onAction,
  informational,
  formatValue,
}: {
  label: string;
  count: number | string;
  status: "ok" | "warn" | "error" | "info";
  actionLabel?: string;
  onAction?: () => void;
  informational?: boolean;
  formatValue?: (v: number) => string;
}) {
  const statusColor =
    status === "ok"
      ? "var(--green)"
      : status === "warn"
      ? "#f59e0b"
      : status === "error"
      ? "var(--red)"
      : "#3b82f6";

  const statusBg =
    status === "ok"
      ? "rgba(0,217,126,0.08)"
      : status === "warn"
      ? "rgba(245,158,11,0.08)"
      : status === "error"
      ? "rgba(248,73,96,0.08)"
      : "rgba(59,130,246,0.08)";

  const statusIcon =
    status === "ok" ? "✓" : status === "warn" ? "!" : status === "error" ? "✗" : "i";

  const displayValue =
    typeof count === "number" && formatValue ? formatValue(count) : String(count);

  return (
    <div
      style={{
        background: "var(--surface-raised)",
        border: `1px solid ${statusColor}33`,
        borderLeft: `3px solid ${statusColor}`,
        borderRadius: "0 var(--radius) var(--radius) 0",
        padding: "0.875rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.875rem",
      }}
    >
      <div
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "50%",
          background: statusBg,
          border: `1px solid ${statusColor}55`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: "0.7rem",
          fontWeight: 700,
          color: statusColor,
        }}
      >
        {statusIcon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>
          {label}
        </div>
        <div
          style={{
            fontSize: "1.375rem",
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            color: informational ? "var(--text)" : statusColor,
            lineHeight: 1.2,
          }}
        >
          {displayValue}
        </div>
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          style={{
            fontSize: "0.75rem",
            padding: "0.25rem 0.75rem",
            background: statusColor + "22",
            color: statusColor,
            border: `1px solid ${statusColor}55`,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default function DataHealthPage({ onNavigate }: Props) {
  const { refreshKey } = useFinance();
  const [report, setReport] = useState<DataHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getDataHealth()
      .then(setReport)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = (tab: string, section?: string, filters?: TransactionFilters) => {
    onNavigate?.(tab, section, filters);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text)", margin: 0 }}>
            Data Health
          </h2>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            At-a-glance quality metrics for your finance data.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            marginLeft: "auto",
            fontSize: "0.75rem",
            padding: "0.25rem 0.625rem",
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "0.8125rem" }}>{error}</p>
      )}

      {report && (
        <>
          {/* Metric grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "0.75rem",
            }}
          >
            <HealthCard
              label="Uncategorized transactions"
              count={report.uncategorized_count}
              status={report.uncategorized_count === 0 ? "ok" : report.uncategorized_count > 50 ? "error" : "warn"}
              actionLabel={report.uncategorized_count > 0 ? "Review" : undefined}
              onAction={() => nav("transactions", "uncategorized")}
            />
            <HealthCard
              label="Imports missing account label"
              count={report.imports_missing_account_label_count}
              status={report.imports_missing_account_label_count === 0 ? "ok" : "warn"}
              actionLabel={report.imports_missing_account_label_count > 0 ? "Review" : undefined}
              onAction={() => nav("import")}
            />
            <HealthCard
              label="Merchants without canonical"
              count={report.merchants_uncanonicalized_count}
              status={report.merchants_uncanonicalized_count === 0 ? "ok" : "warn"}
              actionLabel={report.merchants_uncanonicalized_count > 0 ? "Add Aliases" : undefined}
              onAction={() => nav("transactions", "aliases")}
            />
            <HealthCard
              label="Possible duplicate groups"
              count={report.possible_duplicates_count}
              status={report.possible_duplicates_count === 0 ? "ok" : "warn"}
              actionLabel={report.possible_duplicates_count > 0 ? "Audit" : undefined}
              onAction={() => nav("tax", "audit")}
            />
            <HealthCard
              label="Transfer candidates"
              count={report.transfer_candidates_count}
              status={report.transfer_candidates_count === 0 ? "ok" : "warn"}
              actionLabel={report.transfer_candidates_count > 0 ? "Confirm Transfers" : undefined}
              onAction={() => nav("tax", "audit")}
            />
            <HealthCard
              label="Active rules"
              count={report.active_rules_count}
              status={report.active_rules_count > 0 ? "ok" : "info"}
              informational
            />
            <HealthCard
              label="Total transactions"
              count={report.total_transactions}
              status="info"
              informational
            />
            <HealthCard
              label="Last import"
              count={
                report.last_import_date
                  ? new Date(report.last_import_date).toLocaleDateString()
                  : "Never"
              }
              status={report.last_import_date ? "info" : "warn"}
              informational
            />
          </div>

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "1rem 1.125rem",
              }}
            >
              <h3
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--text-muted)",
                  marginBottom: "0.75rem",
                }}
              >
                Recommendations
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {report.recommendations.map((rec, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                      fontSize: "0.8125rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span style={{ color: "#f59e0b", flexShrink: 0, marginTop: "0.1rem" }}>→</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.recommendations.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "2rem",
                background: "var(--surface-raised)",
                border: "1px solid var(--green)33",
                borderRadius: "var(--radius)",
                color: "var(--green)",
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              ✓ All clear — no data quality issues detected.
            </div>
          )}

          {/* Top problem merchants */}
          {report.top_problem_merchants.length > 0 && (
            <div
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "1rem 1.125rem",
              }}
            >
              <h3
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--text-muted)",
                  marginBottom: "0.75rem",
                }}
              >
                Top merchants missing canonical name
              </h3>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.3rem 0.625rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>Merchant</th>
                    <th style={{ textAlign: "right", padding: "0.3rem 0.625rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>Transactions</th>
                    <th style={{ padding: "0.3rem 0.625rem" }} />
                  </tr>
                </thead>
                <tbody>
                  {report.top_problem_merchants.map((m, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.375rem 0.625rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                        {m.merchant}
                      </td>
                      <td style={{ padding: "0.375rem 0.625rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", textAlign: "right", color: "var(--text-muted)" }}>
                        {m.count}
                      </td>
                      <td style={{ padding: "0.375rem 0.625rem" }}>
                        <button
                          onClick={() => nav("transactions", "aliases")}
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.15rem 0.5rem",
                            background: "transparent",
                            color: "var(--accent)",
                            border: "1px solid var(--accent)44",
                          }}
                        >
                          Add alias ↗
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!report && !loading && !error && (
        <div
          style={{
            textAlign: "center",
            color: "var(--text-muted)",
            padding: "3rem",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
          }}
        >
          Click <strong>Refresh</strong> to load health metrics.
        </div>
      )}
    </div>
  );
}
