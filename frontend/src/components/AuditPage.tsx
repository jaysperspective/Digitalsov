import { useEffect, useState } from "react";
import { confirmTransfer, getAuditFlags, getTransferCandidates } from "../api/client";
import type { AuditFlag, AuditFlagTransaction, FlagType, Severity, TransferCandidate, TransferTxInfo } from "../types";

// ── Constants ─────────────────────────────────────────────────────────────────

const FLAG_META: Record<FlagType, { label: string; description: string; icon: string }> = {
  "duplicate-like": {
    label: "Duplicate-like",
    description: "Same date, amount, and merchant as another transaction",
    icon: "⚠",
  },
  "bank-fee": {
    label: "Bank Fee",
    description: "Description matches known bank-fee keywords",
    icon: "🏦",
  },
  "unusually-large": {
    label: "Unusually Large",
    description: "Amount is >3× the category or overall median",
    icon: "⚠",
  },
  "new-merchant": {
    label: "New Merchant",
    description: "First transaction ever seen from this merchant",
    icon: "🆕",
  },
};

const SEVERITY_COLORS: Record<Severity, { border: string; bg: string; badge: string }> = {
  warning: {
    border: "#f97316",
    bg: "#f9731608",
    badge: "#f97316",
  },
  info: {
    border: "#3b82f6",
    bg: "#3b82f608",
    badge: "#3b82f6",
  },
};

