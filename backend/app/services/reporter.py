"""Reporting service: monthly summaries, category breakdowns, and audit flags."""

import calendar
import re
import statistics
from collections import defaultdict
from datetime import date as _date, timedelta as _timedelta
from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from ..models import Category, Import, Rule, Transaction

def _cents_to_dollars(cents: int) -> float:
    return round(cents / 100, 2)


_EXCLUDED_TYPES = {"transfer", "payment"}


def _is_excluded(t: Transaction) -> bool:
    return (t.transaction_type or "normal") in _EXCLUDED_TYPES


# ── Constants ─────────────────────────────────────────────────────────────────

# Category spike detection
_SPIKE_MIN_DOLLARS = 100      # flag if absolute delta >= $100
_SPIKE_MIN_PCT = 0.40         # flag if percent delta >= 40%

# Merchant anomaly detection
_ANOMALY_MULTIPLIER = 2.5     # flag if > 2.5x merchant/category median
_ANOMALY_MIN_SAMPLES = 3      # minimum history sample size

BANK_FEE_KEYWORDS = [
    "fee",
    "overdraft",
    "nsf",
    "maintenance",
    "penalty",
    "interest",
    "service charge",
    "annual fee",
    "monthly fee",
    "atm fee",
    "wire fee",
    "foreign transaction",
    "returned item",
    "insufficient funds",
    "late payment",
    "finance charge",
]

# Flag if |amount| > this multiple of the category (or global) median
_LARGE_TX_MULTIPLIER = 3.0
# Minimum number of same-category transactions required to use category median
_MIN_CATEGORY_SAMPLE = 3


# ── Date helpers ──────────────────────────────────────────────────────────────


def _expand_from(s: str) -> str:
    """YYYY-MM → YYYY-MM-01; YYYY-MM-DD passes through."""
    return f"{s}-01" if len(s) == 7 else s


def _expand_to(s: str) -> str:
    """YYYY-MM → YYYY-MM-{last_day}; YYYY-MM-DD passes through."""
    if len(s) != 7:
        return s
    y, m = int(s[:4]), int(s[5:7])
    return f"{s}-{calendar.monthrange(y, m)[1]:02d}"


def _month_of(date_str: str) -> str:
    """YYYY-MM-DD → YYYY-MM."""
    return date_str[:7]


# ── Shared ─────────────────────────────────────────────────────────────────────


def _load_all(db: Session) -> list[Transaction]:
    """Load every transaction with its category eagerly (avoids N+1)."""
    return db.query(Transaction).options(joinedload(Transaction.category)).all()


def _tx_dict(t: Transaction) -> dict:
    cat = t.category
    return {
        "id": t.id,
        "import_id": t.import_id,
        "posted_date": t.posted_date,
        "description_raw": t.description_raw,
        "amount": _cents_to_dollars(t.amount_cents),
        "currency": t.currency,
        "merchant": t.merchant,
        "category_id": t.category_id,
        "category_name": cat.name if cat else None,
        "category_color": cat.color if cat else None,
        "category_icon": cat.icon if cat else None,
    }


# ── Monthly summary ───────────────────────────────────────────────────────────


