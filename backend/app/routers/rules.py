import re
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Category, Rule, Transaction
from ..schemas import ApplyRulesResponse, ApplySuggestionRequest, ApplySuggestionResponse, RuleCreate, RuleSchema, RuleUpdate
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
        {"category_rule_id": None, "category_source": "uncategorized"}, synchronize_session="fetch"
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


_EXCLUDED_TYPES = {"transfer", "payment"}


@router.get("/suggestions", summary="Suggest categorization rules based on transaction patterns")
def get_rule_suggestions(db: Session = Depends(get_db)):
    # ── Pre-compute existing rule patterns so we don't suggest duplicates ─────
    existing_rules = db.query(Rule).filter(Rule.is_active.is_(True)).all()
    # A merchant is "already covered" if its lowercase name is a substring of
    # any existing contains/exact rule pattern, or matches a regex rule.
    def _already_covered(merchant_lower: str) -> bool:
        for r in existing_rules:
            pat = r.pattern.lower()
            if r.match_type == "contains" and (pat in merchant_lower or merchant_lower in pat):
                return True
            if r.match_type == "exact" and pat == merchant_lower:
                return True
            if r.match_type == "regex":
                try:
                    if re.search(r.pattern, merchant_lower, re.IGNORECASE):
                        return True
                except re.error:
                    pass
        return False

    # ── Heuristic 1: Uncategorized volume ─────────────────────────────────────
    uncategorized = (
        db.query(Transaction)
        .filter(Transaction.category_id.is_(None))
        .filter(Transaction.transaction_type.notin_(list(_EXCLUDED_TYPES)))
        .all()
    )
    merch_uncat: dict[str, list[Transaction]] = defaultdict(list)
    for tx in uncategorized:
        key = (tx.merchant_canonical or tx.merchant or "").strip()
        if key:
            merch_uncat[key].append(tx)

    # ── Heuristic 2: Manual consistency ───────────────────────────────────────
    manual_txns = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.category_source == "manual")
        .filter(Transaction.transaction_type.notin_(list(_EXCLUDED_TYPES)))
        .all()
    )
    manual_groups: dict[str, dict[int, list[Transaction]]] = defaultdict(lambda: defaultdict(list))
    for tx in manual_txns:
        key = (tx.merchant_canonical or tx.merchant or "").strip()
        if key and tx.category_id is not None:
            manual_groups[key][tx.category_id].append(tx)

    suggestions: list[dict] = []
    seen: set[str] = set()

    # Manual-consistency suggestions first (already have a category)
    for merchant, cat_map in manual_groups.items():
        if _already_covered(merchant.lower()):
            continue
        dom_cat_id, dom_txns = max(cat_map.items(), key=lambda x: len(x[1]))
        total_by_merch = sum(len(v) for v in cat_map.values())
        consistency = len(dom_txns) / total_by_merch if total_by_merch else 0
        if len(dom_txns) >= 2 and consistency >= 0.75:
            cat = dom_txns[0].category
            spend = sum(t.amount_cents for t in dom_txns if t.amount_cents < 0) / 100
            suggestions.append({
                "merchant": merchant,
                "match_type": "contains",
                "pattern": merchant.lower(),
                "category_id": dom_cat_id,
                "category_name": cat.name if cat else None,
                "count": len(dom_txns),
                "total_spend": round(abs(spend), 2),
                "avg_spend": round(abs(spend / len(dom_txns)), 2) if dom_txns else 0,
                "confidence": min(95, int(consistency * 100)),
                "source": "manual_consistency",
                "sample_descriptions": [t.description_raw[:80] for t in dom_txns[:3]],
            })
            seen.add(merchant)

    # Uncategorized-volume suggestions (need category assignment in UI)
    for merchant, txns in merch_uncat.items():
        if merchant in seen or _already_covered(merchant.lower()):
            continue
        spend = sum(t.amount_cents for t in txns if t.amount_cents < 0) / 100
        count = len(txns)
        suggestions.append({
            "merchant": merchant,
            "match_type": "contains",
            "pattern": merchant.lower(),
            "category_id": None,
            "category_name": None,
            "count": count,
            "total_spend": round(abs(spend), 2),
            "avg_spend": round(abs(spend / count), 2) if count else 0,
            "confidence": min(85, 40 + count * 5),
            "source": "uncategorized_volume",
            "sample_descriptions": [t.description_raw[:80] for t in txns[:3]],
        })

    suggestions.sort(key=lambda x: (0 if x["category_id"] else 1, -x["count"]))
    return {"suggestions": suggestions[:50]}


@router.post(
    "/suggestions/apply",
    response_model=ApplySuggestionResponse,
    summary="Create a rule from a suggestion and apply it to matching uncategorized transactions",
)
def apply_rule_suggestion(payload: ApplySuggestionRequest, db: Session = Depends(get_db)):
    _require_category(db, payload.category_id)
    rule = Rule(
        pattern=payload.pattern,
        match_type=payload.match_type,
        category_id=payload.category_id,
        priority=payload.priority,
        is_active=True,
    )
    db.add(rule)
    db.flush()

    # Apply to uncategorized transactions that match
    txns = (
        db.query(Transaction)
        .filter(Transaction.category_id.is_(None))
        .filter(Transaction.transaction_type.notin_(list(_EXCLUDED_TYPES)))
        .all()
    )
    updated = 0
    for tx in txns:
        if _rule_matches(payload.pattern, payload.match_type, tx.description_norm):
            tx.category_id = payload.category_id
            tx.category_source = "rule"
            tx.category_rule_id = rule.id
            updated += 1
    db.commit()
    return ApplySuggestionResponse(created_rule_id=rule.id, updated_transactions_count=updated)


def _rule_matches(pattern: str, match_type: str, description_norm: str) -> bool:
    text = (description_norm or "").lower()
    if match_type == "contains":
        return pattern.lower() in text
    if match_type == "exact":
        return pattern.lower() == text
    if match_type == "regex":
        try:
            return bool(re.search(pattern, text, re.IGNORECASE))
        except re.error:
            return False
    return False


# ── Helpers ──────────────────────────────────────────────────────────────────


def _get_or_404(db: Session, rule_id: int) -> Rule:
    rule = db.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found.")
    return rule


def _require_category(db: Session, cat_id: int) -> None:
    if not db.query(Category).filter(Category.id == cat_id).first():
        raise HTTPException(status_code=422, detail=f"Category id={cat_id} does not exist.")
