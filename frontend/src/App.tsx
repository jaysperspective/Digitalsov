import { useEffect, useState } from "react";
import { getActiveProfile, healthCheck, pingOllama } from "./api/client";
import ProfileGate from "./components/ProfileGate";
import AuditPage from "./components/AuditPage";
import IncomeHousingPage from "./components/IncomeHousingPage";
import CategoriesPage from "./components/CategoriesPage";
import ChatPage from "./components/ChatPage";
import DashboardPage from "./components/DashboardPage";
import ImportsHistory from "./components/ImportsHistory";
import ImportWizard from "./components/ImportWizard";
import LLMSettingsPage from "./components/LLMSettingsPage";
import PDFImportFlow from "./components/PDFImportFlow";
import PayPalImportFlow from "./components/PayPalImportFlow";
import TaxSummaryPage from "./components/TaxSummaryPage";
import RulesPage from "./components/RulesPage";
import TransactionList from "./components/TransactionList";
import UncategorizedPage from "./components/UncategorizedPage";
import DocsPage from "./components/DocsPage";
import type { ImportResult } from "./types";

type HealthState = "loading" | "ok" | "err";
type Tab = "dashboard" | "import" | "transactions" | "categories" | "tax" | "ai" | "docs";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "import", label: "Import" },
  { id: "transactions", label: "Transactions" },
  { id: "categories", label: "Categories" },
  { id: "tax", label: "Tax" },
  { id: "ai", label: "AI" },
  { id: "docs", label: "Docs" },
];

