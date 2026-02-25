from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException

from ..database import get_db
from ..models import Category, Rule, Transaction
from ..schemas import CategoryCreate, CategorySchema, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


def _to_schema(cat: Category, tx_count: int) -> CategorySchema:
    return CategorySchema(
        id=cat.id,
        name=cat.name,
        color=cat.color,
        icon=cat.icon,
        is_default=cat.is_default,
        transaction_count=tx_count,
        monthly_budget=cat.monthly_budget,
        tax_deductible=cat.tax_deductible if cat.tax_deductible is not None else False,
        created_at=cat.created_at,
    )


@router.get("/", response_model=list[CategorySchema], summary="List all categories")
def list_categories(db: Session = Depends(get_db)):
    counts: dict[int, int] = dict(
        db.query(Transaction.category_id, func.count(Transaction.id))
        .filter(Transaction.category_id.isnot(None))
        .group_by(Transaction.category_id)
        .all()
    )
    cats = db.query(Category).order_by(Category.name).all()
    return [_to_schema(c, counts.get(c.id, 0)) for c in cats]


@router.post("/", response_model=CategorySchema, status_code=201, summary="Create a category")
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    if db.query(Category).filter(Category.name == payload.name).first():
        raise HTTPException(status_code=409, detail=f"Category '{payload.name}' already exists.")
    cat = Category(
        name=payload.name,
        color=payload.color,
        icon=payload.icon,
        monthly_budget=payload.monthly_budget,
        tax_deductible=payload.tax_deductible,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return _to_schema(cat, 0)


@router.put("/{cat_id}", response_model=CategorySchema, summary="Update a category")
def update_category(cat_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)):
    cat = _get_or_404(db, cat_id)
    # Check name uniqueness if name changed
    if payload.name != cat.name:
        if db.query(Category).filter(Category.name == payload.name).first():
            raise HTTPException(status_code=409, detail=f"Category '{payload.name}' already exists.")
    cat.name = payload.name
    cat.color = payload.color
    cat.icon = payload.icon
    cat.monthly_budget = payload.monthly_budget
    cat.tax_deductible = payload.tax_deductible
    db.commit()
    db.refresh(cat)
    tx_count = db.query(func.count(Transaction.id)).filter(Transaction.category_id == cat_id).scalar() or 0
    return _to_schema(cat, tx_count)


@router.delete("/{cat_id}", status_code=204, summary="Delete a category")
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    cat = _get_or_404(db, cat_id)
    # Null out transactions that referenced this category (and their provenance)
    db.query(Transaction).filter(Transaction.category_id == cat_id).update(
        {"category_id": None, "category_source": None, "category_rule_id": None},
        synchronize_session="fetch",
    )
    # Rules are cascade-deleted via the relationship
    db.delete(cat)
    db.commit()


def _get_or_404(db: Session, cat_id: int) -> Category:
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found.")
    return cat
