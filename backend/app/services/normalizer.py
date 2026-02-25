"""Normalization utilities shared across all import paths.

Covers:
  - Date parsing (12+ format variants, ISO fallback)
  - Amount parsing (single-column + debit/credit split)
  - Description → merchant-candidate extraction
  - SHA-256 fingerprinting for deduplication
"""

import decimal
import hashlib
import re
from datetime import datetime
from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# Date parsing
# ─────────────────────────────────────────────────────────────────────────────

_DATE_FORMATS = [
    "%m/%d/%Y",             # 01/15/2026
    "%Y-%m-%d",             # 2026-01-15
    "%d/%m/%Y",             # 15/01/2026
    "%m-%d-%Y",             # 01-15-2026
    "%d-%m-%Y",             # 15-01-2026
    "%Y/%m/%d",             # 2026/01/15
    "%m/%d/%y",             # 01/15/26
    "%d-%b-%Y",             # 15-Jan-2026
    "%d %b %Y",             # 15 Jan 2026
    "%b %d, %Y",            # Jan 15, 2026
    "%B %d, %Y",            # January 15, 2026
    "%Y-%m-%dT%H:%M:%S",    # 2026-01-15T12:00:00
    "%Y-%m-%dT%H:%M:%S.%f", # 2026-01-15T12:00:00.000000
]


def parse_date(value: str) -> str:
    """Return ISO date string YYYY-MM-DD; falls back to the raw value."""
    v = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return v  # unknown format — keep as-is so fingerprint is still stable


# ─────────────────────────────────────────────────────────────────────────────
# Amount parsing
# ─────────────────────────────────────────────────────────────────────────────

# Matches European thousands separator: 1.234,56
_EUROPEAN_RE = re.compile(r"^-?\d{1,3}(\.\d{3})*(,\d{1,2})$")


def parse_amount(value: str) -> float:
    """Parse a single amount cell.

    Handles:
      42.99  |  -42.99  |  (42.99)  |  $1,234.56
      £1.234,56 (European)  |  1 234.56 (space thousands)
    """
    v = value.strip()
    if not v:
        raise ValueError("empty amount string")

    negative = v.startswith("(") and v.endswith(")")
    if negative:
        v = v[1:-1]

    # Strip currency symbols
    v = v.lstrip("$€£¥₹").strip()

    # Remove spaces used as thousands separators: "1 234.56" → "1234.56"
    v = v.replace(" ", "")

    # European format "1.234,56" → "1234.56"
    if _EUROPEAN_RE.match(v):
        v = v.replace(".", "").replace(",", ".")
    else:
        # Remove comma-thousands separators before decimal point
        v = re.sub(r",(?=\d{3}(?:[,.]|$))", "", v)
        v = v.replace(",", ".")  # stray comma → decimal

    amount = float(v)
    return -amount if negative else amount


def parse_split_amount(debit_val: str, credit_val: str) -> float:
    """Interpret separate debit (outflow) and credit (inflow) columns.

    Rules:
    - Debit-only   → stored as negative (money left the account)
    - Credit-only  → stored as positive (money entered the account)
    - Both present → net = credit − debit
    - Both empty   → raises ValueError

    Banks typically place only one non-zero value per row; the other is blank
    or explicitly zero.
    """
    _ZERO = {"", "0", "0.0", "0.00", "-0", "-0.0", "-0.00"}

    d_str = debit_val.strip()
    c_str = credit_val.strip()

    debit: Optional[float] = None
    credit: Optional[float] = None

    if d_str not in _ZERO:
        try:
            debit = abs(parse_amount(d_str))
        except ValueError:
            pass

    if c_str not in _ZERO:
        try:
            credit = abs(parse_amount(c_str))
        except ValueError:
            pass

    if debit is not None and credit is not None:
        return credit - debit   # net flow
    if credit is not None:
        return credit           # inflow → positive
    if debit is not None:
        return -debit           # outflow → negative
    raise ValueError(f"no valid amount in debit={d_str!r} credit={c_str!r}")


def to_cents(amount: float) -> int:
    """Convert float dollars to integer cents (ROUND_HALF_UP)."""
    return int(
        (decimal.Decimal(str(amount)) * 100).quantize(
            decimal.Decimal("1"), rounding=decimal.ROUND_HALF_UP
        )
    )


# ─────────────────────────────────────────────────────────────────────────────
# Description → merchant-candidate extraction
# ─────────────────────────────────────────────────────────────────────────────

