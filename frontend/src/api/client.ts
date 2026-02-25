import type {
  ApplyRulesResponse,
  AuditFlag,
  CandleData,
  Category,
  CategoryBreakdown,
  CategoryCreate,
  ChatMessage,
  ChatSSEEvent,
  ColumnMappingInput,
  ImportRecord,
  ImportResult,
  IncomeHousingReport,
  LLMSettings,
  MonthlySummary,
  NetWorthReport,
  OllamaModel,
  PDFPreviewResponse,
  PeriodSummary,
  PreviewResponse,
  PullProgress,
  RecurringGroup,
  Rule,
  RuleCreate,
  TransactionListResponse,
  TransferCandidate,
} from "../types";

const BASE = "/api";

export function getActiveProfile(): string {
  return localStorage.getItem("active_profile") ?? "default";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("X-Profile", getActiveProfile());
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      // FastAPI can return detail as string or array of validation errors
      detail = Array.isArray(body.detail)
        ? body.detail.map((e: { msg: string }) => e.msg).join("; ")
        : (body.detail ?? JSON.stringify(body));
    } catch {
      /* ignore parse errors */
    }
    throw new Error(detail);
  }
  // 204 No Content — no body to parse
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function healthCheck(): Promise<{ status: string; version: string }> {
  return request("/health");
}

/** Legacy endpoint: source-type preset mapping */
export function uploadCSV(file: File, sourceType: string): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("source_type", sourceType);
  return request("/imports/", { method: "POST", body: form });
}

/** Wizard step 1: parse headers + first 20 rows (no DB write) */
export function previewCSV(file: File): Promise<PreviewResponse> {
  const form = new FormData();
  form.append("file", file);
  return request("/imports/preview", { method: "POST", body: form });
}

/** PDF step 1: extract tables — returns preview or needs_manual_mapping */
export function previewPDF(file: File): Promise<PDFPreviewResponse> {
  const form = new FormData();
  form.append("file", file);
  return request("/imports/pdf/preview", { method: "POST", body: form });
}

/** PDF step 2: import with explicit column mapping */
export function importPDFWithMapping(
  file: File,
  mapping: ColumnMappingInput
): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("mapping", JSON.stringify(mapping));
  return request("/imports/pdf", { method: "POST", body: form });
}

/** Wizard step 2: import with explicit user-defined column mapping */
export function importCSVWithMapping(
  file: File,
  mapping: ColumnMappingInput
): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("mapping", JSON.stringify(mapping));
  return request("/imports/csv", { method: "POST", body: form });
}

/** PayPal CSV export — fixed format, no column mapping needed */
export function importPayPalCSV(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  return request("/imports/paypal", { method: "POST", body: form });
}