def get_monthly_summary(db: Session, month: str) -> dict:
    """Return income/expense stats, per-category totals, and per-day totals for one month."""
    from_date = _expand_from(month)
    to_date = _expand_to(month)

    txns = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.posted_date >= from_date, Transaction.posted_date <= to_date)
        .all()
    )
    txns = [t for t in txns if not _is_excluded(t)]

    income_cents = sum(t.amount_cents for t in txns if t.amount_cents > 0)
    expenses_cents = sum(t.amount_cents for t in txns if t.amount_cents < 0)

    # ── By category ──────────────────────────────────────────────────────────
    cat_map: dict = {}
    for t in txns:
        cid = t.category_id
        if cid not in cat_map:
            cat = t.category
            cat_map[cid] = {
                "category_id": cid,
                "category_name": cat.name if cat else None,
                "category_color": cat.color if cat else "#94a3b8",
                "category_icon": cat.icon if cat else "📌",
                "_total_cents": 0,
                "count": 0,
            }
        cat_map[cid]["_total_cents"] += t.amount_cents
        cat_map[cid]["count"] += 1

    # Most-negative (biggest expense category) first
    by_category = sorted(
        [
            {
                "category_id": v["category_id"],
                "category_name": v["category_name"],
                "category_color": v["category_color"],
                "category_icon": v["category_icon"],
                "total": _cents_to_dollars(v["_total_cents"]),
                "count": v["count"],
            }
            for v in cat_map.values()
        ],
        key=lambda x: x["total"],
    )

    # ── By day ───────────────────────────────────────────────────────────────
    day_map: dict[str, dict] = {}
    for t in txns:
        d = t.posted_date
        if d not in day_map:
            day_map[d] = {"date": d, "_expense_cents": 0, "_income_cents": 0}
        if t.amount_cents < 0:
            day_map[d]["_expense_cents"] += abs(t.amount_cents)
        else:
            day_map[d]["_income_cents"] += t.amount_cents

    by_day = [
        {
            "date": v["date"],
            "expenses": _cents_to_dollars(v["_expense_cents"]),
            "income": _cents_to_dollars(v["_income_cents"]),
        }
        for v in (day_map[d] for d in sorted(day_map))
    ]

    return {
        "month": month,
        "total_income": _cents_to_dollars(income_cents),
        "total_expenses": _cents_to_dollars(expenses_cents),
        "net": _cents_to_dollars(income_cents + expenses_cents),
        "transaction_count": len(txns),
        "by_category": by_category,
        "by_day": by_day,
    }


# ── Category breakdown ────────────────────────────────────────────────────────


def get_category_breakdown(db: Session, from_month: str, to_month: str) -> dict:
    """Return per-category totals and per-month subtotals for a date range."""
    from_date = _expand_from(from_month)
    to_date = _expand_to(to_month)

    txns = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.posted_date >= from_date, Transaction.posted_date <= to_date)
        .all()
    )
    txns = [t for t in txns if not _is_excluded(t)]

    all_months: set[str] = set()
    cat_data: dict = {}

    for t in txns:
        mo = _month_of(t.posted_date)
        all_months.add(mo)
        cid = t.category_id
        if cid not in cat_data:
            cat = t.category
            cat_data[cid] = {
                "category_id": cid,
                "category_name": cat.name if cat else None,
                "category_color": cat.color if cat else "#94a3b8",
                "category_icon": cat.icon if cat else "📌",
                "_total_cents": 0,
                "count": 0,
                "_months": defaultdict(int),
            }
        cat_data[cid]["_total_cents"] += t.amount_cents
        cat_data[cid]["count"] += 1
        cat_data[cid]["_months"][mo] += t.amount_cents

    sorted_months = sorted(all_months)

    categories = []
    for data in cat_data.values():
        months_list = [
            {"month": m, "total": _cents_to_dollars(data["_months"].get(m, 0))}
            for m in sorted_months
        ]
        categories.append({
            "category_id": data["category_id"],
            "category_name": data["category_name"],
            "category_color": data["category_color"],
            "category_icon": data["category_icon"],
            "total": _cents_to_dollars(data["_total_cents"]),
            "count": data["count"],
            "months": months_list,
        })

    categories.sort(key=lambda x: x["total"])

    return {
        "from": from_month,
        "to": to_month,
        "months": sorted_months,
        "categories": categories,
    }


# ── Audit flags ───────────────────────────────────────────────────────────────