# Common bank / payment-network prefixes that add zero merchant signal.
# Ordered longest-first to avoid partial shadowing.
_PREFIX_RE = re.compile(
    r"^(?:"
    r"ONLINE (?:PAYMENT|PURCHASE|TRANSFER|BANKING TRANSFER)\s*[-–]?\s*|"
    r"DEBIT CARD (?:PURCHASE|PAYMENT)\s+|"
    r"DEBIT (?:CARD\s+)?PURCHASE\s+|"
    r"DEBIT PURCHASE\s+|"
    r"RECURRING (?:CHARGE|PAYMENT|PMT)\s+|"
    r"BILL PAYMENT\s+|"
    r"POS (?:PURCHASE|DEBIT|PMT|REFUND)?\s*|"
    r"ACH (?:DEBIT|CREDIT|PMT|PAYMENT|TRANSFER)?\s*|"
    r"WIRE (?:TRANSFER|PMT)\s+|"
    r"CHECK (?:CARD\s+)?PURCHASE\s+|"
    r"TST\s*\*\s*|"         # Toast POS
    r"SQ\s*\*\s*|"          # Square
    r"PP\s*\*\s*|"          # PayPal short
    r"PAYPAL\s*\*?\s*|"
    r"VENMO\s*\*?\s*|"
    r"APPLE\.COM/BILL\s+|"
    r"GOOGLE\s+PLAY\s+|"    # Google Play billing
    r"AMZN\s+MKTP\s+|"      # Amazon marketplace
    r"AMZN\s*\*\s*"
    r")",
    re.IGNORECASE,
)

# Trailing noise patterns (applied in order until stable)
_TRAILING = [
    re.compile(r"\s+\d{2}/\d{2}(?:/\d{2,4})?$"),           # 07/15  or 07/15/24
    re.compile(r"\s+\d{2}-\d{2}(?:-\d{2,4})?$"),           # 07-15  or 07-15-24
    re.compile(r"\s+#\w[\w\-]*(?:\s.*)?$"),                 # #12345 receipt / ref
    re.compile(r"\s+REF\s*#?\w+$", re.IGNORECASE),         # REF 123456
    re.compile(r"\s+TXN\s*#?\w*$", re.IGNORECASE),         # TXN or TXN#id
    re.compile(r"\s+PMT$", re.IGNORECASE),                  # trailing PMT
    re.compile(r"\s+\d{6,}$"),                              # long digit ref
    re.compile(r"\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?$"),        # State ZIP: CA 94102
    re.compile(r"\s+[A-Z]{2}$"),                            # trailing 2-letter state
]


def _strip_trailing_noise(s: str) -> str:
    """Repeatedly apply trailing-noise patterns until the string stabilises."""
    prev = None
    while prev != s:
        prev = s
        for pat in _TRAILING:
            s = pat.sub("", s)
    return s.strip().rstrip("*#").strip()


def extract_merchant_candidate(raw: str) -> str:
    """Return a clean, title-cased merchant name from a raw bank description.

    Examples
    --------
    "AMAZON.COM*1Z8Q4K AMZN.COM/BILL"      → "Amazon.Com"
    "STARBUCKS #12345 SAN FRANCISCO CA"     → "Starbucks"
    "SQ *LOCAL COFFEE SHOP SF CA"           → "Local Coffee Shop"
    "ACH DEBIT NETFLIX.COM"                 → "Netflix.Com"
    "GOOGLE *CLOUD"                         → "Google Cloud"
    "LYFT *RIDE 01-20 TXN"                  → "Lyft Ride"
    "PAYROLL DEPOSIT - ACME CORP"           → "Payroll Deposit - Acme Corp"
    """
    s = raw.strip()
    if not s:
        return s

    # 1. Strip bank-added prefixes
    s = _PREFIX_RE.sub("", s).strip()

    # 2. Handle '*' separator between brand and product/ref-code.
    #
    #   Strategy: inspect the FIRST TOKEN after '*'.
    #   - Has digits → ref-code (e.g. 1Z8Q4K, 01-20)  → discard everything after '*'
    #   - All alpha, ≤ 20 chars → product/plan name    → keep as "BRAND PRODUCT"
    #   - Multiple alpha words                          → keep full after part
    if "*" in s:
        before, _, after = s.partition("*")
        before = before.strip()
        after = after.strip()
        first_token = after.split()[0] if after else ""

        if not after or re.search(r"\d", first_token):
            # Ref code in first position → keep only the brand
            s = before
        elif " " not in after and len(after) <= 20:
            # Single short word → product/plan name
            s = f"{before} {after}"
        elif " " in after and not re.search(r"\d", first_token):
            # Multiple words, first is clean → keep both brand and description
            s = f"{before} {after}"
        else:
            s = before

    # 3. Strip trailing noise (dates, refs, states, zip codes …)
    s = _strip_trailing_noise(s)

    # 4. Collapse internal whitespace
    s = re.sub(r"\s+", " ", s).strip()

    # 5. Title-case
    if s:
        s = s.title()

    return s if s else raw.strip()


def normalize_description(raw: str) -> str:
    """Lowercase + collapsed whitespace for the `description_norm` search field."""
    return re.sub(r"\s+", " ", raw.lower().strip())


# ─────────────────────────────────────────────────────────────────────────────
# Hashing
# ─────────────────────────────────────────────────────────────────────────────


def compute_file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_fingerprint(posted_date: str, description_raw: str, amount: float) -> str:
    """Stable cross-import deduplication hash.

    Uses the raw description (not normalised) so that minor normalisation
    changes don't create phantom duplicates.
    """
    canonical = f"{posted_date}|{description_raw.strip()}|{amount:.4f}"
    return hashlib.sha256(canonical.encode()).hexdigest()
