from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Category, Rule, Transaction
from ..schemas import ApplyRulesResponse, RuleCreate, RuleSchema, RuleUpdate
from ..services.categorizer import apply_rules_to_all

router = APIRouter(prefix="/rules", tags=["rules"])


def _to_schema(rule: Rule) -> RuleSchema:
    cat = rule.category
    return RuleSchema(
        id=rule.id,
        pattern=rule.pattern,
        match_type=rule.match_type,
        category_id=rule.category_id,
        category_name=cat.name if cat else None,
        category_color=cat.color if cat else None,
        category_icon=cat.icon if cat else None,
        priority=rule.priority,
        is_active=rule.is_active,
        created_at=rule.created_at,
    )


@router.get("/", response_model=list[RuleSchema], summary="List all rules")
def list_rules(db: Session = Depends(get_db)):
    rules = (
        db.query(Rule)
        .options(joinedload(Rule.category))
        .order_by(Rule.priority.desc(), Rule.id.asc())
        .all()
    )
    return [_to_schema(r) for r in rules]


@router.post("/", response_model=RuleSchema, status_code=201, summary="Create a rule")
def create_rule(payload: RuleCreate, db: Session = Depends(get_db)):
    _require_category(db, payload.category_id)
    rule = Rule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    # Reload with category joined
    rule = db.query(Rule).options(joinedload(Rule.category)).filter(Rule.id == rule.id).first()
    return _to_schema(rule)


@router.put("/{rule_id}", response_model=RuleSchema, summary="Update a rule")
def update_rule(rule_id: int, payload: RuleUpdate, db: Session = Depends(get_db)):
    rule = _get_or_404(db, rule_id)
    _require_category(db, payload.category_id)
    for field, val in payload.model_dump().items():
        setattr(rule, field, val)
    db.commit()
    rule = db.query(Rule).options(joinedload(Rule.category)).filter(Rule.id == rule_id).first()
    return _to_schema(rule)


@router.delete("/{rule_id}", status_code=204, summary="Delete a rule")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = _get_or_404(db, rule_id)
    # Clear rule reference on any transactions that used this rule for provenance
    db.query(Transaction).filter(Transaction.category_rule_id == rule_id).update(
        {"category_rule_id": None, "category_source": None}, synchronize_session="fetch"
    )
    db.delete(rule)
    db.commit()


@router.post(
    "/apply",
    response_model=ApplyRulesResponse,
    summary="Apply all active rules to every transaction",
)
def apply_rules(db: Session = Depends(get_db)):
    return apply_rules_to_all(db)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _get_or_404(db: Session, rule_id: int) -> Rule:
    rule = db.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found.")
    return rule


def _require_category(db: Session, cat_id: int) -> None:
    if not db.query(Category).filter(Category.id == cat_id).first():
        raise HTTPException(status_code=422, detail=f"Category id={cat_id} does not exist.")
