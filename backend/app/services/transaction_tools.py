"""
Transaction query tools for LLM tool-calling.

Each function queries the SQLite database and returns a human-readable
plain-text summary fed back to Ollama as role='tool' messages.

Security constraints enforced server-side (model cannot bypass these):
  MAX_TOOL_ROWS = 200  — hard cap on rows returned by any single tool call
  MAX_QUERY_LEN = 80   — maximum search query length accepted
  Redaction by default — description_raw/norm omitted unless include_raw=True
"""

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..models import Category, Transaction

# ── Security constants ─────────────────────────────────────────────────────────

MAX_TOOL_ROWS = 200   # Hard cap: no tool may return more than this many rows
MAX_QUERY_LEN = 80    # Maximum search-query length (characters)

# ── Ollama tool definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_transactions",
            "description": (
                "Search transactions by keyword in the merchant name or description. "
                "Use this to find any specific merchant (e.g. 'Amazon', 'Starbucks', 'Netflix'), "
                "payee, or recurring charge. Supports optional date range filtering — "
                "ALWAYS pass from_date/to_date when the user specifies a year or date range "
                "(e.g. 'in 2025' → from_date='2025-01-01', to_date='2025-12-31'). "
                "Plain text keyword only — no regex. Returns up to 200 rows maximum."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keyword or merchant name to search for (plain text, 2–80 chars)",
                    },
                    "from_date": {
                        "type": "string",
                        "description": "Start date YYYY-MM-DD or YYYY-MM (optional)",
                    },
                    "to_date": {
                        "type": "string",
                        "description": "End date YYYY-MM-DD or YYYY-MM (optional)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum results to return (default 50, hard max 200)",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_month_detail",
            "description": (
                "Get every transaction and a full category breakdown for one specific month. "
                "Use when the user asks about a specific month in detail, "
                "e.g. 'what happened in March 2025?'. Returns up to 200 rows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {
                        "type": "string",
                        "description": "Month in YYYY-MM format (e.g. '2025-03')",
                    },
                },
                "required": ["month"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_category_transactions",
            "description": (
                "Get transactions for a specific category filtered by date range. "
                "Use to analyse spending in one category — e.g. 'all my Dining charges in 2025'. "
                "Both from_date and to_date are required to keep results bounded. "
                "If the user does not specify dates, use the current year start and today. "
                "Returns up to 200 rows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Category name (e.g. 'Groceries', 'Dining', 'Shopping', 'Income')",
                    },
                    "from_date": {
                        "type": "string",
                        "description": "Start date YYYY-MM-DD or YYYY-MM. Required.",
                    },
                    "to_date": {
                        "type": "string",
                        "description": "End date YYYY-MM-DD or YYYY-MM. Required.",
                    },
                },
                "required": ["category", "from_date", "to_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_largest_transactions",
            "description": (
                "Get the N largest income or expense transactions within a date range. "
                "Use for questions like 'what was my biggest expense last month?' or "
                "'largest income this year?'. Date range and limit are required. "
                "Returns up to 200 rows maximum."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_type": {
                        "type": "string",
                        "enum": ["income", "expense"],
                        "description": "Return the largest income or expense transactions",
                    },
                    "from_date": {
                        "type": "string",
                        "description": "Start date YYYY-MM-DD or YYYY-MM. Required.",
                    },
                    "to_date": {
                        "type": "string",
                        "description": "End date YYYY-MM-DD or YYYY-MM. Required.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Number of transactions to return (default 20, hard max 200)",
                    },
                },
                "required": ["transaction_type", "from_date", "to_date", "limit"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_period",
            "description": (
                "Get income and expense totals broken down by category for any date range. "
                "Use for budget analysis, comparing spending periods, or understanding category trends. "
                "Returns category-level aggregates — no individual transaction rows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "from_date": {
                        "type": "string",
                        "description": "Start date YYYY-MM-DD or YYYY-MM (optional — defaults to all time)",
                    },
                    "to_date": {
                        "type": "string",
                        "description": "End date YYYY-MM-DD or YYYY-MM (optional — defaults to all time)",
                    },
                },
                "required": [],
            },
        },
    },
]