type FilterType = FlagType | "all";

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthRange(): { from: string; to: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${lastDay}` };
}

function fmtUSD(n: number): string {
  return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FlagBadge({ type }: { type: FlagType }) {
  const meta = FLAG_META[type];
  const sev: Severity = type === "duplicate-like" || type === "unusually-large" ? "warning" : "info";
  const colors = SEVERITY_COLORS[sev];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.7rem",
        fontWeight: 700,
        background: colors.badge + "22",
        color: colors.badge,
        border: `1px solid ${colors.badge}55`,
        whiteSpace: "nowrap",
      }}
    >
      {meta.icon} {meta.label}
    </span>
  );
}

function TxRow({ tx }: { tx: AuditFlagTransaction }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "90px 1fr 110px 90px",
        gap: "0.5rem",
        fontSize: "0.8125rem",
        alignItems: "center",
        color: "var(--text-secondary)",
        paddingTop: "0.5rem",
        marginTop: "0.5rem",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        {tx.posted_date}
      </span>
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={tx.description_raw}
      >
        {tx.description_raw}
      </span>
      <span
        style={{
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          color: tx.amount < 0 ? "var(--red)" : "var(--green)",
        }}
      >
        {tx.amount < 0 ? "-" : "+"}${fmtUSD(tx.amount)}
      </span>
      <span style={{ textAlign: "right" }}>
        {tx.category_name && tx.category_color ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.2rem",
              padding: "0.1rem 0.4rem",
              borderRadius: "9999px",
              fontSize: "0.65rem",
              fontWeight: 600,
              background: tx.category_color + "22",
              color: tx.category_color,
            }}
          >
            {tx.category_icon} {tx.category_name}
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>—</span>
        )}
      </span>
    </div>
  );
}

function FlagCard({ flag, onDismiss }: { flag: AuditFlag; onDismiss: () => void }) {
  const sev = flag.severity as Severity;
  const colors = SEVERITY_COLORS[sev];
  return (
    <div
      style={{
        position: "relative",
        borderLeft: `3px solid ${colors.border}`,
        background: colors.bg,
        borderRadius: "0 var(--radius) var(--radius) 0",
        padding: "0.75rem 1rem",
        border: `1px solid ${colors.border}33`,
        borderLeftWidth: "3px",
      }}
    >
      <button
        onClick={onDismiss}
        title="Dismiss this flag"
        style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.5rem",
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
          fontSize: "0.875rem",
          padding: "0.15rem 0.35rem",
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        ×
      </button>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem", paddingRight: "1.5rem" }}>
        <FlagBadge type={flag.flag_type} />
        <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {flag.explanation}
        </p>
      </div>
      <TxRow tx={flag.transaction} />
    </div>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({
  flags,
  activeFilter,
  onFilter,
}: {
  flags: AuditFlag[];
  activeFilter: FilterType;
  onFilter: (t: FilterType) => void;
}) {
  const counts = flags.reduce<Record<FlagType, number>>(
    (acc, f) => { acc[f.flag_type] = (acc[f.flag_type] ?? 0) + 1; return acc; },
    {} as Record<FlagType, number>
  );
  const types: FlagType[] = ["duplicate-like", "unusually-large", "bank-fee", "new-merchant"];

  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <button
        onClick={() => onFilter("all")}
        style={{
          fontSize: "0.75rem",
          padding: "0.25rem 0.625rem",
          background: activeFilter === "all" ? "var(--accent)" : "transparent",
          color: activeFilter === "all" ? "#fff" : "var(--text-secondary)",
          border: `1px solid ${activeFilter === "all" ? "var(--accent)" : "var(--border)"}`,
        }}
      >
        All ({flags.length})
      </button>
      {types.map((t) => {
        const n = counts[t] ?? 0;
        if (n === 0) return null;
        const sev: Severity = t === "duplicate-like" || t === "unusually-large" ? "warning" : "info";
        const active = activeFilter === t;
        const accent = SEVERITY_COLORS[sev].badge;
        return (
          <button
            key={t}
            onClick={() => onFilter(t)}
            style={{
              fontSize: "0.75rem",
              padding: "0.25rem 0.625rem",
              background: active ? accent + "22" : "transparent",
              color: active ? accent : "var(--text-secondary)",
              border: `1px solid ${active ? accent : "var(--border)"}`,
            }}
          >
            {FLAG_META[t].icon} {FLAG_META[t].label} ({n})
          </button>
        );
      })}
    </div>
  );
}

// ── Transfer Candidates ───────────────────────────────────────────────────────

function confidenceColor(pct: number): string {
  if (pct >= 85) return "#10b981";
  if (pct >= 70) return "#f59e0b";
  return "#f97316";
}

function TransferTxSide({ tx, label }: { tx: TransferTxInfo; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "0.625rem 0.75rem",
      }}
    >
      <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
        {tx.account_label && (
          <span style={{ marginLeft: "0.4rem", fontWeight: 600, color: "var(--text-secondary)" }}>
            {tx.account_label}
          </span>
        )}
        {tx.account_type && (
          <span style={{ marginLeft: "0.25rem", color: "var(--text-muted)" }}>({tx.account_type})</span>
        )}
      </p>
      <p
        style={{
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: "0.25rem",
        }}
        title={tx.description_raw}
      >
        {tx.description_raw}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {tx.posted_date}
        </span>
        <span
          style={{
            fontSize: "0.875rem",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            color: tx.amount < 0 ? "var(--red)" : "var(--green)",
          }}
        >
          {tx.amount < 0 ? "-" : "+"}${Math.abs(tx.amount).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function TransferCandidateCard({
  candidate,
  onConfirmed,
}: {
  candidate: TransferCandidate;
  onConfirmed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const color = confidenceColor(candidate.confidence_pct);

  const handleConfirm = () => {
    setBusy(true);
    setErr(null);
    confirmTransfer(candidate.tx1.id, candidate.tx2.id)
      .then(onConfirmed)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Failed"))
      .finally(() => setBusy(false));
  };

  return (
    <div
      style={{
        border: `1px solid ${color}44`,
        borderLeft: `3px solid ${color}`,
        borderRadius: "0 var(--radius) var(--radius) 0",
        padding: "0.75rem 1rem",
        background: color + "08",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.625rem" }}>
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            padding: "0.15rem 0.5rem",
            borderRadius: "9999px",
            background: color + "22",
            color,
            border: `1px solid ${color}55`,
            whiteSpace: "nowrap",
          }}
        >
          {candidate.confidence_pct}% confidence
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {candidate.day_diff === 0 ? "same day" : `${candidate.day_diff} day(s) apart`}
        </span>
      </div>
      <div style={{ display: "flex", gap: "0.625rem", marginBottom: "0.625rem" }}>
        <TransferTxSide tx={candidate.tx1} label="Credit" />
        <TransferTxSide tx={candidate.tx2} label="Debit" />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{candidate.reason}</p>
        <button
          onClick={handleConfirm}
          disabled={busy}
          style={{
            fontSize: "0.75rem",
            padding: "0.25rem 0.75rem",
            background: color + "22",
            color,
            border: `1px solid ${color}55`,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Confirming…" : "Confirm Transfer"}
        </button>
      </div>
      {err && <p style={{ fontSize: "0.75rem", color: "var(--red)", marginTop: "0.25rem" }}>{err}</p>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function dismissKey(flag: AuditFlag): string {
  return `${flag.transaction.id}:${flag.flag_type}`;
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem("audit_dismissed");
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>): void {
  localStorage.setItem("audit_dismissed", JSON.stringify([...set]));
}

export default function AuditPage({ refreshKey }: { refreshKey: number }) {
  const defaultRange = currentMonthRange();
  const [fromDate, setFromDate] = useState(defaultRange.from);
  const [toDate, setToDate] = useState(defaultRange.to);
  const [flags, setFlags] = useState<AuditFlag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [showDismissed, setShowDismissed] = useState(false);

  // Transfer candidates state
  const [candidates, setCandidates] = useState<TransferCandidate[] | null>(null);
  const [candLoading, setCandLoading] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(85);
  const [confirmAllBusy, setConfirmAllBusy] = useState(false);
  const [confirmAllCount, setConfirmAllCount] = useState<number | null>(null);

  useEffect(() => {
    setCandLoading(true);
    getTransferCandidates()
      .then(setCandidates)
      .finally(() => setCandLoading(false));
  }, [refreshKey]);

  const scan = () => {
    setLoading(true);
    setError(null);
    setFlags(null);
    getAuditFlags(fromDate || undefined, toDate || undefined)
      .then((f) => { setFlags(f); setActiveFilter("all"); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to scan"))
      .finally(() => setLoading(false));
  };

  const handleDismiss = (flag: AuditFlag) => {
    const key = dismissKey(flag);
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    saveDismissed(next);
  };

  const handleConfirmAll = async () => {
    if (!candidates) return;
    const above = candidates.filter((c) => c.confidence_pct >= confidenceThreshold);
    if (above.length === 0) return;
    setConfirmAllBusy(true);
    setConfirmAllCount(0);
    let confirmed = 0;
    for (const c of above) {
      try {
        await confirmTransfer(c.tx1.id, c.tx2.id);
        confirmed++;
        setConfirmAllCount(confirmed);
      } catch {
        /* skip failed */
      }
    }
    setConfirmAllBusy(false);
    setCandidates((prev) =>
      prev ? prev.filter((c) => c.confidence_pct < confidenceThreshold) : prev
    );
  };

  const allFilteredFlags = flags
    ? activeFilter === "all"
      ? flags
      : flags.filter((f) => f.flag_type === activeFilter)
    : null;

  const visibleFlags = allFilteredFlags
    ? showDismissed
      ? allFilteredFlags
      : allFilteredFlags.filter((f) => !dismissed.has(dismissKey(f)))
    : null;

  const dismissedCount = allFilteredFlags
    ? allFilteredFlags.filter((f) => dismissed.has(dismissKey(f))).length
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* ── Controls ── */}
      <div style={{ display: "flex", gap: "0.625rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
            From
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ fontSize: "0.875rem", padding: "0.25rem 0.5rem" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
            To
          </label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ fontSize: "0.875rem", padding: "0.25rem 0.5rem" }}
          />
        </div>
        <button
          onClick={scan}
          disabled={loading}
          style={{ background: "var(--accent)", color: "#fff", borderColor: "transparent", padding: "0.3rem 1rem" }}
        >
          {loading ? "Scanning…" : "Scan for Flags"}
        </button>
        {flags && !loading && (
          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", alignSelf: "center" }}>
            {flags.length} flag{flags.length !== 1 ? "s" : ""} found
          </span>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "0.8125rem" }}>{error}</p>
      )}

      {/* ── Flag type legend ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "0.625rem",
        }}
      >
        {(Object.keys(FLAG_META) as FlagType[]).map((t) => {
          const meta = FLAG_META[t];
          const sev: Severity = t === "duplicate-like" || t === "unusually-large" ? "warning" : "info";
          const colors = SEVERITY_COLORS[sev];
          return (
            <div
              key={t}
              style={{
                background: "var(--surface-raised)",
                border: `1px solid ${colors.border}44`,
                borderRadius: "var(--radius)",
                padding: "0.625rem 0.875rem",
                display: "flex",
                gap: "0.5rem",
                alignItems: "flex-start",
              }}
            >
              <span style={{ fontSize: "1rem", lineHeight: 1.4 }}>{meta.icon}</span>
              <div>
                <p style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.badge, marginBottom: "0.15rem" }}>
                  {meta.label}
                </p>
                <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  {meta.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Results ── */}
      {visibleFlags !== null && (
        <>
          <SummaryBar flags={flags!} activeFilter={activeFilter} onFilter={setActiveFilter} />
          {visibleFlags.length === 0 ? (
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
              {flags!.length === 0
                ? "No flags found for the selected period."
                : `No "${activeFilter}" flags — try another filter.`}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                {visibleFlags.map((flag, i) => (
                  <FlagCard key={`${flag.flag_type}-${flag.transaction.id}-${i}`} flag={flag} onDismiss={() => handleDismiss(flag)} />
                ))}
              </div>
              {dismissedCount > 0 && (
                <button
                  onClick={() => setShowDismissed((v) => !v)}
                  style={{ alignSelf: "flex-start", fontSize: "0.75rem", background: "transparent", border: "none", color: "var(--text-muted)", textDecoration: "underline", cursor: "pointer", padding: 0 }}
                >
                  {showDismissed ? "Hide dismissed" : `Show ${dismissedCount} dismissed`}
                </button>
              )}
            </>
          )}
        </>
      )}

      {flags === null && !loading && (
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
          Choose a date range and click <strong>Scan for Flags</strong> to analyze transactions.
        </div>
      )}

      {/* ── Transfer Candidates ── */}
      <div style={{ marginTop: "1rem" }}>
        <h3
          style={{
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: "0.75rem",
            paddingBottom: "0.5rem",
            borderBottom: "1px solid var(--border)",
          }}
        >
          Transfer Candidates
        </h3>

        {candLoading && (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>Detecting transfer pairs…</p>
        )}

        {!candLoading && candidates !== null && candidates.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              Confidence threshold:
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                style={{ width: "100px" }}
              />
              <span style={{ fontFamily: "var(--font-mono)", minWidth: "2.5rem" }}>{confidenceThreshold}%</span>
            </label>
            <button
              onClick={handleConfirmAll}
              disabled={confirmAllBusy || candidates.filter((c) => c.confidence_pct >= confidenceThreshold).length === 0}
              style={{ fontSize: "0.8125rem", padding: "0.25rem 0.875rem", background: "var(--accent)", color: "#fff", border: "none" }}
            >
              {confirmAllBusy
                ? `Confirming… ${confirmAllCount ?? 0}/${candidates.filter((c) => c.confidence_pct >= confidenceThreshold).length}`
                : `Confirm all ≥${confidenceThreshold}% (${candidates.filter((c) => c.confidence_pct >= confidenceThreshold).length})`}
            </button>
          </div>
        )}

        {!candLoading && candidates !== null && (
          <>
            {candidates.length > 0 && (
              <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                {candidates.length} potential transfer pair{candidates.length !== 1 ? "s" : ""} detected
              </p>
            )}
            {candidates.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  padding: "2rem",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  fontSize: "0.875rem",
                }}
              >
                No transfer candidates found across your imports.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                {candidates.map((c) => (
                  <TransferCandidateCard
                    key={`${c.tx1.id}-${c.tx2.id}`}
                    candidate={c}
                    onConfirmed={() =>
                      setCandidates((prev) =>
                        prev ? prev.filter((p) => !(p.tx1.id === c.tx1.id && p.tx2.id === c.tx2.id)) : prev
                      )
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
