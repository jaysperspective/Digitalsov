import { useState } from "react";

type Section = "overview" | "install" | "import" | "security" | "profiles" | "terms";

const NAV: { id: Section; label: string }[] = [
  { id: "overview",  label: "Overview" },
  { id: "install",   label: "Installation" },
  { id: "import",    label: "Importing Data" },
  { id: "security",  label: "Data Security" },
  { id: "profiles",  label: "Profiles" },
  { id: "terms",     label: "Terms & Conditions" },
];

// ── Shared primitives ─────────────────────────────────────────────────────────

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
        margin: "2rem 0 0.625rem",
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

function Block({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "0.775rem",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1rem 1.25rem",
        color: "var(--green)",
        overflowX: "auto",
        margin: "0.625rem 0 1.25rem",
        lineHeight: 1.65,
      }}
    >
      {children}
    </pre>
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
    info:   { bg: "var(--accent-light)", border: "var(--accent)", text: "var(--accent)" },
    warn:   { bg: "var(--red-bg)",       border: "var(--red-border)", text: "var(--red)" },
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
      <span
        style={{
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          lineHeight: 1.7,
        }}
      >
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

// ── Sections ──────────────────────────────────────────────────────────────────

function Overview() {
  return (
    <div>
      <H1>◆ DIGITALSOV — Overview</H1>
      <P>
        DigitalSov is a <strong style={{ color: "var(--text)" }}>local-first, privacy-first personal finance audit tool</strong>.
        It runs entirely on your machine. No accounts. No cloud. No telemetry.
        Your financial data never leaves your computer.
      </P>

      <H2>Architecture</H2>
      <P>
        The app is a two-process stack: a Python <strong style={{ color: "var(--text)" }}>FastAPI</strong> backend
        that manages SQLite databases, and a <strong style={{ color: "var(--text)" }}>React + TypeScript</strong> frontend
        served by Vite. All data is stored in SQLite <Code>.db</Code> files on your local filesystem.
      </P>
      <Block>{`backend/  ← FastAPI (Python)   http://localhost:8000
frontend/ ← React/Vite (TS)   http://localhost:5173
profiles/ ← SQLite databases  (one .db per profile)`}</Block>

      <H2>What it does</H2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Imports bank/credit card statements via CSV, PDF, or PayPal CSV export</Li>
        <Li>Deduplicates transactions across imports automatically</Li>
        <Li>Categorises transactions with a rule engine (keyword matching + regex)</Li>
        <Li>Generates monthly summaries, category breakdowns, candlestick spending charts</Li>
        <Li>Produces tax-year CSV exports grouped by deductible category</Li>
        <Li>Flags audit risks: large transactions, uncategorised items, duplicate candidates</Li>
        <Li>Detects internal transfers between your own accounts</Li>
        <Li>AI chat assistant (requires a local Ollama model — fully offline)</Li>
        <Li>Multi-profile support — completely isolated SQLite databases per person</Li>
      </ul>

      <H2>Tech stack</H2>
      <Block>{`Python 3.11+  FastAPI · SQLAlchemy · SQLite
Node 18+      React 18 · TypeScript · Vite · Recharts
AI            Ollama (local LLM, optional)`}</Block>

      <Callout type="secure">
        DigitalSov was built with one constraint above all others: your financial data stays on your machine.
        There are no analytics, no error reporting, no update checks, no network calls except to your own localhost.
      </Callout>
    </div>
  );
}