def _detect_category_spikes(
    period_txns: list,
    all_txns: list,
    from_str: Optional[str],
    to_str: Optional[str],
) -> list[dict]:
    """Flag categories that spiked vs prior period of the same length."""
    if not from_str or not to_str:
        return []

    try:
        from_date = _date.fromisoformat(from_str)
        to_date = _date.fromisoformat(to_str)
    except ValueError:
        return []

    period_len = (to_date - from_date).days + 1
    prior_to = from_date - _timedelta(days=1)
    prior_from = prior_to - _timedelta(days=period_len - 1)
    prior_from_str = prior_from.isoformat()
    prior_to_str = prior_to.isoformat()

    # Accumulate expense totals per category for current and prior periods
    current_cat: dict[Optional[int], int] = defaultdict(int)
    prior_cat: dict[Optional[int], int] = defaultdict(int)

    for t in period_txns:
        if t.amount_cents < 0 and not _is_excluded(t):
            current_cat[t.category_id] += abs(t.amount_cents)

    for t in all_txns:
        if (
            t.amount_cents < 0
            and not _is_excluded(t)
            and t.posted_date >= prior_from_str
            and t.posted_date <= prior_to_str
        ):
            prior_cat[t.category_id] += abs(t.amount_cents)

    flags: list[dict] = []

    for cat_id, current_cents in current_cat.items():
        prior_cents = prior_cat.get(cat_id, 0)
        if prior_cents == 0:
            continue  # no prior history to compare

        delta_cents = current_cents - prior_cents
        delta_dollars = delta_cents / 100
        delta_pct = delta_cents / prior_cents

        if delta_dollars < _SPIKE_MIN_DOLLARS and delta_pct < _SPIKE_MIN_PCT:
            continue

        # Find representative transaction (largest expense in category this period)
        cat_txns = [
            t for t in period_txns
            if t.category_id == cat_id and t.amount_cents < 0 and not _is_excluded(t)
        ]
        if not cat_txns:
            continue
        rep_tx = max(cat_txns, key=lambda t: abs(t.amount_cents))

        # Top 3 merchants driving the delta
        merch_totals: dict[str, int] = defaultdict(int)
        for t in cat_txns:
            key = (t.merchant_canonical or t.merchant or "Unknown").strip()
            merch_totals[key] += abs(t.amount_cents)
        top_merchants = sorted(merch_totals.items(), key=lambda x: x[1], reverse=True)[:3]

        cat = rep_tx.category
        flags.append({
            "flag_type": "category-spike",
            "severity": "warning",
            "explanation": (
                f"Category '{cat.name if cat else 'Unknown'}' spending "
                f"${current_cents / 100:.0f} vs ${prior_cents / 100:.0f} prior period "
                f"(+{delta_pct * 100:.0f}%)"
            ),
            "transaction": _tx_dict(rep_tx),
            "extra": {
                "category_id": cat_id,
                "category_name": cat.name if cat else None,
                "period_total": current_cents / 100,
                "prior_total": prior_cents / 100,
                "delta_pct": round(delta_pct, 4),
                "top_merchants": [{"merchant": m, "total": c / 100} for m, c in top_merchants],
            },
        })

    return flags


def _detect_merchant_anomalies(
    period_txns: list,
    all_txns: list,
    from_str: Optional[str],
) -> list[dict]:
    """Flag expense transactions that are anomalously large vs merchant/category history."""
    if not from_str:
        return []

    # Build merchant and category baselines from history BEFORE the period
    merch_hist: dict[str, list[int]] = defaultdict(list)
    cat_hist: dict[Optional[int], list[int]] = defaultdict(list)

    for t in all_txns:
        if t.amount_cents >= 0 or _is_excluded(t):
            continue
        if t.posted_date >= from_str:
            continue
        merch_key = (t.merchant_canonical or t.merchant or "").lower().strip()
        if merch_key:
            merch_hist[merch_key].append(abs(t.amount_cents))
        cat_hist[t.category_id].append(abs(t.amount_cents))

    flags: list[dict] = []

    for t in period_txns:
        if t.amount_cents >= 0 or _is_excluded(t):
            continue

        amt_cents = abs(t.amount_cents)
        merch_key = (t.merchant_canonical or t.merchant or "").lower().strip()

        baseline: Optional[float] = None
        sample_count = 0
        source = "merchant"

        # Try merchant history first
        hist = merch_hist.get(merch_key, [])
        if len(hist) >= _ANOMALY_MIN_SAMPLES:
            baseline = statistics.median(hist)
            sample_count = len(hist)
            source = "merchant"
        else:
            # Fallback to category history
            cat_hist_list = cat_hist.get(t.category_id, [])
            if len(cat_hist_list) >= _ANOMALY_MIN_SAMPLES:
                baseline = statistics.median(cat_hist_list)
                sample_count = len(cat_hist_list)
                source = "category"

        if baseline is None or baseline == 0:
            continue

        ratio = amt_cents / baseline
        if ratio <= _ANOMALY_MULTIPLIER:
            continue

        flags.append({
            "flag_type": "merchant-anomaly",
            "severity": "warning",
            "explanation": (
                f"${amt_cents / 100:.2f} is {ratio:.1f}× the {source} median "
                f"(${baseline / 100:.2f}, n={sample_count})"
            ),
            "transaction": _tx_dict(t),
            "extra": {
                "baseline_median": round(baseline / 100, 2),
                "sample_count": sample_count,
                "ratio": round(ratio, 2),
                "source": source,
            },
        })

    return flags


