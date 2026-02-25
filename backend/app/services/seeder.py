"""Database seeder — idempotent default categories and rules."""

from sqlalchemy.orm import Session

from ..models import Category, Rule, Transaction

# ─────────────────────────────────────────────────────────────────────────────
# Default categories
# ─────────────────────────────────────────────────────────────────────────────

_DEFAULT_CATEGORIES = [
    {"name": "Income",               "color": "#10b981", "icon": "💰"},
    {"name": "Housing",              "color": "#6366f1", "icon": "🏠"},
    {"name": "Insurance",            "color": "#f59e0b", "icon": "🛡️"},
    {"name": "Investments",          "color": "#22d3ee", "icon": "📈"},
    {"name": "Credit Cards",         "color": "#a855f7", "icon": "💳"},
    {"name": "Groceries",            "color": "#22c55e", "icon": "🛒"},
    {"name": "Dining & Restaurants", "color": "#f97316", "icon": "🍽️"},
    {"name": "Transportation",       "color": "#3b82f6", "icon": "🚗"},
    {"name": "Shopping",             "color": "#ec4899", "icon": "🛍️"},
    {"name": "Entertainment",        "color": "#a855f7", "icon": "🎬"},
    {"name": "Subscriptions",        "color": "#8b5cf6", "icon": "📱"},
    {"name": "Utilities",            "color": "#f59e0b", "icon": "⚡"},
    {"name": "Healthcare",           "color": "#14b8a6", "icon": "💊"},
    {"name": "Travel",               "color": "#06b6d4", "icon": "✈️"},
    {"name": "Finance & Banking",    "color": "#64748b", "icon": "🏦"},
    {"name": "Personal Transfers",   "color": "#94a3b8", "icon": "👤"},
    {"name": "Transfer",             "color": "#64748b", "icon": "🔄"},
    {"name": "Other",                "color": "#94a3b8", "icon": "📌"},
]

# ─────────────────────────────────────────────────────────────────────────────
# Default rules  (pattern, match_type, category_name, priority)
#
# Priority convention:  higher number = matched first.
# Order matters for overlapping patterns: e.g. "amazon prime" (80) before
# "amazon" (50) so Prime subscribers land in Subscriptions, not Shopping.
# ─────────────────────────────────────────────────────────────────────────────

_DEFAULT_RULES: list[tuple[str, str, str, int]] = [
    # ── Transfer (top priority — prevents "transfer from" landing in Income) ─
    ("online banking transfer",  "contains", "Transfer", 96),
    ("mobile banking transfer",  "contains", "Transfer", 96),
    ("online banking payment",   "contains", "Transfer", 93),
    ("account transfer",         "contains", "Transfer", 91),
    ("overdraft protection",     "contains", "Transfer", 86),
    ("keep the change",          "contains", "Transfer", 86),

    # ── Income (highest priority — deposits should never mis-fire) ──────────
    ("fox tv",             "contains", "Income", 97),
    ("payroll",            "contains", "Income", 90),
    ("direct deposit",     "contains", "Income", 90),
    ("salary",             "contains", "Income", 85),
    ("transfer from",      "contains", "Income", 80),

    # ── Subscriptions (before generic Shopping/Entertainment) ────────────────
    ("amazon prime",       "contains", "Subscriptions", 80),
    ("netflix",            "contains", "Subscriptions", 75),
    ("spotify",            "contains", "Subscriptions", 75),
    ("hulu",               "contains", "Subscriptions", 75),
    ("disney",             "contains", "Subscriptions", 75),
    ("apple.com/bill",     "contains", "Subscriptions", 75),
    ("google.*storage",    "regex",    "Subscriptions", 75),

    # ── Dining (Uber Eats before generic Uber → Transportation) ─────────────
    ("uber eats",          "contains", "Dining & Restaurants", 80),
    ("doordash",           "contains", "Dining & Restaurants", 75),
    ("grubhub",            "contains", "Dining & Restaurants", 75),
    ("starbucks",          "contains", "Dining & Restaurants", 70),
    ("mcdonald",           "contains", "Dining & Restaurants", 70),
    ("chipotle",           "contains", "Dining & Restaurants", 70),
    ("dunkin",             "contains", "Dining & Restaurants", 70),
    ("subway",             "contains", "Dining & Restaurants", 70),

    # ── Groceries ────────────────────────────────────────────────────────────
    ("whole foods",        "contains", "Groceries", 70),
    ("trader joe",         "contains", "Groceries", 70),
    ("safeway",            "contains", "Groceries", 65),
    ("kroger",             "contains", "Groceries", 65),
    ("costco",             "contains", "Groceries", 65),
    ("walmart",            "contains", "Groceries", 60),

    # ── Transportation (Uber after Uber Eats) ────────────────────────────────
    ("lyft",               "contains", "Transportation", 70),
    ("uber",               "contains", "Transportation", 65),
    ("bart",               "contains", "Transportation", 70),
    ("metro",              "contains", "Transportation", 60),

    # ── Shopping (Amazon after Amazon Prime) ─────────────────────────────────
    ("amazon",             "contains", "Shopping", 50),
    ("target",             "contains", "Shopping", 55),
    ("ebay",               "contains", "Shopping", 60),
    ("etsy",               "contains", "Shopping", 60),

    # ── Healthcare ───────────────────────────────────────────────────────────
    ("cvs",                "contains", "Healthcare", 65),
    ("walgreens",          "contains", "Healthcare", 65),
    ("pharmacy",           "contains", "Healthcare", 60),
    ("rite aid",           "contains", "Healthcare", 65),

    # ── Utilities ────────────────────────────────────────────────────────────
    ("pg&e",               "contains", "Utilities", 70),
    ("comcast",            "contains", "Utilities", 65),
    ("verizon",            "contains", "Utilities", 65),
    ("electric bill",      "contains", "Utilities", 70),
    ("internet",           "contains", "Utilities", 55),

    # ── Entertainment ────────────────────────────────────────────────────────
    ("ticketmaster",       "contains", "Entertainment", 70),
    ("amc theatre",        "contains", "Entertainment", 70),
    ("eventbrite",         "contains", "Entertainment", 65),

    # ── Travel ───────────────────────────────────────────────────────────────
    ("airbnb",             "contains", "Travel", 75),
    ("marriott",           "contains", "Travel", 70),
    ("hilton",             "contains", "Travel", 70),
    ("delta",              "contains", "Travel", 65),
    ("united airlines",    "contains", "Travel", 70),
    ("hotel",              "contains", "Travel", 55),

    # ── Finance & Banking ────────────────────────────────────────────────────
    ("atm withdrawal",     "contains", "Finance & Banking", 65),
    ("bank fee",           "contains", "Finance & Banking", 70),
    ("interest charge",    "contains", "Finance & Banking", 70),
    ("venmo",              "contains", "Finance & Banking", 55),
    ("zelle",              "contains", "Finance & Banking", 55),
]


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────


