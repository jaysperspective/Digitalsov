"""Reports router — monthly summary, category breakdown, and audit flags."""

import csv as _csv
import io
import re
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..database import get_db, get_db_download
from ..models import Transaction
from ..services.reporter import (
    get_audit_flags,
    get_candlestick_data,
    get_category_breakdown,
    get_monthly_summary,
    get_net_worth_by_account,
    get_period_summary,
    get_recurring_transactions,
)

router = APIRouter(prefix="/reports", tags=["reports"])

# ── Tracked payee pattern groups ─────────────────────────────────────────────

_TRACKED_GROUPS: list[dict] = [
    # ── Income ────────────────────────────────────────────────────────────────
    {
        "key": "income",
        "label": "Fox TV Income",
        "icon": "📺",
        "color": "#22c55e",
        "bg": "rgba(34,197,94,0.08)",
        "border": "rgba(34,197,94,0.25)",
        "patterns": ["fox tv", "fox tv stations"],
        "positive": True,
        "amount_sign": "positive",
    },
    {
        "key": "zelle_income",
        "label": "Zelle Income",
        "icon": "💸",
        "color": "#4ade80",
        "bg": "rgba(74,222,128,0.08)",
        "border": "rgba(74,222,128,0.25)",
        "patterns": ["zelle payment from", "zelle"],
        "positive": True,
        "amount_sign": "positive",
    },
    {
        "key": "paypal_income",
        "label": "PayPal Transfers In",
        "icon": "🅿️",
        "color": "#60a5fa",
        "bg": "rgba(96,165,250,0.08)",
        "border": "rgba(96,165,250,0.25)",
        "patterns": ["paypal"],
        "positive": True,
        "amount_sign": "positive",
    },
    # ── Expenses ──────────────────────────────────────────────────────────────
    {
        "key": "housing",
        "label": "Housing",
        "icon": "🏠",
        "color": "#f87171",
        "bg": "rgba(248,113,113,0.08)",
        "border": "rgba(248,113,113,0.25)",
        "patterns": ["newrez", "shellpoin", "saxony square", "clickpay"],
        "positive": False,
        "amount_sign": "negative",
    },
    {
        "key": "apple_card",
        "label": "Apple Card",
        "icon": "🍎",
        "color": "#a855f7",
        "bg": "rgba(168,85,247,0.08)",
        "border": "rgba(168,85,247,0.25)",
        "patterns": ["applecard gsbank", "apple card gsbank"],
        "positive": False,
        "amount_sign": "negative",
    },
    {
        "key": "robinhood",
        "label": "Robinhood",
        "icon": "📈",
        "color": "#22d3ee",
        "bg": "rgba(34,211,238,0.08)",
        "border": "rgba(34,211,238,0.25)",
        "patterns": ["robinhood"],
        "positive": False,
        "amount_sign": "negative",
    },
    {
        "key": "northwestern",
        "label": "Northwestern Mutual",
        "icon": "🛡️",
        "color": "#f59e0b",
        "bg": "rgba(245,158,11,0.08)",
        "border": "rgba(245,158,11,0.25)",
        "patterns": ["northwestern mu"],
        "positive": False,
        "amount_sign": "negative",
    },
    {
        "key": "telecom",
        "label": "AT&T + Verizon",
        "icon": "📱",
        "color": "#6366f1",
        "bg": "rgba(99,102,241,0.08)",
        "border": "rgba(99,102,241,0.25)",
        "patterns": ["verizon wireless", "vz wireless", "att* bill", "at&t bill"],
        "positive": False,
        "amount_sign": "negative",
    },
    {
        "key": "apple_cash_sent",
        "label": "Apple Cash Sent",
        "icon": "👤",
        "color": "#94a3b8",
        "bg": "rgba(148,163,184,0.08)",
        "border": "rgba(148,163,184,0.25)",
        "patterns": ["apple cash sent"],
        "positive": False,
        "amount_sign": "negative",
    },
]


