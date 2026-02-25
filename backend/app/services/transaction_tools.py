"""
Transaction query tools for LLM tool-calling.

Each function queries the SQLite database and returns a human-readable
plain-text summary. Tool results are fed back to Ollama as role='tool'
messages so the model can reason over them before producing a final answer.
"""

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..models import Category, Transaction

# ── Ollama tool definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_transactions",
            "description": (
                "Search transactions by keyword in the description or merchant name. "
                "Use this to find any specific merchant (e.g. 'Amazon', 'Starbucks', 'Netflix'), "
                "payee, or recurring charge. Supports optional date range filtering — "
                "ALWAYS pass from_date/to_date when the user specifies a year or date range "
                "(e.g. 'in 2025' → from_date='2025-01', to_date='2025-12')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search keyword or merchant name to look for",
                    },
                    "from_date": {
                        "type": "string",
                        "description": "Start date YYYY-MM-DD or YYYY-MM (optional). Use when the user specifies a year or start date.",
                    },
                    "to_date": {
                        "type": "string",
                        "description": "End date YYYY-MM-DD or YYYY-MM (optional). Use when the user specifies a year or end date.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum results to return (default 30, max 100)",
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
                "Use when the user asks about a specific month in detail, e.g. 'what happened in March 2025?'"
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
                "Get all transactions for a specific category, optionally filtered by date range. "
                "Use to analyse spending in one category over time — e.g. 'all my Dining charges in 2025'."
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
                        "description": "Start date YYYY-MM-DD or YYYY-MM (optional)",
                    },
                    "to_date": {
                        "type": "string",
                        "description": "End date YYYY-MM-DD or YYYY-MM (optional)",
                    },
                },
                "required": ["category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_largest_transactions",
            "description": (
                "Get the N largest income or expense transactions, optionally filtered by date range. "
                "Use for questions like 'what was my biggest expense?' or 'largest income this year?'"
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
                        "description": "Start date YYYY-MM-DD or YYYY-MM (optional)",
                    },
                    "to_date": {
                        "type": "string",
                        "description": "End date YYYY-MM-DD or YYYY-MM (optional)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Number of transactions to return (default 20, max 50)",
                    },
                },
                "required": ["transaction_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_period",
            "description": (
                "Get income and expense totals broken down by category for any date range. "
                "Use for budget analysis, comparing spending periods, or understanding category trends."
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

def _fmt(t: Transaction) -> str:
    amt = t.amount_cents / 100
    sign = "+" if amt > 0 else ""
    cat = t.category.name if t.category else "Uncategorized"
    desc = (t.description_norm or t.description_raw)[:45]
    return f"  [{t.posted_date}]  {desc:<45}  {sign}{amt:>10.2f}  [{cat}]"


def _normalize_date(d: str, end: bool = False) -> str:
    """Expand YYYY-MM to YYYY-MM-01 (start) or YYYY-MM-31 (end) for string comparison."""
    if d and len(d) == 7:
        return d + ("-31" if end else "-01")
    return d


# ── Tool implementations ──────────────────────────────────────────────────────

def search_transactions(
    db: Session,
    query: str,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 30,
) -> str:
    limit = min(max(1, limit), 100)
    pattern = f"%{query}%"
    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.transaction_type != "transfer")
        .filter(
            or_(
                Transaction.description_norm.ilike(pattern),
                Transaction.description_raw.ilike(pattern),
                Transaction.merchant.ilike(pattern),
            )
        )
    )
    if from_date:
        q = q.filter(Transaction.posted_date >= _normalize_date(from_date))
    if to_date:
        q = q.filter(Transaction.posted_date <= _normalize_date(to_date, end=True))

    results = q.order_by(Transaction.posted_date.desc()).limit(limit).all()

    if not results:
        date_part = ""
        if from_date or to_date:
            date_part = f" between {from_date or 'start'} and {to_date or 'now'}"
        return f"No transactions found matching '{query}'{date_part}."

    total = sum(t.amount_cents for t in results) / 100
    income = sum(t.amount_cents for t in results if t.amount_cents > 0) / 100
    expenses = abs(sum(t.amount_cents for t in results if t.amount_cents < 0)) / 100

    date_part = ""
    if from_date or to_date:
        date_part = f" ({from_date or 'start'} – {to_date or 'now'})"

    lines = [f"Found {len(results)} transactions matching '{query}'{date_part}:"]
    lines += [_fmt(t) for t in results]
    lines += [
        "",
        f"  Income:   +${income:,.2f}",
        f"  Expenses: -${expenses:,.2f}",
        f"  Net:       ${total:,.2f}",
    ]
    return "\n".join(lines)


