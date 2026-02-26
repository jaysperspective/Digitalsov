"""Period comparison service — compare two date ranges across totals,
categories, merchants, and recurring patterns."""

from collections import defaultdict
from datetime import date as _date
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from ..models import Transaction

# Minimum absolute delta (dollars) to flag a recurring-charge change
_RECURRING_CHANGE_THRESHOLD = 5.0
# A merchant must appear >= this many times in a period to be "recurring"
_RECURRING_MIN_COUNT = 2


def _merchant_display(tx: Transaction) -> str:
    return tx.merchant_canonical or tx.merchant or ""


def _merchant_key(tx: Transaction) -> str:
    return _merchant_display(tx).lower().strip()


def _period_txns(db: Session, from_date: str, to_date: str) -> list[Transaction]:
    """Return non-transfer transactions for the given date range."""
    return (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(
            Transaction.posted_date >= from_date,
            Transaction.posted_date <= to_date,
            Transaction.transaction_type.notin_(["transfer", "payment"]),
        )
        .all()
    )


def _compute_totals(txns: list[Transaction]) -> dict:
    income = sum(t.amount_cents for t in txns if t.amount_cents > 0)
    expense = sum(t.amount_cents for t in txns if t.amount_cents < 0)
    return {
        "income": round(income / 100, 2),
        "expense": round(expense / 100, 2),
        "net": round((income + expense) / 100, 2),
        "tx_count": len(txns),
    }


def _category_groups(txns: list[Transaction]) -> dict[str, dict]:
    groups: dict[str, dict] = {}
    for t in txns:
        key = f"cat:{t.category_id}" if t.category_id is not None else "cat:null"
        if key not in groups:
            groups[key] = {
                "category_id": t.category_id,
                "category_name": (t.category.name if t.category else "Uncategorized"),
                "total_cents": 0,
                "count": 0,
            }
        groups[key]["total_cents"] += t.amount_cents
        groups[key]["count"] += 1
    return groups


def _merchant_groups(txns: list[Transaction]) -> dict[str, dict]:
    groups: dict[str, dict] = {}
    for t in txns:
        key = _merchant_key(t)
        if not key:
            continue
        if key not in groups:
            groups[key] = {"merchant": _merchant_display(t), "total_cents": 0, "count": 0}
        groups[key]["total_cents"] += t.amount_cents
        groups[key]["count"] += 1
    return groups


def _pct_change(a: float, b: float) -> Optional[float]:
    if a == 0:
        return None
    return round((b - a) / abs(a) * 100, 1)


def _detect_cadence(txns: list[Transaction]) -> Optional[str]:
    if len(txns) < 2:
        return None
    dates = sorted(t.posted_date for t in txns)
    gaps = []
    for i in range(1, len(dates)):
        d1 = _date.fromisoformat(dates[i - 1])
        d2 = _date.fromisoformat(dates[i])
        gaps.append((d2 - d1).days)
    avg_gap = sum(gaps) / len(gaps)
    if 6 <= avg_gap <= 8:
        return "weekly"
    if 13 <= avg_gap <= 16:
        return "biweekly"
    if 28 <= avg_gap <= 35:
        return "monthly"
    return None