def _tx_to_dict(t: Transaction) -> dict:
    return {
        "id": t.id,
        "posted_date": t.posted_date,
        "description_raw": t.description_raw,
        "description_norm": t.description_norm,
        "amount": t.amount_cents / 100,
        "currency": t.currency,
        "merchant": t.merchant,
        "category_id": t.category_id,
        "category_name": t.category.name if t.category else None,
    }


@router.get("/income-housing", summary="Tracked payee groups: income, housing, and fixed expenses")
def income_housing(
    year: Optional[str] = Query(None, description="4-digit year to filter (e.g. '2025'). Omit for all time."),
    db: Session = Depends(get_db),
):
    if year and not re.match(r"^\d{4}$", year):
        raise HTTPException(status_code=422, detail="year must be a 4-digit year, e.g. '2025'")

    def _build_query(patterns: list[str], amount_sign: str = "any"):
        filters = or_(
            *[
                or_(
                    Transaction.description_raw.ilike(f"%{p}%"),
                    Transaction.description_norm.ilike(f"%{p}%"),
                    Transaction.merchant.ilike(f"%{p}%"),
                )
                for p in patterns
            ]
        )
        q = (
            db.query(Transaction)
            .options(joinedload(Transaction.category))
            .filter(Transaction.transaction_type != "transfer")
            .filter(filters)
        )
        if amount_sign == "positive":
            q = q.filter(Transaction.amount_cents > 0)
        elif amount_sign == "negative":
            q = q.filter(Transaction.amount_cents < 0)
        if year:
            q = q.filter(Transaction.posted_date >= f"{year}-01-01")
            q = q.filter(Transaction.posted_date <= f"{year}-12-31")
        return q.order_by(Transaction.posted_date.desc()).all()

    groups = []
    for g in _TRACKED_GROUPS:
        txs = _build_query(g["patterns"], g.get("amount_sign", "any"))
        groups.append({
            "key": g["key"],
            "label": g["label"],
            "icon": g["icon"],
            "color": g["color"],
            "bg": g["bg"],
            "border": g["border"],
            "positive": g["positive"],
            "amount_sign": g.get("amount_sign", "any"),
            "total": sum(t.amount_cents for t in txs) / 100,
            "count": len(txs),
            "transactions": [_tx_to_dict(t) for t in txs],
        })

    # Sum ALL positive groups for income, ALL negative groups for expenses
    total_in = sum(g["total"] for g in groups if g["positive"])
    total_out = sum(g["total"] for g in groups if not g["positive"])

    return {
        "year": year,
        "summary": {
            "total_income": total_in,
            "total_tracked_expenses": abs(total_out),
            "net": total_in + total_out,
        },
        "groups": groups,
    }


_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")


def _require_month(value: str, param: str) -> None:
    if not _MONTH_RE.match(value):
        raise HTTPException(status_code=422, detail=f"{param} must be YYYY-MM, got {value!r}")


def _require_date(value: str, param: str) -> None:
    if not _DATE_RE.match(value):
        raise HTTPException(
            status_code=422, detail=f"{param} must be YYYY-MM or YYYY-MM-DD, got {value!r}"
        )


@router.get(
    "/monthly-summary",
    summary="Income/expense breakdown for a single month",
)
def monthly_summary(
    month: str = Query(..., description="Month in YYYY-MM format"),
    db: Session = Depends(get_db),
):
    _require_month(month, "month")
    return get_monthly_summary(db, month)


@router.get(
    "/category-breakdown",
    summary="Per-category totals with month-over-month sub-totals",
)
def category_breakdown(
    from_month: str = Query(..., alias="from", description="Start month YYYY-MM"),
    to_month: str = Query(..., alias="to", description="End month YYYY-MM"),
    db: Session = Depends(get_db),
):
    _require_month(from_month, "from")
    _require_month(to_month, "to")
    if from_month > to_month:
        raise HTTPException(status_code=422, detail="'from' must be ≤ 'to'")
    return get_category_breakdown(db, from_month, to_month)


