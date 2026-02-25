"""Categorization service.

Applies Rule objects to transaction descriptions in priority order.
Rules are sorted by priority DESC so higher numbers take precedence.
"""

import re
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Rule, Transaction


# ─────────────────────────────────────────────────────────────────────────────
# Core matching
# ─────────────────────────────────────────────────────────────────────────────


def categorize(description_norm: str, rules: list) -> tuple[Optional[int], Optional[int]]:
    """Return (category_id, rule_id) for the first rule that matches, or (None, None).

    Rules must already be sorted by priority DESC (highest first).
    Matching is performed against the normalised (lowercase) description.
    """
    for rule in rules:
        if not rule.is_active:
            continue
        try:
            matched = False
            if rule.match_type == "contains":
                matched = rule.pattern.lower() in description_norm
            elif rule.match_type == "exact":
                matched = rule.pattern.lower() == description_norm.strip()
            elif rule.match_type == "regex":
                matched = bool(re.search(rule.pattern, description_norm, re.IGNORECASE))
            if matched:
                return rule.category_id, rule.id
        except re.error:
            continue  # skip invalid regex patterns
    return None, None


def _load_active_rules(db: Session) -> list:
    return (
        db.query(Rule)
        .filter(Rule.is_active == True)  # noqa: E712
        .order_by(Rule.priority.desc(), Rule.id.asc())
        .all()
    )


# ─────────────────────────────────────────────────────────────────────────────
# Bulk operations
# ─────────────────────────────────────────────────────────────────────────────


def apply_rules_to_all(db: Session) -> dict:
    """Recategorize EVERY transaction using the current active rule set.

    This is a full re-scan: previously set category_ids are overwritten.
    Returns counts of updated / unchanged / total transactions.
    """
    rules = _load_active_rules(db)
    transactions = db.query(Transaction).all()
    updated = 0

    for tx in transactions:
        new_cat, new_rule_id = categorize(tx.description_norm, rules)
        new_source = "rule" if new_cat is not None else None
        if tx.category_id != new_cat or tx.category_rule_id != new_rule_id:
            tx.category_id = new_cat
            tx.category_source = new_source
            tx.category_rule_id = new_rule_id
            updated += 1

    if updated:
        db.commit()

    return {
        "updated": updated,
        "unchanged": len(transactions) - updated,
        "total": len(transactions),
    }


def auto_categorize_import(db: Session, import_id: int) -> None:
    """Categorize only the transactions that belong to a specific import.

    Called immediately after a CSV import completes so that newly inserted
    rows are categorized without re-scanning the whole database.
    """
    rules = _load_active_rules(db)
    if not rules:
        return

    transactions = (
        db.query(Transaction)
        .filter(Transaction.import_id == import_id)
        .all()
    )
    changed = False
    for tx in transactions:
        cat_id, rule_id = categorize(tx.description_norm, rules)
        new_source = "rule" if cat_id is not None else None
        if tx.category_id != cat_id or tx.category_rule_id != rule_id:
            tx.category_id = cat_id
            tx.category_source = new_source
            tx.category_rule_id = rule_id
            changed = True

    if changed:
        db.commit()
