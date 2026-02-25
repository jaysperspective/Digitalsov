#!/usr/bin/env python3
"""
PayPal CSV vs Bank Statement Cross-Reference Tool
==================================================
Files:
  PayPal CSVs : Download.CSV, Download-2.CSV
  Bank stmts  : 1654checking.txt, 1612checking.txt
"""

import csv
import re
import os
from datetime import datetime, timedelta
from collections import defaultdict

# ──────────────────────────────────────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────────────────────────────────────

PAYPAL_CSVS = [
    ("/Users/joshuaharrington/Downloads/Download.CSV",   "Download.CSV"),
    ("/Users/joshuaharrington/Downloads/Download-2.CSV", "Download-2.CSV"),
]
BANK_FILES = [
    ("/Users/joshuaharrington/Downloads/1654checking.txt", "1654checking"),
    ("/Users/joshuaharrington/Downloads/1612checking.txt", "1612checking"),
]

DATE_FMT = "%m/%d/%Y"

# Column indices (0-based)
COL_DATE          = 0
COL_TIME          = 1
COL_NAME          = 3
COL_TYPE          = 4
COL_STATUS        = 5
COL_CURRENCY      = 6
COL_GROSS         = 7
COL_FEE           = 8
COL_NET           = 9
COL_TXN_ID        = 12
COL_ITEM_TITLE    = 14
COL_SUBJECT       = 28
COL_BALANCE_IMPACT= 36

DIVIDER  = "=" * 90
SUBDIV   = "-" * 90
ARROW    = "  --> "


def sep(char="=", width=90):
    print(char * width)


def header(title):
    sep()
    print(f"  {title}")
    sep()


def subheader(title):
    print(f"\n{'-'*90}")
    print(f"  {title}")
    print(f"{'-'*90}")


def money(val):
    """Format a float as currency string with sign."""
    return f"${val:,.2f}"


def parse_amount(raw):
    """Strip commas/spaces and convert to float. Returns None on failure."""
    if raw is None:
        return None
    cleaned = raw.strip().replace(",", "")
    if cleaned == "" or cleaned == "-":
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_date(raw):
    """Parse MM/DD/YYYY -> datetime.date. Returns None on failure."""
    raw = raw.strip()
    try:
        return datetime.strptime(raw, DATE_FMT).date()
    except ValueError:
        return None


def amounts_match(a, b, tol=0.01):
    return abs(abs(a) - abs(b)) <= tol


def dates_match(d1, d2, window=1):
    return abs((d1 - d2).days) <= window


# ──────────────────────────────────────────────────────────────────────────────
# STEP 1 — PARSE PAYPAL CSVs
# ──────────────────────────────────────────────────────────────────────────────