# ── Formatting helper ─────────────────────────────────────────────────────────

def _fmt(t: Transaction, include_raw: bool = False) -> str:
    """Format one transaction row for LLM tool results.

    By default, description fields are omitted (redact-by-default policy).
    Only merchant name, date, amount, and category are surfaced.
    Pass include_raw=True to append the normalised description — only when the
    user has explicitly requested full descriptions in their message.
    """
    amt = t.amount_cents / 100
    sign = "+" if amt > 0 else ""
    cat = t.category.name if t.category else "Uncategorized"
    merchant = t.merchant_canonical or t.merchant or "—"
    line = f"  [{t.posted_date}]  {merchant:<40}  {sign}{amt:>10.2f}  [{cat}]"
    if include_raw:
        desc = (t.description_norm or t.description_raw or "")[:50]
        line += f"  | {desc}"
    return line


def _normalize_date(d: str, end: bool = False) -> str:
    """Expand YYYY-MM to YYYY-MM-01 (start) or YYYY-MM-31 (end)."""
    if d and len(d) == 7:
        return d + ("-31" if end else "-01")
    return d


# ── Tool implementations ──────────────────────────────────────────────────────

def search_transactions(
    db: Session,
    query: str,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 50,
    include_raw: bool = False,
) -> str:
    # Sanitize: strip whitespace, enforce length bounds
    query = query.strip()[:MAX_QUERY_LEN]
    if len(query) < 2:
        return "Search query must be at least 2 characters."
    limit = min(max(1, limit), MAX_TOOL_ROWS)

    pattern = f"%{query}%"
    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.transaction_type != "transfer")
        .filter(
            or_(
                Transaction.merchant_canonical.ilike(pattern),
                Transaction.merchant.ilike(pattern),
                Transaction.description_norm.ilike(pattern),
            )
        )
    )
    if from_date:
        q = q.filter(Transaction.posted_date >= _normalize_date(from_date))
    if to_date:
        q = q.filter(Transaction.posted_date <= _normalize_date(to_date, end=True))

    results = q.order_by(Transaction.posted_date.desc()).limit(limit).all()

    if not results:
        date_part = (
            f" between {from_date or 'start'} and {to_date or 'now'}"
            if (from_date or to_date)
            else ""
        )
        return f"No transactions found matching '{query}'{date_part}."

    income = sum(t.amount_cents for t in results if t.amount_cents > 0) / 100
    expenses = abs(sum(t.amount_cents for t in results if t.amount_cents < 0)) / 100
    net = sum(t.amount_cents for t in results) / 100

    date_part = (
        f" ({from_date or 'start'} – {to_date or 'now'})"
        if (from_date or to_date)
        else ""
    )
    cap_note = f" (showing first {limit})" if len(results) == limit else ""

    lines = [f"Found {len(results)} transactions matching '{query}'{date_part}{cap_note}:"]
    lines += [_fmt(t, include_raw) for t in results]
    lines += [
        "",
        f"  Income:   +${income:,.2f}",
        f"  Expenses: -${expenses:,.2f}",
        f"  Net:       ${net:,.2f}",
    ]
    return "\n".join(lines)


