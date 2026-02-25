"""LLM service — Ollama client, agentic tool-calling loop, structured output."""

import json
import logging
from datetime import datetime
from typing import Any, AsyncIterator

import httpx
from sqlalchemy.orm import Session, joinedload

from ..models import Setting, Transaction

logger = logging.getLogger(__name__)

OLLAMA_BASE = "http://localhost:11434"
DEFAULT_MODEL = "llama3.1:latest"
DEFAULT_FAST_MODEL = "llama3.2:3b-instruct-q8_0"
MAX_TOOL_ITERATIONS = 6

# JSON Schema enforced on the final structured response (no tools in this call)
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "facts_used": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "value": {"type": "string"},
                    "source": {"type": "string"},
                },
                "required": ["label", "value", "source"],
            },
        },
        "follow_ups": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["answer", "facts_used", "follow_ups"],
}


# ── Settings helpers ──────────────────────────────────────────────────────────

def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(Setting).filter(Setting.key == key).first()
    return row.value if (row and row.value is not None) else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()


def get_llm_settings(db: Session) -> dict:
    return {
        "provider": get_setting(db, "llm_provider", "ollama"),
        "model": get_setting(db, "llm_model", DEFAULT_MODEL),
        "fast_model": get_setting(db, "llm_fast_model", DEFAULT_FAST_MODEL),
        "use_fast_mode": get_setting(db, "llm_use_fast_mode", "false") == "true",
    }


# ── Ollama availability / model management ────────────────────────────────────

async def ping_ollama() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


async def list_models() -> list[dict]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{OLLAMA_BASE}/api/tags")
        r.raise_for_status()
        models: list[dict] = []
        for m in r.json().get("models", []):
            size_bytes: int = m.get("size", 0)
            size_label = (
                f"{size_bytes / 1e9:.1f} GB"
                if size_bytes >= 1_000_000_000
                else f"{size_bytes // 1_000_000} MB"
            )
            models.append({
                "name": m.get("name", ""),
                "size": size_label,
                "modified": m.get("modified_at", ""),
            })
        return models


async def pull_model_stream(model: str) -> AsyncIterator[str]:
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST", f"{OLLAMA_BASE}/api/pull", json={"name": model}
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line:
                    yield line + "\n"


# ── Financial overview (lightweight — tools handle detail queries) ─────────────

def build_financial_context(db: Session) -> str:
    """
    Build a compact monthly-level overview for the system prompt.
    The LLM uses tools (search_transactions, get_month_detail, etc.)
    for any queries that need individual transaction detail.
    """
    txs = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.transaction_type != "transfer")
        .order_by(Transaction.posted_date.asc())
        .all()
    )

    if not txs:
        return "No transactions found in the database."

    first_date = txs[0].posted_date
    last_date = txs[-1].posted_date
    today = datetime.utcnow().strftime("%Y-%m-%d")

    all_income = sum(t.amount_cents for t in txs if t.amount_cents > 0) / 100
    all_expenses = abs(sum(t.amount_cents for t in txs if t.amount_cents < 0)) / 100

    monthly: dict[str, dict] = {}
    for t in txs:
        month = t.posted_date[:7]
        if month not in monthly:
            monthly[month] = {"income": 0.0, "expenses": 0.0, "count": 0}
        if t.amount_cents > 0:
            monthly[month]["income"] += t.amount_cents / 100
        else:
            monthly[month]["expenses"] += abs(t.amount_cents) / 100
        monthly[month]["count"] += 1

    lines = [
        f"Data range: {first_date} → {last_date}  (today: {today})",
        f"Transactions: {len(txs)}  |  All-time income: ${all_income:,.2f}  |  All-time expenses: ${all_expenses:,.2f}  |  Net: ${all_income - all_expenses:,.2f}",
        "",
        f"{'Month':<10}  {'Income':>12}  {'Expenses':>12}  {'Net':>12}  {'Txns':>5}",
        "-" * 58,
    ]
    for month in sorted(monthly.keys()):
        m = monthly[month]
        net_m = m["income"] - m["expenses"]
        lines.append(
            f"{month:<10}  ${m['income']:>11,.2f}  ${m['expenses']:>11,.2f}"
            f"  ${net_m:>11,.2f}  {m['count']:>4}"
        )
    return "\n".join(lines)


# ── Validation ────────────────────────────────────────────────────────────────