export function patchTransactionCategory(
  txId: number,
  categoryId: number | null
): Promise<import("../types").Transaction> {
  return request(`/transactions/${txId}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: categoryId }),
  });
}

export function patchTransactionNote(
  txId: number,
  note: string | null
): Promise<import("../types").Transaction> {
  return request(`/transactions/${txId}/note`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

export function deleteTransaction(txId: number): Promise<void> {
  return request(`/transactions/${txId}`, { method: "DELETE" });
}

export function fetchTransactions(params: {
  limit?: number;
  offset?: number;
  import_id?: number | null;
  category_id?: number | null;
  uncategorized?: boolean;
  from_date?: string | null;
  to_date?: string | null;
}): Promise<TransactionListResponse> {
  const q = new URLSearchParams();
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  if (params.import_id != null) q.set("import_id", String(params.import_id));
  if (params.category_id != null) q.set("category_id", String(params.category_id));
  if (params.uncategorized) q.set("uncategorized", "true");
  if (params.from_date) q.set("from_date", params.from_date);
  if (params.to_date) q.set("to_date", params.to_date);
  return request(`/transactions/?${q}`);
}

// ── Categories ────────────────────────────────────────────────────────────────

export function getCategories(): Promise<Category[]> {
  return request("/categories/");
}

export function createCategory(payload: CategoryCreate): Promise<Category> {
  return request("/categories/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateCategory(id: number, payload: CategoryCreate): Promise<Category> {
  return request(`/categories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteCategory(id: number): Promise<void> {
  return request(`/categories/${id}`, { method: "DELETE" });
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export function getRules(): Promise<Rule[]> {
  return request("/rules/");
}

export function createRule(payload: RuleCreate): Promise<Rule> {
  return request("/rules/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateRule(id: number, payload: RuleCreate): Promise<Rule> {
  return request(`/rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteRule(id: number): Promise<void> {
  return request(`/rules/${id}`, { method: "DELETE" });
}

export function applyRules(): Promise<ApplyRulesResponse> {
  return request("/rules/apply", { method: "POST" });
}

// ── Reports ───────────────────────────────────────────────────────────────────

export function getMonthlySummary(month: string): Promise<MonthlySummary> {
  return request(`/reports/monthly-summary?month=${encodeURIComponent(month)}`);
}

export function getCategoryBreakdown(from: string, to: string): Promise<CategoryBreakdown> {
  return request(
    `/reports/category-breakdown?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
}

export function getAuditFlags(from?: string, to?: string): Promise<AuditFlag[]> {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return request(`/reports/audit-flags?${q}`);
}

export function getPeriodSummary(from: string, to: string): Promise<PeriodSummary> {
  return request(
    `/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
}

export function getCandlestick(
  from: string,
  to: string,
  period: "day" | "month"
): Promise<CandleData[]> {
  return request(
    `/reports/candlestick?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&period=${period}`
  );
}

/** Returns the URL to download the tax-year CSV export (use as href). */
export function taxExportURL(year: string): string {
  return `${BASE}/reports/tax-export?year=${year}&profile=${encodeURIComponent(getActiveProfile())}`;
}

export function exportTransactionsCsv(params: {
  import_id?: number | null;
  category_id?: number | null;
  uncategorized?: boolean;
  from_date?: string | null;
  to_date?: string | null;
}): string {
  const q = new URLSearchParams();
  if (params.import_id != null) q.set("import_id", String(params.import_id));
  if (params.category_id != null) q.set("category_id", String(params.category_id));
  if (params.uncategorized) q.set("uncategorized", "true");
  if (params.from_date) q.set("from_date", params.from_date);
  if (params.to_date) q.set("to_date", params.to_date);
  q.set("profile", getActiveProfile());
  return `${BASE}/transactions/export?${q}`;
}

export function getRecurring(): Promise<RecurringGroup[]> {
  return request("/reports/recurring");
}

export function getNetWorth(): Promise<NetWorthReport> {
  return request("/reports/net-worth");
}

// ── Import history ─────────────────────────────────────────────────────────────

export function listImports(): Promise<ImportRecord[]> {
  return request("/imports/list");
}

export function patchImportLabel(
  id: number,
  payload: { account_label?: string | null; account_type?: string | null; notes?: string | null }
): Promise<ImportRecord> {
  return request(`/imports/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteImport(id: number): Promise<void> {
  return request(`/imports/${id}`, { method: "DELETE" });
}

// ── Audit / Transfer detection ─────────────────────────────────────────────────

export function getTransferCandidates(): Promise<TransferCandidate[]> {
  return request("/audit/transfer-candidates");
}

export function confirmTransfer(id1: number, id2: number): Promise<void> {
  return request("/audit/confirm-transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction_id_1: id1, transaction_id_2: id2 }),
  });
}

export function getIncomeHousing(year?: string): Promise<IncomeHousingReport> {
  const q = year ? `?year=${encodeURIComponent(year)}` : "";
  return request(`/reports/income-housing${q}`);
}

// ── LLM / Ollama ──────────────────────────────────────────────────────────────

export function pingOllama(): Promise<{ available: boolean }> {
  return request("/llm/ping");
}

export function listOllamaModels(): Promise<{ models: OllamaModel[] }> {
  return request("/llm/models");
}

export function getLLMSettings(): Promise<LLMSettings> {
  return request("/llm/settings");
}

export function updateLLMSettings(payload: LLMSettings): Promise<LLMSettings> {
  return request("/llm/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Stream an agentic chat response as SSE events.
 *
 * Yields typed ChatSSEEvent objects: thinking → tool_call → tool_result →
 * answer → done (or error).
 *
 * Usage:
 *   for await (const event of streamChat(messages)) { ... }
 */
export async function* streamChat(
  messages: ChatMessage[],
  useFastMode?: boolean
): AsyncGenerator<ChatSSEEvent> {
  const response = await fetch(`${BASE}/llm/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Profile": getActiveProfile() },
    body: JSON.stringify({ messages, use_fast_mode: useFastMode ?? null }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are delimited by double newline
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventType = "message";
      let dataStr = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
      }
      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          yield { type: eventType, data: parsed } as ChatSSEEvent;
        } catch {
          /* skip malformed SSE frames */
        }
      }
    }
  }

  // Flush any remaining buffer
  if (buffer.trim()) {
    let eventType = "message";
    let dataStr = "";
    for (const line of buffer.split("\n")) {
      if (line.startsWith("event: ")) eventType = line.slice(7).trim();
      if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
    }
    if (dataStr) {
      try {
        yield { type: eventType, data: JSON.parse(dataStr) } as ChatSSEEvent;
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Pull an Ollama model and yield NDJSON progress objects.
 * Caller should iterate with `for await (const p of pullOllamaModel(...))`.
 */
export async function* pullOllamaModel(
  model: string
): AsyncGenerator<PullProgress> {
  const response = await fetch(`${BASE}/llm/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Profile": getActiveProfile() },
    body: JSON.stringify({ model }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Pull request failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          yield JSON.parse(trimmed) as PullProgress;
        } catch {
          /* skip malformed lines */
        }
      }
    }
  }

  // flush remainder
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim()) as PullProgress;
    } catch {
      /* ignore */
    }
  }
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export function listProfiles(): Promise<{ profiles: string[] }> {
  return request("/profiles/");
}

export function createProfile(name: string): Promise<{ name: string }> {
  return request("/profiles/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteProfile(name: string): Promise<void> {
  return request(`/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
}
