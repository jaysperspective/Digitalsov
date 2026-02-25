import { useEffect, useRef, useState } from "react";
import {
  getLLMSettings,
  listOllamaModels,
  pingOllama,
  pullOllamaModel,
  updateLLMSettings,
} from "../api/client";
import type { LLMSettings, OllamaModel, PullProgress } from "../types";

interface Props {
  onSettingsChange?: (s: LLMSettings) => void;
}

export default function LLMSettingsPage({ onSettingsChange }: Props) {
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [settings, setSettings] = useState<LLMSettings>({
    provider: "ollama",
    model: "llama3.1:latest",
    fast_model: "llama3.2:3b-instruct-q8_0",
    use_fast_mode: false,
  });
  const [draft, setDraft] = useState<LLMSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Pull model
  const [pullModel, setPullModel] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullLines, setPullLines] = useState<PullProgress[]>([]);
  const [pullDone, setPullDone] = useState(false);
  const pullScrollRef = useRef<HTMLDivElement>(null);

  const refreshModels = async () => {
    try {
      const { models: ms } = await listOllamaModels();
      setModels(ms);
    } catch {
      setModels([]);
    }
  };

  const checkPing = async () => {
    try {
      const { available } = await pingOllama();
      setOllamaAvailable(available);
      if (available) refreshModels();
    } catch {
      setOllamaAvailable(false);
    }
  };

  useEffect(() => {
    checkPing();
    getLLMSettings()
      .then((s) => {
        setSettings(s);
        setDraft(s);
      })
      .catch(() => {});
  }, []);

  // Auto-scroll pull log
  useEffect(() => {
    if (pullScrollRef.current) {
      pullScrollRef.current.scrollTop = pullScrollRef.current.scrollHeight;
    }
  }, [pullLines]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const updated = await updateLLMSettings(draft);
      setSettings(updated);
      setDraft(updated);
      setSaveMsg("Saved.");
      onSettingsChange?.(updated);
    } catch (err: unknown) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePull = async () => {
    if (!pullModel.trim() || pulling) return;
    setPulling(true);
    setPullLines([]);
    setPullDone(false);

    try {
      for await (const line of pullOllamaModel(pullModel.trim())) {
        setPullLines((prev) => [...prev, line]);
        if (line.status === "success") setPullDone(true);
        if (line.error) setPullDone(true);
      }
    } catch (err: unknown) {
      setPullLines((prev) => [
        ...prev,
        { status: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setPulling(false);
      setPullDone(true);
      refreshModels();
    }
  };

  const pullPercent = (() => {
    const last = [...pullLines].reverse().find((l) => l.total && l.completed);
    if (!last || !last.total) return null;
    return Math.round(((last.completed ?? 0) / last.total) * 100);
  })();

  const labelStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "0.375rem",
    display: "block",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.4rem 0.625rem",
    fontSize: "0.875rem",
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    background: "var(--surface)",
    color: "var(--text)",
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: "0.6875rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--text-muted)",
    marginBottom: "0.875rem",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>

      {/* ── Ollama status ── */}
      <div>
        <p style={sectionTitle}>Ollama Status</p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background:
                ollamaAvailable === null
                  ? "#6b7280"
                  : ollamaAvailable
                  ? "#22c55e"
                  : "#ef4444",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: "0.875rem" }}>
            {ollamaAvailable === null
              ? "Checking…"
              : ollamaAvailable
              ? "Ollama is running at localhost:11434"
              : "Ollama is not reachable. Start it with: ollama serve"}
          </span>
          <button
            onClick={checkPing}
            style={{ marginLeft: "auto", fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
          >
            Re-check
          </button>
        </div>
      </div>

      {/* ── Installed models ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
          <p style={{ ...sectionTitle, marginBottom: 0 }}>Installed Models</p>
          <button
            onClick={refreshModels}
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
          >
            Refresh
          </button>
        </div>
        {models.length === 0 ? (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            {ollamaAvailable ? "No models installed." : "Ollama unavailable."}
          </p>
        ) : (
          <table>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>Name</th>
                <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>Size</th>
                <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>Modified</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.name} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.375rem 0.75rem", fontSize: "0.8125rem", fontFamily: "monospace" }}>{m.name}</td>
                  <td style={{ padding: "0.375rem 0.75rem", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>{m.size}</td>
                  <td style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {m.modified ? new Date(m.modified).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pull a model ── */}
      <div>
        <p style={sectionTitle}>Pull a Model</p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginBottom: "0.75rem" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Model name</label>
            <input
              style={inputStyle}
              value={pullModel}
              onChange={(e) => setPullModel(e.target.value)}
              placeholder="e.g. llama3.1:latest"
              disabled={pulling}
              onKeyDown={(e) => e.key === "Enter" && handlePull()}
            />
          </div>
          <button
            onClick={handlePull}
            disabled={!pullModel.trim() || pulling || !ollamaAvailable}
            style={{
              padding: "0.4rem 1rem",
              background: pulling ? "var(--bg)" : "var(--accent)",
              color: pulling ? "var(--text)" : "#fff",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {pulling ? "Pulling…" : "Pull"}
          </button>
        </div>

        {pullLines.length > 0 && (
          <div
            ref={pullScrollRef}
            style={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 6,
              padding: "0.625rem 0.875rem",
              maxHeight: 220,
              overflowY: "auto",
              fontFamily: "monospace",
              fontSize: "0.75rem",
              lineHeight: 1.6,
            }}
          >
            {pullLines.map((line, i) => {
              const isError = !!line.error;
              const isDone = line.status === "success";
              const pct = line.total && line.completed
                ? Math.round((line.completed / line.total) * 100)
                : null;
              return (
                <div
                  key={i}
                  style={{
                    color: isError ? "#f87171" : isDone ? "#86efac" : "#94a3b8",
                  }}
                >
                  {isError
                    ? `ERROR: ${line.error}`
                    : pct !== null
                    ? `${line.status} — ${pct}%`
                    : line.status}
                </div>
              );
            })}
            {pulling && !pullDone && (
              <div style={{ color: "#818cf8", marginTop: "0.25rem" }}>
                {pullPercent !== null ? (
                  <div>
                    <div style={{ color: "#94a3b8", marginBottom: "0.25rem" }}>Downloading…</div>
                    <div
                      style={{
                        height: 4,
                        background: "#1e293b",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${pullPercent}%`,
                          background: "#818cf8",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  "Working…"
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Model settings ── */}
      <div>
        <p style={sectionTitle}>Model Configuration</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <label style={labelStyle}>Quality model (default)</label>
            <input
              style={inputStyle}
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="llama3.1:latest"
            />
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Used for thorough analysis
            </p>
          </div>
          <div>
            <label style={labelStyle}>Fast model</label>
            <input
              style={inputStyle}
              value={draft.fast_model}
              onChange={(e) => setDraft({ ...draft, fast_model: e.target.value })}
              placeholder="llama3.2:3b-instruct-q8_0"
            />
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Used when Fast mode is on
            </p>
          </div>
        </div>

        {/* Fast mode toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.875rem",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
          }}
        >
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.875rem", fontWeight: 600 }}>Fast mode</p>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>
              Uses the smaller, faster model for quicker responses
            </p>
          </div>
          <button
            onClick={() => setDraft({ ...draft, use_fast_mode: !draft.use_fast_mode })}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              border: "none",
              background: draft.use_fast_mode ? "var(--accent)" : "var(--border-strong)",
              position: "relative",
              transition: "background 0.2s",
              padding: 0,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: draft.use_fast_mode ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
              }}
            />
          </button>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: draft.use_fast_mode ? "var(--accent)" : "var(--text-muted)",
              minWidth: 48,
            }}
          >
            {draft.use_fast_mode ? "Fast" : "Quality"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "0.4rem 1.25rem",
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
            }}
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {saveMsg && (
            <span
              style={{
                fontSize: "0.8125rem",
                color: saveMsg.startsWith("Error") ? "var(--red)" : "var(--green)",
              }}
            >
              {saveMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
