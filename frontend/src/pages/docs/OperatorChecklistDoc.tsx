import { useState } from "react";

// ── Local style primitives (mirror DocsPage aesthetic) ───────────────────────

function H1({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "0.9375rem",
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        color: "var(--text)",
        letterSpacing: "0.06em",
        margin: "0 0 1.5rem",
        paddingBottom: "0.75rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </h2>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: "0.8125rem",
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        color: "var(--accent)",
        letterSpacing: "0.08em",
        margin: "2.25rem 0 0.75rem",
        textTransform: "uppercase" as const,
      }}
    >
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: "0.8125rem",
        color: "var(--text-secondary)",
        lineHeight: 1.75,
        margin: "0 0 0.875rem",
      }}
    >
      {children}
    </p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "0.78rem",
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "0.1rem 0.4rem",
        color: "var(--green)",
      }}
    >
      {children}
    </code>
  );
}

function Callout({
  type = "info",
  children,
}: {
  type?: "info" | "warn" | "secure";
  children: React.ReactNode;
}) {
  const colors = {
    info:   { bg: "var(--accent-light)", border: "var(--accent)",      text: "var(--accent)" },
    warn:   { bg: "var(--red-bg)",       border: "var(--red-border)",  text: "var(--red)" },
    secure: { bg: "var(--green-bg)",     border: "var(--green-border)", text: "var(--green)" },
  }[type];
  const icons = { info: "◈", warn: "⚠", secure: "◆" };

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: "var(--radius)",
        padding: "0.875rem 1rem",
        margin: "0.875rem 0",
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          color: colors.text,
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          flexShrink: 0,
          marginTop: "0.1rem",
        }}
      >
        {icons[type]}
      </span>
      <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
        {children}
      </span>
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li
      style={{
        fontSize: "0.8125rem",
        color: "var(--text-secondary)",
        lineHeight: 1.75,
        marginBottom: "0.25rem",
      }}
    >
      {children}
    </li>
  );
}

// ── CopyBlock ────────────────────────────────────────────────────────────────

function CopyBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ position: "relative", margin: "0.625rem 0 1.25rem" }}>
      <pre
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.775rem",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0.875rem 4.5rem 0.875rem 1.25rem",
          color: "var(--green)",
          overflowX: "auto",
          lineHeight: 1.65,
          margin: 0,
        }}
      >
        {command}
      </pre>
      <button
        onClick={handleCopy}
        style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.5rem",
          fontSize: "0.625rem",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          letterSpacing: "0.07em",
          padding: "0.2rem 0.5rem",
          background: copied ? "var(--green-bg)" : "var(--surface-raised)",
          border: `1px solid ${copied ? "var(--green-border)" : "var(--border)"}`,
          color: copied ? "var(--green)" : "var(--text-muted)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        {copied ? "COPIED" : "COPY"}
      </button>
    </div>
  );
}

// ── Step component ────────────────────────────────────────────────────────────

interface StepProps {
  num: number;
  title: string;
  path?: string;
  bullets: React.ReactNode[];
  verify: string[];
  extra?: React.ReactNode;
}

