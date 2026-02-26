"""CSV / PDF import service.

Public entry points:

  preview_csv(content)                    – parse headers + first 20 rows
  import_csv(db, …, source_type)          – legacy source-type-based import
  import_csv_with_mapping(db, …, mapping) – explicit user-supplied column map
  import_pdf_with_mapping(db, …, mapping) – PDF extraction + same mapping logic
"""

import csv
import io
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Import, Transaction
from .categorizer import auto_categorize_import
from .normalizer import (
    compute_file_hash,
    compute_fingerprint,
    extract_merchant_candidate,
    normalize_description,
    parse_amount,
    parse_date,
    parse_split_amount,
    to_cents,
)

# ─────────────────────────────────────────────────────────────────────────────
# Legacy source-type column-mapping configs (for POST /imports/)
# ─────────────────────────────────────────────────────────────────────────────

COLUMN_MAPPERS: dict[str, dict[str, list[str] | None]] = {
    "generic": {
        "posted_date": ["Date", "Transaction Date", "Posted Date", "Trans. Date", "Posting Date"],
        "description_raw": ["Description", "Payee", "Memo", "Narrative", "Details", "Transaction Description"],
        "amount": ["Amount", "Transaction Amount"],
        "currency": ["Currency", "Ccy"],
        "merchant": ["Merchant", "Merchant Name"],
    },
    "chase": {
        "posted_date": ["Transaction Date"],
        "description_raw": ["Description"],
        "amount": ["Amount"],
        "currency": None,
        "merchant": ["Description"],  # same col → triggers auto-extract below
    },
    "bofa": {
        "posted_date": ["Date"],
        "description_raw": ["Description"],
        "amount": ["Amount"],
        "currency": None,
        "merchant": ["Description"],
    },
    "amex": {
        "posted_date": ["Date"],
        "description_raw": ["Description"],
        "amount": ["Amount"],
        "currency": None,
        "merchant": ["Description"],
    },
}

_DEFAULT_CURRENCY = "USD"


def resolve_column(headers: list[str], candidates: list[str] | None) -> Optional[str]:
    """Return the first candidate header name that exists in the CSV (case-insensitive)."""
    if candidates is None:
        return None
    index = {h.strip().lower(): h for h in headers}
    for c in candidates:
        match = index.get(c.strip().lower())
        if match is not None:
            return match
    return None


# ─────────────────────────────────────────────────────────────────────────────
# CSV preview (no DB interaction)
# ─────────────────────────────────────────────────────────────────────────────


