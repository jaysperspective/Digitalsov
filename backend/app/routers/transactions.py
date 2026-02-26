import csv as _csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload, selectinload

from ..database import get_db, get_db_download
from ..models import Import, Tag, Transaction, transaction_tags
from ..schemas import (
    PatchTransactionCategory,
    PatchTransactionNote,
    TagAssignRequest,
    TagSchema,
    TransactionListResponse,
    TransactionSchema,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _tx_to_schema(tx: Transaction, tags: list | None = None) -> TransactionSchema:
    rule = tx.category_rule
    return TransactionSchema(
        id=tx.id,
        import_id=tx.import_id,
        posted_date=tx.posted_date,
        description_raw=tx.description_raw,
        description_norm=tx.description_norm,
        amount_cents=tx.amount_cents,
        currency=tx.currency,
        merchant=tx.merchant,
        merchant_canonical=tx.merchant_canonical,
        category_id=tx.category_id,
        category_name=tx.category.name if tx.category else None,
        category_color=tx.category.color if tx.category else None,
        category_icon=tx.category.icon if tx.category else None,
        fingerprint_hash=tx.fingerprint_hash,
        transaction_type=tx.transaction_type,
        note=tx.note,
        category_source=tx.category_source,
        category_rule_id=tx.category_rule_id,
        category_rule_pattern=rule.pattern if rule else None,
        category_rule_match_type=rule.match_type if rule else None,
        category_rule_priority=rule.priority if rule else None,
        created_at=tx.created_at,
        tags=tags if tags is not None else [],
    )


def _base_query(db: Session):
    return db.query(Transaction).options(
        joinedload(Transaction.category),
        joinedload(Transaction.category_rule),
    )


@router.get("/", response_model=TransactionListResponse, summary="List transactions")
def list_transactions(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    import_id: Optional[int] = Query(default=None, description="Filter by import ID"),
    category_id: Optional[int] = Query(default=None, description="Filter by category ID"),
    uncategorized: bool = Query(default=False, description="Return only uncategorized rows"),
    from_date: Optional[str] = Query(default=None, description="Filter from date (YYYY-MM-DD)"),
    to_date: Optional[str] = Query(default=None, description="Filter to date (YYYY-MM-DD)"),
    merchant_search: Optional[str] = Query(default=None, description="Filter by merchant name (partial match)"),
    tag_id: Optional[int] = Query(default=None, description="Filter by tag ID (any match)"),
    include_tags: bool = Query(default=False, description="Include tags list per row (adds one DB query)"),
    db: Session = Depends(get_db),
):
    query = _base_query(db)

    if import_id is not None:
        query = query.filter(Transaction.import_id == import_id)
    if uncategorized:
        query = query.filter(Transaction.category_id == None)  # noqa: E711
    elif category_id is not None:
        query = query.filter(Transaction.category_id == category_id)
    if from_date is not None:
        query = query.filter(Transaction.posted_date >= from_date)
    if to_date is not None:
        query = query.filter(Transaction.posted_date <= to_date)
    if merchant_search:
        pat = f"%{merchant_search}%"
        query = query.filter(
            or_(Transaction.merchant_canonical.ilike(pat), Transaction.merchant.ilike(pat))
        )
    if tag_id is not None:
        query = query.filter(
            Transaction.id.in_(
                db.query(transaction_tags.c.transaction_id).filter(
                    transaction_tags.c.tag_id == tag_id
                )
            )
        )

    if include_tags:
        query = query.options(selectinload(Transaction.tags))

    total = query.count()
    items = (
        query.order_by(Transaction.posted_date.desc(), Transaction.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    def _tags_for(tx: Transaction) -> list:
        if not include_tags:
            return []
        return [TagSchema(id=t.id, name=t.name, color=t.color, created_at=t.created_at) for t in tx.tags]

    return {"total": total, "items": [_tx_to_schema(tx, tags=_tags_for(tx)) for tx in items]}


@router.get("/export", summary="Export filtered transactions as CSV")
def export_transactions_csv(
    import_id: Optional[int] = Query(default=None),
    category_id: Optional[int] = Query(default=None),
    uncategorized: bool = Query(default=False),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    merchant_search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db_download),
):
    query = _base_query(db)
    if import_id is not None:
        query = query.filter(Transaction.import_id == import_id)
    if uncategorized:
        query = query.filter(Transaction.category_id == None)  # noqa: E711
    elif category_id is not None:
        query = query.filter(Transaction.category_id == category_id)
    if from_date is not None:
        query = query.filter(Transaction.posted_date >= from_date)
    if to_date is not None:
        query = query.filter(Transaction.posted_date <= to_date)
    if merchant_search:
        pat = f"%{merchant_search}%"
        query = query.filter(
            or_(Transaction.merchant_canonical.ilike(pat), Transaction.merchant.ilike(pat))
        )
    txns = query.order_by(Transaction.posted_date.desc(), Transaction.id.desc()).all()

    output = io.StringIO()
    writer = _csv.writer(output)
    writer.writerow(["Date", "Description", "Merchant", "Amount", "Category", "Account", "Note"])
    for tx in txns:
        imp = db.query(Import).filter(Import.id == tx.import_id).first()
        account = imp.account_label if imp and imp.account_label else (imp.filename if imp else "")
        cat = tx.category.name if tx.category else ""
        writer.writerow([
            tx.posted_date,
            tx.description_raw,
            tx.merchant or "",
            f"{tx.amount_cents / 100:.2f}",
            cat,
            account,
            tx.note or "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="transactions_export.csv"'},
    )


@router.patch("/{tx_id}/category", response_model=TransactionSchema, summary="Manually set category")
def patch_category(tx_id: int, body: PatchTransactionCategory, db: Session = Depends(get_db)):
    """Override a transaction's category. Sets source='manual' and clears the rule reference."""
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    tx.category_id = body.category_id
    tx.category_source = "manual" if body.category_id is not None else "uncategorized"
    tx.category_rule_id = None
    db.commit()
    # Reload with joins for the response
    tx = _base_query(db).filter(Transaction.id == tx_id).first()
    return _tx_to_schema(tx)


@router.patch("/{tx_id}/note", response_model=TransactionSchema, summary="Set or clear a note on a transaction")
def patch_note(tx_id: int, body: PatchTransactionNote, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    tx.note = body.note
    db.commit()
    tx = _base_query(db).filter(Transaction.id == tx_id).first()
    return _tx_to_schema(tx)


@router.delete("/{tx_id}", status_code=204, summary="Permanently delete a transaction")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(tx)
    db.commit()


# ── Tag management on transactions ───────────────────────────────────────────


@router.get("/{tx_id}/tags", response_model=list[TagSchema], summary="List tags for a transaction")
def get_transaction_tags(tx_id: int, db: Session = Depends(get_db)):
    tx = (
        db.query(Transaction)
        .options(selectinload(Transaction.tags))
        .filter(Transaction.id == tx_id)
        .first()
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return [TagSchema(id=t.id, name=t.name, color=t.color, created_at=t.created_at) for t in tx.tags]


@router.put("/{tx_id}/tags", response_model=list[TagSchema], summary="Replace tags on a transaction")
def set_transaction_tags(tx_id: int, body: TagAssignRequest, db: Session = Depends(get_db)):
    tx = (
        db.query(Transaction)
        .options(selectinload(Transaction.tags))
        .filter(Transaction.id == tx_id)
        .first()
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if body.tag_ids:
        tags = db.query(Tag).filter(Tag.id.in_(body.tag_ids)).all()
        if len(tags) != len(set(body.tag_ids)):
            raise HTTPException(status_code=422, detail="One or more tag IDs not found.")
    else:
        tags = []
    tx.tags = tags
    db.commit()
    return [TagSchema(id=t.id, name=t.name, color=t.color, created_at=t.created_at) for t in tx.tags]
