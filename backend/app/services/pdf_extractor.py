"""PDF table-extraction service using pdfplumber.

Public surface:
    extract_pdf(content: bytes) -> dict
        Returns {"status": "preview",              "headers": [...], "rows": [...all rows...], "pages": N}
             or {"status": "needs_manual_mapping", "pages": N, "reason": "..."}

The caller (imports router preview endpoint) truncates rows to MAX_PREVIEW_ROWS
before returning to the client; the import endpoint uses all rows.

Extraction strategy:
  1. Try pdfplumber table extraction (works for PDFs with embedded table structure).
  2. If no tables found, fall back to line-by-line text parsing.  This handles
     text-layout statements (e.g. Bank of America eStatements) where transactions
     appear in plain-text sections introduced by a "Date  Description  Amount"
     column-header line.
"""

import io
import re
from collections import Counter
from typing import Optional

try:
    import pdfplumber  # noqa: F401 — presence test only; import inside functions too
    _PDFPLUMBER_OK = True
except ImportError:
    _PDFPLUMBER_OK = False

MAX_PREVIEW_ROWS = 20

# Keywords whose presence in a row suggests it is a totals / summary line,
# not an individual transaction.
_NOISE_PHRASES = [
    "total", "balance", "beginning balance", "ending balance",
    "new balance", "previous balance", "account summary",
    "subtotal", "statement period", "continued on", "page ",
    "opening balance", "closing balance",
]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _norm(v) -> str:
    """Normalize a PDF cell value to a clean string."""
    if v is None:
        return ""
    return " ".join(str(v).split())  # collapses newlines and extra whitespace


def _is_noise(row: list[str]) -> bool:
    """Return True if the row looks like a totals / header / separator line."""
    joined = " ".join(row).lower()
    if not joined.strip():
        return True
    return any(phrase in joined for phrase in _NOISE_PHRASES)


def _looks_like_header(row: list[str]) -> bool:
    """Heuristic: header rows have mostly alphabetic (non-numeric) cells."""
    if not row:
        return False
    # A cell is "alphabetic" when stripping common numeric chars leaves text
    def is_alpha(c: str) -> bool:
        return bool(c and not c.replace(".", "").replace(",", "")
                    .replace("-", "").replace("$", "").replace(" ", "").isnumeric())
    alpha = sum(1 for c in row if is_alpha(c))
    return alpha / len(row) > 0.55


# ── Text-based fallback (Bank of America and similar text-layout PDFs) ────────

# Matches a transaction line that starts with a date: "11/17/25 DESCRIPTION AMOUNT"
_RE_DATE_LINE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{2,4})\s+(.+)$")

# Extracts the amount (with optional leading minus and commas) from the end of a
# string: "SOME DESCRIPTION -1,234.56"  →  group1=description, group2="-1234.56"
_RE_AMOUNT_END = re.compile(r"^(.*?)\s+(-?[\d,]+\.\d{2})\s*$")

# Column-header sentinel for Bank of America PDF text-layout format:
#   "Date  Description  Amount"  (no Running Bal column)
_RE_SECTION_HEADER = re.compile(r"^date\s+description\s+amount\s*$", re.IGNORECASE)

# Column-header sentinel for Bank of America TXT export format:
#   "Date        Description        Amount  Running Bal."
_RE_TABULAR_HEADER = re.compile(r"date\s+description\s+amount\s+running\s+bal", re.IGNORECASE)

# Column-header sentinel for Bank of America Year-End Credit Card Summary:
#   "Date  Description  Location  Amount"  (4-column layout, all are charges)
_RE_YE_COLUMN_HEADER = re.compile(
    r"^date\s+description\s+location\s+amount\s*$", re.IGNORECASE
)

# Transaction line for Year-End Summary format:
#   MM/DD/YY  MERCHANT NAME  LOCATION, ST  166.51
# Description field contains both merchant name and location; amount is always
# a positive number in the source (credit card charge = expense).
_RE_YE_DATE_LINE = re.compile(
    r"^(\d{2}/\d{2}/\d{2})\s+(.+?)\s+([\d,]+\.\d{2})\s*$"
)

# Matches a transaction line starting with a full MM/DD/YYYY date (zero-padded)
_RE_FULL_DATE = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+(.+)$")

# Extracts the two right-aligned numbers (Amount + Running Bal) from the end of a
# tabular transaction line.  The column separator is always 3+ spaces in BoA exports.
_RE_TWO_NUMS = re.compile(r"^(.*?)\s{3,}(-?[\d,]+\.\d{2})\s{3,}(-?[\d,]+\.\d{2})\s*$")

# Prefixes of lines that should be discarded entirely (section labels, totals…)
_TEXT_NOISE_PREFIXES = (
    "total ",
    "beginning balance",
    "ending balance",
    "opening balance",
    "closing balance",
    "deposits and other",
    "withdrawals and other",
    "account number",
    "page ",
    "statement period",
    "statement date",
    "customer service",
    "please see",
    "for questions",
    "for more information",
)

