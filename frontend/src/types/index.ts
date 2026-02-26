// ── Tags ──────────────────────────────────────────────────────────────────────

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  created_at: string;
}

export interface TagCreate {
  name: string;
  color?: string | null;
}

export interface TagUpdate {
  name?: string;
  color?: string | null;
}

export interface Transaction {
  id: number;
  import_id: number;
  posted_date: string;
  description_raw: string;
  description_norm: string;
  amount: number;
  amount_cents: number;
  currency: string;
  merchant: string | null;
  merchant_canonical: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  fingerprint_hash: string;
  transaction_type: string;
  note: string | null;
  category_source: string | null;
  category_rule_id: number | null;
  category_rule_pattern: string | null;
  category_rule_match_type: string | null;
  category_rule_priority: number | null;
  created_at: string;
  tags: Tag[];
}

export interface ImportResult {
  id: number;
  filename: string;
  file_hash: string;
  source_type: string;
  column_mapping: ColumnMappingInput | null;
  account_label: string | null;
  account_type: string | null;
  created_at: string;
  inserted: number;
  skipped: number;
}

export interface ImportRecord {
  id: number;
  filename: string;
  source_type: string;
  account_label: string | null;
  account_type: string | null;
  notes: string | null;
  created_at: string;
  transaction_count: number;
}

export interface TransactionListResponse {
  total: number;
  items: Transaction[];
}

// ── Import Wizard ─────────────────────────────────────────────────────────────

export interface ColumnMappingInput {
  posted_date: string;
  description_raw: string;
  amount_type: "single" | "split";
  amount?: string;
  debit?: string;
  credit?: string;
  currency?: string;
  merchant?: string;
}

export interface PreviewResponse {
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
  total_rows_previewed: number;
  total_rows: number;
}

export type PDFStatus = "preview" | "needs_manual_mapping";

export interface PDFPreviewSuccess {
  status: "preview";
  filename: string;
  pages: number;
  headers: string[];
  rows: Record<string, string>[];
  total_rows: number;
}

export interface PDFPreviewFailed {
  status: "needs_manual_mapping";
  filename: string;
  pages: number;
  reason: string;
}

export type PDFPreviewResponse = PDFPreviewSuccess | PDFPreviewFailed;

// ── Categories ────────────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  color: string;
  icon: string;
  is_default: boolean;
  transaction_count: number;
  monthly_budget: number | null;
  tax_deductible: boolean;
  created_at: string;
}