def preview_csv(content: bytes, max_rows: int = 20) -> dict:
    """Return headers and the first *max_rows* rows as plain dicts.

    Also counts total rows so the UI can display "showing 20 of 42".
    """
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    headers: list[str] = list(reader.fieldnames or [])
    rows: list[dict[str, str]] = []
    total = 0

    for row in reader:
        total += 1
        if len(rows) < max_rows:
            rows.append({k: (v or "") for k, v in row.items()})

    return {
        "headers": headers,
        "rows": rows,
        "total_rows_previewed": len(rows),
        "total_rows": total,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Shared row-level processing
# ─────────────────────────────────────────────────────────────────────────────


def _resolve_merchant(
    row: dict,
    col_merchant: Optional[str],
    col_desc: str,
    raw_desc: str,
) -> Optional[str]:
    """Return merchant value: explicit column if distinct from description,
    otherwise auto-extract from the description text."""
    if col_merchant and col_merchant != col_desc:
        explicit = (row.get(col_merchant) or "").strip()
        if explicit:
            return explicit
    # Auto-extract: strip bank noise and return title-cased candidate
    candidate = extract_merchant_candidate(raw_desc)
    return candidate or None


def _insert_transaction(
    db: Session,
    import_id: int,
    posted_date: str,
    raw_desc: str,
    amount: float,
    currency: str,
    merchant: Optional[str],
    batch_seen: Optional[set] = None,
) -> bool:
    """Attempt to insert one transaction.  Returns True if inserted, False if duplicate.

    batch_seen is an in-memory set of fingerprints already inserted in this
    import batch.  It prevents UNIQUE-constraint errors when the same
    date+description+amount appears more than once in the same file (e.g. two
    identical metro fares on the same day).
    """
    fingerprint = compute_fingerprint(posted_date, raw_desc, amount)

    # 1. In-memory check — catches duplicates within the same uncommitted batch.
    if batch_seen is not None and fingerprint in batch_seen:
        return False

    # 2. DB check — catches duplicates from previous imports.
    if db.query(Transaction).filter(Transaction.fingerprint_hash == fingerprint).first():
        return False

    if batch_seen is not None:
        batch_seen.add(fingerprint)

    db.add(
        Transaction(
            import_id=import_id,
            posted_date=posted_date,
            description_raw=raw_desc,
            description_norm=normalize_description(raw_desc),
            amount_cents=to_cents(amount),
            currency=currency,
            merchant=merchant,
            fingerprint_hash=fingerprint,
        )
    )
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Legacy import  (POST /imports/)
# ─────────────────────────────────────────────────────────────────────────────


def import_csv(
    db: Session,
    filename: str,
    content: bytes,
    source_type: str = "generic",
) -> dict:
    """Import using a pre-configured source-type column mapping."""
    file_hash = compute_file_hash(content)

    existing = db.query(Import).filter(Import.file_hash == file_hash).first()
    if existing:
        tx_count = db.query(Transaction).filter(Transaction.import_id == existing.id).count()
        return {
            "id": existing.id,
            "filename": existing.filename,
            "file_hash": file_hash,
            "source_type": existing.source_type,
            "column_mapping": existing.column_mapping,
            "created_at": existing.created_at,
            "inserted": 0,
            "skipped": tx_count,
        }

    mapper = COLUMN_MAPPERS.get(source_type, COLUMN_MAPPERS["generic"])
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    headers: list[str] = list(reader.fieldnames or [])

    col_date = resolve_column(headers, mapper["posted_date"])
    col_desc = resolve_column(headers, mapper["description_raw"])
    col_amount = resolve_column(headers, mapper["amount"])
    col_currency = resolve_column(headers, mapper.get("currency"))
    col_merchant = resolve_column(headers, mapper.get("merchant"))

    if not col_date or not col_desc or not col_amount:
        raise ValueError(
            f"CSV headers {headers!r} could not be mapped for source_type={source_type!r}. "
            f"Resolved — date: {col_date!r}  desc: {col_desc!r}  amount: {col_amount!r}. "
            "Check the source_type or verify your CSV columns."
        )

    import_record = Import(filename=filename, file_hash=file_hash, source_type=source_type)
    db.add(import_record)

    try:
        db.flush()
        inserted = skipped = 0
        batch_seen: set = set()

        for row in reader:
            try:
                raw_date = (row.get(col_date) or "").strip()
                raw_desc = (row.get(col_desc) or "").strip()
                raw_amount = (row.get(col_amount) or "").strip()

                if not raw_date or not raw_desc or not raw_amount:
                    skipped += 1
                    continue

                posted_date = parse_date(raw_date)
                amount = parse_amount(raw_amount)

                currency = _DEFAULT_CURRENCY
                if col_currency:
                    cv = (row.get(col_currency) or "").strip()
                    if cv:
                        currency = cv

                merchant = _resolve_merchant(row, col_merchant, col_desc, raw_desc)

                if _insert_transaction(db, import_record.id, posted_date, raw_desc, amount, currency, merchant, batch_seen):
                    inserted += 1
                else:
                    skipped += 1

            except (ValueError, KeyError, TypeError):
                skipped += 1

        db.commit()

    except Exception:
        db.rollback()
        raise

    try:
        auto_categorize_import(db, import_record.id)
    except Exception:
        pass  # categorization is best-effort; don't fail the import

    try:
        from .merchant_canonicalizer import apply_canonical_to_import
        apply_canonical_to_import(db, import_record.id)
    except Exception:
        pass  # canonicalization is best-effort

    return {
        "id": import_record.id,
        "filename": filename,
        "file_hash": file_hash,
        "source_type": source_type,
        "column_mapping": None,
        "created_at": import_record.created_at,
        "inserted": inserted,
        "skipped": skipped,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Wizard import  (POST /imports/csv)
# ─────────────────────────────────────────────────────────────────────────────


def import_csv_with_mapping(
    db: Session,
    filename: str,
    content: bytes,
    mapping: dict,
) -> dict:
    """Import a CSV using an explicit column mapping supplied by the user."""
    file_hash = compute_file_hash(content)

    existing = db.query(Import).filter(Import.file_hash == file_hash).first()
    if existing:
        tx_count = db.query(Transaction).filter(Transaction.import_id == existing.id).count()
        return {
            "id": existing.id,
            "filename": existing.filename,
            "file_hash": file_hash,
            "source_type": "custom",
            "column_mapping": existing.column_mapping,
            "created_at": existing.created_at,
            "inserted": 0,
            "skipped": tx_count,
        }

    # ── Column references ─────────────────────────────────────────────────
    col_date: str = mapping.get("posted_date") or ""
    col_desc: str = mapping.get("description_raw") or ""
    amount_type: str = mapping.get("amount_type", "single")
    col_amount: str = mapping.get("amount") or ""
    col_debit: str = mapping.get("debit") or ""
    col_credit: str = mapping.get("credit") or ""
    col_currency: str = mapping.get("currency") or ""
    col_merchant: str = mapping.get("merchant") or ""

    if not col_date or not col_desc:
        raise ValueError("mapping must specify both posted_date and description_raw columns")
    if amount_type == "single" and not col_amount:
        raise ValueError("mapping.amount is required when amount_type='single'")
    if amount_type == "split" and not col_debit and not col_credit:
        raise ValueError("mapping must specify at least one of debit or credit when amount_type='split'")

    # ── Validate headers ─────────────────────────────────────────────────
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    headers: list[str] = list(reader.fieldnames or [])

    def _check(col: str, label: str) -> None:
        if col and col not in headers:
            raise ValueError(
                f"Column {col!r} (mapped as {label}) not found in CSV. "
                f"Available headers: {headers}"
            )

    _check(col_date, "Date")
    _check(col_desc, "Description")
    _check(col_amount, "Amount")
    _check(col_debit, "Debit")
    _check(col_credit, "Credit")
    _check(col_currency, "Currency")
    _check(col_merchant, "Merchant")

    # ── Persist import record ─────────────────────────────────────────────
    import_record = Import(
        filename=filename,
        file_hash=file_hash,
        source_type="custom",
        column_mapping=mapping,
    )
    db.add(import_record)

    try:
        db.flush()
        inserted = skipped = 0
        batch_seen: set = set()

        for row in reader:
            try:
                raw_date = (row.get(col_date) or "").strip()
                raw_desc = (row.get(col_desc) or "").strip()

                if not raw_date or not raw_desc:
                    skipped += 1
                    continue

                # ── Amount ───────────────────────────────────────────────
                if amount_type == "single":
                    raw_amount = (row.get(col_amount) or "").strip()
                    if not raw_amount:
                        skipped += 1
                        continue
                    amount = parse_amount(raw_amount)
                else:
                    d_val = (row.get(col_debit) or "") if col_debit else ""
                    c_val = (row.get(col_credit) or "") if col_credit else ""
                    try:
                        amount = parse_split_amount(d_val, c_val)
                    except ValueError:
                        skipped += 1
                        continue

                posted_date = parse_date(raw_date)

                currency = _DEFAULT_CURRENCY
                if col_currency:
                    cv = (row.get(col_currency) or "").strip()
                    if cv:
                        currency = cv

                merchant = _resolve_merchant(row, col_merchant or None, col_desc, raw_desc)

                if _insert_transaction(db, import_record.id, posted_date, raw_desc, amount, currency, merchant, batch_seen):
                    inserted += 1
                else:
                    skipped += 1

            except (ValueError, KeyError, TypeError):
                skipped += 1

        db.commit()

    except Exception:
        db.rollback()
        raise

    try:
        auto_categorize_import(db, import_record.id)
    except Exception:
        pass  # categorization is best-effort; don't fail the import

    try:
        from .merchant_canonicalizer import apply_canonical_to_import
        apply_canonical_to_import(db, import_record.id)
    except Exception:
        pass  # canonicalization is best-effort

    return {
        "id": import_record.id,
        "filename": filename,
        "file_hash": file_hash,
        "source_type": "custom",
        "column_mapping": mapping,
        "created_at": import_record.created_at,
        "inserted": inserted,
        "skipped": skipped,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PayPal CSV import  (POST /imports/paypal)
# ─────────────────────────────────────────────────────────────────────────────

_PAYPAL_SKIP_TYPES = {
    "general withdrawal - bank account",
    "withdrawal to bank account",
    "transfer to bank account",
    "transfer from paypal to bank",
    "general credit card withdrawal",
}


def import_paypal_csv(
    db: Session,
    filename: str,
    content: bytes,
) -> dict:
    """Import a PayPal CSV activity export.

    PayPal CSV format includes columns: Date, Name, Type, Status, Currency,
    Gross, Fee, Net, Subject, Balance Impact.

    We keep only rows where:
      - Status == "Completed"
      - Balance Impact == "Debit"   (money leaving PayPal = actual payments)
      - Type is not a bank withdrawal / transfer-out

    The same SHA-256 fingerprint deduplication used by all other importers
    automatically handles overlapping date ranges across multiple exports.
    """
    file_hash = compute_file_hash(content)

    existing = db.query(Import).filter(Import.file_hash == file_hash).first()
    if existing:
        tx_count = db.query(Transaction).filter(Transaction.import_id == existing.id).count()
        return {
            "id": existing.id,
            "filename": existing.filename,
            "file_hash": file_hash,
            "source_type": "paypal",
            "column_mapping": None,
            "created_at": existing.created_at,
            "inserted": 0,
            "skipped": tx_count,
        }

    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    import_record = Import(filename=filename, file_hash=file_hash, source_type="paypal")
    db.add(import_record)

    try:
        db.flush()
        inserted = skipped = 0
        batch_seen: set = set()

        for row in reader:
            try:
                status = (row.get("Status") or "").strip()
                balance_impact = (row.get("Balance Impact") or "").strip()
                tx_type = (row.get("Type") or "").strip().lower()

                # Only completed debit transactions (actual PayPal payments/purchases)
                if status != "Completed":
                    skipped += 1
                    continue
                if balance_impact != "Debit":
                    skipped += 1
                    continue
                if tx_type in _PAYPAL_SKIP_TYPES or "withdrawal" in tx_type:
                    skipped += 1
                    continue

                raw_date = (row.get("Date") or "").strip()
                name = (row.get("Name") or "").strip()
                subject = (row.get("Subject") or "").strip()
                net_str = (row.get("Net") or "").strip()
                currency = (row.get("Currency") or _DEFAULT_CURRENCY).strip() or _DEFAULT_CURRENCY

                if not raw_date or not net_str:
                    skipped += 1
                    continue

                # Build a human-readable description from Name + Subject
                if subject and subject.lower() != name.lower():
                    raw_desc = f"{name} - {subject}" if name else subject
                else:
                    raw_desc = name or tx_type or "PayPal Payment"

                posted_date = parse_date(raw_date)
                amount = parse_amount(net_str)
                merchant = name or None

                if _insert_transaction(
                    db, import_record.id, posted_date, raw_desc, amount, currency, merchant, batch_seen
                ):
                    inserted += 1
                else:
                    skipped += 1

            except (ValueError, KeyError, TypeError):
                skipped += 1

        db.commit()

    except Exception:
        db.rollback()
        raise

    try:
        auto_categorize_import(db, import_record.id)
    except Exception:
        pass  # categorization is best-effort; don't fail the import

    try:
        from .merchant_canonicalizer import apply_canonical_to_import
        apply_canonical_to_import(db, import_record.id)
    except Exception:
        pass  # canonicalization is best-effort

    return {
        "id": import_record.id,
        "filename": filename,
        "file_hash": file_hash,
        "source_type": "paypal",
        "column_mapping": None,
        "created_at": import_record.created_at,
        "inserted": inserted,
        "skipped": skipped,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PDF import  (POST /imports/pdf)
# ─────────────────────────────────────────────────────────────────────────────


def import_pdf_with_mapping(
    db: Session,
    filename: str,
    content: bytes,
    mapping: dict,
) -> dict:
    """Extract tables from a PDF and import rows using an explicit column mapping.

    Delegates extraction to pdf_extractor.extract_pdf(), then processes rows
    with the same pipeline as import_csv_with_mapping().
    """
    from .pdf_extractor import extract_pdf, extract_txt  # local import to avoid circular at load time

    extraction = extract_txt(content) if filename.lower().endswith(".txt") else extract_pdf(content)
    if extraction["status"] != "preview":
        raise ValueError(
            f"PDF table extraction failed: {extraction.get('reason', 'unknown error')}"
        )

    all_rows: list[dict] = extraction["rows"]
    headers: list[str] = extraction["headers"]

    # ── File-level dedup ─────────────────────────────────────────────────────
    file_hash = compute_file_hash(content)
    existing = db.query(Import).filter(Import.file_hash == file_hash).first()
    if existing:
        tx_count = db.query(Transaction).filter(Transaction.import_id == existing.id).count()
        return {
            "id": existing.id,
            "filename": existing.filename,
            "file_hash": file_hash,
            "source_type": "pdf",
            "column_mapping": existing.column_mapping,
            "created_at": existing.created_at,
            "inserted": 0,
            "skipped": tx_count,
        }

    # ── Column references ─────────────────────────────────────────────────────
    col_date: str = mapping.get("posted_date") or ""
    col_desc: str = mapping.get("description_raw") or ""
    amount_type: str = mapping.get("amount_type", "single")
    col_amount: str = mapping.get("amount") or ""
    col_debit: str = mapping.get("debit") or ""
    col_credit: str = mapping.get("credit") or ""
    col_currency: str = mapping.get("currency") or ""
    col_merchant: str = mapping.get("merchant") or ""

    if not col_date or not col_desc:
        raise ValueError("mapping must specify both posted_date and description_raw columns")
    if amount_type == "single" and not col_amount:
        raise ValueError("mapping.amount is required when amount_type='single'")
    if amount_type == "split" and not col_debit and not col_credit:
        raise ValueError("mapping must specify at least one of debit or credit when amount_type='split'")

    # ── Validate that mapped columns actually exist in the extracted headers ─
    def _check(col: str, label: str) -> None:
        if col and col not in headers:
            raise ValueError(
                f"Column {col!r} (mapped as {label}) not found in PDF. "
                f"Available headers: {headers}"
            )

    _check(col_date, "Date")
    _check(col_desc, "Description")
    _check(col_amount, "Amount")
    _check(col_debit, "Debit")
    _check(col_credit, "Credit")
    _check(col_currency, "Currency")
    _check(col_merchant, "Merchant")

    # ── Persist import record ─────────────────────────────────────────────────
    import_record = Import(
        filename=filename,
        file_hash=file_hash,
        source_type="pdf",
        column_mapping=mapping,
    )
    db.add(import_record)

    try:
        db.flush()
        inserted = skipped = 0
        batch_seen: set = set()

        for row in all_rows:
            try:
                raw_date = (row.get(col_date) or "").strip()
                raw_desc = (row.get(col_desc) or "").strip()

                if not raw_date or not raw_desc:
                    skipped += 1
                    continue

                if amount_type == "single":
                    raw_amount = (row.get(col_amount) or "").strip()
                    if not raw_amount:
                        skipped += 1
                        continue
                    amount = parse_amount(raw_amount)
                else:
                    d_val = (row.get(col_debit) or "") if col_debit else ""
                    c_val = (row.get(col_credit) or "") if col_credit else ""
                    try:
                        amount = parse_split_amount(d_val, c_val)
                    except ValueError:
                        skipped += 1
                        continue

                posted_date = parse_date(raw_date)

                currency = _DEFAULT_CURRENCY
                if col_currency:
                    cv = (row.get(col_currency) or "").strip()
                    if cv:
                        currency = cv

                merchant = _resolve_merchant(row, col_merchant or None, col_desc, raw_desc)

                if _insert_transaction(db, import_record.id, posted_date, raw_desc, amount, currency, merchant, batch_seen):
                    inserted += 1
                else:
                    skipped += 1

            except (ValueError, KeyError, TypeError):
                skipped += 1

        db.commit()

    except Exception:
        db.rollback()
        raise

    try:
        auto_categorize_import(db, import_record.id)
    except Exception:
        pass  # categorization is best-effort; don't fail the import

    try:
        from .merchant_canonicalizer import apply_canonical_to_import
        apply_canonical_to_import(db, import_record.id)
    except Exception:
        pass  # canonicalization is best-effort

    return {
        "id": import_record.id,
        "filename": filename,
        "file_hash": file_hash,
        "source_type": "pdf",
        "column_mapping": mapping,
        "created_at": import_record.created_at,
        "inserted": inserted,
        "skipped": skipped,
    }