def get_month_detail(db: Session, month: str, include_raw: bool = False) -> str:
    results = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.posted_date.like(f"{month}%"))
        .filter(Transaction.transaction_type != "transfer")
        .order_by(Transaction.posted_date.asc())
        .limit(MAX_TOOL_ROWS)
        .all()
    )

    if not results:
        return f"No transactions found for {month}."

    income = sum(t.amount_cents for t in results if t.amount_cents > 0) / 100
    expenses = abs(sum(t.amount_cents for t in results if t.amount_cents < 0)) / 100

    cat_totals: dict[str, float] = {}
    cat_ids: dict[str, int | None] = {}
    for t in results:
        if t.amount_cents < 0:
            cat = t.category.name if t.category else "Uncategorized"
            cat_totals[cat] = cat_totals.get(cat, 0.0) + abs(t.amount_cents) / 100
            if cat not in cat_ids:
                cat_ids[cat] = t.category.id if t.category else None

    lines = [
        f"{month} — {len(results)} transactions",
        f"  Date range: {month}-01 to {month}-31",
        f"  Income:   +${income:,.2f}",
        f"  Expenses: -${expenses:,.2f}",
        f"  Net:       ${income - expenses:,.2f}",
        "",
        "  Expense categories:",
    ]
    for cat, total in sorted(cat_totals.items(), key=lambda x: x[1], reverse=True):
        cid = cat_ids.get(cat)
        cid_note = f" (category_id={cid})" if cid else ""
        lines.append(f"    {cat:<30}  ${total:>10,.2f}{cid_note}")

    lines += ["", "  All transactions:"]
    lines += [_fmt(t, include_raw) for t in results]
    return "\n".join(lines)


def get_category_transactions(
    db: Session,
    category: str,
    from_date: str | None = None,
    to_date: str | None = None,
    include_raw: bool = False,
) -> str:
    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.transaction_type != "transfer")
    )

    cat_obj = None
    if category.lower() in ("uncategorized", "none", ""):
        q = q.filter(Transaction.category_id.is_(None))
    else:
        cat_obj = (
            db.query(Category).filter(Category.name.ilike(f"%{category}%")).first()
        )
        q = q.join(Transaction.category).filter(Category.name.ilike(f"%{category}%"))

    if from_date:
        q = q.filter(Transaction.posted_date >= _normalize_date(from_date))
    if to_date:
        q = q.filter(Transaction.posted_date <= _normalize_date(to_date, end=True))

    results = q.order_by(Transaction.posted_date.desc()).limit(MAX_TOOL_ROWS).all()

    if not results:
        date_part = (
            f" between {from_date or 'start'} and {to_date or 'now'}"
            if (from_date or to_date)
            else ""
        )
        return f"No transactions found for category '{category}'{date_part}."

    total = sum(t.amount_cents for t in results) / 100
    sign = "+" if total >= 0 else ""

    cat_id_note = f" (category_id={cat_obj.id})" if cat_obj else ""
    date_str = f" from {from_date} to {to_date}" if (from_date or to_date) else ""

    lines = [f"Found {len(results)} transactions in '{category}'{cat_id_note}{date_str}:"]
    lines += [_fmt(t, include_raw) for t in results]
    lines += ["", f"  Total: {sign}${abs(total):,.2f}"]
    return "\n".join(lines)


def get_largest_transactions(
    db: Session,
    transaction_type: str,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 20,
    include_raw: bool = False,
) -> str:
    limit = min(max(1, limit), MAX_TOOL_ROWS)

    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.transaction_type != "transfer")
    )

    if transaction_type == "income":
        q = q.filter(Transaction.amount_cents > 0).order_by(Transaction.amount_cents.desc())
    else:
        q = q.filter(Transaction.amount_cents < 0).order_by(Transaction.amount_cents.asc())

    if from_date:
        q = q.filter(Transaction.posted_date >= _normalize_date(from_date))
    if to_date:
        q = q.filter(Transaction.posted_date <= _normalize_date(to_date, end=True))

    results = q.limit(limit).all()

    if not results:
        return f"No {transaction_type} transactions found for the specified period."

    date_str = (
        f" ({from_date or 'start'} – {to_date or 'now'})"
        if (from_date or to_date)
        else ""
    )
    label = "income" if transaction_type == "income" else "expense"
    lines = [f"Top {len(results)} {label} transactions{date_str}:"]
    lines += [_fmt(t, include_raw) for t in results]
    return "\n".join(lines)