def seed_categories(db: Session) -> None:
    """Insert default categories that don't already exist (idempotent by name)."""
    for data in _DEFAULT_CATEGORIES:
        if not db.query(Category).filter(Category.name == data["name"]).first():
            db.add(Category(is_default=True, **data))
    db.commit()


def seed_transfer_rules(db: Session) -> None:
    """Idempotently add Transfer rules for existing installs.

    seed_rules() only runs on a fresh (empty) rules table.  This function
    adds Transfer-category rules whenever the Transfer category exists but
    has no rules yet — safe to call on every startup.
    """
    transfer_cat = db.query(Category).filter(Category.name == "Transfer").first()
    if not transfer_cat:
        return

    existing = db.query(Rule).filter(Rule.category_id == transfer_cat.id).count()
    if existing > 0:
        return  # already seeded

    _transfer_patterns = [
        ("online banking transfer", "contains", 96),
        ("mobile banking transfer", "contains", 96),
        ("online banking payment",  "contains", 93),
        ("account transfer",        "contains", 91),
        ("overdraft protection",    "contains", 86),
        ("keep the change",         "contains", 86),
    ]
    for pattern, match_type, priority in _transfer_patterns:
        db.add(Rule(
            pattern=pattern,
            match_type=match_type,
            category_id=transfer_cat.id,
            priority=priority,
            is_active=True,
        ))
    db.commit()