def get_audit_flags(
    db: Session,
    from_date: Optional[str],
    to_date: Optional[str],
) -> list[dict]:
    """Detect four classes of anomalous transactions in the requested period."""
    from_str = _expand_from(from_date) if from_date else None
    to_str = _expand_to(to_date) if to_date else None

    # One eager query for everything — avoids N+1 on .category accesses
    all_txns = _load_all(db)

    # Filter to the requested window in Python (avoids a second round-trip)
    period_txns = [
        t for t in all_txns
        if (not from_str or t.posted_date >= from_str)
        and (not to_str or t.posted_date <= to_str)
    ]

    flags: list[dict] = []

    # ── 1. Duplicate-like ────────────────────────────────────────────────────
    # Same (date, amount_cents, merchant) in the period but different fingerprint/id
    dupe_groups: dict[tuple, list] = defaultdict(list)
    for t in period_txns:
        key = (t.posted_date, t.amount_cents, (t.merchant or "").lower().strip())
        dupe_groups[key].append(t)

    for key, group in dupe_groups.items():
        if len(group) < 2:
            continue
        peer_ids = [t.id for t in group]
        for t in group:
            others = ", ".join(str(i) for i in peer_ids if i != t.id)
            flags.append({
                "flag_type": "duplicate-like",
                "severity": "warning",
                "explanation": (
                    f"Same date ({key[0]}), amount (${abs(key[1]) / 100:.2f}), and merchant "
                    f"as {len(group) - 1} other transaction(s) [IDs: {others}]"
                ),
                "transaction": _tx_dict(t),
            })

    # ── 2. Bank fees ─────────────────────────────────────────────────────────
    for t in period_txns:
        desc = (t.description_norm or "").lower()
        matched = next((kw for kw in BANK_FEE_KEYWORDS if kw in desc), None)
        if matched:
            flags.append({
                "flag_type": "bank-fee",
                "severity": "info",
                "explanation": f'Description contains bank-fee keyword "{matched}"',
                "transaction": _tx_dict(t),
            })

    # ── 3. Unusually large ───────────────────────────────────────────────────
    # Build per-category expense distributions from ALL transactions (in cents)
    cat_amounts: dict[Optional[int], list[int]] = defaultdict(list)
    for t in all_txns:
        if t.amount_cents < 0:
            cat_amounts[t.category_id].append(abs(t.amount_cents))

    global_expenses = [abs(t.amount_cents) for t in all_txns if t.amount_cents < 0]
    global_median = statistics.median(global_expenses) if len(global_expenses) >= _MIN_CATEGORY_SAMPLE else None

    for t in period_txns:
        if t.amount_cents >= 0:
            continue
        amt_cents = abs(t.amount_cents)
        cat_list = cat_amounts.get(t.category_id, [])
        if len(cat_list) >= _MIN_CATEGORY_SAMPLE:
            median = statistics.median(cat_list)
            source = "category"
        elif global_median is not None:
            median = global_median
            source = "overall"
        else:
            continue  # insufficient data to compute a baseline

        if amt_cents > _LARGE_TX_MULTIPLIER * median:
            flags.append({
                "flag_type": "unusually-large",
                "severity": "warning",
                "explanation": (
                    f"${amt_cents / 100:.2f} is {amt_cents / median:.1f}× the {source} median "
                    f"(${median / 100:.2f})"
                ),
                "transaction": _tx_dict(t),
            })

    # ── 4. New merchants ─────────────────────────────────────────────────────
    # For each unique merchant in all_txns, find its earliest posted_date.
    # Flag if that first appearance falls within the requested period.
    merchant_first: dict[str, Transaction] = {}
    for t in sorted(all_txns, key=lambda x: x.posted_date):
        if not t.merchant:
            continue
        key = t.merchant.strip().lower()
        if key not in merchant_first:
            merchant_first[key] = t

    for key, first_tx in merchant_first.items():
        if from_str and first_tx.posted_date < from_str:
            continue
        if to_str and first_tx.posted_date > to_str:
            continue
        flags.append({
            "flag_type": "new-merchant",
            "severity": "info",
            "explanation": (
                f'First-ever transaction from "{first_tx.merchant}" '
                f"(first seen {first_tx.posted_date})"
            ),
            "transaction": _tx_dict(first_tx),
        })

    # ── 5. Category spikes ───────────────────────────────────────────────────
    flags.extend(_detect_category_spikes(period_txns, all_txns, from_str, to_str))

    # ── 6. Merchant anomalies ────────────────────────────────────────────────
    flags.extend(_detect_merchant_anomalies(period_txns, all_txns, from_str))

    # Most-recent first, then by flag type for stable ordering
    flags.sort(
        key=lambda f: (f["transaction"]["posted_date"], f["flag_type"]),
        reverse=True,
    )
    return flags