export default function App() {
  const [health, setHealth] = useState<HealthState>("loading");
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [importSource, setImportSource] = useState<"csv" | "pdf" | "paypal">("csv");
  const [transactionSection, setTransactionSection] = useState<"all" | "uncategorized">("all");
  const [categorizationSection, setCategorizationSection] = useState<"categories" | "rules">("categories");
  const [taxSection, setTaxSection] = useState<"finances" | "tax-summary" | "audit">("finances");
  const [aiSection, setAiSection] = useState<"chat" | "llm-settings">("chat");
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("theme") as "light" | "dark") ?? "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    healthCheck()
      .then(() => setHealth("ok"))
      .catch(() => setHealth("err"));

    pingOllama()
      .then(({ available }) => setOllamaOk(available))
      .catch(() => setOllamaOk(false));
  }, []);

  const handleImportComplete = (result: ImportResult) => {
    setLastImport(result);
    setRefreshKey((k) => k + 1);
    setActiveTab("dashboard");
  };

  const subTabBar = (
    items: { id: string; label: string }[],
    active: string,
    onSelect: (id: string) => void
  ) => (
    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          style={{
            fontSize: "0.8125rem",
            padding: "0.25rem 0.875rem",
            background: active === item.id ? "var(--accent)" : "transparent",
            color: active === item.id ? "#fff" : "var(--text-secondary)",
            border: `1px solid ${active === item.id ? "var(--accent)" : "var(--border)"}`,
            fontWeight: active === item.id ? 600 : 400,
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  const activeProfile = getActiveProfile();

  function switchProfile() {
    localStorage.removeItem("active_profile");
    window.location.reload();
  }

  return (
    <ProfileGate>
    <div style={{ minHeight: "100vh" }}>
      {/* ── Header ── */}
      <header
        style={{
          background: "var(--header-bg)",
          color: "#fff",
          padding: "0 1.5rem",
          height: "48px",
          display: "flex",
          alignItems: "center",
          gap: "0.875rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h1
          style={{
            fontSize: "0.8125rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            fontFamily: "var(--font-mono)",
            color: "#fff",
          }}
        >
          ◆ DIGITALSOV
        </h1>
        <div style={{ flexGrow: 1 }} />

        {/* Profile indicator + switch */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.7rem",
            fontFamily: "var(--font-mono)",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          {activeProfile}
        </span>
        <button
          onClick={switchProfile}
          title="Switch profile"
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.7)",
            fontSize: "0.65rem",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "0.2rem 0.5rem",
            borderRadius: "var(--radius)",
            cursor: "pointer",
          }}
        >
          ⇄
        </button>

        {ollamaOk !== null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.7rem",
              color: ollamaOk ? "var(--green)" : "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: ollamaOk ? "var(--green)" : "var(--text-muted)",
              }}
            />
            {ollamaOk ? "OLLAMA" : "NO OLLAMA"}
          </span>
        )}

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.7rem",
            fontFamily: "var(--font-mono)",
            color:
              health === "ok" ? "var(--green)" : health === "err" ? "var(--red)" : "var(--text-muted)",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background:
                health === "ok" ? "var(--green)" : health === "err" ? "var(--red)" : "var(--text-muted)",
              animation: health === "loading" ? "pulse 1.4s ease-in-out infinite" : "none",
            }}
          />
          {health === "ok" ? "CONNECTED" : health === "err" ? "UNREACHABLE" : "CONNECTING"}
        </span>

        <button
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.7)",
            fontSize: "0.65rem",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "0.2rem 0.5rem",
            borderRadius: "var(--radius)",
            cursor: "pointer",
          }}
        >
          {theme === "light" ? "DARK" : "LITE"}
        </button>
      </header>

      {/* ── Backend error notice ── */}
      {health === "err" && (
        <div
          style={{
            background: "var(--red-bg)",
            borderBottom: "1px solid var(--red-border)",
            color: "var(--red)",
            fontSize: "0.8125rem",
            padding: "0.625rem 1.5rem",
          }}
        >
          Cannot reach the backend. Make sure <code>uvicorn</code> is running on port 8000.
        </div>
      )}

      {/* ── Tab bar ── */}
      <nav
        className="tab-nav"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          padding: "0 1.5rem",
          display: "flex",
          gap: "0",
          overflowX: "auto",
          justifyContent: "center",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: "none",
              border: "none",
              borderBottom:
                activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              borderRadius: 0,
              color: activeTab === tab.id ? "var(--accent)" : "var(--text-muted)",
              fontWeight: activeTab === tab.id ? 600 : 400,
              fontSize: "0.8125rem",
              padding: "0.75rem 1.25rem",
              cursor: "pointer",
              transition: "color 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
            {tab.id === "dashboard" && lastImport && (
              <span
                style={{
                  marginLeft: "0.375rem",
                  fontSize: "0.6rem",
                  background: "var(--accent)",
                  color: "#fff",
                  borderRadius: "2px",
                  padding: "0.05rem 0.35rem",
                  verticalAlign: "middle",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                }}
              >
                NEW
              </span>
            )}
            {tab.id === "ai" && ollamaOk === false && (
              <span
                style={{
                  marginLeft: "0.375rem",
                  fontSize: "0.6rem",
                  background: "var(--surface-raised)",
                  color: "var(--text-muted)",
                  borderRadius: "2px",
                  padding: "0.05rem 0.35rem",
                  verticalAlign: "middle",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                }}
              >
                OFFLINE
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Main content ── */}
      <main
        style={{
          maxWidth: "1100px",
          margin: "1.5rem auto",
          padding: "0 1.5rem",
        }}
      >
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "1.25rem 1.5rem",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {/* Dashboard */}
          {activeTab === "dashboard" && <DashboardPage refreshKey={refreshKey} />}

          {/* Import */}
          {activeTab === "import" && (
            <>
              {subTabBar(
                [
                  { id: "csv", label: "CSV" },
                  { id: "pdf", label: "PDF / TXT Statement" },
                  { id: "paypal", label: "PayPal CSV" },
                ],
                importSource,
                (id) => setImportSource(id as "csv" | "pdf" | "paypal")
              )}
              {importSource === "csv" && <ImportWizard onImportComplete={handleImportComplete} />}
              {importSource === "paypal" && <PayPalImportFlow onImportComplete={handleImportComplete} />}
              {importSource === "pdf" && (
                <PDFImportFlow
                  onImportComplete={handleImportComplete}
                  onSwitchToCSV={() => setImportSource("csv")}
                />
              )}
              <div
                style={{
                  marginTop: "2rem",
                  paddingTop: "1.5rem",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <ImportsHistory refreshKey={refreshKey} />
              </div>
            </>
          )}

          {/* Transactions */}
          {activeTab === "transactions" && (
            <>
              {subTabBar(
                [
                  { id: "all", label: "All Transactions" },
                  { id: "uncategorized", label: "Uncategorized" },
                ],
                transactionSection,
                (id) => setTransactionSection(id as "all" | "uncategorized")
              )}
              {transactionSection === "all" && <TransactionList refreshKey={refreshKey} />}
              {transactionSection === "uncategorized" && <UncategorizedPage refreshKey={refreshKey} />}
            </>
          )}

          {/* Categories */}
          {activeTab === "categories" && (
            <>
              {subTabBar(
                [
                  { id: "categories", label: "Categories" },
                  { id: "rules", label: "Rules" },
                ],
                categorizationSection,
                (id) => setCategorizationSection(id as "categories" | "rules")
              )}
              {categorizationSection === "categories" && <CategoriesPage refreshKey={refreshKey} />}
              {categorizationSection === "rules" && <RulesPage refreshKey={refreshKey} />}
            </>
          )}

          {/* Tax */}
          {activeTab === "tax" && (
            <>
              {subTabBar(
                [
                  { id: "finances", label: "Finances" },
                  { id: "tax-summary", label: "Tax Summary" },
                  { id: "audit", label: "Audit" },
                ],
                taxSection,
                (id) => setTaxSection(id as "finances" | "tax-summary" | "audit")
              )}
              {taxSection === "finances" && <IncomeHousingPage refreshKey={refreshKey} />}
              {taxSection === "tax-summary" && <TaxSummaryPage refreshKey={refreshKey} />}
              {taxSection === "audit" && <AuditPage refreshKey={refreshKey} />}
            </>
          )}

          {/* Docs */}
          {activeTab === "docs" && <DocsPage />}

          {/* AI */}
          {activeTab === "ai" && (
            <>
              {subTabBar(
                [
                  { id: "chat", label: "AI Chat" },
                  { id: "llm-settings", label: "LLM Settings" },
                ],
                aiSection,
                (id) => setAiSection(id as "chat" | "llm-settings")
              )}
              {aiSection === "chat" && <ChatPage refreshKey={refreshKey} />}
              {aiSection === "llm-settings" && (
                <LLMSettingsPage
                  onSettingsChange={() => {
                    pingOllama()
                      .then(({ available }) => setOllamaOk(available))
                      .catch(() => setOllamaOk(false));
                  }}
                />
              )}
            </>
          )}
        </section>
      </main>
    </div>
    </ProfileGate>
  );
}