function Install() {
  return (
    <div>
      <H1>Installation & Running Locally</H1>

      <H2>Prerequisites</H2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li><strong style={{ color: "var(--text)" }}>Python 3.11+</strong> — <Code>python3 --version</Code></Li>
        <Li><strong style={{ color: "var(--text)" }}>Node.js 18+</strong> — <Code>node --version</Code></Li>
        <Li><strong style={{ color: "var(--text)" }}>Git</strong> — to clone the repo</Li>
        <Li><strong style={{ color: "var(--text)" }}>Ollama</strong> (optional) — for the AI chat feature</Li>
      </ul>

      <H2>1 — Clone the repository</H2>
      <Block>{`git clone https://github.com/your-username/digitalsov.git
cd digitalsov`}</Block>

      <H2>2 — Set up the Python backend</H2>
      <Block>{`cd backend

# Create a virtual environment
python3 -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\\Scripts\\activate.bat    # Windows

# Install dependencies
pip install -r requirements.txt`}</Block>

      <H2>3 — Set up the frontend</H2>
      <Block>{`cd ../frontend
npm install`}</Block>

      <H2>4 — Start both services</H2>
      <P>
        From the repo root, run the included dev script. It starts both processes
        and writes logs to <Code>/tmp/</Code>.
      </P>
      <Block>{`# From the repo root:
./dev

# To stop:
./dev   # (run again to toggle off)

# Logs:
tail -f /tmp/digitalsov-backend.log
tail -f /tmp/digitalsov-frontend.log`}</Block>

      <P>
        Open <Code>http://localhost:5173</Code> in your browser. You will be prompted to
        select or create a profile before accessing the app.
      </P>

      <H2>Manual start (without ./dev)</H2>
      <Block>{`# Terminal 1 — backend
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev`}</Block>

      <H2>First-time data migration</H2>
      <P>
        If you have an existing <Code>finance.db</Code> from a previous install, it will be
        automatically copied to <Code>profiles/default.db</Code> on the first startup.
        Your data is preserved without any manual steps.
      </P>

      <H2>AI Chat (optional)</H2>
      <P>
        The AI assistant requires <strong style={{ color: "var(--text)" }}>Ollama</strong> running locally.
        Install it from <Code>ollama.com</Code>, then pull a model:
      </P>
      <Block>{`ollama pull llama3.2   # or any model you prefer`}</Block>
      <P>
        The app auto-detects Ollama at <Code>http://localhost:11434</Code>. The green
        OLLAMA indicator in the header confirms it is available.
      </P>

      <Callout type="info">
        All AI inference runs locally on your hardware via Ollama. No prompts, no financial data,
        and no conversation history is ever sent to an external API.
      </Callout>
    </div>
  );
}

function ImportData() {
  return (
    <div>
      <H1>Importing Financial Data</H1>
      <P>
        DigitalSov accepts transaction data in three formats. Go to the{" "}
        <strong style={{ color: "var(--text)" }}>Import</strong> tab to get started.
        All imports are deduplicated automatically — re-importing the same file is safe.
      </P>

      <H2>CSV Import (generic bank export)</H2>
      <P>
        Most banks and credit cards let you export transactions as a CSV file.
        The import wizard handles any column layout.
      </P>
      <ol style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Log in to your bank's website → Accounts → Download / Export</Li>
        <Li>Choose <strong style={{ color: "var(--text)" }}>CSV</strong> format and a date range</Li>
        <Li>In DigitalSov: go to <strong style={{ color: "var(--text)" }}>Import → CSV</strong></Li>
        <Li>Drop or select your file — the wizard previews the first 20 rows</Li>
        <Li>Map columns: Date, Description, Amount (credit/debit or single amount)</Li>
        <Li>Click <strong style={{ color: "var(--text)" }}>Import</strong> — transactions are added and rules are applied automatically</Li>
      </ol>
      <Callout type="info">
        The wizard auto-detects common column names (date, description, amount, debit, credit)
        and pre-fills the mapping. You only need to adjust if your bank uses unusual headers.
      </Callout>

      <H2>PDF / TXT Statement Import</H2>
      <P>
        For banks that only provide PDF statements (e.g. mortgage servicers, legacy institutions),
        the PDF importer extracts transaction tables automatically.
      </P>
      <ol style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Download your PDF statement from your bank portal</Li>
        <Li>Go to <strong style={{ color: "var(--text)" }}>Import → PDF / TXT Statement</strong></Li>
        <Li>Upload the file — DigitalSov attempts automatic column detection</Li>
        <Li>If auto-detection works: review the preview and confirm</Li>
        <Li>If the layout is unusual: use the manual column mapping screen</Li>
      </ol>
      <Callout type="warn">
        PDF extraction quality depends on how the statement was generated.
        Text-based PDFs work well. Scanned image PDFs (photos of paper statements)
        are not supported — request a digital export from your bank.
      </Callout>

      <H2>PayPal CSV Import</H2>
      <P>
        PayPal's CSV format is unique and is handled by a dedicated importer that
        correctly parses currency, fees, and transaction types.
      </P>
      <ol style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Log in to PayPal → Activity → Statements → Download</Li>
        <Li>Choose <strong style={{ color: "var(--text)" }}>CSV (All transactions)</strong></Li>
        <Li>Go to <strong style={{ color: "var(--text)" }}>Import → PayPal CSV</strong></Li>
        <Li>Upload the file — no column mapping needed</Li>
      </ol>

      <H2>After importing</H2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Rules run automatically — transactions matching keyword/regex patterns get categorised instantly</Li>
        <Li>Uncategorised transactions appear in <strong style={{ color: "var(--text)" }}>Transactions → Uncategorized</strong> for manual review</Li>
        <Li>Go to <strong style={{ color: "var(--text)" }}>Categories → Rules</strong> to add new auto-categorisation rules</Li>
        <Li>The <strong style={{ color: "var(--text)" }}>Audit</strong> tab flags potential issues: large transactions, suspected internal transfers, anomalies</Li>
      </ul>

      <H2>Deduplication</H2>
      <P>
        Transactions are fingerprinted by date + description + amount. Re-importing the same
        statement (even with a different filename) will not create duplicates.
        Overlapping date ranges across multiple imports are handled safely.
      </P>

      <H2>Managing imports</H2>
      <P>
        Every import is tracked in <strong style={{ color: "var(--text)" }}>Import → Import History</strong>.
        You can label each import with an account name (e.g. "Chase Checking", "Apple Card"),
        add notes, and delete an import to remove all its transactions from the ledger.
      </P>
    </div>
  );
}