function Step({ num, title, path, bullets, verify, extra }: StepProps) {
  return (
    <div
      style={{
        marginBottom: "1.75rem",
        paddingBottom: "1.75rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Step header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.625rem",
          marginBottom: "0.625rem",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.625rem",
            fontWeight: 700,
            letterSpacing: "0.09em",
            background: "var(--accent)",
            color: "#fff",
            padding: "0.1rem 0.45rem",
            borderRadius: "2px",
            flexShrink: 0,
          }}
        >
          {String(num).padStart(2, "0")}
        </span>
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
            letterSpacing: "0.04em",
          }}
        >
          {title}
        </span>
        {path && (
          <span
            style={{
              fontSize: "0.7rem",
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
              marginLeft: "auto",
            }}
          >
            Path: <span style={{ color: "var(--accent)" }}>{path}</span>
          </span>
        )}
      </div>

      {/* Bullets */}
      <ul style={{ paddingLeft: "1.25rem", margin: "0.5rem 0 0.875rem" }}>
        {bullets.map((b, i) => (
          <Li key={i}>{b}</Li>
        ))}
      </ul>

      {/* Extra content (e.g. CopyBlock) */}
      {extra}

      {/* Verify checklist */}
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0.625rem 0.875rem",
        }}
      >
        <span
          style={{
            fontSize: "0.6rem",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "var(--text-muted)",
            textTransform: "uppercase" as const,
            display: "block",
            marginBottom: "0.5rem",
          }}
        >
          Verify
        </span>
        {verify.map((v, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              marginBottom: "0.25rem",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                color: "var(--border-strong)",
                flexShrink: 0,
                marginTop: "0.15rem",
                lineHeight: 1,
              }}
            >
              ☐
            </span>
            <span
              style={{
                fontSize: "0.775rem",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
              }}
            >
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OperatorChecklistDoc() {
  return (
    <div>
      <H1>◆ OPERATOR CHECKLIST</H1>

      <P>
        Use this sequence after every import to keep your ledger accurate, your
        categories clean, and your audit flags under control. Completing all steps
        takes 15–30 minutes depending on import volume.
      </P>

      <Callout type="info">
        <strong>Principle:</strong> A finance tool is only as trustworthy as the
        person operating it. This checklist is your contract with future-you —
        the one who needs to file taxes, investigate a charge, or understand
        where the money went.
      </Callout>

      {/* ── Steps ── */}

      <Step
        num={0}
        title="Backup your database"
        path="profiles/"
        bullets={[
          "Copy your profile database before making any changes to the ledger.",
          "Store the backup outside the project folder — external drive or encrypted folder.",
          <>Replace <Code>YYYYMMDD</Code> in the command below with today's date.</>,
        ]}
        extra={
          <CopyBlock command="cp profiles/default.db profiles/default_backup_YYYYMMDD.db" />
        }
        verify={[
          "Backup file exists with today's date in the filename.",
        ]}
      />

      <Step
        num={1}
        title="Import new statements"
        path="Import tab"
        bullets={[
          "Import CSV, PDF, TXT, or PayPal CSV for every account covering the new period.",
          "Re-importing an overlapping date range is safe — duplicates are filtered automatically.",
          "Check the deduplication count in the import result banner (imported vs. skipped).",
        ]}
        verify={[
          "Each account's import appears in Import History.",
          "Transaction count is plausible for the statement period.",
        ]}
      />

      <Step
        num={2}
        title="Label the import"
        path="Import → Import History"
        bullets={[
          <>Set the <strong style={{ color: "var(--text)" }}>account label</strong> on each new import (e.g. "Chase Checking", "Amex Gold").</>,
          "Labels appear in Tax Summary and net-worth breakdowns — unlabelled imports create blind spots.",
          "Add a note if the import covers an unusual period or a one-off account.",
        ]}
        verify={[
          "Every import has a non-empty account label.",
        ]}
      />

      <Step
        num={3}
        title="Categorize uncategorized transactions"
        path="Transactions → Uncategorized"
        bullets={[
          "Assign a category to each unmatched transaction.",
          <>For recurring merchants: create a rule in <strong style={{ color: "var(--text)" }}>Categories → Rules</strong> instead of categorizing manually each cycle.</>,
          "After adding rules, re-run them — new rules apply retroactively to all existing transactions.",
        ]}
        verify={[
          "Uncategorized count is 0 or at an acceptable minimum.",
          "No recurring merchant you recognize is uncategorized.",
        ]}
      />

      <Step
        num={4}
        title="Update merchant aliases"
        path="Transactions → Merchant Aliases"
        bullets={[
          "Add aliases for any new merchant strings that appeared in this import.",
          <>Use the <strong style={{ color: "var(--text)" }}>✎</strong> quick-alias button in the Transactions table for fast one-off entry.</>,
          <>Click <strong style={{ color: "var(--text)" }}>Rebuild canonical merchants</strong> after adding or editing aliases to backfill existing transactions.</>,
        ]}
        verify={[
          "Health tab \u201cMerchants without canonical\u201d count has not grown since last cycle.",
          "Key merchants (Amazon, subscriptions, utilities) have canonical names.",
        ]}
      />

      <Step
        num={5}
        title="Review and update rules"
        path="Categories → Rules"
        bullets={[
          "Verify active rules are still matching the intended merchants and descriptions.",
          "Add keyword or regex rules for recurring transaction patterns you noticed this cycle.",
          "Disable or delete rules that are firing incorrectly.",
        ]}
        verify={[
          "No recurring transaction you recognize is mis-categorized.",
          "Rule count is ≥ 1.",
        ]}
      />

      <Step
        num={6}
        title="Confirm transfer candidates"
        path="Tax → Audit"
        bullets={[
          "Review transaction pairs flagged as potential inter-account transfers.",
          "Confirm genuine transfers (paycheck deposit + savings sweep, credit card payment + bank debit).",
          "Dismiss false positives — dismissed flags will not reappear unless the transactions are re-imported.",
        ]}
        verify={[
          "Transfer candidates count in Health tab = 0.",
        ]}
      />

      <Step
        num={7}
        title="Resolve duplicate flags"
        path="Tax → Audit"
        bullets={[
          "Review \u201cduplicate-like\u201d flags — identical date, amount, and merchant.",
          "Delete genuine duplicates using the action on the flag card.",
          "Dismiss false positives for intentional repeat charges (rent, split subscription).",
        ]}
        verify={[
          "No unreviewed duplicate-like flags remain.",
        ]}
      />

      <Step
        num={8}
        title="Review all audit flags"
        path="Tax → Audit"
        bullets={[
          "Scan unusually-large, bank-fee, category-spike, and merchant-anomaly flags.",
          <>A category-spike of ≥ 40% warrants investigation — click <strong style={{ color: "var(--text)" }}>View ↗</strong> to drill into the transactions behind it.</>,
          "Flag any transaction you do not recognize for investigation with your bank.",
        ]}
        verify={[
          "All high-severity flags reviewed.",
          "No unexplained unusually-large charges remain.",
        ]}
      />

      <Step
        num={9}
        title="Validate data health"
        path="Health tab"
        bullets={[
          "Review all metric cards against your expectations for this import cycle.",
          "Follow any recommendations listed at the bottom of the page.",
          <>Confirm <strong style={{ color: "var(--text)" }}>Imports missing account label</strong> = 0.</>,
        ]}
        verify={[
          "Uncategorized, uncanonical, and duplicate counts are at expected levels.",
          "No recommendations remain unaddressed.",
        ]}
      />

      <Step
        num={10}
        title="Verify the dashboard"
        path="Dashboard"
        bullets={[
          "Confirm net income and total expense figures are consistent with your bank's statement totals.",
          "Use the month/period selector to compare the current period to the prior period.",
          "Review the category breakdown for unexpected shifts.",
          "Record any discrepancies before closing the cycle.",
        ]}
        verify={[
          "Dashboard net figures agree with official bank totals (within rounding).",
          "No category shows a materially unexpected balance.",
        ]}
      />

      {/* ── Monthly Audit Flow ────────────────────────────────────────────── */}

      <H2>Monthly Audit Flow (10-Minute Version)</H2>
      <P>
        Run this lighter flow between full import cycles to stay on top of
        anomalies without repeating the full checklist.
      </P>
      <ol
        style={{
          paddingLeft: "1.25rem",
          margin: "0 0 1.25rem",
          fontSize: "0.8125rem",
          color: "var(--text-secondary)",
          lineHeight: 1.85,
        }}
      >
        <li>Open <strong style={{ color: "var(--text)" }}>Tax → Audit</strong>, set the date range to the past 30 days, and click <strong style={{ color: "var(--text)" }}>Scan for Flags</strong>.</li>
        <li>Review and dismiss <strong style={{ color: "var(--text)" }}>category-spike</strong> flags — investigate any category up ≥ 40% vs. the prior period.</li>
        <li>Review and dismiss <strong style={{ color: "var(--text)" }}>merchant-anomaly</strong> flags — verify any charge that is ≥ 2.5× the merchant's historical baseline.</li>
        <li>Confirm no <strong style={{ color: "var(--text)" }}>duplicate-like</strong> flags remain unreviewed.</li>
        <li>Confirm no <strong style={{ color: "var(--text)" }}>transfer candidates</strong> remain unconfirmed.</li>
        <li>Open the <strong style={{ color: "var(--text)" }}>Health</strong> tab — verify all metric counts are at acceptable levels.</li>
      </ol>

      {/* ── Quarterly Deep Audit ──────────────────────────────────────────── */}

      <H2>Quarterly Deep Audit</H2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1.25rem" }}>
        <Li>Run the full Operator Checklist (Steps 0–10) against the quarter's imports.</Li>
        <Li>Export a Tax Summary for the quarter and compare totals to official bank statements.</Li>
        <Li>Review all rules — prune any that no longer apply to your current spending patterns.</Li>
        <Li>Review all merchant aliases — add canonical names for any gaps discovered.</Li>
        <Li>Audit the category breakdown for drift (categories growing unexpectedly quarter-over-quarter).</Li>
        <Li>Export a quarterly backup of each profile database and store it off-machine.</Li>
      </ul>

      {/* ── Annual Close-Out ─────────────────────────────────────────────── */}

      <H2>Annual Close-Out</H2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1.25rem" }}>
        <Li>Export the full-year Tax Summary CSV from <strong style={{ color: "var(--text)" }}>Tax → Tax Summary</strong>.</Li>
        <Li>Audit all category totals against your tax preparation worksheet before filing.</Li>
        <Li>Verify every import in Import History has an account label and a correct date range.</Li>
        <Li>Rebuild canonical merchants with the complete, final alias set for the year.</Li>
        <Li>
          Create and archive a year-end database backup:
          <CopyBlock command="cp profiles/default.db profiles/default_YYYY_year_end.db" />
        </Li>
        <Li>Store the year-end archive in durable offline storage (encrypted USB, external drive).</Li>
      </ul>

      {/* ── Philosophy Reminder ───────────────────────────────────────────── */}

      <Callout type="secure">
        <strong>Philosophy Reminder — </strong>
        Data you do not understand is not data; it is noise. The checklist is
        not a ritual — it is how you stay sovereign over your own financial
        picture. Import cleanly, categorize consistently, and investigate every
        anomaly. A ledger you trust is worth more than a perfect algorithm.
      </Callout>
    </div>
  );
}