@router.get(
    "/audit-flags",
    summary="Detect duplicate-like, bank fees, unusually large, and new-merchant transactions",
)
def audit_flags(
    from_date: Optional[str] = Query(None, alias="from", description="Start date YYYY-MM or YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, alias="to", description="End date YYYY-MM or YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    if from_date:
        _require_date(from_date, "from")
    if to_date:
        _require_date(to_date, "to")
    return get_audit_flags(db, from_date, to_date)


@router.get(
    "/summary",
    summary="Income/expense summary for any date range (excludes Transfer transactions)",
)
def period_summary(
    from_date: str = Query(..., alias="from", description="Start date YYYY-MM or YYYY-MM-DD"),
    to_date: str = Query(..., alias="to", description="End date YYYY-MM or YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    _require_date(from_date, "from")
    _require_date(to_date, "to")
    return get_period_summary(db, from_date, to_date)


@router.get(
    "/candlestick",
    summary="OHLC candle data tracking cumulative net balance",
)
def candlestick(
    from_date: str = Query(..., alias="from", description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., alias="to", description="End date YYYY-MM-DD"),
    period: str = Query("day", description="day | month"),
    db: Session = Depends(get_db),
):
    _require_date(from_date, "from")
    _require_date(to_date, "to")
    if period not in ("day", "month"):
        raise HTTPException(status_code=422, detail="period must be 'day' or 'month'")
    return get_candlestick_data(db, from_date, to_date, period)


@router.get("/recurring", summary="Detect recurring transactions by merchant pattern")
def recurring_transactions(db: Session = Depends(get_db)):
    return get_recurring_transactions(db)


@router.get("/net-worth", summary="Monthly net flow grouped by account/import")
def net_worth(db: Session = Depends(get_db)):
    return get_net_worth_by_account(db)


# ── Tax-year CSV export ───────────────────────────────────────────────────────


@router.get(
    "/tax-export",
    summary="Download a CSV of all transactions for a year, grouped by category",
)
def tax_export(
    year: str = Query(..., description="4-digit year, e.g. '2025'"),
    db: Session = Depends(get_db_download),
):
    if not re.match(r"^\d{4}$", year):
        raise HTTPException(status_code=422, detail="year must be a 4-digit year, e.g. '2025'")

    txs = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.posted_date >= f"{year}-01-01")
        .filter(Transaction.posted_date <= f"{year}-12-31")
        .order_by(Transaction.posted_date)
        .all()
    )

    # ── Build category-grouped summary ────────────────────────────────────────
    by_category: dict[str, list] = defaultdict(list)
    for t in txs:
        cat = t.category.name if t.category else "Uncategorized"
        by_category[cat].append(t)

    output = io.StringIO()
    writer = _csv.writer(output)

    # Section 1: Summary by category
    writer.writerow(["=== CATEGORY SUMMARY ==="])
    writer.writerow(["Category", "Transaction Count", "Total (USD)"])
    cat_totals = []
    for cat, rows in sorted(by_category.items(), key=lambda x: sum(r.amount_cents for r in x[1])):
        total = sum(r.amount_cents for r in rows) / 100
        cat_totals.append((cat, len(rows), total))
        writer.writerow([cat, len(rows), f"{total:.2f}"])

    income_total = sum(t for _, _, t in cat_totals if t > 0)
    expense_total = sum(t for _, _, t in cat_totals if t < 0)
    writer.writerow([])
    writer.writerow(["Total Income", "", f"{income_total:.2f}"])
    writer.writerow(["Total Expenses", "", f"{expense_total:.2f}"])
    writer.writerow(["Net", "", f"{income_total + expense_total:.2f}"])
    writer.writerow([])

    # Section 2: All transactions
    writer.writerow(["=== ALL TRANSACTIONS ==="])
    writer.writerow(["Date", "Description", "Merchant", "Amount (USD)", "Category", "Account"])
    for t in txs:
        from ..models import Import  # local to avoid circular at module load
        imp = db.query(Import).filter(Import.id == t.import_id).first()
        account = imp.account_label if imp and imp.account_label else (imp.filename if imp else "")
        cat = t.category.name if t.category else "Uncategorized"
        writer.writerow([
            t.posted_date,
            t.description_raw,
            t.merchant or "",
            f"{t.amount_cents / 100:.2f}",
            cat,
            account,
        ])

    output.seek(0)
    filename = f"transactions_{year}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
