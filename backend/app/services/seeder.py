"""Database seeder — idempotent default categories and rules."""

import calendar
import hashlib
from datetime import date

from sqlalchemy.orm import Session

from ..models import Category, Import, Rule, Transaction

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


# ─────────────────────────────────────────────────────────────────────────────
# Demo profile seeder  (fictional data — no relation to any real user)
# ─────────────────────────────────────────────────────────────────────────────

def seed_demo_transactions(db: Session) -> None:
    """Populate the 'sample' profile with realistic fictional transactions.

    Idempotent — does nothing if any transactions already exist.
    All data (names, amounts, merchants) is entirely made up.
    Dates are shifted to the 3 months leading up to the current month so
    the dashboard always shows recent data rather than hardcoded Q4 2024.
    """
    if db.query(Transaction).count() > 0:
        return

    # ── Rolling date helpers ──────────────────────────────────────────────────
    def _months_ago(n: int) -> tuple[int, int]:
        today = date.today()
        year, month = today.year, today.month
        month -= n
        while month <= 0:
            month += 12
            year -= 1
        return year, month

    # Map the 3 source months (Oct→Nov→Dec 2024) to rolling recent months.
    # "current month" is _months_ago(0); 1-3 months back fill the prior months.
    _SRC = {
        "2024-10": _months_ago(2),
        "2024-11": _months_ago(1),
        "2024-12": _months_ago(0),
    }

    def shift_date(dt: str) -> str:
        """Shift a hardcoded 2024 date string to its rolling equivalent."""
        src_prefix = dt[:7]
        if src_prefix not in _SRC:
            return dt
        year, month = _SRC[src_prefix]
        day = int(dt[8:10])
        max_day = calendar.monthrange(year, month)[1]
        day = min(day, max_day)
        return f"{year}-{month:02d}-{day:02d}"

    cat_map: dict[str, int] = {c.name: c.id for c in db.query(Category).all()}

    def _fp(dt: str, desc: str, cents: int) -> str:
        """Compute deterministic fingerprint identical to normalizer.compute_fingerprint."""
        canonical = f"{dt}|{desc.strip()}|{cents / 100:.4f}"
        return hashlib.sha256(canonical.encode()).hexdigest()

    def _imp_hash(key: str) -> str:
        return hashlib.sha256(f"digitalsov-demo-v1-{key}".encode()).hexdigest()

    # ── Two fictional account imports ─────────────────────────────────────────
    imp_chk = Import(
        filename="sample_riverdale_checking.csv",
        file_hash=_imp_hash("riverdale-checking-4521"),
        source_type="generic",
        account_label="Riverdale Bank Checking ••4521",
        account_type="checking",
        notes="Demo profile — all data is fictional",
    )
    imp_cc = Import(
        filename="sample_apex_card.csv",
        file_hash=_imp_hash("apex-card-8834"),
        source_type="generic",
        account_label="Apex Rewards Card ••8834",
        account_type="credit",
        notes="Demo profile — all data is fictional",
    )
    db.add_all([imp_chk, imp_cc])
    db.flush()  # materialise IDs before linking transactions

    # Category shorthand
    INC = "Income"
    HSG = "Housing"
    SUB = "Subscriptions"
    GRC = "Groceries"
    DIN = "Dining & Restaurants"
    TRP = "Transportation"
    SHP = "Shopping"
    UTL = "Utilities"
    HLT = "Healthcare"
    ENT = "Entertainment"
    FIN = "Finance & Banking"

    def t(
        dt: str,
        desc: str,
        merchant: str,
        cents: int,
        imp: Import,
        cat: str | None = None,
        tx_type: str = "debit",
        note: str | None = None,
    ) -> Transaction:
        dt = shift_date(dt)  # shift hardcoded 2024 dates to rolling recent months
        cat_id = cat_map.get(cat) if cat else None
        return Transaction(
            import_id=imp.id,
            posted_date=dt,
            description_raw=desc,
            description_norm=desc.lower(),
            merchant=merchant,
            merchant_canonical=merchant,
            amount_cents=cents,
            transaction_type=tx_type,
            category_id=cat_id,
            category_source="manual" if cat_id else "uncategorized",
            fingerprint_hash=_fp(dt, desc, cents),
            note=note,
        )

    CHK = imp_chk
    CC  = imp_cc

    txns = [
        # ── OCTOBER 2024 ──────────────────────────────────────────────────────
        # Housing
        t("2024-10-01", "MAPLEWOOD APARTMENTS OCT RENT",  "Maplewood Apartments", -185000, CHK, HSG),
        # Income — bi-weekly payroll from fictional employer
        t("2024-10-04", "MERIDIAN TECH PAYROLL DIR DEP",  "Meridian Tech",         418750, CHK, INC, "credit"),
        # Groceries
        t("2024-10-05", "WHOLE FOODS MKT #0423",          "Whole Foods",            -9247, CC,  GRC),
        # Dining
        t("2024-10-07", "STARBUCKS #09421",               "Starbucks",               -735, CC,  DIN),
        # Uncategorized — gym (no default rule)
        t("2024-10-08", "PEAK FITNESS 0042",              "Peak Fitness",           -2499, CHK),
        # Subscriptions
        t("2024-10-09", "NETFLIX.COM",                    "Netflix",                -1599, CC,  SUB),
        # Transportation
        t("2024-10-10", "LYFT *RIDE 10/10",               "Lyft",                   -1480, CC,  TRP),
        # Dining
        t("2024-10-11", "CHIPOTLE ONLINE #441",           "Chipotle",               -1625, CC,  DIN),
        # Shopping
        t("2024-10-12", "AMAZON.COM AMZN.COM",            "Amazon",                 -8999, CC,  SHP),
        # Groceries
        t("2024-10-14", "TRADER JOE'S #145",              "Trader Joe's",            -6347, CC,  GRC),
        # Subscriptions
        t("2024-10-15", "SPOTIFY USA",                    "Spotify",                -1099, CC,  SUB),
        # Utilities
        t("2024-10-16", "HARBOR ELECTRIC UTILITY",        "Harbor Electric",        -9422, CHK, UTL),
        # Dining
        t("2024-10-17", "STARBUCKS #09421",               "Starbucks",               -685, CC,  DIN),
        # Income
        t("2024-10-18", "MERIDIAN TECH PAYROLL DIR DEP",  "Meridian Tech",         418750, CHK, INC, "credit"),
        # Dining
        t("2024-10-19", "DOORDASH*DELIVERY",              "DoorDash",               -3875, CC,  DIN),
        # Uncategorized — gas station (no default rule for "coastal fuel")
        t("2024-10-20", "COASTAL FUEL #3847",             "Coastal Fuel",           -6245, CHK),
        # Shopping
        t("2024-10-21", "TARGET #1832",                   "Target",                 -6730, CC,  SHP),
        # Subscriptions
        t("2024-10-22", "AMAZON PRIME MEMBERSHIP",        "Amazon Prime",           -1499, CC,  SUB),
        # Utilities
        t("2024-10-23", "BROADWAVE INTERNET",             "Broadwave Internet",     -8999, CHK, UTL),
        # Healthcare
        t("2024-10-24", "WALGREENS #4821",                "Walgreens",              -2347, CC,  HLT),
        # Transportation
        t("2024-10-25", "BART CLIPPER",                   "BART",                    -650, CHK, TRP),
        # Entertainment
        t("2024-10-26", "AMC THEATRES #0321",             "AMC Theatre",            -2450, CC,  ENT),
        # Finance
        t("2024-10-27", "VENMO PAYMENT",                  "Venmo",                  -4000, CHK, FIN),
        # Dining
        t("2024-10-28", "STARBUCKS #09421",               "Starbucks",               -815, CC,  DIN),
        # Groceries
        t("2024-10-29", "WHOLE FOODS MKT #0423",          "Whole Foods",           -11863, CC,  GRC),
        # Utilities
        t("2024-10-30", "NOVA WIRELESS",                  "Nova Wireless",           -7200, CHK, UTL),
        # Transfer to savings
        t("2024-10-31", "ONLINE BANKING TRANSFER SAVINGS","Savings Transfer",      -50000, CHK, None, "transfer", "Monthly savings deposit"),

        # ── NOVEMBER 2024 ─────────────────────────────────────────────────────
        # Housing
        t("2024-11-01", "MAPLEWOOD APARTMENTS NOV RENT",  "Maplewood Apartments", -185000, CHK, HSG),
        # Income
        t("2024-11-01", "MERIDIAN TECH PAYROLL DIR DEP",  "Meridian Tech",         418750, CHK, INC, "credit"),
        # Groceries
        t("2024-11-02", "TRADER JOE'S #145",              "Trader Joe's",            -7592, CC,  GRC),
        # Uncategorized — video conferencing subscription (no default rule)
        t("2024-11-03", "ZOOM.US SUBSCRIPTION",           "Zoom Video",             -1599, CC),
        # Transportation
        t("2024-11-04", "LYFT *RIDE 11/04",               "Lyft",                   -2230, CC,  TRP),
        # Dining
        t("2024-11-05", "CHIPOTLE ONLINE #441",           "Chipotle",               -1495, CC,  DIN),
        # Shopping
        t("2024-11-06", "TARGET #1832",                   "Target",                -13477, CC,  SHP),
        # Healthcare
        t("2024-11-07", "CVS PHARMACY #4821",             "CVS",                    -3489, CC,  HLT),
        # Dining
        t("2024-11-08", "STARBUCKS #09421",               "Starbucks",               -765, CC,  DIN),
        # Subscriptions
        t("2024-11-09", "NETFLIX.COM",                    "Netflix",                -1599, CC,  SUB),
        # Shopping
        t("2024-11-10", "AMAZON.COM AMZN.COM",            "Amazon",                -15640, CC,  SHP),
        # Transportation
        t("2024-11-11", "BART CLIPPER",                   "BART",                    -975, CHK, TRP),
        # Dining
        t("2024-11-12", "UBER EATS",                      "Uber Eats",              -4265, CC,  DIN),
        # Uncategorized — gas station
        t("2024-11-13", "COASTAL FUEL #3847",             "Coastal Fuel",           -5890, CHK),
        # Entertainment
        t("2024-11-14", "TICKETMASTER",                   "Ticketmaster",          -12750, CC,  ENT),
        # Income
        t("2024-11-15", "MERIDIAN TECH PAYROLL DIR DEP",  "Meridian Tech",         418750, CHK, INC, "credit"),
        # Subscriptions
        t("2024-11-15", "SPOTIFY USA",                    "Spotify",                -1099, CC,  SUB),
        # Utilities
        t("2024-11-16", "HARBOR ELECTRIC UTILITY",        "Harbor Electric",       -10844, CHK, UTL),
        # Groceries
        t("2024-11-17", "WHOLE FOODS MKT #0423",          "Whole Foods",            -8723, CC,  GRC),
        # Uncategorized — AI subscription (no default rule)
        t("2024-11-18", "OPENAI PLUS SUBSCRIPTION",       "OpenAI",                 -2000, CC),
        # Dining
        t("2024-11-19", "STARBUCKS #09421",               "Starbucks",               -645, CC,  DIN),
        # Groceries (bulk run)
        t("2024-11-20", "COSTCO WHOLESALE #0042",         "Costco",                -21357, CHK, GRC),
        # Subscriptions
        t("2024-11-22", "AMAZON PRIME MEMBERSHIP",        "Amazon Prime",           -1499, CC,  SUB),
        # Utilities
        t("2024-11-23", "BROADWAVE INTERNET",             "Broadwave Internet",     -8999, CHK, UTL),
        # Dining
        t("2024-11-24", "CHIPOTLE ONLINE #441",           "Chipotle",               -1735, CC,  DIN),
        # Finance
        t("2024-11-25", "ATM WITHDRAWAL",                 "ATM Withdrawal",        -20000, CHK, FIN),
        # Groceries
        t("2024-11-26", "WHOLE FOODS MKT #0423",          "Whole Foods",            -9682, CC,  GRC),
        # Uncategorized — local restaurant (no default rule)
        t("2024-11-27", "BRAVOS PIZZA & PASTA",           "Bravos Pizza",           -2850, CC),
        # Income
        t("2024-11-29", "MERIDIAN TECH PAYROLL DIR DEP",  "Meridian Tech",         418750, CHK, INC, "credit"),
        # Utilities
        t("2024-11-30", "NOVA WIRELESS",                  "Nova Wireless",           -7200, CHK, UTL),
        # Transfer to savings
        t("2024-11-30", "ONLINE BANKING TRANSFER SAVINGS","Savings Transfer",      -50000, CHK, None, "transfer", "Monthly savings deposit"),

        # ── DECEMBER 2024 ─────────────────────────────────────────────────────
        # Housing
        t("2024-12-01", "MAPLEWOOD APARTMENTS DEC RENT",  "Maplewood Apartments", -185000, CHK, HSG),
        # Groceries
        t("2024-12-03", "TRADER JOE'S #145",              "Trader Joe's",            -8844, CC,  GRC),
        # Transportation
        t("2024-12-04", "LYFT *RIDE 12/04",               "Lyft",                   -1890, CC,  TRP),
        # Dining
        t("2024-12-05", "STARBUCKS #09421",               "Starbucks",               -925, CC,  DIN),
        # Shopping
        t("2024-12-07", "TARGET #1832",                   "Target",                 -9855, CC,  SHP),
        # Uncategorized — gym
        t("2024-12-08", "PEAK FITNESS 0042",              "Peak Fitness",           -2499, CHK),
        # Subscriptions
        t("2024-12-09", "NETFLIX.COM",                    "Netflix",                -1599, CC,  SUB),
        # Healthcare
        t("2024-12-10", "CVS PHARMACY #4821",             "CVS",                    -2815, CC,  HLT),
        # Shopping — holiday gifts
        t("2024-12-11", "AMAZON.COM AMZN.COM",            "Amazon",                -24578, CC,  SHP, note="Holiday gifts"),
        # Dining
        t("2024-12-12", "DOORDASH*DELIVERY",              "DoorDash",               -4730, CC,  DIN),
        # Income
        t("2024-12-13", "MERIDIAN TECH PAYROLL DIR DEP",  "Meridian Tech",         418750, CHK, INC, "credit"),
        # Uncategorized — gas station
        t("2024-12-14", "COASTAL FUEL #3847",             "Coastal Fuel",           -6825, CHK),
        # Subscriptions
        t("2024-12-15", "SPOTIFY USA",                    "Spotify",                -1099, CC,  SUB),
        # Dining
        t("2024-12-16", "UBER EATS",                      "Uber Eats",              -3580, CC,  DIN),
        # Groceries — holiday grocery haul
        t("2024-12-17", "WHOLE FOODS MKT #0423",          "Whole Foods",           -14392, CC,  GRC, note="Holiday groceries"),
        # Utilities — higher winter bill
        t("2024-12-18", "HARBOR ELECTRIC UTILITY",        "Harbor Electric",       -12735, CHK, UTL),
        # Healthcare
        t("2024-12-19", "WALGREENS #4821",                "Walgreens",              -3150, CC,  HLT),
        # Shopping — more holiday gifts
        t("2024-12-20", "AMAZON.COM AMZN.COM",            "Amazon",                -17830, CC,  SHP, note="Holiday gifts"),
        # Dining
        t("2024-12-21", "STARBUCKS #09421",               "Starbucks",               -890, CC,  DIN),
        # Subscriptions
        t("2024-12-22", "AMAZON PRIME MEMBERSHIP",        "Amazon Prime",           -1499, CC,  SUB),
        # Utilities
        t("2024-12-23", "BROADWAVE INTERNET",             "Broadwave Internet",     -8999, CHK, UTL),
        # Dining
        t("2024-12-24", "CHIPOTLE ONLINE #441",           "Chipotle",               -1945, CC,  DIN),
        # Uncategorized — farmers market
        t("2024-12-26", "EASTSIDE FARMERS MARKET",        "Eastside Farmers Market",-3500, CHK),
        # Income
        t("2024-12-27", "MERIDIAN TECH PAYROLL DIR DEP",  "Meridian Tech",         418750, CHK, INC, "credit"),
        # Entertainment
        t("2024-12-28", "AMC THEATRES #0321",             "AMC Theatre",            -3150, CC,  ENT),
        # Groceries
        t("2024-12-29", "TRADER JOE'S #145",              "Trader Joe's",            -7255, CC,  GRC),
        # Utilities
        t("2024-12-30", "NOVA WIRELESS",                  "Nova Wireless",           -7200, CHK, UTL),
        # Transfer to savings
        t("2024-12-31", "ONLINE BANKING TRANSFER SAVINGS","Savings Transfer",      -50000, CHK, None, "transfer", "Monthly savings deposit"),
    ]

    db.add_all(txns)
    db.commit()