# Substrings that flag a line as noise regardless of its position
_TEXT_NOISE_CONTAINS = (
    "- continued",
    "continued on next",
    "continued on page",
)


def _is_text_noise(line: str) -> bool:
    lower = line.lower()
    if any(lower.startswith(p) for p in _TEXT_NOISE_PREFIXES):
        return True
    if any(s in lower for s in _TEXT_NOISE_CONTAINS):
        return True
    return False


def _parse_tabular(all_lines: list[str]) -> list[dict]:
    """Parse Bank of America TXT export format.

    Format: single flat table introduced by a
      'Date  Description  Amount  Running Bal.'
    header line.  Each transaction row is:
      MM/DD/YYYY  <description>  <amount>  <running_bal>
    where the columns are separated by 3+ spaces (right-aligned in fixed columns).
    The running balance column is discarded; only Date, Description, and Amount
    are returned.
    """
    in_section = False
    transactions: list[dict] = []

    for raw_line in all_lines:
        line = raw_line.strip()
        if not line:
            continue

        if _RE_TABULAR_HEADER.search(line):
            in_section = True
            continue

        if not in_section:
            continue

        dm = _RE_FULL_DATE.match(line)
        if not dm:
            continue  # non-date lines after the header are noise (summaries, etc.)

        date = dm.group(1)
        rest = dm.group(2).strip()

        if _is_text_noise(rest):
            continue  # "Beginning balance", "Ending balance", etc.

        nm = _RE_TWO_NUMS.match(rest)
        if not nm:
            continue  # single-number line (e.g. beginning balance row) — skip

        # group1=description, group2=amount, group3=running_bal (discarded)
        description = nm.group(1).rstrip("\\").strip()
        amount = nm.group(2).replace(",", "")
        transactions.append({"Date": date, "Description": description, "Amount": amount})

    return transactions


def _parse_year_end_summary(all_lines: list[str]) -> list[dict]:
    """Parse Bank of America Year-End Credit Card Summary PDF.

    Transactions are grouped under category headings but each appears as a
    single line:
        MM/DD/YY  MERCHANT NAME  LOCATION, ST  166.51

    The Description column captures both merchant and location (everything
    between the date and the trailing amount).  All transactions are credit
    card charges (expenses) so amounts are stored as negative values.
    """
    transactions: list[dict] = []

    for raw_line in all_lines:
        line = raw_line.strip()
        if not line:
            continue

        m = _RE_YE_DATE_LINE.match(line)
        if not m:
            continue  # category headers, subtotals, page numbers, etc.

        date_str = m.group(1)          # MM/DD/YY — normalizer handles 2-digit year
        description = m.group(2).strip()
        amount_str = m.group(3)        # e.g. "1,290.88"

        # Credit card charges are stored as negative amounts
        amount = f"-{amount_str.replace(',', '')}"

        transactions.append({
            "Date": date_str,
            "Description": description,
            "Amount": amount,
        })

    return transactions


def _parse_section_based(all_lines: list[str]) -> list[dict]:
    """Parse Bank of America PDF text-layout format.

    Transactions appear in sections introduced by a 'Date  Description  Amount'
    column-header line.  Each transaction starts with a MM/DD/YY date prefix;
    continuation lines (no leading date) are appended to the previous
    transaction's description.
    """
    in_section = False
    transactions: list[dict] = []
    current: Optional[dict] = None

    for raw_line in all_lines:
        line = raw_line.strip()
        if not line:
            continue

        if _RE_SECTION_HEADER.match(line):
            in_section = True
            continue

        if not in_section:
            continue

        if _is_text_noise(line):
            continue

        dm = _RE_DATE_LINE.match(line)
        if dm:
            if current:
                transactions.append(current)

            date = dm.group(1)
            rest = dm.group(2).strip()

            am = _RE_AMOUNT_END.match(rest)
            if am:
                description = am.group(1).strip()
                amount = am.group(2).replace(",", "")
            else:
                description = rest
                amount = ""

            current = {"Date": date, "Description": description, "Amount": amount}
        else:
            if current is not None:
                if not current["Amount"]:
                    am = _RE_AMOUNT_END.match(line)
                    if am:
                        current["Description"] = (
                            current["Description"] + " " + am.group(1)
                        ).strip()
                        current["Amount"] = am.group(2).replace(",", "")
                        continue
                current["Description"] = (
                    current["Description"] + " " + line
                ).strip()

    if current:
        transactions.append(current)

    return [t for t in transactions if t["Amount"]]


