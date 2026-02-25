import { useEffect, useRef, useState } from "react";
import { createProfile, deleteProfile, listProfiles } from "../api/client";

export default function ProfileSelector() {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProfiles()
      .then(({ profiles: p }) => setProfiles(p))
      .catch(() => setError("Cannot reach backend — make sure uvicorn is running on port 8000."))
      .finally(() => setLoading(false));
  }, []);

  function selectProfile(name: string) {
    localStorage.setItem("active_profile", name);
    window.location.reload();
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`Permanently delete profile "${name}" and all its data?`)) return;
    setError(null);
    setDeleting(name);
    try {
      await deleteProfile(name);
      setProfiles((prev) => prev.filter((p) => p !== name));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete profile");
    } finally {
      setDeleting(null);
    }
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const { name } = await createProfile(trimmed);
      selectProfile(name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create profile");
      setCreating(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "3rem", textAlign: "center" }}>
        <h1
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            letterSpacing: "0.14em",
            fontFamily: "var(--font-mono)",
            color: "#fff",
            margin: 0,
          }}
        >
          ◆ DIGITALSOV
        </h1>
        <p
          style={{
            marginTop: "0.5rem",
            fontSize: "0.75rem",
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            letterSpacing: "0.06em",
          }}
        >
          your data, your machine
        </p>
      </div>

      {/* Card */}
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "1.75rem",
        }}
      >
        <p
          style={{
            fontSize: "0.75rem",
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            letterSpacing: "0.08em",
            margin: "0 0 1.25rem",
          }}
        >
          SELECT PROFILE
        </p>

        {loading && (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>Loading…</p>
        )}

        {!loading && profiles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.25rem" }}>
            {profiles.map((name) => (
              <div
                key={name}
                style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}
              >
                <button
                  onClick={() => selectProfile(name)}
                  style={{
                    flex: 1,
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.8125rem",
                    padding: "0.625rem 1rem",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
                  }}
                >
                  {name}
                </button>
                {profiles.length > 1 && (
                  <button
                    onClick={() => handleDelete(name)}
                    disabled={deleting === name}
                    title={`Delete profile "${name}"`}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.75rem",
                      padding: "0 0.6rem",
                      cursor: "pointer",
                      transition: "color 0.15s, border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.color = "var(--red)";
                      b.style.borderColor = "var(--red-border)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.color = "var(--text-muted)";
                      b.style.borderColor = "var(--border)";
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && profiles.length === 0 && (
          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
              marginBottom: "1.25rem",
            }}
          >
            No profiles yet. Create one below to get started.
          </p>
        )}

        {/* New profile row */}
        {!loading && (
          <>
            <div
              style={{
                height: "1px",
                background: "var(--border)",
                margin: "0 0 1.25rem",
              }}
            />
            <p
              style={{
                fontSize: "0.75rem",
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                letterSpacing: "0.08em",
                margin: "0 0 0.75rem",
              }}
            >
              NEW PROFILE
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="e.g. alice"
                disabled={creating}
                style={{
                  flex: 1,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8125rem",
                  padding: "0.5rem 0.75rem",
                  outline: "none",
                }}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "var(--radius)",
                  color: "#fff",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8125rem",
                  fontWeight: 700,
                  padding: "0.5rem 1rem",
                  cursor: creating || !newName.trim() ? "not-allowed" : "pointer",
                  opacity: creating || !newName.trim() ? 0.5 : 1,
                }}
              >
                {creating ? "…" : "CREATE"}
              </button>
            </div>
          </>
        )}

        {error && (
          <p
            style={{
              marginTop: "1rem",
              fontSize: "0.8rem",
              color: "var(--red)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