# ── Period summary (any date range, Transfer-excluded) ────────────────────────


def get_period_summary(db: Session, from_date: str, to_date: str) -> dict:
    """Return income/expense stats for any date range.

    Transfer-category transactions are excluded from income and expense totals
    so that inter-account moves don't distort the net figure.
    """
    from_str = _expand_from(from_date)
    to_str = _expand_to(to_date)

    transfer_cat = db.query(Category).filter(Category.name == "Transfer").first()
    transfer_cat_id: Optional[int] = transfer_cat.id if transfer_cat else None

    txns = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.posted_date >= from_str, Transaction.posted_date <= to_str)
        .all()
    )

    non_transfer = [t for t in txns if t.category_id != transfer_cat_id and not _is_excluded(t)]

    income_cents = sum(t.amount_cents for t in non_transfer if t.amount_cents > 0)
    expenses_cents = sum(t.amount_cents for t in non_transfer if t.amount_cents < 0)

    cat_map: dict = {}
    for t in non_transfer:
        cid = t.category_id
        if cid not in cat_map:
            cat = t.category
            cat_map[cid] = {
                "category_id": cid,
                "category_name": cat.name if cat else None,
                "category_color": cat.color if cat else "#94a3b8",
                "category_icon": cat.icon if cat else "📌",
                "_total_cents": 0,
                "count": 0,
            }
        cat_map[cid]["_total_cents"] += t.amount_cents
        cat_map[cid]["count"] += 1

    by_category = sorted(
        [
            {
                "category_id": v["category_id"],
                "category_name": v["category_name"],
                "category_color": v["category_color"],
                "category_icon": v["category_icon"],
                "total": _cents_to_dollars(v["_total_cents"]),
                "count": v["count"],
            }
            for v in cat_map.values()
        ],
        key=lambda x: x["total"],
    )

    day_map: dict[str, dict] = {}
    for t in txns:
        d = t.posted_date
        if d not in day_map:
            day_map[d] = {"date": d, "_expense_cents": 0, "_income_cents": 0}
        if t.amount_cents < 0:
            day_map[d]["_expense_cents"] += abs(t.amount_cents)
        else:
            day_map[d]["_income_cents"] += t.amount_cents

    by_day = [
        {
            "date": v["date"],
            "expenses": _cents_to_dollars(v["_expense_cents"]),
            "income": _cents_to_dollars(v["_income_cents"]),
        }
        for v in (day_map[d] for d in sorted(day_map))
    ]

    return {
        "from": from_str,
        "to": to_str,
        "total_income": _cents_to_dollars(income_cents),
        "total_expenses": _cents_to_dollars(expenses_cents),
        "net": _cents_to_dollars(income_cents + expenses_cents),
        "transaction_count": len(txns),
        "by_category": by_category,
        "by_day": by_day,
    }


# ── Recurring transactions ────────────────────────────────────────────────────

_NOISE_RE = re.compile(r"\b(inc|llc|corp|co|ltd|the|of|#\w+|\d{4,})\b", re.IGNORECASE)