def seed_housing_rules(db: Session) -> None:
    """Idempotently add known fixed-expense categories and rules.

    Safe to call on every startup — only inserts what is missing.
    Handles existing installs that predate these categories.
    """
    def _ensure_cat(name: str, color: str, icon: str) -> Category:
        cat = db.query(Category).filter(Category.name == name).first()
        if not cat:
            cat = Category(name=name, color=color, icon=icon, is_default=True)
            db.add(cat)
            db.flush()
        return cat

    housing_cat    = _ensure_cat("Housing",            "#6366f1", "🏠")
    income_cat     = _ensure_cat("Income",             "#10b981", "💰")
    insurance_cat  = _ensure_cat("Insurance",          "#f59e0b", "🛡️")
    invest_cat     = _ensure_cat("Investments",        "#22d3ee", "📈")
    cc_cat         = _ensure_cat("Credit Cards",       "#a855f7", "💳")
    utils_cat      = _ensure_cat("Utilities",          "#f59e0b", "⚡")
    subs_cat       = _ensure_cat("Subscriptions",      "#8b5cf6", "📱")
    finance_cat    = _ensure_cat("Finance & Banking",  "#64748b", "🏦")
    personal_cat   = _ensure_cat("Personal Transfers", "#94a3b8", "👤")

    # (pattern, match_type, category, priority)
    new_rules: list[tuple[str, str, Category, int]] = [
        # Housing
        ("newrez",            "contains", housing_cat,   95),
        ("shellpoin",         "contains", housing_cat,   95),
        ("saxony square",     "contains", housing_cat,   95),
        ("clickpay",          "contains", housing_cat,   95),
        # Income
        ("fox tv",            "contains", income_cat,    97),
        # Insurance
        ("northwestern mu",   "contains", insurance_cat, 95),
        # Investments
        ("robinhood",         "contains", invest_cat,    95),
        ("schwab brokerage",  "contains", invest_cat,    95),
        # Credit cards
        ("applecard gsbank",  "contains", cc_cat,        95),
        # Telecom
        ("verizon wireless",  "contains", utils_cat,     92),
        ("vz wireless",       "contains", utils_cat,     92),
        ("att* bill",         "contains", utils_cat,     92),
        # Subscriptions (PayPal-identified services)
        ("adobe",             "contains", subs_cat,      82),
        ("microsoft",         "contains", subs_cat,      82),
        ("midjourney",        "contains", subs_cat,      82),
        ("soundcloud",        "contains", subs_cat,      78),
        ("serato",            "contains", subs_cat,      78),
        ("tradingview",       "contains", subs_cat,      78),
        ("ancestry",          "contains", subs_cat,      78),
        ("godaddy",           "contains", subs_cat,      78),
        ("apple services",    "contains", subs_cat,      82),
        ("digitalocean",      "contains", subs_cat,      78),
        # Finance / BNPL
        ("klarna",            "contains", finance_cat,   80),
        ("sofi",              "contains", finance_cat,   78),
        ("paypal cashback",   "contains", cc_cat,        90),
        # Personal transfers (Apple Cash peer-to-peer)
        ("apple cash sent",   "contains", personal_cat,  96),
    ]

    existing_patterns = {r.pattern.lower() for r in db.query(Rule).all()}

    for pattern, match_type, cat, priority in new_rules:
        if pattern not in existing_patterns:
            db.add(Rule(
                pattern=pattern,
                match_type=match_type,
                category_id=cat.id,
                priority=priority,
                is_active=True,
            ))

    db.commit()


def seed_401k_loan_note(db: Session) -> None:
    """One-time: mark large Schwab MoneyLink deposits as transfers with a note.

    Excludes them from income/expense summaries (transaction_type='transfer').
    Idempotent — only touches transactions that are not already marked.
    """
    txs = (
        db.query(Transaction)
        .filter(
            Transaction.description_norm.ilike("%schwab%") |
            Transaction.description_raw.ilike("%schwab%") |
            Transaction.merchant.ilike("%schwab%")
        )
        .filter(Transaction.amount_cents > 2_000_000)  # > $20,000
        .filter(Transaction.transaction_type != "transfer")
        .all()
    )
    for tx in txs:
        tx.transaction_type = "transfer"
        if not tx.note:
            tx.note = "401k loan — reinvested elsewhere (excluded from income/expense summaries)"
    if txs:
        db.commit()


def delete_personal_zelle(db: Session) -> None:
    """One-time: delete personal Zelle transactions to/from Darren Crews.

    These are non-business transactions that should not appear in the ledger.
    Idempotent — safe to call every startup (silently does nothing if already deleted).
    """
    txs = (
        db.query(Transaction)
        .filter(
            Transaction.description_norm.ilike("%darren%") |
            Transaction.description_raw.ilike("%darren%")
        )
        .all()
    )
    for tx in txs:
        db.delete(tx)
    if txs:
        db.commit()


def seed_rules(db: Session) -> None:
    """Insert default rules only when the rules table is completely empty."""
    if db.query(Rule).count() > 0:
        return  # user may have customised rules — don't clobber them

    # Build name→id map (categories must already be seeded)
    cat_map: dict[str, int] = {
        name: cat_id
        for name, cat_id in db.query(Category.name, Category.id).all()
    }

    for pattern, match_type, cat_name, priority in _DEFAULT_RULES:
        cat_id = cat_map.get(cat_name)
        if cat_id is None:
            continue  # unknown category — skip gracefully
        db.add(
            Rule(
                pattern=pattern,
                match_type=match_type,
                category_id=cat_id,
                priority=priority,
                is_active=True,
            )
        )
    db.commit()