def parse_paypal_csv(filepath, label):
    debits  = []
    credits = []
    skipped = 0

    with open(filepath, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for lineno, row in enumerate(reader, start=2):
            # Pad row so index access never throws
            while len(row) <= COL_BALANCE_IMPACT:
                row.append("")

            bi     = row[COL_BALANCE_IMPACT].strip()
            status = row[COL_STATUS].strip()
            txtype = row[COL_TYPE].strip()
            gross  = parse_amount(row[COL_GROSS])
            date   = parse_date(row[COL_DATE])

            if date is None or gross is None:
                skipped += 1
                continue

            record = {
                "date":       date,
                "time":       row[COL_TIME].strip(),
                "name":       row[COL_NAME].strip(),
                "type":       txtype,
                "status":     status,
                "gross":      gross,
                "fee":        parse_amount(row[COL_FEE]) or 0.0,
                "net":        parse_amount(row[COL_NET]) or 0.0,
                "txn_id":     row[COL_TXN_ID].strip(),
                "item_title": row[COL_ITEM_TITLE].strip(),
                "subject":    row[COL_SUBJECT].strip(),
                "bi":         bi,
                "source":     label,
                "lineno":     lineno,
            }

            # Money-OUT: Debit + Completed + negative gross
            if (bi == "Debit"
                    and status == "Completed"
                    and gross < 0):
                debits.append(record)

            # Money-IN: Credit + not a bank/card deposit
            elif (bi == "Credit"
                  and "Bank Deposit" not in txtype
                  and "General Card Deposit" not in txtype):
                credits.append(record)
            else:
                skipped += 1

    return debits, credits, skipped


all_debits  = []
all_credits = []

print()
header("STEP 1 — Parsing PayPal CSVs")

for path, label in PAYPAL_CSVS:
    d, c, sk = parse_paypal_csv(path, label)
    all_debits.extend(d)
    all_credits.extend(c)
    print(f"  {label:20s}  debits={len(d):4d}  credits={len(c):4d}  skipped={sk:4d}")

print(f"\n  TOTAL across both CSVs: {len(all_debits)} debit rows, {len(all_credits)} credit rows")


# ──────────────────────────────────────────────────────────────────────────────
# STEP 2 — PARSE BANK STATEMENTS
# ──────────────────────────────────────────────────────────────────────────────

DATE_RE = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+(.+)")

def parse_bank_statement(filepath, label):
    """
    Extract lines that:
      - start with a date token (MM/DD/YYYY)
      - contain 'paypal' (case-insensitive)
      - have a parseable amount as the second-to-last whitespace-separated token
    """
    entries = []
    with open(filepath, encoding="utf-8-sig") as f:
        for lineno, raw in enumerate(f, start=1):
            line = raw.rstrip()
            m = DATE_RE.match(line)
            if not m:
                continue
            if "paypal" not in line.lower():
                continue

            date_str = m.group(1)
            date     = parse_date(date_str)
            if date is None:
                continue

            tokens = line.split()
            if len(tokens) < 3:
                continue

            # Second-to-last token = amount, last token = running balance
            amt_raw = tokens[-2].replace(",", "")
            bal_raw = tokens[-1].replace(",", "")
            amount  = parse_amount(amt_raw)
            balance = parse_amount(bal_raw)

            if amount is None:
                continue

            entries.append({
                "date":    date,
                "raw":     line.strip(),
                "amount":  amount,
                "balance": balance,
                "source":  label,
                "lineno":  lineno,
            })

    return entries


all_bank = []

print()
header("STEP 2 — Parsing Bank Statements (PayPal lines only)")

for path, label in BANK_FILES:
    entries = parse_bank_statement(path, label)
    all_bank.extend(entries)
    print(f"  {label:20s}  PayPal lines found: {len(entries)}")

print(f"\n  TOTAL bank PayPal entries: {len(all_bank)}")


# ──────────────────────────────────────────────────────────────────────────────
# STEP 3 — CROSS-REFERENCE
# ──────────────────────────────────────────────────────────────────────────────

print()
header("STEP 3 — Cross-Reference")

# All PayPal transactions = debits + credits for matching purposes
all_paypal_txns = all_debits + all_credits

# --- Bank -> PayPal CSV matching (±1 day, ±$0.01) ---
for be in all_bank:
    matches = []
    for pt in all_paypal_txns:
        if (dates_match(be["date"], pt["date"], window=1)
                and amounts_match(be["amount"], pt["gross"])):
            matches.append(pt)
    be["matches"]  = matches
    be["matched"]  = len(matches) > 0

# --- PayPal CSV -> Bank matching (±2 days, ±$0.01) ---
for pt in all_paypal_txns:
    matches = []
    for be in all_bank:
        if (dates_match(pt["date"], be["date"], window=2)
                and amounts_match(pt["gross"], be["amount"])):
            matches.append(be)
    pt["bank_matches"] = matches
    pt["bank_matched"] = len(matches) > 0

bank_matched   = [e for e in all_bank         if e["matched"]]
bank_unmatched = [e for e in all_bank         if not e["matched"]]
pp_matched     = [t for t in all_paypal_txns  if t["bank_matched"]]
pp_unmatched   = [t for t in all_paypal_txns  if not t["bank_matched"]]

print(f"\n  Bank PayPal entries   MATCHED to CSV  : {len(bank_matched)}")
print(f"  Bank PayPal entries   UNMATCHED       : {len(bank_unmatched)}")
print(f"  PayPal CSV txns       MATCHED to bank : {len(pp_matched)}")
print(f"  PayPal CSV txns       UNMATCHED       : {len(pp_unmatched)}")


# ──────────────────────────────────────────────────────────────────────────────
# STEP 4 — DUPLICATE CHECK
# ──────────────────────────────────────────────────────────────────────────────

print()
header("STEP 4 — Duplicate Check Within & Across CSVs")

# 4A — Duplicate Transaction IDs
txn_id_map = defaultdict(list)
for t in all_paypal_txns:
    if t["txn_id"]:
        txn_id_map[t["txn_id"]].append(t)

dup_txn_ids = {tid: rows for tid, rows in txn_id_map.items() if len(rows) > 1}

# 4B — Same date+amount+name across both files
combo_map = defaultdict(list)
for t in all_paypal_txns:
    key = (t["date"], t["gross"], t["name"].lower())
    combo_map[key].append(t)

dup_combos = {k: v for k, v in combo_map.items() if len(v) > 1
              and len({r["source"] for r in v}) > 1}  # only flag cross-file

print(f"\n  Duplicate Transaction IDs (appearing >1 time): {len(dup_txn_ids)}")
print(f"  Duplicate date+amount+name across both CSVs  : {len(dup_combos)}")


# ──────────────────────────────────────────────────────────────────────────────
# STEP 5 — PRINT RESULTS
# ──────────────────────────────────────────────────────────────────────────────

# ── A) Summary ────────────────────────────────────────────────────────────────

print()
header("SECTION A — Summary of Both PayPal CSVs")

for label in [p[1] for p in PAYPAL_CSVS]:
    d_rows = [t for t in all_debits  if t["source"] == label]
    c_rows = [t for t in all_credits if t["source"] == label]
    all_rows = d_rows + c_rows

    if not all_rows:
        print(f"\n  {label}: no qualifying rows found.")
        continue

    dates     = [t["date"] for t in all_rows]
    d_total   = sum(t["gross"] for t in d_rows)
    c_total   = sum(t["gross"] for t in c_rows)

    print(f"\n  File    : {label}")
    print(f"  Debits  : {len(d_rows):4d} transactions   Total: {money(d_total)}")
    print(f"  Credits : {len(c_rows):4d} transactions   Total: {money(c_total)}")
    print(f"  Date range: {min(dates).strftime(DATE_FMT)}  to  {max(dates).strftime(DATE_FMT)}")

# Combined totals
if all_debits or all_credits:
    all_dates  = [t["date"] for t in all_debits + all_credits]
    tot_debit  = sum(t["gross"] for t in all_debits)
    tot_credit = sum(t["gross"] for t in all_credits)
    print(f"\n  {'─'*60}")
    print(f"  COMBINED TOTAL DEBITS  : {money(tot_debit)}")
    print(f"  COMBINED TOTAL CREDITS : {money(tot_credit)}")
    print(f"  NET                    : {money(tot_debit + tot_credit)}")
    print(f"  Overall date range     : {min(all_dates).strftime(DATE_FMT)}  to  {max(all_dates).strftime(DATE_FMT)}")


# ── B) PayPal CSV transactions NOT in any bank statement ─────────────────────

print()
header("SECTION B — PayPal CSV Transactions NOT Found in Any Bank Statement")
print("  (Paid via PayPal balance or linked credit card — no bank debit)\n")

# Only look at debits for this section — credits are incoming, irrelevant here
debit_unmatched = [t for t in all_debits if not t["bank_matched"]]

if not debit_unmatched:
    print("  None — all CSV debits were matched to a bank statement entry.")
else:
    debit_unmatched.sort(key=lambda t: t["date"])
    col_w = [12, 22, 10, 20, 12, 12]
    hdr   = f"  {'Date':<12} {'Name':<22} {'Gross':>10}  {'Type':<20} {'Source':<12} {'TxnID':<12}"
    print(hdr)
    print(f"  {'-'*88}")
    for t in debit_unmatched:
        vendor = (t["name"] or t["item_title"] or t["subject"] or "—")[:20]
        txtype = t["type"][:18]
        print(f"  {t['date'].strftime(DATE_FMT):<12} {vendor:<22} {money(t['gross']):>10}  "
              f"{txtype:<20} {t['source']:<12} {t['txn_id'][:14]}")
    print(f"\n  Total unmatched debit rows : {len(debit_unmatched)}")
    print(f"  Total unmatched debit amt  : {money(sum(t['gross'] for t in debit_unmatched))}")


# ── C) Bank entries NOT matched to any CSV transaction ────────────────────────

print()
header("SECTION C — Bank PayPal Entries NOT Matched to Any CSV Transaction")
print("  (Unexplained PayPal bank hits — possibly missing from exported date range)\n")

if not bank_unmatched:
    print("  None — all bank PayPal entries matched a CSV transaction.")
else:
    bank_unmatched.sort(key=lambda e: e["date"])
    print(f"  {'Date':<12} {'Amount':>10}  {'Balance':>12}  {'Source':<16}  Description")
    print(f"  {'-'*88}")
    for e in bank_unmatched:
        bal_str = money(e["balance"]) if e["balance"] is not None else "N/A"
        # Truncate the raw description
        desc = e["raw"]
        # Remove the date prefix and trim
        desc_clean = desc[10:].strip()[:60]
        print(f"  {e['date'].strftime(DATE_FMT):<12} {money(e['amount']):>10}  {bal_str:>12}  {e['source']:<16}  {desc_clean}")
    print(f"\n  Total unmatched bank PayPal entries : {len(bank_unmatched)}")
    print(f"  Total unmatched bank PayPal amount  : {money(sum(e['amount'] for e in bank_unmatched))}")


# ── D) Duplicate Transaction IDs ──────────────────────────────────────────────

print()
header("SECTION D — Duplicate Transaction IDs Across Both CSVs")

if not dup_txn_ids:
    print("\n  No duplicate Transaction IDs found.")
else:
    for tid, rows in sorted(dup_txn_ids.items()):
        print(f"\n  TxnID: {tid}  ({len(rows)} occurrences)")
        for r in rows:
            print(f"    {r['source']:<18} line {r['lineno']:>4}  "
                  f"{r['date'].strftime(DATE_FMT)}  {money(r['gross']):>10}  {r['name'][:30]}")

if not dup_combos:
    print("\n  No cross-file duplicate date+amount+name combos found.")
else:
    print(f"\n  Cross-file duplicate date+amount+name combos: {len(dup_combos)}")
    for (dt, amt, name), rows in sorted(dup_combos.items()):
        print(f"\n  {dt.strftime(DATE_FMT)}  {money(amt):>10}  {name}")
        for r in rows:
            print(f"    {r['source']:<18} line {r['lineno']:>4}  TxnID: {r['txn_id']}")


# ── E) Spending Breakdown by Merchant ─────────────────────────────────────────

print()
header("SECTION E — Full Spending Breakdown by Merchant / Vendor")
print("  (Debit transactions only, sorted by total amount spent DESC)\n")

merchant_totals = defaultdict(lambda: {"total": 0.0, "count": 0, "dates": []})

for t in all_debits:
    vendor = (t["name"] or t["item_title"] or t["subject"] or "UNKNOWN").strip()
    merchant_totals[vendor]["total"] += t["gross"]  # negative
    merchant_totals[vendor]["count"] += 1
    merchant_totals[vendor]["dates"].append(t["date"])

# Sort by absolute total descending (largest spend first)
sorted_merchants = sorted(
    merchant_totals.items(),
    key=lambda x: x[1]["total"]  # most negative first
)

print(f"  {'Vendor':<35} {'# Txns':>7}  {'Total Spent':>13}  {'Date Range'}")
print(f"  {'-'*88}")
for vendor, info in sorted_merchants:
    dates    = info["dates"]
    dr       = f"{min(dates).strftime(DATE_FMT)} – {max(dates).strftime(DATE_FMT)}" if len(dates) > 1 else min(dates).strftime(DATE_FMT)
    vendor_t = vendor[:33]
    print(f"  {vendor_t:<35} {info['count']:>7}  {money(info['total']):>13}  {dr}")

print(f"\n  {'-'*88}")
print(f"  {'GRAND TOTAL':<35} {len(all_debits):>7}  {money(sum(t['gross'] for t in all_debits)):>13}")


# ── F) Incoming PayPal Payments (Credits) ─────────────────────────────────────

print()
header("SECTION F — Incoming PayPal Payments (Money Received)")

if not all_credits:
    print("\n  No qualifying incoming payments found.")
else:
    all_credits.sort(key=lambda t: t["date"])
    print(f"\n  {'Date':<12} {'From / Name':<28} {'Gross':>10}  {'Type':<30}  {'Source'}")
    print(f"  {'-'*88}")
    for t in all_credits:
        sender = (t["name"] or t["subject"] or "—")[:26]
        txtype = t["type"][:28]
        print(f"  {t['date'].strftime(DATE_FMT):<12} {sender:<28} {money(t['gross']):>10}  "
              f"{txtype:<30}  {t['source']}")
    total_in = sum(t["gross"] for t in all_credits)
    print(f"\n  Total incoming payments : {len(all_credits)}")
    print(f"  Total amount received   : {money(total_in)}")


# ── Matched Bank Entries (bonus transparency) ──────────────────────────────────

print()
header("BONUS — Bank PayPal Entries Successfully Matched to a CSV Transaction")
print("  (Shows which bank hits were reconciled)\n")

if not bank_matched:
    print("  No bank entries were matched.")
else:
    bank_matched.sort(key=lambda e: e["date"])
    print(f"  {'Bank Date':<12} {'Bank Amt':>10}  {'Source':<16}  {'Matched CSV Txn Date':<14} {'CSV Gross':>10}  {'Vendor'}")
    print(f"  {'-'*88}")
    for e in bank_matched:
        for m in e["matches"][:1]:  # show first match
            vendor = (m["name"] or m["item_title"] or "—")[:25]
            print(f"  {e['date'].strftime(DATE_FMT):<12} {money(e['amount']):>10}  {e['source']:<16}  "
                  f"{m['date'].strftime(DATE_FMT):<14} {money(m['gross']):>10}  {vendor}")
    print(f"\n  Total matched bank entries: {len(bank_matched)}")


sep()
print("  Reconciliation complete.")
sep()
print()
