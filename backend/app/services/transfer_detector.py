"""Heuristic cross-import transfer/payment pair detection."""

import re
from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session, joinedload

from ..models import Transaction

_TRANSFER_KEYWORDS = re.compile(
    r"\b(transfer|zelle|venmo|wire|ach|xfer|trf)\b", re.IGNORECASE
)


def _tx_info(t: Transaction) -> dict:
    imp = t.import_record
    cat = t.category
    return {
        "id": t.id,
        "import_id": t.import_id,
        "posted_date": t.posted_date,
        "description_raw": t.description_raw,
        "amount_cents": t.amount_cents,
        "currency": t.currency,
        "merchant": t.merchant,
        "category_id": t.category_id,
        "category_name": cat.name if cat else None,
        "account_label": imp.account_label if imp else None,
        "account_type": imp.account_type if imp else None,
    }


def _score(pos: Transaction, neg: Transaction, day_diff: int) -> int:
    confidence = 60

    # Date proximity bonus
    if day_diff == 0:
        confidence += 20
    elif day_diff == 1:
        confidence += 10
    else:
        confidence += 3

    # Different account_type bonus
    pos_type = pos.import_record.account_type if pos.import_record else None
    neg_type = neg.import_record.account_type if neg.import_record else None
    if pos_type and neg_type and pos_type != neg_type:
        confidence += 15

    # Transfer keyword in either description
    pos_norm = pos.description_norm or ""
    neg_norm = neg.description_norm or ""
    if _TRANSFER_KEYWORDS.search(pos_norm) or _TRANSFER_KEYWORDS.search(neg_norm):
        confidence += 5

    return min(confidence, 99)


def _reason(pos: Transaction, neg: Transaction, day_diff: int, confidence: int) -> str:
    parts = [f"Opposite-sign pair ±${abs(pos.amount_cents) / 100:.2f}"]
    if day_diff == 0:
        parts.append("same day")
    else:
        parts.append(f"{day_diff} day(s) apart")
    pos_type = pos.import_record.account_type if pos.import_record else None
    neg_type = neg.import_record.account_type if neg.import_record else None
    if pos_type and neg_type and pos_type != neg_type:
        parts.append(f"{pos_type} ↔ {neg_type}")
    pos_norm = pos.description_norm or ""
    neg_norm = neg.description_norm or ""
    if _TRANSFER_KEYWORDS.search(pos_norm) or _TRANSFER_KEYWORDS.search(neg_norm):
        parts.append("transfer keyword matched")
    parts.append(f"{confidence}% confidence")
    return "; ".join(parts)


def find_transfer_candidates(db: Session) -> list[dict]:
    """Find opposite-sign, same-absolute-amount transaction pairs across imports."""
    txns = (
        db.query(Transaction)
        .options(joinedload(Transaction.import_record), joinedload(Transaction.category))
        .filter(Transaction.transaction_type == "normal")
        .all()
    )

    by_abs: dict[int, list[Transaction]] = defaultdict(list)
    for t in txns:
        if t.amount_cents != 0:
            by_abs[abs(t.amount_cents)].append(t)

    pairs: list[dict] = []
    seen: set[frozenset] = set()

    for group in by_abs.values():
        positives = [t for t in group if t.amount_cents > 0]
        negatives = [t for t in group if t.amount_cents < 0]
        for pos in positives:
            for neg in negatives:
                key = frozenset([pos.id, neg.id])
                if key in seen or pos.import_id == neg.import_id:
                    continue
                day_diff = abs(
                    (date.fromisoformat(pos.posted_date) - date.fromisoformat(neg.posted_date)).days
                )
                if day_diff > 2:
                    continue
                confidence = _score(pos, neg, day_diff)
                seen.add(key)
                pairs.append({
                    "tx1": _tx_info(pos),
                    "tx2": _tx_info(neg),
                    "confidence_pct": confidence,
                    "day_diff": day_diff,
                    "reason": _reason(pos, neg, day_diff, confidence),
                })

    pairs.sort(key=lambda p: p["confidence_pct"], reverse=True)
    return pairs