def get_month_detail(db: Session, month: str) -> str:
    results = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.posted_date.like(f"{month}%"))
        .filter(Transaction.transaction_type != "transfer")
        .order_by(Transaction.posted_date.asc())
        .all()
    )

    if not results:
        return f"No transactions found for {month}."

    income = sum(t.amount_cents for t in results if t.amount_cents > 0) / 100
    expenses = abs(sum(t.amount_cents for t in results if t.amount_cents < 0)) / 100

    cat_totals: dict[str, float] = {}
    for t in results:
        if t.amount_cents < 0:
            cat = t.category.name if t.category else "Uncategorized"
            cat_totals[cat] = cat_totals.get(cat, 0.0) + abs(t.amount_cents) / 100

    lines = [
        f"{month} — {len(results)} transactions",
        f"  Income:   +${income:,.2f}",
        f"  Expenses: -${expenses:,.2f}",
        f"  Net:       ${income - expenses:,.2f}",
        "",
        "  Expense categories:",
    ]
    for cat, total in sorted(cat_totals.items(), key=lambda x: x[1], reverse=True):
        lines.append(f"    {cat:<30}  ${total:>10,.2f}")

    lines += ["", "  All transactions:"]
    lines += [_fmt(t) for t in results]
    return "\n".join(lines)


def get_category_transactions(
    db: Session,
    category: str,
    from_date: str | None = None,
    to_date: str | None = None,
) -> str:
    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.transaction_type != "transfer")
    )

    if category.lower() in ("uncategorized", "none", ""):
        q = q.filter(Transaction.category_id.is_(None))
    else:
        q = q.join(Transaction.category).filter(Category.name.ilike(f"%{category}%"))

    if from_date:
        q = q.filter(Transaction.posted_date >= _normalize_date(from_date))
    if to_date:
        q = q.filter(Transaction.posted_date <= _normalize_date(to_date, end=True))

    results = q.order_by(Transaction.posted_date.desc()).limit(150).all()

    if not results:
        date_part = ""
        if from_date or to_date:
            date_part = f" between {from_date or 'start'} and {to_date or 'now'}"
        return f"No transactions found for category '{category}'{date_part}."

    total = sum(t.amount_cents for t in results) / 100
    sign = "+" if total >= 0 else ""

    lines = [f"Found {len(results)} transactions in '{category}':"]
    lines += [_fmt(t) for t in results]
    lines += ["", f"  Total: {sign}${total:,.2f}"]
    return "\n".join(lines)


def get_largest_transactions(
    db: Session,
    transaction_type: str,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 20,
) -> str:
    limit = min(max(1, limit), 50)

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

    date_str = ""
    if from_date or to_date:
        date_str = f" ({from_date or 'start'} – {to_date or 'now'})"

    label = "income" if transaction_type == "income" else "expense"
    lines = [f"Top {len(results)} {label} transactions{date_str}:"]
    lines += [_fmt(t) for t in results]
    return "\n".join(lines)


def summarize_period(
    db: Session,
    from_date: str | None = None,
    to_date: str | None = None,
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
    for t in txs:
        cat = t.category.name if t.category else "Uncategorized"
        if cat not in cat_data:
            cat_data[cat] = {"income": 0.0, "expenses": 0.0, "count": 0}
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
        f"  {'Category':<30}  {'Income':>12}  {'Expenses':>12}  {'Count':>5}",
        "  " + "-" * 66,
    ]
    for cat, data in sorted(cat_data.items(), key=lambda x: x[1]["expenses"], reverse=True):
        lines.append(
            f"  {cat:<30}  ${data['income']:>11,.2f}  ${data['expenses']:>11,.2f}  {data['count']:>4}"
        )
    return "\n".join(lines)


# ── Dispatcher ────────────────────────────────────────────────────────────────

def execute_tool(name: str, arguments: dict, db: Session) -> str:
    """Route a tool call by name and return a plain-text result string."""
    try:
        if name == "search_transactions":
            return search_transactions(
                db,
                arguments["query"],
                arguments.get("from_date"),
                arguments.get("to_date"),
                int(arguments.get("limit", 30)),
            )
        elif name == "get_month_detail":
            return get_month_detail(db, arguments["month"])
        elif name == "get_category_transactions":
            return get_category_transactions(
                db,
                arguments["category"],
                arguments.get("from_date"),
                arguments.get("to_date"),
            )
        elif name == "get_largest_transactions":
            return get_largest_transactions(
                db,
                arguments["transaction_type"],
                arguments.get("from_date"),
                arguments.get("to_date"),
                int(arguments.get("limit", 20)),
            )
        elif name == "summarize_period":
            return summarize_period(
                db,
                arguments.get("from_date"),
                arguments.get("to_date"),
            )
        else:
            return f"Unknown tool '{name}'. Available tools: search_transactions, get_month_detail, get_category_transactions, get_largest_transactions, summarize_period."
    except KeyError as e:
        return f"Tool '{name}' called with missing required argument: {e}"
    except Exception as e:
        return f"Tool '{name}' error: {e}"
