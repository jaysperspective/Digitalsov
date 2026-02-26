"""Merchants router — CRUD for merchant_aliases + canonical rebuild."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import MerchantAlias
from ..schemas import MerchantAliasCreate, MerchantAliasSchema
from ..services.merchant_canonicalizer import rebuild_canonical_all

router = APIRouter(prefix="/merchants", tags=["merchants"])


@router.get("/aliases", response_model=list[MerchantAliasSchema])
def list_aliases(db: Session = Depends(get_db)):
    """List all merchant aliases ordered by canonical name."""
    return db.query(MerchantAlias).order_by(MerchantAlias.canonical, MerchantAlias.alias).all()


@router.post("/aliases", response_model=MerchantAliasSchema, status_code=201)
def create_alias(payload: MerchantAliasCreate, db: Session = Depends(get_db)):
    """Create a new merchant alias."""
    alias_lower = payload.alias.strip().lower()
    if not alias_lower:
        raise HTTPException(status_code=422, detail="alias cannot be empty")
    if not payload.canonical.strip():
        raise HTTPException(status_code=422, detail="canonical cannot be empty")

    existing = db.query(MerchantAlias).filter(
        MerchantAlias.alias == alias_lower
    ).first()
    if existing:
        raise HTTPException(
            status_code=409, detail=f"Alias '{payload.alias}' already exists"
        )

    record = MerchantAlias(alias=alias_lower, canonical=payload.canonical.strip())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.put("/aliases/{alias_id}", response_model=MerchantAliasSchema)
def update_alias(alias_id: int, payload: MerchantAliasCreate, db: Session = Depends(get_db)):
    """Update an existing merchant alias."""
    record = db.get(MerchantAlias, alias_id)
    if not record:
        raise HTTPException(status_code=404, detail="Alias not found")

    alias_lower = payload.alias.strip().lower()
    if not alias_lower:
        raise HTTPException(status_code=422, detail="alias cannot be empty")
    if not payload.canonical.strip():
        raise HTTPException(status_code=422, detail="canonical cannot be empty")

    # Check uniqueness excluding self
    conflict = db.query(MerchantAlias).filter(
        MerchantAlias.alias == alias_lower,
        MerchantAlias.id != alias_id,
    ).first()
    if conflict:
        raise HTTPException(
            status_code=409, detail=f"Alias '{payload.alias}' already exists"
        )

    record.alias = alias_lower
    record.canonical = payload.canonical.strip()
    db.commit()
    db.refresh(record)
    return record


@router.delete("/aliases/{alias_id}", status_code=204)
def delete_alias(alias_id: int, db: Session = Depends(get_db)):
    """Delete a merchant alias."""
    record = db.get(MerchantAlias, alias_id)
    if not record:
        raise HTTPException(status_code=404, detail="Alias not found")
    db.delete(record)
    db.commit()


@router.post("/rebuild-canonical")
def rebuild_canonical(db: Session = Depends(get_db)):
    """Recompute merchant_canonical for all transactions using current alias map."""
    return rebuild_canonical_all(db)