def _norm_merchant(name: str) -> str:
    s = name.lower().strip()
    s = _NOISE_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def get_recurring_transactions(db: Session) -> list[dict]:
    """Group transactions by merchant and detect weekly/biweekly/monthly patterns."""
    txns = (
        db.query(Transaction)
        .filter(Transaction.merchant.isnot(None))
        .order_by(Transaction.posted_date)
        .all()
    )

    groups: dict[str, list[Transaction]] = defaultdict(list)
    for t in txns:
        key = _norm_merchant(t.merchant or "")
        if key:
            groups[key].append(t)

    results = []
    for key, txlist in groups.items():
        if len(txlist) < 3:
            continue

        dates = sorted(_date.fromisoformat(t.posted_date) for t in txlist)
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        avg_gap = sum(gaps) / len(gaps)

        if 5 <= avg_gap <= 9:
            pattern = "weekly"
        elif 11 <= avg_gap <= 17:
            pattern = "biweekly"
        elif 23 <= avg_gap <= 36:
            pattern = "monthly"
        else:
            continue

        avg_amount = sum(t.amount_cents for t in txlist) / len(txlist) / 100
        results.append({
            "merchant": txlist[0].merchant,
            "merchant_key": key,
            "pattern": pattern,
            "avg_amount": round(avg_amount, 2),
            "count": len(txlist),
            "last_date": max(t.posted_date for t in txlist),
            "transactions": [
                {
                    "id": t.id,
                    "posted_date": t.posted_date,
                    "description_raw": t.description_raw,
                    "amount": t.amount_cents / 100,
                }
                for t in sorted(txlist, key=lambda x: x.posted_date, reverse=True)
            ],
        })

    results.sort(key=lambda r: r["last_date"], reverse=True)
    return results


# ── Net worth by account ───────────────────────────────────────────────────────


def get_net_worth_by_account(db: Session) -> dict:
    """Return monthly net flow per labeled import/account."""
    imports = db.query(Import).all()
    accounts = []
    for imp in imports:
        label = imp.account_label or imp.filename
        txns = (
            db.query(Transaction)
            .filter(Transaction.import_id == imp.id)
            .all()
        )
        if not txns:
            continue

        monthly: dict[str, int] = defaultdict(int)
        for t in txns:
            mo = t.posted_date[:7]
            monthly[mo] += t.amount_cents

        monthly_totals = [
            {"month": mo, "net": round(cents / 100, 2)}
            for mo, cents in sorted(monthly.items())
        ]
        total_net = round(sum(monthly.values()) / 100, 2)
        accounts.append({
            "label": label,
            "type": imp.account_type,
            "monthly_totals": monthly_totals,
            "total_net": total_net,
        })

    accounts.sort(key=lambda a: a["total_net"], reverse=True)
    return {"accounts": accounts}


# ── Candlestick data ──────────────────────────────────────────────────────────


def _day_keys_in_range(from_date: str, to_date: str) -> list[str]:
    start = _date.fromisoformat(from_date)
    end = _date.fromisoformat(to_date)
    keys: list[str] = []
    cur = start
    while cur <= end:
        keys.append(cur.isoformat())
        cur += _timedelta(days=1)
    return keys


def _month_keys_in_range(from_month: str, to_month: str) -> list[str]:
    y, m = int(from_month[:4]), int(from_month[5:7])
    ey, em = int(to_month[:4]), int(to_month[5:7])
    keys: list[str] = []
    while (y, m) <= (ey, em):
        keys.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return keys


def get_candlestick_data(
    db: Session,
    from_date: str,
    to_date: str,
    period: str = "day",
) -> list[dict]:
    """Return OHLC candles tracking cumulative net balance starting from 0.

    period: "day"   — one candle per calendar day
            "month" — one candle per calendar month

    open  = running balance at start of period
    close = open + income + expenses
    high  = max reachable balance (open + all income received)
    low   = min reachable balance (open + all expenses paid)
    """
    from_str = _expand_from(from_date)
    to_str = _expand_to(to_date)

    txns = (
        db.query(Transaction)
        .filter(Transaction.posted_date >= from_str, Transaction.posted_date <= to_str)
        .order_by(Transaction.posted_date)
        .all()
    )
    txns = [t for t in txns if not _is_excluded(t)]

    def _key(date_str: str) -> str:
        return date_str[:7] if period == "month" else date_str

    groups: dict[str, dict] = {}
    for t in txns:
        k = _key(t.posted_date)
        if k not in groups:
            groups[k] = {"income": 0, "expenses": 0}
        if t.amount_cents >= 0:
            groups[k]["income"] += t.amount_cents
        else:
            groups[k]["expenses"] += t.amount_cents  # negative cents

    if period == "month":
        all_keys = _month_keys_in_range(from_str[:7], to_str[:7])
    else:
        all_keys = _day_keys_in_range(from_str, to_str)

    candles: list[dict] = []
    running = 0  # integer cents

    for k in all_keys:
        g = groups.get(k, {"income": 0, "expenses": 0})
        open_val = running
        income_sum = g["income"]
        expense_sum = g["expenses"]
        close_val = running + income_sum + expense_sum

        high_val = max(open_val, open_val + income_sum, close_val)
        low_val = min(open_val, open_val + expense_sum, close_val)

        running = close_val

        candles.append({
            "period": k,
            "open": _cents_to_dollars(open_val),
            "high": _cents_to_dollars(high_val),
            "low": _cents_to_dollars(low_val),
            "close": _cents_to_dollars(close_val),
            "volume": _cents_to_dollars(income_sum + abs(expense_sum)),
        })

    return candles


