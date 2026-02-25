import csv as _csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from ..database import get_db, get_db_download
from ..models import Import, Transaction
from ..schemas import PatchTransactionCategory, PatchTransactionNote, TransactionListResponse, TransactionSchema

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _tx_to_schema(tx: Transaction) -> TransactionSchema:
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

    total = query.count()
    items = (
        query.order_by(Transaction.posted_date.desc(), Transaction.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {"total": total, "items": [_tx_to_schema(tx) for tx in items]}


@router.get("/export", summary="Export filtered transactions as CSV")
def export_transactions_csv(
    import_id: Optional[int] = Query(default=None),
    category_id: Optional[int] = Query(default=None),
    uncategorized: bool = Query(default=False),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
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
    tx.category_source = "manual" if body.category_id is not None else None
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