function Security() {
  return (
    <div>
      <H1>Data Security & Privacy</H1>

      <Callout type="secure">
        DigitalSov is designed around a single core principle: your financial data never leaves your machine.
        No exceptions. No opt-outs needed because there is nothing to opt out of.
      </Callout>

      <H2>What leaves your machine</H2>
      <P>
        <strong style={{ color: "var(--green)" }}>Nothing.</strong> There are no outbound network requests
        from DigitalSov. No analytics. No crash reporting. No update pings.
        No authentication servers. No license checks.
      </P>
      <P>
        The only network traffic the app generates is between your browser and
        <Code>localhost:8000</Code> (your own backend). You can verify this with
        your browser's DevTools Network tab.
      </P>

      <H2>Where data is stored</H2>
      <P>
        All data lives in SQLite <Code>.db</Code> files at:
      </P>
      <Block>{`digitalsov/profiles/<profile-name>.db`}</Block>
      <P>
        Each profile is a single self-contained file. Backup is as simple as copying
        that file. Deletion is <Code>rm profiles/name.db</Code>. There is no hidden
        application state elsewhere.
      </P>

      <H2>No authentication by design</H2>
      <P>
        DigitalSov does not have passwords or login accounts. It runs on localhost
        and is only accessible from your own machine. The profile system provides
        data isolation without authentication theater — each profile's data is kept
        entirely separate.
      </P>
      <Callout type="info">
        If you run DigitalSov on a shared machine, OS-level user account isolation
        is your security boundary. Do not expose port 8000 to a network.
      </Callout>

      <H2>AI assistant</H2>
      <P>
        The AI chat feature uses <strong style={{ color: "var(--text)" }}>Ollama</strong>,
        which runs LLM inference 100% locally on your hardware.
        No prompts or financial context are sent to OpenAI, Anthropic, or any
        cloud API. If Ollama is not installed, the AI tab simply shows as offline.
      </P>

      <H2>Sharing the app with others</H2>
      <P>
        The profile system was built specifically for this use case. Each person creates
        their own profile (a separate <Code>.db</Code> file). When you share your
        machine or a deployment of the app, other users see only their own data.
        Profiles are isolated at the database level — there is no shared state.
      </P>

      <H2>Backup & portability</H2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Copy <Code>profiles/your-name.db</Code> to back up all your data</Li>
        <Li>Move that file to a new machine running DigitalSov and drop it in <Code>profiles/</Code></Li>
        <Li>The profile will appear in the selector on next startup</Li>
        <Li>SQLite files are a universal, open format readable by any SQLite client</Li>
      </ul>

      <H2>Deleting your data</H2>
      <P>
        To permanently delete a profile and all its financial data, use the delete button
        in the profile selector, or simply:
      </P>
      <Block>{`rm digitalsov/profiles/your-profile.db`}</Block>
      <P>
        The data is gone. There is no server, no cloud backup, no recovery option.
        That is intentional.
      </P>

      <H2>Network exposure warning</H2>
      <Callout type="warn">
        The backend listens on <Code>127.0.0.1:8000</Code> by default, which is only
        accessible from your local machine. Do not bind it to <Code>0.0.0.0</Code>
        or expose it through a reverse proxy without adding authentication middleware.
        This app has no built-in auth and is not designed to be a public web service.
      </Callout>
    </div>
  );
}