def _parse_text_lines(all_lines: list[str], pages: int) -> dict:
    """Detect the statement format and dispatch to the appropriate parser.

    Supports three Bank of America layouts:
      • 'year-end'      — Year-End Credit Card Summary with a
                          'Date Description Location Amount' column header;
                          all rows are charges stored as negative amounts.
      • 'tabular'       — TXT export with a Date/Description/Amount/Running Bal
                          column header and all transactions in one flat list.
      • 'section-based' — PDF text-layout with 'Date Description Amount' section
                          sentinel lines and optional multi-line descriptions.
    """
    stripped = [l.strip() for l in all_lines]
    is_year_end = any(_RE_YE_COLUMN_HEADER.match(l) for l in stripped)
    is_tabular = any(_RE_TABULAR_HEADER.search(l) for l in stripped)

    if is_year_end:
        transactions = _parse_year_end_summary(all_lines)
    elif is_tabular:
        transactions = _parse_tabular(all_lines)
    else:
        transactions = _parse_section_based(all_lines)

    if not transactions:
        return {
            "status": "needs_manual_mapping",
            "pages": pages,
            "reason": "no_transactions_found",
        }

    return {
        "status": "preview",
        "headers": ["Date", "Description", "Amount"],
        "rows": transactions,
        "pages": pages,
    }


def _extract_text_transactions(pdf, pages: int) -> dict:
    """Collect lines from a pdfplumber PDF object, then run the text parser."""
    all_lines: list[str] = []
    for page in pdf.pages:
        text = page.extract_text() or ""
        all_lines.extend(text.splitlines())
    return _parse_text_lines(all_lines, pages)


# ── Core extraction ───────────────────────────────────────────────────────────


def _no_tables(pages: int, reason: str) -> dict:
    return {"status": "needs_manual_mapping", "pages": pages, "reason": reason}


def _run_extraction(pdf, pages: int) -> dict:
    """Scan every page; find the dominant transaction table."""
    raw_tables: list[list[list]] = []

    for page in pdf.pages:
        try:
            for tbl in (page.extract_tables() or []):
                if tbl and len(tbl) >= 2:
                    raw_tables.append(tbl)
        except Exception:
            continue

    if not raw_tables:
        # ── Fallback: try text-based line parsing ─────────────────────────
        result = _extract_text_transactions(pdf, pages)
        if result["status"] == "preview":
            return result
        return _no_tables(
            pages,
            "No tables could be extracted from this PDF. "
            "The document may be scanned/image-based, use a non-standard layout, "
            "or have text-extraction restrictions.",
        )

    # ── Determine dominant column count (the transaction table is usually
    #    the one with the most rows and a consistent column count) ──────────
    col_counts: Counter = Counter()
    for tbl in raw_tables:
        for row in tbl:
            if row:
                col_counts[len(row)] += 1

    if not col_counts:
        return _no_tables(pages, "Tables found but all rows were empty.")

    dominant_n: int = col_counts.most_common(1)[0][0]

    # ── Collect rows, normalised to dominant_n columns ────────────────────
    headers: Optional[list[str]] = None
    all_data: list[list[str]] = []

    for tbl in raw_tables:
        normalised: list[list[str]] = []
        for row in tbl:
            cells = [_norm(c) for c in row]
            # Pad or truncate to the dominant column count
            cells = (cells + [""] * dominant_n)[:dominant_n]
            if any(cells):
                normalised.append(cells)

        if not normalised:
            continue

        if headers is None:
            # First non-empty row of the first qualifying table = header
            headers = normalised[0]
            data_slice = normalised[1:]
        else:
            # Skip repeat-header rows that some PDFs stamp on every page
            first = normalised[0]
            if first == headers or _looks_like_header(first):
                data_slice = normalised[1:]
            else:
                data_slice = normalised

        all_data.extend(r for r in data_slice if not _is_noise(r))

    if headers is None:
        return _no_tables(pages, "Could not identify a header row in the extracted tables.")

    if not all_data:
        return _no_tables(pages, "Tables were found but contained no usable data rows after filtering.")

    # ── Build list-of-dicts (same shape as CSV preview rows) ─────────────
    row_dicts: list[dict] = [dict(zip(headers, row)) for row in all_data]

    return {
        "status": "preview",
        "headers": headers,
        "rows": row_dicts,   # ALL rows — preview endpoint slices to MAX_PREVIEW_ROWS
        "pages": pages,
    }


# ── Public entry point ────────────────────────────────────────────────────────


def extract_pdf(content: bytes) -> dict:
    """Attempt to extract a transaction table from PDF bytes.

    Always returns a dict; never raises.
    """
    if not _PDFPLUMBER_OK:
        return _no_tables(
            0,
            "pdfplumber is not installed on this server. "
            "Run: pip install pdfplumber",
        )

    try:
        import pdfplumber  # local import so the module loads even without it

        with pdfplumber.open(io.BytesIO(content)) as pdf:
            pages = len(pdf.pages)
            return _run_extraction(pdf, pages)

    except Exception as exc:
        return _no_tables(0, f"Could not open or parse PDF: {exc}")


def extract_txt(content: bytes) -> dict:
    """Extract transactions from a plain-text bank statement (.txt).

    Decodes the file and runs the same line-based parser used as the PDF
    text-layout fallback.  Always returns a dict; never raises.
    """
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception as exc:
        return _no_tables(0, f"Could not read text file: {exc}")
    return _parse_text_lines(text.splitlines(), 0)