# ── Data Health ────────────────────────────────────────────────────────────────


def get_data_health(db: Session) -> dict:
    """Return data quality metrics and recommendations."""
    from ..services.transfer_detector import find_transfer_candidates

    # 1. Uncategorized transactions
    uncategorized = (
        db.query(func.count())
        .select_from(Transaction)
        .filter(Transaction.category_id.is_(None))
        .scalar()
        or 0
    )

    # 2. Imports missing account label
    missing_label = (
        db.query(func.count())
        .select_from(Import)
        .filter(or_(Import.account_label.is_(None), Import.account_label == ""))
        .scalar()
        or 0
    )

    # 3. Merchants without canonical
    uncanon = (
        db.query(func.count())
        .select_from(Transaction)
        .filter(
            Transaction.merchant.isnot(None),
            Transaction.merchant_canonical.is_(None),
        )
        .scalar()
        or 0
    )

    # 4. Possible duplicate groups (groups with >1 same date+amount+merchant)
    dup_subq = (
        db.query(func.count().label("cnt"))
        .select_from(Transaction)
        .group_by(
            Transaction.posted_date,
            Transaction.amount_cents,
            func.lower(Transaction.merchant),
        )
        .having(func.count() > 1)
        .subquery()
    )
    possible_dups = db.query(func.count()).select_from(dup_subq).scalar() or 0

    # 5. Transfer candidates
    try:
        transfer_candidates_count = len(find_transfer_candidates(db))
    except Exception:
        transfer_candidates_count = 0

    # 6. Active rules
    active_rules = (
        db.query(func.count())
        .select_from(Rule)
        .filter(Rule.is_active.is_(True))
        .scalar()
        or 0
    )

    # 7. Last import date
    last_imp = db.query(Import.created_at).order_by(Import.created_at.desc()).first()
    last_import_date = last_imp[0].isoformat() if last_imp else None

    # 8. Total transactions
    total_txns = db.query(func.count()).select_from(Transaction).scalar() or 0

    # 9. Top problem merchants (most transactions without canonical)
    top_merchants_q = (
        db.query(Transaction.merchant, func.count().label("cnt"))
        .filter(
            Transaction.merchant.isnot(None),
            Transaction.merchant_canonical.is_(None),
        )
        .group_by(Transaction.merchant)
        .order_by(func.count().desc())
        .limit(5)
        .all()
    )
    top_problem_merchants = [{"merchant": r.merchant, "count": r.cnt} for r in top_merchants_q]

    # 10. Recommendations
    recs: list[str] = []
    if uncategorized > 0:
        recs.append(f"Categorize {uncategorized} uncategorized transaction{'s' if uncategorized != 1 else ''}")
    if uncanon > 0:
        recs.append(f"Add merchant aliases for {uncanon} unmapped merchant{'s' if uncanon != 1 else ''}")
    if missing_label > 0:
        recs.append(f"Label {missing_label} import{'s' if missing_label != 1 else ''} with account names")
    if transfer_candidates_count > 0:
        recs.append(f"Review {transfer_candidates_count} transfer candidate{'s' if transfer_candidates_count != 1 else ''}")
    if possible_dups > 0:
        recs.append(f"Check {possible_dups} possible duplicate group{'s' if possible_dups != 1 else ''}")

    return {
        "uncategorized_count": uncategorized,
        "imports_missing_account_label_count": missing_label,
        "merchants_uncanonicalized_count": uncanon,
        "possible_duplicates_count": possible_dups,
        "transfer_candidates_count": transfer_candidates_count,
        "active_rules_count": active_rules,
        "last_import_date": last_import_date,
        "total_transactions": total_txns,
        "top_problem_merchants": top_problem_merchants,
        "recommendations": recs,
    }