def summarize_period(
    db: Session,
    from_date: str | None = None,
    to_date: str | None = None,
    include_raw: bool = False,  # noqa: ARG001 — summary tool never emits rows
) -> str:
    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.transaction_type != "transfer")
    )
    if from_date:
        q = q.filter(Transaction.posted_date >= _normalize_date(from_date))
    if to_date:
        q = q.filter(Transaction.posted_date <= _normalize_date(to_date, end=True))

    txs = q.all()

    if not txs:
        return "No transactions found for the specified period."

    total_income = sum(t.amount_cents for t in txs if t.amount_cents > 0) / 100
    total_expenses = abs(sum(t.amount_cents for t in txs if t.amount_cents < 0)) / 100

    cat_data: dict[str, dict] = {}
    cat_ids: dict[str, int | None] = {}
    for t in txs:
        cat = t.category.name if t.category else "Uncategorized"
        if cat not in cat_data:
            cat_data[cat] = {"income": 0.0, "expenses": 0.0, "count": 0}
            cat_ids[cat] = t.category.id if t.category else None
        if t.amount_cents > 0:
            cat_data[cat]["income"] += t.amount_cents / 100
        else:
            cat_data[cat]["expenses"] += abs(t.amount_cents) / 100
        cat_data[cat]["count"] += 1

    date_str = f"{from_date or 'all time'} to {to_date or 'now'}"
    lines = [
        f"Period summary: {date_str}",
        f"  Total Income:   +${total_income:,.2f}",
        f"  Total Expenses: -${total_expenses:,.2f}",
        f"  Net:             ${total_income - total_expenses:,.2f}",
        f"  Transactions:    {len(txs)}",
        "",
        f"  {'Category':<30}  {'cat_id':>6}  {'Income':>12}  {'Expenses':>12}  {'Txns':>5}",
        "  " + "-" * 75,
    ]
    for cat, data in sorted(cat_data.items(), key=lambda x: x[1]["expenses"], reverse=True):
        cid = cat_ids.get(cat)
        cid_str = str(cid) if cid else "—"
        lines.append(
            f"  {cat:<30}  {cid_str:>6}  ${data['income']:>11,.2f}"
            f"  ${data['expenses']:>11,.2f}  {data['count']:>4}"
        )
    return "\n".join(lines)


# ── Dispatcher ────────────────────────────────────────────────────────────────

def execute_tool(
    name: str, arguments: dict, db: Session, include_raw: bool = False
) -> str:
    """Route a tool call by name and return a plain-text result string."""
    try:
        if name == "search_transactions":
            return search_transactions(
                db,
                arguments["query"],
                arguments.get("from_date"),
                arguments.get("to_date"),
                int(arguments.get("limit", 50)),
                include_raw,
            )
        elif name == "get_month_detail":
            return get_month_detail(db, arguments["month"], include_raw)
        elif name == "get_category_transactions":
            return get_category_transactions(
                db,
                arguments["category"],
                arguments.get("from_date"),
                arguments.get("to_date"),
                include_raw,
            )
        elif name == "get_largest_transactions":
            return get_largest_transactions(
                db,
                arguments["transaction_type"],
                arguments.get("from_date"),
                arguments.get("to_date"),
                int(arguments.get("limit", 20)),
                include_raw,
            )
        elif name == "summarize_period":
            return summarize_period(
                db,
                arguments.get("from_date"),
                arguments.get("to_date"),
                include_raw,
            )
        else:
            return (
                f"Unknown tool '{name}'. "
                "Available: search_transactions, get_month_detail, get_category_transactions, "
                "get_largest_transactions, summarize_period."
            )
    except KeyError as e:
        return f"Tool '{name}' called with missing required argument: {e}"
    except Exception as e:
        return f"Tool '{name}' error: {e}"
