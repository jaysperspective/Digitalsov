"""Merchant canonicalization service.

Provides alias lookup and bulk rebuild for merchant_canonical field.
"""

from sqlalchemy.orm import Session

from ..models import MerchantAlias, Transaction


def _build_alias_map(db: Session) -> dict[str, str]:
    """Return {alias_lower: canonical} for all aliases in the database."""
    return {a.alias.lower(): a.canonical for a in db.query(MerchantAlias).all()}


def get_canonical(merchant: str, alias_map: dict[str, str]) -> str:
    """Look up canonical name from alias map; fallback to merchant itself."""
    return alias_map.get(merchant.lower().strip(), merchant)


def apply_canonical_to_import(db: Session, import_id: int) -> None:
    """Set merchant_canonical for all transactions in one import batch."""
    alias_map = _build_alias_map(db)
    txns = db.query(Transaction).filter(Transaction.import_id == import_id).all()
    for tx in txns:
        tx.merchant_canonical = get_canonical(tx.merchant, alias_map) if tx.merchant else None
    db.commit()


def rebuild_canonical_all(db: Session) -> dict:
    """Recompute merchant_canonical for every transaction in the database."""
    alias_map = _build_alias_map(db)
    txns = db.query(Transaction).all()
    updated = 0
    for tx in txns:
        new_val = get_canonical(tx.merchant, alias_map) if tx.merchant else None
        if tx.merchant_canonical != new_val:
            tx.merchant_canonical = new_val
            updated += 1
    if updated:
        db.commit()
    return {"updated": updated, "total": len(txns)}