def get_period_comparison(
    db: Session,
    from_a: str,
    to_a: str,
    from_b: str,
    to_b: str,
    limit_merchants: int = 20,
) -> dict:
    txns_a = _period_txns(db, from_a, to_a)
    txns_b = _period_txns(db, from_b, to_b)

    # ── Totals ────────────────────────────────────────────────────────────────
    tot_a = _compute_totals(txns_a)
    tot_b = _compute_totals(txns_b)
    totals = {
        "incomeA": tot_a["income"],
        "expenseA": tot_a["expense"],
        "netA": tot_a["net"],
        "txCountA": tot_a["tx_count"],
        "incomeB": tot_b["income"],
        "expenseB": tot_b["expense"],
        "netB": tot_b["net"],
        "txCountB": tot_b["tx_count"],
        "incomeDelta": round(tot_b["income"] - tot_a["income"], 2),
        "expenseDelta": round(tot_b["expense"] - tot_a["expense"], 2),
        "netDelta": round(tot_b["net"] - tot_a["net"], 2),
        "txCountDelta": tot_b["tx_count"] - tot_a["tx_count"],
    }

    # ── Category deltas ───────────────────────────────────────────────────────
    cats_a = _category_groups(txns_a)
    cats_b = _category_groups(txns_b)
    all_cat_keys = set(cats_a) | set(cats_b)

    _empty_cat = {"category_id": None, "category_name": "Uncategorized", "total_cents": 0, "count": 0}
    category_deltas = []
    for key in all_cat_keys:
        ga = cats_a.get(key, _empty_cat)
        gb = cats_b.get(key, _empty_cat)
        meta = ga if ga["total_cents"] != 0 else gb
        a_total = round(ga["total_cents"] / 100, 2)
        b_total = round(gb["total_cents"] / 100, 2)
        delta = round(b_total - a_total, 2)
        category_deltas.append({
            "category_id": meta["category_id"],
            "category_name": meta["category_name"],
            "a_total": a_total,
            "b_total": b_total,
            "delta": delta,
            "pct_change": _pct_change(a_total, b_total),
            "a_count": ga["count"],
            "b_count": gb["count"],
        })
    category_deltas.sort(key=lambda x: abs(x["delta"]), reverse=True)

    # ── Merchant deltas ───────────────────────────────────────────────────────
    merch_a = _merchant_groups(txns_a)
    merch_b = _merchant_groups(txns_b)
    all_merch_keys = set(merch_a) | set(merch_b)

    merchant_deltas = []
    for key in all_merch_keys:
        ga = merch_a.get(key, {"merchant": key, "total_cents": 0, "count": 0})
        gb = merch_b.get(key, {"merchant": ga["merchant"], "total_cents": 0, "count": 0})
        display = ga["merchant"] if ga["total_cents"] != 0 else gb["merchant"]
        a_total = round(ga["total_cents"] / 100, 2)
        b_total = round(gb["total_cents"] / 100, 2)
        delta = round(b_total - a_total, 2)
        merchant_deltas.append({
            "merchant": display,
            "a_total": a_total,
            "b_total": b_total,
            "delta": delta,
            "pct_change": _pct_change(a_total, b_total),
            "a_count": ga["count"],
            "b_count": gb["count"],
        })
    merchant_deltas.sort(key=lambda x: abs(x["delta"]), reverse=True)
    merchant_deltas = merchant_deltas[:limit_merchants]

    # ── Recurring changes ─────────────────────────────────────────────────────
    def _recurring_groups(txns: list[Transaction]) -> dict[str, list[Transaction]]:
        g: dict[str, list[Transaction]] = defaultdict(list)
        for t in txns:
            k = _merchant_key(t)
            if k:
                g[k].append(t)
        return {k: v for k, v in g.items() if len(v) >= _RECURRING_MIN_COUNT}

    rec_a = _recurring_groups(txns_a)
    rec_b = _recurring_groups(txns_b)

    new_recurring = []
    stopped_recurring = []
    changed_recurring = []

    for key, b_txns in rec_b.items():
        if key not in rec_a:
            avg = sum(t.amount_cents for t in b_txns) / len(b_txns) / 100
            new_recurring.append({
                "merchant": _merchant_display(b_txns[0]) or key,
                "amount": round(avg, 2),
                "cadence": _detect_cadence(b_txns),
            })

    for key, a_txns in rec_a.items():
        if key not in rec_b:
            avg = sum(t.amount_cents for t in a_txns) / len(a_txns) / 100
            stopped_recurring.append({
                "merchant": _merchant_display(a_txns[0]) or key,
                "amount": round(avg, 2),
                "cadence": _detect_cadence(a_txns),
            })

    for key in rec_a:
        if key in rec_b:
            a_txns = rec_a[key]
            b_txns = rec_b[key]
            avg_a = sum(t.amount_cents for t in a_txns) / len(a_txns) / 100
            avg_b = sum(t.amount_cents for t in b_txns) / len(b_txns) / 100
            delta = avg_b - avg_a
            if abs(delta) >= _RECURRING_CHANGE_THRESHOLD:
                changed_recurring.append({
                    "merchant": _merchant_display(b_txns[0]) or key,
                    "amountA": round(avg_a, 2),
                    "amountB": round(avg_b, 2),
                    "delta": round(delta, 2),
                    "cadence": _detect_cadence(b_txns),
                })

    # ── Notes ─────────────────────────────────────────────────────────────────
    notes: list[str] = []
    if tot_a["tx_count"] == 0:
        notes.append("Period A has no transactions in this profile.")
    if tot_b["tx_count"] == 0:
        notes.append("Period B has no transactions in this profile.")

    return {
        "periodA": {"from": from_a, "to": to_a},
        "periodB": {"from": from_b, "to": to_b},
        "totals": totals,
        "categoryDeltas": category_deltas,
        "merchantDeltas": merchant_deltas,
        "recurringChanges": {
            "new": new_recurring,
            "stopped": stopped_recurring,
            "changed": changed_recurring,
        },
        "notes": notes,
    }
