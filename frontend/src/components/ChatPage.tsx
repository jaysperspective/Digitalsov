import { useEffect, useRef, useState } from "react";
import { getLLMSettings, listOllamaModels, pingOllama, pullOllamaModel, streamChat } from "../api/client";
import type { ChatMessage, ChatResponse, LLMSettings, PullProgress, ToolCall } from "../types";

// ── Internal state types ───────────────────────────────────────────────────────

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  structured?: ChatResponse;
  error?: string;
}

interface ActiveTool {
  id: number;
  name: string;
  label: string;
  summary?: string;
  done: boolean;
}

interface LoadingState {
  thinking: string;
  tools: ActiveTool[];
}

interface Props {
  refreshKey?: number;
}

const DEFAULT_MODEL = "llama3.1:latest";

// ── Tool name → icon ──────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  search_transactions: "🔍",
  get_month_detail: "📅",
  get_category_transactions: "🏷️",
  get_largest_transactions: "📊",
  summarize_period: "📈",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChatPage({ refreshKey }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingState, setLoadingState] = useState<LoadingState | null>(null);
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);

  // Pull-to-install flow
  const [pulling, setPulling] = useState(false);
  const [pullLines, setPullLines] = useState<PullProgress[]>([]);
  const [pullDone, setPullDone] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pullScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loadingState]);

  useEffect(() => {
    checkStatus();
  }, [refreshKey]);

  useEffect(() => {
    if (pullScrollRef.current) {
      pullScrollRef.current.scrollTop = pullScrollRef.current.scrollHeight;
    }
  }, [pullLines]);

  const checkStatus = async () => {
    try {
      const { available } = await pingOllama();
      setOllamaOk(available);
      if (!available) return;
      const [s, { models }] = await Promise.all([getLLMSettings(), listOllamaModels()]);
      setSettings(s);
      const target = s.use_fast_mode ? s.fast_model : s.model;
      setModelInstalled(models.some((m) => m.name === target));
    } catch {
      setOllamaOk(false);
    }
  };

  const activeModel = settings
    ? settings.use_fast_mode
      ? settings.fast_model
      : settings.model
    : DEFAULT_MODEL;

  // ── Pull to install ────────────────────────────────────────────────────────

  const handlePullModel = async () => {
    if (pulling) return;
    setPulling(true);
    setPullLines([]);
    setPullDone(false);
    try {
      for await (const line of pullOllamaModel(activeModel)) {
        setPullLines((p) => [...p, line]);
        if (line.status === "success" || line.error) setPullDone(true);
      }
    } catch (err: unknown) {
      setPullLines((p) => [...p, { status: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setPulling(false);
      setPullDone(true);
      checkStatus();
    }
  };

  const pullPercent = (() => {
    const last = [...pullLines].reverse().find((l) => l.total && l.completed);
    if (!last?.total) return null;
    return Math.round(((last.completed ?? 0) / last.total) * 100);
  })();

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    setLoadingState({ thinking: "Analyzing your question…", tools: [] });

    abortRef.current = new AbortController();

    try {
      const history: ChatMessage[] = messages
        .filter((m) => !m.error)
        .map((m) => ({
          role: m.role,
          content: m.structured ? m.structured.answer : m.content,
        }));
      history.push({ role: "user", content: text });

      for await (const event of streamChat(history, settings?.use_fast_mode)) {
        if (event.type === "thinking") {
          setLoadingState((prev) =>
            prev ? { ...prev, thinking: event.data.message } : { thinking: event.data.message, tools: [] }
          );
        } else if (event.type === "tool_call") {
          const tool: ActiveTool = {
            id: event.data.id,
            name: event.data.name,
            label: event.data.label,
            done: false,
          };
          setLoadingState((prev) =>
            prev ? { ...prev, tools: [...prev.tools, tool] } : { thinking: "", tools: [tool] }
          );
        } else if (event.type === "tool_result") {
          setLoadingState((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              tools: prev.tools.map((t) =>
                t.id === event.data.id ? { ...t, summary: event.data.summary, done: true } : t
              ),
            };
          });
        } else if (event.type === "answer") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: event.data.answer, structured: event.data },
          ]);
          setLoadingState(null);
        } else if (event.type === "error") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "", error: event.data.message },
          ]);
          setLoadingState(null);
        } else if (event.type === "done") {
          setLoadingState(null);
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", error: err instanceof Error ? err.message : String(err) },
        ]);
      }
      setLoadingState(null);
    } finally {
      setLoading(false);
      setLoadingState(null);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setLoading(false);
    setLoadingState(null);
  };

  const handleFollowUp = (q: string) => {
    setInput(q);
    inputRef.current?.focus();
  };

  // ── Status banners ─────────────────────────────────────────────────────────

  if (ollamaOk === false) {
    return (
      <div style={{ background: "var(--red-bg)", border: "1px solid var(--red-border)", borderRadius: "var(--radius)", padding: "1.5rem", textAlign: "center" }}>
        <p style={{ fontWeight: 600, color: "var(--red)", marginBottom: "0.5rem" }}>Ollama is not running</p>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
          Start Ollama to use the AI assistant.
        </p>
        <code style={{ display: "inline-block", background: "var(--surface-raised)", color: "var(--green)", padding: "0.375rem 0.875rem", borderRadius: "var(--radius)", fontSize: "0.875rem", fontFamily: "var(--font-mono)" }}>
          ollama serve
        </code>
        <div style={{ marginTop: "1rem" }}>
          <button onClick={checkStatus} style={{ fontSize: "0.8125rem" }}>Retry</button>
        </div>
      </div>
    );
  }

  if (modelInstalled === false && !pulling && pullLines.length === 0) {
    return (
      <div style={{ background: "var(--accent-light)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", padding: "1.5rem", textAlign: "center" }}>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
          Model not installed: <code style={{ fontSize: "0.875rem" }}>{activeModel}</code>
        </p>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
          Download it once — everything stays on your device.
        </p>
        <button onClick={handlePullModel} style={{ padding: "0.5rem 1.5rem", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", fontWeight: 600, fontSize: "0.875rem" }}>
          Download {activeModel}
        </button>
      </div>
    );
  }

  if (pulling || (modelInstalled === false && pullLines.length > 0)) {
    return (
      <div>
        <p style={{ fontWeight: 600, marginBottom: "0.75rem", fontSize: "0.875rem" }}>
          Downloading <code>{activeModel}</code>…
        </p>
        <div ref={pullScrollRef} style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0.75rem 1rem", maxHeight: 260, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "0.75rem", lineHeight: 1.6, marginBottom: "0.75rem" }}>
          {pullLines.map((line, i) => {
            const pct = line.total && line.completed ? Math.round((line.completed / line.total) * 100) : null;
            return (
              <div key={i} style={{ color: line.error ? "var(--red)" : line.status === "success" ? "var(--green)" : "var(--text-secondary)" }}>
                {line.error ? `ERROR: ${line.error}` : pct !== null ? `${line.status} — ${pct}%` : line.status}
              </div>
            );
          })}
          {pulling && pullPercent !== null && (
            <div style={{ marginTop: "0.375rem" }}>
              <div style={{ height: 4, background: "var(--surface-raised)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pullPercent}%`, background: "var(--accent)", transition: "width 0.3s ease" }} />
              </div>
            </div>
          )}
        </div>
        {pullDone && (
          <button onClick={checkStatus} style={{ padding: "0.4rem 1rem", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", fontWeight: 600 }}>
            Continue to Chat
          </button>
        )}
      </div>
    );
  }

  // ── Main chat UI ───────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "65vh", minHeight: 420 }}>

      {/* Model + privacy badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
        <span style={{
          background: settings?.use_fast_mode ? "#fef3c7" : "var(--accent-light)",
          color: settings?.use_fast_mode ? "#b45309" : "var(--accent)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius)", padding: "0.125rem 0.5rem", fontWeight: 600, fontSize: "0.6875rem",
        }}>
          {settings?.use_fast_mode ? "Fast" : "Quality"}
        </span>
        <code style={{ fontSize: "0.75rem" }}>{activeModel}</code>
        <span style={{ marginLeft: "auto" }}>All processing is local — no data leaves your device.</span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.25rem 0", display: "flex", flexDirection: "column", gap: "1rem" }}>

        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem", paddingTop: "3rem" }}>
            <p style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>💬</p>
            <p style={{ fontWeight: 600, marginBottom: "0.375rem" }}>Ask anything about your finances</p>
            <p style={{ fontSize: "0.8125rem" }}>
              I can search all your transactions, break down spending by month or category, and find patterns.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", justifyContent: "center", marginTop: "1rem" }}>
              {[
                "What were my biggest expenses last month?",
                "How much did I spend on dining in 2025?",
                "Show me all Amazon transactions",
                "What's my largest income source?",
              ].map((q) => (
                <button key={q} onClick={() => handleFollowUp(q)} style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", background: "var(--accent-light)", color: "var(--accent)", border: "1px solid var(--border-strong)", borderRadius: 9999, fontWeight: 500 }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: "0.375rem" }}>

            {/* Main bubble */}
            <div style={{
              maxWidth: "82%",
              background: msg.role === "user" ? "var(--accent)" : msg.error ? "var(--red-bg)" : "var(--bg)",
              color: msg.role === "user" ? "#fff" : msg.error ? "var(--red)" : "var(--text)",
              border: msg.role === "assistant" ? `1px solid ${msg.error ? "var(--red-border)" : "var(--border)"}` : "none",
              borderRadius: msg.role === "user" ? "6px 6px 2px 6px" : "2px 6px 6px 6px",
              padding: "0.625rem 0.875rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {msg.error ? `Error: ${msg.error}` : msg.structured?.answer ?? msg.content}
            </div>

            {/* Facts used */}
            {msg.structured?.facts_used && msg.structured.facts_used.length > 0 && (
              <div style={{ maxWidth: "82%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0.5rem 0.75rem", fontSize: "0.75rem" }}>
                <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "0.375rem" }}>
                  Facts cited
                </p>
                {msg.structured.facts_used.map((f, fi) => (
                  <div key={fi} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "0.375rem", alignItems: "baseline", marginBottom: "0.125rem" }}>
                    <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{f.label}:</span>
                    <span style={{ fontWeight: 600 }}>{f.value}</span>
                    <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)", background: "var(--bg)", padding: "0.0625rem 0.375rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                      {f.source}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Tools used */}
            {msg.structured?.tools_called && msg.structured.tools_called.length > 0 && (
              <div style={{ maxWidth: "82%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.25rem" }}>
                <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginRight: "0.125rem" }}>Tools used:</span>
                {(msg.structured.tools_called as ToolCall[]).map((t) => (
                  <span key={t.id} title={t.summary} style={{ fontSize: "0.6875rem", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "0.0625rem 0.375rem", color: "var(--text-secondary)" }}>
                    {TOOL_ICONS[t.name] ?? "🔧"} {t.label}
                  </span>
                ))}
              </div>
            )}

            {/* Follow-ups */}
            {msg.structured?.follow_ups && msg.structured.follow_ups.length > 0 && (
              <div style={{ maxWidth: "82%", display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {msg.structured.follow_ups.map((q, qi) => (
                  <button key={qi} onClick={() => handleFollowUp(q)} style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", background: "var(--accent-light)", color: "var(--accent)", border: "1px solid var(--border-strong)", borderRadius: 9999, fontWeight: 500 }}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Live loading / tool-call indicator */}
        {loading && loadingState && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "2px 6px 6px 6px", padding: "0.625rem 0.875rem", minWidth: 200, maxWidth: "70%" }}>
              {/* Thinking label */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: loadingState.tools.length > 0 ? "0.5rem" : 0 }}>
                <span style={{ display: "flex", gap: "0.2rem" }}>
                  {[0, 1, 2].map((n) => (
                    <span key={n} style={{ width: 5, height: 5, background: "var(--text-muted)", borderRadius: "50%", display: "inline-block", animation: `pulse 1.2s ease-in-out ${n * 0.2}s infinite` }} />
                  ))}
                </span>
                {loadingState.thinking}
              </div>

              {/* Tool call rows */}
              {loadingState.tools.map((tool) => (
                <div key={tool.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.8125rem", padding: "0.1875rem 0", borderTop: "1px solid var(--border)" }}>
                  <span style={{ fontSize: "0.875rem", flexShrink: 0, marginTop: "0.0625rem" }}>
                    {TOOL_ICONS[tool.name] ?? "🔧"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: tool.done ? "var(--text)" : "var(--accent)", fontWeight: 500 }}>
                      {tool.label}
                    </span>
                    {tool.done && tool.summary && (
                      <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginLeft: "0.375rem" }}>
                        — {tool.summary}
                      </span>
                    )}
                  </div>
                  <span style={{ flexShrink: 0, fontSize: "0.75rem", color: tool.done ? "var(--green)" : "var(--accent)" }}>
                    {tool.done ? "✓" : "…"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
          }}
          placeholder="Ask about your finances… (Enter to send, Shift+Enter for newline)"
          disabled={loading}
          rows={2}
          style={{ flex: 1, padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", background: "var(--surface)", color: "var(--text)", resize: "none", lineHeight: 1.5, fontFamily: "inherit" }}
        />
        {loading ? (
          <button onClick={handleStop} style={{ padding: "0.5rem 1rem", background: "var(--red-bg)", color: "var(--red)", border: "1px solid var(--red-border)", borderRadius: "var(--radius)", fontWeight: 600, alignSelf: "flex-end", whiteSpace: "nowrap" }}>
            Stop
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={!input.trim()} style={{ padding: "0.5rem 1.125rem", background: input.trim() ? "var(--accent)" : "var(--bg)", color: input.trim() ? "#fff" : "var(--text-muted)", border: `1px solid ${input.trim() ? "transparent" : "var(--border-strong)"}`, borderRadius: "var(--radius)", fontWeight: 600, alignSelf: "flex-end" }}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