function Profiles() {
  return (
    <div>
      <H1>Profile System</H1>
      <P>
        Profiles allow multiple people to use the same DigitalSov instance with
        completely isolated financial data. Each profile is a separate SQLite
        database file. There is no shared data between profiles.
      </P>

      <H2>How it works</H2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Each profile maps to <Code>profiles/&lt;name&gt;.db</Code> on disk</Li>
        <Li>The active profile is stored in <Code>localStorage</Code> in the browser</Li>
        <Li>Every API request sends an <Code>X-Profile: name</Code> header — the backend routes the DB session accordingly</Li>
        <Li>No route handlers were changed — isolation is transparent at the database layer</Li>
      </ul>

      <H2>Creating a profile</H2>
      <ol style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Click the <strong style={{ color: "var(--text)" }}>⇄</strong> button in the header to return to the profile selector</Li>
        <Li>Type a name in the NEW PROFILE field and click CREATE</Li>
        <Li>Profile names are restricted to <Code>[a-z0-9_-]</Code>, max 50 characters</Li>
        <Li>The new profile is initialised with default categories and rules, ready to import data</Li>
      </ol>

      <H2>Switching profiles</H2>
      <P>
        Click the <strong style={{ color: "var(--text)" }}>⇄</strong> button in the top-right
        of the header at any time. This returns you to the profile selector without
        losing any data. Select a different profile to switch contexts.
      </P>

      <H2>Deleting a profile</H2>
      <P>
        From the profile selector screen, click the delete icon next to any profile.
        The last remaining profile cannot be deleted. Deletion is permanent and
        removes the <Code>.db</Code> file from disk.
      </P>

      <H2>Profile name rules</H2>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>Lowercase letters, digits, hyphens, and underscores only</Li>
        <Li>Maximum 50 characters</Li>
        <Li>No spaces, dots, slashes, or special characters (prevents path traversal)</Li>
        <Li>Names are sanitised on the backend before constructing the file path</Li>
      </ul>

      <H2>Default profile migration</H2>
      <P>
        If you had data in <Code>finance.db</Code> before the profile system was added,
        it was automatically copied to <Code>profiles/default.db</Code> on the first
        startup. Your original <Code>finance.db</Code> is left untouched.
      </P>
    </div>
  );
}

