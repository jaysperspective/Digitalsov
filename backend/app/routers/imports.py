import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Import, Transaction
from ..schemas import ColumnMappingInput, ImportRecord, ImportResponse, PatchImportLabel, PreviewResponse
from ..services.csv_importer import import_csv, import_csv_with_mapping, import_paypal_csv, import_pdf_with_mapping, preview_csv
from ..services.pdf_extractor import MAX_PREVIEW_ROWS, extract_pdf, extract_txt

MAX_CSV_BYTES = 10 * 1024 * 1024      # 10 MB
MAX_PDF_BYTES = 25 * 1024 * 1024      # 25 MB

router = APIRouter(prefix="/imports", tags=["imports"])


# ─────────────────────────────────────────────────────────────────────────────
# Legacy endpoint  (source-type auto-mapper)
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/", response_model=ImportResponse, summary="Import CSV via preset source-type mapping")
async def upload_csv_legacy(
    file: UploadFile = File(...),
    source_type: str = Form(default="generic", description="generic | chase | bofa | amex"),
    db: Session = Depends(get_db),
):
    _require_csv(file)
    content = await file.read()
    _require_max_size(content, MAX_CSV_BYTES, "CSV")
    _require_content(content)

    try:
        result = import_csv(db, file.filename or "upload.csv", content, source_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Wizard step 1 — preview
# ─────────────────────────────────────────────────────────────────────────────


@router.post(
    "/preview",
    response_model=PreviewResponse,
    summary="Return headers + first 20 rows for the column-mapping wizard",
)
async def preview_csv_endpoint(
    file: UploadFile = File(...),
):
    _require_csv(file)
    content = await file.read()
    _require_max_size(content, MAX_CSV_BYTES, "CSV")
    _require_content(content)

    try:
        data = preview_csv(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {exc}")

    return PreviewResponse(filename=file.filename or "upload.csv", **data)


# ─────────────────────────────────────────────────────────────────────────────
# Wizard step 2 — import with explicit mapping
# ─────────────────────────────────────────────────────────────────────────────


@router.post(
    "/csv",
    response_model=ImportResponse,
    summary="Import CSV with an explicit user-defined column mapping",
)
async def import_csv_endpoint(
    file: UploadFile = File(...),
    mapping: str = Form(
        ...,
        description="JSON-encoded ColumnMappingInput (posted_date, description_raw, amount_type, …)",
    ),
    db: Session = Depends(get_db),
):
    _require_csv(file)

    # Parse and validate the mapping JSON
    try:
        raw = json.loads(mapping)
        mapping_obj = ColumnMappingInput(**raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"mapping is not valid JSON: {exc}")
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    content = await file.read()
    _require_max_size(content, MAX_CSV_BYTES, "CSV")
    _require_content(content)

    try:
        result = import_csv_with_mapping(
            db,
            file.filename or "upload.csv",
            content,
            mapping_obj.model_dump(exclude_none=False),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return result


# ─────────────────────────────────────────────────────────────────────────────
# PayPal CSV endpoint  (fixed format — no column mapping needed)
# ─────────────────────────────────────────────────────────────────────────────


@router.post(
    "/paypal",
    response_model=ImportResponse,
    summary="Import a PayPal CSV activity export (fixed format — no column mapping needed)",
)
async def import_paypal_endpoint(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _require_csv(file)
    content = await file.read()
    _require_max_size(content, MAX_CSV_BYTES, "CSV")
    _require_content(content)

    try:
        result = import_paypal_csv(db, file.filename or "paypal_export.csv", content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return result


# ─────────────────────────────────────────────────────────────────────────────
# PDF endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.post(
    "/pdf/preview",
    summary="Extract tables from a PDF statement — returns preview or needs-manual-mapping",
)
async def preview_pdf_endpoint(
    file: UploadFile = File(...),
):
    _require_pdf_or_txt(file)
    content = await file.read()
    _require_max_size(content, MAX_PDF_BYTES, "PDF/TXT")
    _require_content(content)

    fname = file.filename or "upload.pdf"
    result = extract_txt(content) if fname.lower().endswith(".txt") else extract_pdf(content)
    result["filename"] = fname

    # Truncate rows to MAX_PREVIEW_ROWS so the response stays small;
    # the import endpoint re-extracts and processes all rows.
    if result.get("rows") is not None:
        result["total_rows"] = len(result["rows"])
        result["rows"] = result["rows"][:MAX_PREVIEW_ROWS]

    return result


@router.post(
    "/pdf",
    response_model=ImportResponse,
    summary="Import a PDF statement with an explicit column mapping",
)
async def import_pdf_endpoint(
    file: UploadFile = File(...),
    mapping: str = Form(
        ...,
        description="JSON-encoded ColumnMappingInput",
    ),
    db: Session = Depends(get_db),
):
    _require_pdf_or_txt(file)

    try:
        raw = json.loads(mapping)
        mapping_obj = ColumnMappingInput(**raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"mapping is not valid JSON: {exc}")
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    content = await file.read()
    _require_max_size(content, MAX_PDF_BYTES, "PDF/TXT")
    _require_content(content)

    try:
        result = import_pdf_with_mapping(
            db,
            file.filename or "upload.pdf",
            content,
            mapping_obj.model_dump(exclude_none=False),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Import history / management
# ─────────────────────────────────────────────────────────────────────────────


@router.get(
    "/list",
    response_model=list[ImportRecord],
    summary="List all imported documents with transaction counts",
)
def list_imports(db: Session = Depends(get_db)):
    rows = (
        db.query(Import, func.count(Transaction.id).label("tx_count"))
        .outerjoin(Transaction, Transaction.import_id == Import.id)
        .group_by(Import.id)
        .order_by(Import.created_at.desc())
        .all()
    )
    return [
        ImportRecord(
            id=imp.id,
            filename=imp.filename,
            source_type=imp.source_type,
            account_label=imp.account_label,
            account_type=imp.account_type,
            notes=imp.notes,
            created_at=imp.created_at,
            transaction_count=count,
        )
        for imp, count in rows
    ]


@router.patch(
    "/{import_id}",
    response_model=ImportRecord,
    summary="Update account label and/or account type for an import",
)
def patch_import(
    import_id: int,
    payload: PatchImportLabel,
    db: Session = Depends(get_db),
):
    imp = db.query(Import).filter(Import.id == import_id).first()
    if not imp:
        raise HTTPException(status_code=404, detail=f"Import {import_id} not found.")

    if payload.account_label is not None:
        imp.account_label = payload.account_label or None
    if payload.account_type is not None:
        imp.account_type = payload.account_type or None
    if payload.notes is not None:
        imp.notes = payload.notes or None

    db.commit()
    db.refresh(imp)

    tx_count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.import_id == imp.id)
        .scalar()
    ) or 0
    return ImportRecord(
        id=imp.id,
        filename=imp.filename,
        source_type=imp.source_type,
        account_label=imp.account_label,
        account_type=imp.account_type,
        notes=imp.notes,
        created_at=imp.created_at,
        transaction_count=tx_count,
    )


@router.delete(
    "/{import_id}",
    status_code=204,
    summary="Delete an import and all its transactions",
)
def delete_import(
    import_id: int,
    db: Session = Depends(get_db),
):
    imp = db.query(Import).filter(Import.id == import_id).first()
    if not imp:
        raise HTTPException(status_code=404, detail=f"Import {import_id} not found.")
    db.query(Transaction).filter(Transaction.import_id == import_id).delete()
    db.delete(imp)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _require_csv(file: UploadFile) -> None:
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted.")


def _require_pdf_or_txt(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not (name.endswith(".pdf") or name.endswith(".txt")):
        raise HTTPException(status_code=400, detail="Only .pdf and .txt files are accepted.")


def _require_content(content: bytes) -> None:
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")


def _require_max_size(content: bytes, max_bytes: int, label: str) -> None:
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"{label} file too large (>{max_bytes // (1024*1024)} MB).",
        )