export interface CategoryCreate {
  name: string;
  color: string;
  icon: string;
  monthly_budget?: number | null;
  tax_deductible?: boolean;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export type MatchType = "contains" | "regex" | "exact";

export interface Rule {
  id: number;
  pattern: string;
  match_type: MatchType;
  category_id: number;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
}

export interface RuleCreate {
  pattern: string;
  match_type: MatchType;
  category_id: number;
  priority: number;
  is_active: boolean;
}

export interface ApplyRulesResponse {
  updated: number;
  unchanged: number;
  total: number;
}

// ── Reports ───────────────────────────────────────────────────────────────────

export interface CategoryTotal {
  category_id: number | null;
  category_name: string | null;
  category_color: string;
  category_icon: string;
  total: number;
  count: number;
}

export interface DayTotal {
  date: string;
  expenses: number;
  income: number;
}

export interface MonthlySummary {
  month: string;
  total_income: number;
  total_expenses: number;
  net: number;
  transaction_count: number;
  by_category: CategoryTotal[];
  by_day: DayTotal[];
}

export interface MonthTotal {
  month: string;
  total: number;
}

export interface CategoryBreakdownRow extends CategoryTotal {
  months: MonthTotal[];
}

export interface CategoryBreakdown {
  from: string;
  to: string;
  months: string[];
  categories: CategoryBreakdownRow[];
}

// ── Candlestick / period summary ──────────────────────────────────────────────

export interface CandleData {
  period: string;   // YYYY-MM-DD or YYYY-MM
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PeriodSummary {
  from: string;
  to: string;
  total_income: number;
  total_expenses: number;
  net: number;
  transaction_count: number;
  by_category: CategoryTotal[];
  by_day: DayTotal[];
}

export type FlagType =
  | "duplicate-like"
  | "bank-fee"
  | "unusually-large"
  | "new-merchant"
  | "category-spike"
  | "merchant-anomaly";
export type Severity = "warning" | "info";

export interface AuditFlagTransaction {
  id: number;
  import_id: number;
  posted_date: string;
  description_raw: string;
  amount: number;
  currency: string;
  merchant: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
}

export interface AuditFlag {
  flag_type: FlagType;
  severity: Severity;
  explanation: string;
  transaction: AuditFlagTransaction;
  extra?: Record<string, unknown>;
}

// ── Transfer detection ─────────────────────────────────────────────────────────

export interface TransferTxInfo {
  id: number;
  import_id: number;
  posted_date: string;
  description_raw: string;
  amount: number;
  amount_cents: number;
  currency: string;
  merchant: string | null;
  category_name: string | null;
  account_label: string | null;
  account_type: string | null;
}

export interface TransferCandidate {
  tx1: TransferTxInfo;
  tx2: TransferTxInfo;
  confidence_pct: number;
  day_diff: number;
  reason: string;
}

// ── LLM / Ollama ──────────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  size: string;
  modified: string;
}

export interface LLMSettings {
  provider: string;
  model: string;
  fast_model: string;
  use_fast_mode: boolean;
}

export interface EvidenceFilters {
  from?: string;
  to?: string;
  category_id?: number;
  merchant?: string;
  transaction_id?: number;
  import_id?: number;
  uncategorized?: boolean;
  min_amount_cents?: number;
  max_amount_cents?: number;
}

export interface TransactionFilters {
  from_date?: string | null;
  to_date?: string | null;
  category_id?: number | null;
  merchant_search?: string | null;
  import_id?: number | null;
  uncategorized?: boolean;
}

export interface FactUsed {
  label: string;
  value: string;
  source: string;
  filters?: EvidenceFilters;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCall {
  id: number;
  name: string;
  label: string;
  summary: string;
}

export interface ChatResponse {
  model: string;
  answer: string;
  facts_used: FactUsed[];
  follow_ups: string[];
  tools_called: ToolCall[];
}

/** Raw NDJSON line emitted by Ollama's pull API */
export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

// ── Income & Housing report ───────────────────────────────────────────────────

export interface IncomeHousingTransaction {
  id: number;
  posted_date: string;
  description_raw: string;
  description_norm: string;
  amount: number;
  currency: string;
  merchant: string | null;
  category_id: number | null;
  category_name: string | null;
}

export interface TrackedGroup {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
  positive: boolean;
  amount_sign: "positive" | "negative" | "any";
  total: number;
  count: number;
  transactions: IncomeHousingTransaction[];
}

export interface IncomeHousingSummary {
  total_income: number;
  total_tracked_expenses: number;
  net: number;
}

export interface IncomeHousingReport {
  year: string | null;
  summary: IncomeHousingSummary;
  groups: TrackedGroup[];
}

// ── Recurring transactions ─────────────────────────────────────────────────────

export interface RecurringTransaction {
  id: number;
  posted_date: string;
  description_raw: string;
  amount: number;
}

export interface RecurringGroup {
  merchant: string;
  merchant_key: string;
  pattern: "weekly" | "biweekly" | "monthly";
  avg_amount: number;
  count: number;
  last_date: string;
  transactions: RecurringTransaction[];
}

// ── Net worth ─────────────────────────────────────────────────────────────────

export interface NetWorthMonthTotal {
  month: string;
  net: number;
}

export interface NetWorthAccount {
  label: string;
  type: string | null;
  monthly_totals: NetWorthMonthTotal[];
  total_net: number;
}

export interface NetWorthReport {
  accounts: NetWorthAccount[];
}

// ── Merchant Aliases ──────────────────────────────────────────────────────────

export interface MerchantAlias {
  id: number;
  alias: string;
  canonical: string;
  created_at: string;
  updated_at: string;
}

export interface MerchantAliasCreate {
  alias: string;
  canonical: string;
}

// ── Data Health ────────────────────────────────────────────────────────────────

export interface DataHealthReport {
  uncategorized_count: number;
  imports_missing_account_label_count: number;
  merchants_uncanonicalized_count: number;
  possible_duplicates_count: number;
  transfer_candidates_count: number;
  active_rules_count: number;
  last_import_date: string | null;
  total_transactions: number;
  top_problem_merchants: { merchant: string; count: number }[];
  recommendations: string[];
}

// ── SSE event types from /api/llm/chat/stream ─────────────────────────────────

export interface SSEThinkingEvent {
  type: "thinking";
  data: { message: string };
}

export interface SSEToolCallEvent {
  type: "tool_call";
  data: { id: number; name: string; label: string; args: Record<string, unknown> };
}

export interface SSEToolResultEvent {
  type: "tool_result";
  data: { id: number; name: string; summary: string };
}

export interface SSEAnswerEvent {
  type: "answer";
  data: ChatResponse;
}

export interface SSEErrorEvent {
  type: "error";
  data: { message: string };
}

export interface SSEDoneEvent {
  type: "done";
  data: Record<string, never>;
}

export type ChatSSEEvent =
  | SSEThinkingEvent
  | SSEToolCallEvent
  | SSEToolResultEvent
  | SSEAnswerEvent
  | SSEErrorEvent
  | SSEDoneEvent;

// ── Period Comparison ─────────────────────────────────────────────────────────

export interface ComparisonTotals {
  incomeA: number;
  expenseA: number;
  netA: number;
  txCountA: number;
  incomeB: number;
  expenseB: number;
  netB: number;
  txCountB: number;
  incomeDelta: number;
  expenseDelta: number;
  netDelta: number;
  txCountDelta: number;
}

export interface CategoryDelta {
  category_id: number | null;
  category_name: string | null;
  a_total: number;
  b_total: number;
  delta: number;
  pct_change: number | null;
  a_count: number;
  b_count: number;
}

export interface MerchantDelta {
  merchant: string;
  a_total: number;
  b_total: number;
  delta: number;
  pct_change: number | null;
  a_count: number;
  b_count: number;
}

export interface RecurringItem {
  merchant: string;
  amount: number;
  cadence: string | null;
}

export interface RecurringChanged {
  merchant: string;
  amountA: number;
  amountB: number;
  delta: number;
  cadence: string | null;
}

export interface PeriodComparison {
  periodA: { from: string; to: string };
  periodB: { from: string; to: string };
  totals: ComparisonTotals;
  categoryDeltas: CategoryDelta[];
  merchantDeltas: MerchantDelta[];
  recurringChanges: {
    new: RecurringItem[];
    stopped: RecurringItem[];
    changed: RecurringChanged[];
  };
  notes: string[];
}

// ── Rule Suggestions ──────────────────────────────────────────────────────────

export interface RuleSuggestion {
  merchant: string;
  match_type: MatchType;
  pattern: string;
  category_id: number | null;
  category_name: string | null;
  count: number;
  total_spend: number;
  avg_spend: number;
  confidence: number;
  source: "uncategorized_volume" | "manual_consistency";
  sample_descriptions: string[];
}

export interface RuleSuggestionsResponse {
  suggestions: RuleSuggestion[];
}

export interface ApplySuggestionRequest {
  merchant: string;
  match_type: MatchType;
  pattern: string;
  category_id: number;
  priority?: number;
}

export interface ApplySuggestionResponse {
  created_rule_id: number;
  updated_transactions_count: number;
}
