from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, computed_field, model_validator


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str
    version: str


# ─────────────────────────────────────────────────────────────────────────────
# Category
# ─────────────────────────────────────────────────────────────────────────────


class CategoryCreate(BaseModel):
    name: str
    color: str = "#94a3b8"
    icon: str = "📌"
    monthly_budget: Optional[int] = None   # cents, null = no budget
    tax_deductible: bool = False


class CategoryUpdate(BaseModel):
    name: str
    color: str
    icon: str
    monthly_budget: Optional[int] = None   # cents, null = no budget
    tax_deductible: bool = False


class CategorySchema(BaseModel):
    id: int
    name: str
    color: str
    icon: str
    is_default: bool
    transaction_count: int = 0
    monthly_budget: Optional[int] = None
    tax_deductible: bool = False
    created_at: datetime


# ─────────────────────────────────────────────────────────────────────────────
# Rule
# ─────────────────────────────────────────────────────────────────────────────


class RuleCreate(BaseModel):
    pattern: str
    match_type: Literal["contains", "regex", "exact"]
    category_id: int
    priority: int = 50
    is_active: bool = True


class RuleUpdate(BaseModel):
    pattern: str
    match_type: Literal["contains", "regex", "exact"]
    category_id: int
    priority: int
    is_active: bool


class RuleSchema(BaseModel):
    id: int
    pattern: str
    match_type: str
    category_id: int
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    category_icon: Optional[str] = None
    priority: int
    is_active: bool
    created_at: datetime


class ApplyRulesResponse(BaseModel):
    updated: int
    unchanged: int
    total: int


# ─────────────────────────────────────────────────────────────────────────────
# Import wizard: column mapping
# ─────────────────────────────────────────────────────────────────────────────


class ColumnMappingInput(BaseModel):
    posted_date: str
    description_raw: str
    amount_type: Literal["single", "split"] = "single"
    amount: Optional[str] = None
    debit: Optional[str] = None
    credit: Optional[str] = None
    currency: Optional[str] = None
    merchant: Optional[str] = None

    @model_validator(mode="after")
    def _check_amount_fields(self) -> "ColumnMappingInput":
        if self.amount_type == "single" and not self.amount:
            raise ValueError("amount column is required when amount_type='single'")
        if self.amount_type == "split" and not self.debit and not self.credit:
            raise ValueError(
                "At least one of debit or credit is required when amount_type='split'"
            )
        return self


class PreviewResponse(BaseModel):
    filename: str
    headers: list[str]
    rows: list[dict[str, str]]
    total_rows_previewed: int
    total_rows: int


# ─────────────────────────────────────────────────────────────────────────────
# Import result
# ─────────────────────────────────────────────────────────────────────────────


class ImportResponse(BaseModel):
    id: int
    filename: str
    file_hash: str
    source_type: str
    column_mapping: Optional[dict[str, Any]] = None
    account_label: Optional[str] = None
    account_type: Optional[str] = None
    created_at: datetime
    inserted: int
    skipped: int


class ImportRecord(BaseModel):
    id: int
    filename: str
    source_type: str
    account_label: Optional[str] = None
    account_type: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    transaction_count: int


class PatchImportLabel(BaseModel):
    account_label: Optional[str] = None
    account_type: Optional[str] = None
    notes: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Transactions
# ─────────────────────────────────────────────────────────────────────────────


class TransactionSchema(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    import_id: int
    posted_date: str
    description_raw: str
    description_norm: str
    amount_cents: int
    currency: str
    merchant: Optional[str]
    category_id: Optional[int]
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    category_icon: Optional[str] = None
    fingerprint_hash: str
    transaction_type: str = "normal"
    note: Optional[str] = None
    category_source: Optional[str] = None
    category_rule_id: Optional[int] = None
    category_rule_pattern: Optional[str] = None
    category_rule_match_type: Optional[str] = None
    category_rule_priority: Optional[int] = None
    created_at: datetime

    @computed_field
    @property
    def amount(self) -> float:
        return round(self.amount_cents / 100, 2)


class TransactionListResponse(BaseModel):
    total: int
    items: list[TransactionSchema]


class PatchTransactionCategory(BaseModel):
    category_id: Optional[int] = None


class PatchTransactionNote(BaseModel):
    note: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Transfer detection
# ─────────────────────────────────────────────────────────────────────────────


class TransferTxSchema(BaseModel):
    id: int
    import_id: int
    posted_date: str
    description_raw: str
    amount_cents: int
    currency: str
    merchant: Optional[str]
    category_id: Optional[int]
    category_name: Optional[str] = None
    account_label: Optional[str] = None
    account_type: Optional[str] = None

    @computed_field
    @property
    def amount(self) -> float:
        return round(self.amount_cents / 100, 2)


class TransferCandidateSchema(BaseModel):
    tx1: TransferTxSchema
    tx2: TransferTxSchema
    confidence_pct: int
    day_diff: int
    reason: str


class ConfirmTransferBody(BaseModel):
    transaction_id_1: int
    transaction_id_2: int


# ─────────────────────────────────────────────────────────────────────────────
# LLM / Ollama
# ─────────────────────────────────────────────────────────────────────────────


class LLMModelInfo(BaseModel):
    name: str
    size: str
    modified: str


class LLMModelsResponse(BaseModel):
    models: list[LLMModelInfo]


class LLMPingResponse(BaseModel):
    available: bool


class LLMSettingsSchema(BaseModel):
    provider: str = "ollama"
    model: str = "llama3.1:latest"
    fast_model: str = "llama3.2:3b-instruct-q8_0"
    use_fast_mode: bool = False


class ChatMessageSchema(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessageSchema]
    use_fast_mode: Optional[bool] = None


class FactUsed(BaseModel):
    label: str
    value: str
    source: str


class ChatResponse(BaseModel):
    model: str
    answer: str
    facts_used: list[FactUsed]
    follow_ups: list[str]