def _validate_response(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    if not isinstance(data.get("answer"), str):
        return False
    if not isinstance(data.get("facts_used"), list):
        return False
    if not isinstance(data.get("follow_ups"), list):
        return False
    for fact in data["facts_used"]:
        if not isinstance(fact, dict):
            return False
        if not all(k in fact for k in ("label", "value", "source")):
            return False
    return True


# ── SSE helpers ───────────────────────────────────────────────────────────────

def _sse(event: str, data: dict) -> str:
    """Format a Server-Sent Event line."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _tool_label(name: str, args: dict) -> str:
    """Human-readable description of a tool call for the UI."""
    if name == "search_transactions":
        return f'Searching for "{args.get("query", "")}"'
    if name == "get_month_detail":
        return f"Loading {args.get('month', '')} detail"
    if name == "get_category_transactions":
        cat = args.get("category", "")
        parts = [cat]
        if args.get("from_date") or args.get("to_date"):
            parts.append(f"({args.get('from_date', '')} – {args.get('to_date', '')})")
        return " ".join(parts)
    if name == "get_largest_transactions":
        t = args.get("transaction_type", "")
        parts = [f"Largest {t}s"]
        if args.get("from_date") or args.get("to_date"):
            parts.append(f"({args.get('from_date', '')} – {args.get('to_date', '')})")
        return " ".join(parts)
    if name == "summarize_period":
        f_, t_ = args.get("from_date", "all time"), args.get("to_date", "now")
        return f"Summary {f_} – {t_}"
    return name


# ── Agentic chat stream ───────────────────────────────────────────────────────

async def chat_stream(
    messages: list[dict],
    model: str,
    db: Session,
) -> AsyncIterator[str]:
    """
    Agentic chat with tool-calling.  Streams SSE events:

      event: thinking   data: {"message": "..."}
      event: tool_call  data: {"id": N, "name": "...", "label": "...", "args": {...}}
      event: tool_result data: {"id": N, "name": "...", "summary": "..."}
      event: answer     data: {model, answer, facts_used, follow_ups, tools_called}
      event: error      data: {"message": "..."}
      event: done       data: {}

    IMPORTANT: Ollama does not support sending 'tools' and 'format' in the same
    request.  The agentic loop uses 'tools' (no format); the final structured-
    output call uses 'format' (no tools).
    """
    from .transaction_tools import TOOLS, execute_tool

    context = build_financial_context(db)
    # Pull the last user message so Phase 2 can re-anchor to it
    original_question = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"), ""
    )

    system_msg = {
        "role": "system",
        "content": (
            "You are a helpful personal finance assistant with full access to the user's "
            "complete transaction history through the tools below.\n\n"
            "USE TOOLS when you need:\n"
            "  • A specific merchant or keyword  → search_transactions\n"
            "  • Full detail for one month       → get_month_detail\n"
            "  • All charges in a category       → get_category_transactions\n"
            "  • Biggest income or expense items → get_largest_transactions\n"
            "  • Category totals for any period  → summarize_period\n\n"
            "STRICT RULES — read carefully:\n"
            "  1. Answer ONLY the question the user actually asked. Never answer a different question.\n"
            "  2. If the user asks to 'show' or 'list' transactions, your answer MUST include those transactions.\n"
            "  3. Do not call get_month_detail unless the user explicitly asks about a month overview.\n"
            "  4. Use ONLY data returned by tools — do not use the monthly overview below to fabricate transaction details.\n"
            "  5. Never invent sources. Only cite tool names you actually called.\n"
            "  6. Always provide 2-3 follow-up questions relevant to what was asked.\n\n"
            "=== Financial Overview (for context only — use tools for specifics) ===\n"
            + context
        ),
    }

    all_messages: list[dict] = [system_msg] + messages
    tools_called: list[dict] = []
    tool_idx = 0
    final_text = ""

    yield _sse("thinking", {"message": "Analyzing your question…"})

    # ── Phase 1: Agentic tool-calling loop (no 'format') ─────────────────
    async with httpx.AsyncClient(timeout=120.0) as client:
        for _iteration in range(MAX_TOOL_ITERATIONS):
            r = await client.post(
                f"{OLLAMA_BASE}/api/chat",
                json={
                    "model": model,
                    "messages": all_messages,
                    "tools": TOOLS,
                    "stream": False,
                },
            )
            r.raise_for_status()
            msg = r.json().get("message", {})
            tool_calls: list[dict] = msg.get("tool_calls") or []

            if not tool_calls:
                final_text = msg.get("content", "")
                break

            # Append the assistant's tool-calling turn
            all_messages.append({
                "role": "assistant",
                "content": msg.get("content", ""),
                "tool_calls": tool_calls,
            })

            for tc in tool_calls:
                fn = tc.get("function", {})
                name: str = fn.get("name", "")
                # Ollama returns arguments as a pre-parsed dict (not a JSON string)
                args: dict = fn.get("arguments", {})
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        args = {}

                label = _tool_label(name, args)
                yield _sse("tool_call", {"id": tool_idx, "name": name, "label": label, "args": args})

                result_text = execute_tool(name, args, db)
                summary = result_text.split("\n")[0].strip()

                tools_called.append({"id": tool_idx, "name": name, "label": label, "summary": summary})
                yield _sse("tool_result", {"id": tool_idx, "name": name, "summary": summary})

                all_messages.append({"role": "tool", "content": result_text})
                tool_idx += 1

    # ── Phase 2: Structured output (no 'tools') ───────────────────────────
    yield _sse("thinking", {"message": "Formatting response…"})

    structure_messages = all_messages + [
        {
            "role": "user",
            "content": (
                f'The user\'s original question was: "{original_question}"\n\n'
                "Answer THAT question — and only that question — using the tool results above. "
                "Do not answer a different question. "
                "If the user asked to see specific transactions, include them in your answer field. "
                "Respond ONLY with a valid JSON object."
            ),
        }
    ]

    async def _structured(msgs: list[dict]) -> dict:
        async with httpx.AsyncClient(timeout=120.0) as cl:
            r = await cl.post(
                f"{OLLAMA_BASE}/api/chat",
                json={"model": model, "messages": msgs, "format": RESPONSE_SCHEMA, "stream": False},
            )
            r.raise_for_status()
            raw = r.json().get("message", {}).get("content", "{}")
            return json.loads(raw)

    result = await _structured(structure_messages)

    if not _validate_response(result):
        logger.warning("Structured output failed validation — retrying with correction")
        correction = {
            "role": "user",
            "content": (
                f'Reminder: the user asked "{original_question}". '
                "Answer ONLY that question. "
                'Respond ONLY with a JSON object: "answer" (string), '
                '"facts_used" (array of {label, value, source}), "follow_ups" (array of strings).'
            ),
        }
        result = await _structured(structure_messages + [correction])

        if not _validate_response(result):
            logger.error("Structured output failed validation after retry — using fallback")
            result = {
                "answer": final_text or "I was unable to produce a structured response. Please try again.",
                "facts_used": [],
                "follow_ups": [],
            }

    result["model"] = model
    result["tools_called"] = tools_called

    yield _sse("answer", result)
    yield _sse("done", {})