function Terms() {
  const date = "February 25, 2026";
  return (
    <div>
      <H1>Terms & Conditions</H1>
      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          margin: "0 0 1.5rem",
        }}
      >
        Last updated: {date}
      </p>

      <H2>1. Nature of the Software</H2>
      <P>
        DigitalSov is a <strong style={{ color: "var(--text)" }}>free, open-source, self-hosted</strong> personal
        finance tool. It runs entirely on your local machine. By using this software you agree to
        these terms. If you do not agree, do not use the software.
      </P>

      <H2>2. No Warranty</H2>
      <P>
        This software is provided <strong style={{ color: "var(--text)" }}>"as is"</strong>, without warranty
        of any kind, express or implied, including but not limited to the warranties of
        merchantability, fitness for a particular purpose, accuracy of financial calculations,
        or non-infringement.
      </P>
      <P>
        DigitalSov is a <strong style={{ color: "var(--text)" }}>personal organisation tool only</strong>.
        It is not a certified accounting, tax preparation, or financial advisory service.
        All data, summaries, reports, and AI-generated responses are for informational and
        organisational purposes only. They do not constitute financial, tax, legal, or
        investment advice.
      </P>

      <H2>3. Limitation of Liability</H2>
      <P>
        In no event shall the authors or copyright holders be liable for any claim, damages,
        or other liability — whether in contract, tort, or otherwise — arising from, out of,
        or in connection with the software or the use of or other dealings in the software.
        This includes but is not limited to financial decisions made based on data displayed
        or reports generated by this application.
      </P>

      <H2>4. Your Responsibility for Data</H2>
      <P>
        You are solely responsible for:
      </P>
      <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
        <Li>The accuracy and completeness of data you import</Li>
        <Li>Backing up your SQLite database files</Li>
        <Li>Securing access to the machine running this software</Li>
        <Li>Verifying any financial figures against your official bank statements</Li>
        <Li>Any tax filings or financial decisions you make using data from this app</Li>
      </ul>

      <H2>5. Data Privacy</H2>
      <P>
        DigitalSov does not collect, transmit, store, or process your data on any server
        outside your local machine. No personal information, financial data, usage data,
        or analytics are sent anywhere. The authors have no access to your data under any
        circumstances.
      </P>
      <P>
        You are responsible for the physical and logical security of the machine on which
        you run this software. The authors assume no liability for unauthorised access to
        your financial data resulting from inadequate system security.
      </P>

      <H2>6. AI Features</H2>
      <P>
        The AI assistant feature uses Ollama, a third-party local inference engine.
        AI responses are generated locally and are not sent to any cloud service.
        AI-generated content may be inaccurate, incomplete, or misleading.
        Do not rely on AI chat responses for financial, tax, or legal decisions.
        You use the AI feature entirely at your own risk.
      </P>

      <H2>7. Open Source License</H2>
      <P>
        DigitalSov is released under the MIT License. You are free to use, copy, modify,
        merge, publish, distribute, sublicense, and/or sell copies of the software,
        subject to the conditions of that license.
      </P>

      <H2>8. Third-Party Software</H2>
      <P>
        This application uses open-source dependencies (FastAPI, SQLAlchemy, React, Recharts,
        and others). Each is subject to its own license. DigitalSov does not endorse or
        warrant the fitness of any third-party component.
      </P>

      <H2>9. Changes to These Terms</H2>
      <P>
        These terms may be updated with new versions of the software. The date at the top
        of this page reflects the most recent revision. Continued use of the software
        constitutes acceptance of the current terms.
      </P>

      <H2>10. Governing Law</H2>
      <P>
        These terms are governed by and construed in accordance with the laws of the
        jurisdiction in which the software author resides, without regard to conflict
        of law principles.
      </P>

      <Callout type="secure">
        Short version: this is a free local tool, use it at your own risk, don't make
        major financial decisions based solely on what it shows, keep your own backups,
        and secure your machine.
      </Callout>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [active, setActive] = useState<Section>("overview");

  const CONTENT: Record<Section, React.ReactNode> = {
    overview: <Overview />,
    install:  <Install />,
    import:   <ImportData />,
    security: <Security />,
    profiles: <Profiles />,
    terms:    <Terms />,
  };

  return (
    <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
      {/* Sidebar nav */}
      <nav
        style={{
          flexShrink: 0,
          width: "148px",
          position: "sticky",
          top: "1rem",
        }}
      >
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: active === item.id ? "var(--accent-light)" : "transparent",
              border: "none",
              borderLeft: `2px solid ${active === item.id ? "var(--accent)" : "transparent"}`,
              color: active === item.id ? "var(--accent)" : "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              fontWeight: active === item.id ? 700 : 400,
              letterSpacing: "0.05em",
              padding: "0.45rem 0.75rem",
              cursor: "pointer",
              transition: "color 0.15s",
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {CONTENT[active]}
      </div>
    </div>
  );
}
