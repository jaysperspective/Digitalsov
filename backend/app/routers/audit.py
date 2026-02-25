"""Audit endpoints: transfer candidate detection and confirmation."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Transaction
from ..schemas import ConfirmTransferBody, TransferCandidateSchema
from ..services.transfer_detector import find_transfer_candidates

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/transfer-candidates", response_model=list[TransferCandidateSchema])
def transfer_candidates(db: Session = Depends(get_db)):
    """Return scored transfer/payment candidate pairs across all imports."""
    return find_transfer_candidates(db)


@router.post("/confirm-transfer", status_code=204)
def confirm_transfer(body: ConfirmTransferBody, db: Session = Depends(get_db)):
    """Mark two transactions as confirmed transfers (excluded from income/expense reports)."""
    for tx_id in (body.transaction_id_1, body.transaction_id_2):
        tx = db.get(Transaction, tx_id)
        if not tx:
            raise HTTPException(status_code=404, detail=f"Transaction {tx_id} not found")
        tx.transaction_type = "transfer"
    db.commit()
