---
name: costar-saved-search
description: >-
  Process a CoStar saved-search export for Adana deal sourcing: read the
  spreadsheet the user exported into the project folder, screen the listings
  against the FAR / PLSF / PSFB land-vs-building criteria (via the gateway),
  persist the deduped properties and their broker/owner contacts, and write back
  a qualification for each. The user runs the CoStar export themselves; this skill
  takes over from the file. Use this whenever the user names one of their CoStar
  saved searches (e.g. "Hamptons IOS", "NEW PRODUCT", "Montana", "IOS For Sale
  Southeast") and asks to run, pull, process, refresh or screen it — including
  casually, like "run Montana through CoStar" or "I've dropped the export in, take
  it from here".
allowed-tools: mcp__gateway__adana_screen_costar mcp__gateway__adana_ingest_costar_export mcp__gateway__adana_targets_needing_qualification mcp__gateway__adana_save_qualification
area: Collection
use_for: "Process a CoStar export the user has placed in the project folder: map all 39 columns, screen it (FAR/PLSF/PSFB via gateway), persist deduped properties + contacts, then score every priced property the gateway kept from the stated rubric — draining the backlog until it returns empty."
deps:
  mcp: []
  gateway: ["adana_screen_costar", "adana_ingest_costar_export", "adana_targets_needing_qualification", "adana_save_qualification"]
  files: ["exports/CostarExport*.xlsx (read)"]
  env: ["gateway_api_key", "ADANA_EXPORT_DIR"]
---

# CoStar export → screen → ingest → qualify

**The user exports from CoStar; this skill starts at the file.** No browser, no
login, no automation of CoStar's UI — the spreadsheet in `exports/` is the
interface between their half and yours.

Everything is persisted through the **gateway** MCP. The export file is a working
artifact; the gateway is the record.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- A **fresh CoStar export** in the project's `exports/` folder
  (`$ADANA_EXPORT_DIR`, default `exports/`), produced with the **Industrial saved
  layout**. Step 1 walks the user through it.
- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's
  **Credential Loading** section before the first `adana_*` call. Scheduled runs
  do not inject it automatically.

## Step 1 — Get the export

If the user has already exported and said so, go to Step 2. Otherwise give them
the recipe. **The layout choice is the part that matters**: the wrong one produces
a file that looks fine but is missing the columns everything downstream needs.

> In CoStar:
> 1. **Properties → All Properties**, then **Save → OPEN SAVED SEARCH** and pick your saved search. Let the count settle — it can flash something like "17,001" mid-load, which isn't the real number.
> 2. **More → Export**.
> 3. Under **Selected Field Layout**, scroll past "PRE-DEFINED LAYOUTS" to the separate **"SAVED LAYOUTS"** section and choose **Industrial** from *there*. Not the pre-defined Industrial — they are different layouts, and only the saved one carries For Sale Price, RBA, Land Area (AC) and the contact columns.
> 4. Leave **File type** as "Microsoft Excel File" and click **Export**.
> 5. Put the file in this project's **`exports/`** folder and tell me.

If their browser already downloads to `exports/` (`/adana-dsa:adana-setup` Step 5),
the last step happens on its own.

**You need the saved-search name** for the `location` argument at ingest, and the
file doesn't record it. Ask when running interactively. On a scheduled run there
is nobody to ask, so infer it from the filename if the user names their exports,
and otherwise pass the best label you have — `location` is a reporting label, not
a key, so an imperfect one is far better than skipping the ingest.

### Find what's new

The user drops exports into `exports/` whenever they like, and this skill runs on
a schedule as well as on request — so the question is never "is this file recent?"
but **"have I already processed it?"**. Nothing is deleted from `exports/`, so
that has to be tracked explicitly.

```python
import glob, json, os, datetime

export_dir = os.environ.get("ADANA_EXPORT_DIR", "exports")
marker = os.path.join(export_dir, ".processed.json")

seen = {}
if os.path.exists(marker):
    with open(marker, encoding="utf-8") as f:
        seen = json.load(f)          # {filename: mtime_when_processed}

files = sorted(glob.glob(os.path.join(export_dir, "CostarExport*.xlsx")),
               key=os.path.getmtime)
todo = [f for f in files
        if seen.get(os.path.basename(f)) != os.path.getmtime(f)]

for f in files:
    mark = "NEW" if f in todo else "done"
    age_h = (datetime.datetime.now().timestamp() - os.path.getmtime(f)) / 3600
    print(f"  [{mark:4}] {os.path.basename(f)} — {age_h:.1f}h old")
print(f"{len(todo)} export(s) to process, {len(files) - len(todo)} already done")
```

**If `todo` is empty, stop and say so.** On a scheduled run that is the normal
outcome for any week the user hasn't exported — report it plainly and exit. Do not
reprocess the newest file to have something to do: re-ingesting last week's export
produces a run that looks clean and collected nothing.

**Process each new file separately**, oldest first, each with its own `location`.
Several exports can accumulate between runs — different saved searches, or a
re-export after a correction — and merging them loses which search found what.

Comparing the stored **mtime** rather than just the name matters: a re-export
usually arrives with the same filename, and treating it as already-done would
silently skip the corrected file.

**Record it only after a successful ingest** (Step 4), never before — a run that
fails midway must be retried, not marked done:

```python
seen[os.path.basename(path)] = os.path.getmtime(path)
with open(marker, "w", encoding="utf-8") as f:
    json.dump(seen, f, indent=2)
```

When running interactively and something looks off — the only file present is
weeks old, or the user says they exported but nothing is new — say what you see
and ask, rather than guessing.

## Step 2 — Read the export into rows

Build one row per listing from the **raw** columns. Do **not** compute FAR, PSFB
or PLSF — the gateway derives them.

Do this once per file in `todo`, oldest first.

```python
import datetime, openpyxl

ws = openpyxl.load_workbook(path, data_only=True).active   # `path` = the file from Step 1
rows = list(ws.iter_rows(values_only=True))
if len(rows) < 2:
    raise SystemExit("Export has only a header — the saved search returned nothing.")

header = rows[0]
idx = {name: i for i, name in enumerate(header) if name}
print(list(idx))          # always inspect the real header before mapping

def cell(r, col):
    i = idx.get(col)
    return r[i] if i is not None else None

def phone_str(v):
    """Excel returns phone columns as numbers — 7702998083 (int) or
    7702998083.0 (float). str() on the float gives '7702998083.0', which is not a
    phone number. Normalise to digits, then E.164, so every row stores one shape."""
    if v is None or str(v).strip() == "":
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    digits = "".join(ch for ch in str(v) if ch.isdigit())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return str(v).strip() or None      # unparseable: keep it rather than lose it

def split_name(n):
    """'Frank Martone' -> ('Frank', 'Martone'). Suffixes stay on the last name."""
    parts = str(n or "").split()
    if not parts:
        return (None, None)
    return (parts[0], " ".join(parts[1:])) if len(parts) > 1 else (parts[0], None)

def excel_date(v):
    """CoStar ships `Last Sale Date` as an Excel serial, not a date: 41716 is
    2014-03-18. Sending the raw number stores a five-digit integer in a date
    column. openpyxl usually converts it for you, but not always — depends on the
    cell's number format — so handle both shapes."""
    if v is None or str(v).strip() == "":
        return None
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    try:
        serial = int(float(v))
    except (TypeError, ValueError):
        return None
    # Excel's epoch is 1899-12-30 (the 1900 leap-year bug is baked in).
    return (datetime.date(1899, 12, 30) + datetime.timedelta(days=serial)).isoformat()

def num(v):
    """A numeric cell, or None. Blanks arrive as '' or None depending on the cell."""
    if v is None or str(v).strip() == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

# Discover email columns from the real header — layouts are configurable, so never
# assume they're absent. An email outranks a phone: it's the outreach channel.
EMAIL_COLS   = [c for c in idx if "email" in str(c).lower()]
BROKER_EMAIL = [c for c in EMAIL_COLS
                if any(h in str(c).lower() for h in ("sale", "broker", "listing", "agent"))]
OWNER_EMAIL  = [c for c in EMAIL_COLS if "owner" in str(c).lower()]
OTHER_EMAIL  = [c for c in EMAIL_COLS if c not in BROKER_EMAIL and c not in OWNER_EMAIL]
print(f"email columns found: {EMAIL_COLS or 'none in this layout'}")

def first_val(r, cols):
    for c in cols:
        v = cell(r, c)
        if v is not None and str(v).strip():
            return str(v).strip()
    return None

def contact_for(r):
    """The listing broker if the export gives a way to reach one, else the owner.

    Reachable means an email OR a phone — either is enough. One contact per
    listing: the gateway keys contacts on (property_id, email) with NULLS NOT
    DISTINCT, so a property holds only ONE contact that has no email."""
    sales       = cell(r, "Sales Contact")
    sales_email = first_val(r, BROKER_EMAIL) or first_val(r, OTHER_EMAIL)
    sales_phone = phone_str(cell(r, "Sales Contact Phone"))
    if sales and (sales_email or sales_phone):
        first, last = split_name(sales)
        return {"first_name": first, "last_name": last, "email": sales_email,
                "mobile": sales_phone, "title": "Listing broker", "contact_type": "broker"}

    owner_email = first_val(r, OWNER_EMAIL)
    owner_phone = phone_str(cell(r, "True Owner Phone"))
    if owner_email or owner_phone:
        first, last = split_name(cell(r, "True Owner Contact"))
        c = {"email": owner_email, "mobile": owner_phone,
             "title": "Owner", "contact_type": "owner"}
        if first:
            c["first_name"], c["last_name"] = first, last
        if cell(r, "True Owner Name"):
            c["company"] = cell(r, "True Owner Name")
        return c
    return None

def clean(d):
    """ingest's schema is `.optional()`: it accepts a MISSING key but rejects an
    explicit null. Strip empties rather than passing them through."""
    return {k: v for k, v in d.items() if v is not None and str(v).strip() != ""}

# Columns the layout carries that nothing reads yet. Kept verbatim rather than
# dropped — this whole mapping exists because 31 of 39 columns were being read
# out of the file and thrown away on every run.
KEEP_RAW = ["Submarket Cluster", "For Sale Status", "Rent/SF/Yr",
            "Total Available Space (SF)", "Property Name", "Year Renovated"]

listings, skipped = [], 0
for r in rows[1:]:
    l = clean({
        "address_raw":    cell(r, "Property Address"),
        "city":           cell(r, "City"),
        "state":          cell(r, "State"),
        "zip":            cell(r, "Zip"),
        "property_type":  cell(r, "Secondary Type"),   # NOT "Property Type" — see below
        "asking_price":   cell(r, "For Sale Price"),   # blank => no-price listing
        "building_sf":    cell(r, "RBA"),
        "lot_size_acres": cell(r, "Land Area (AC)"),

        # CoStar detail. lat/long are what make transport-proximity checks
        # possible at all — they were in every export and captured by nothing.
        "latitude":        num(cell(r, "Latitude")),
        "longitude":       num(cell(r, "Longitude")),
        "submarket":       cell(r, "Submarket Name"),
        "market":          cell(r, "Market Name"),
        "days_on_market":  num(cell(r, "Days On Market")),
        "year_built":      num(cell(r, "Year Built")),
        "tenancy":         cell(r, "Tenancy"),
        "percent_leased":  num(cell(r, "Percent Leased")),   # 100 == 100%
        "parking_ratio":   num(cell(r, "Parking Ratio")),
        "last_sale_date":  excel_date(cell(r, "Last Sale Date")),
        "last_sale_price": num(cell(r, "Last Sale Price")),
        "cap_rate":        num(cell(r, "Cap Rate")),         # 8 == 8%
    })
    if not l.get("address_raw"):        # the dedup key — unusable without it
        skipped += 1
        continue
    raw = clean({k: cell(r, k) for k in KEEP_RAW})
    if raw:
        l["source_attributes"] = raw
    c = contact_for(r)
    if c:
        l["broker"] = clean(c)
    listings.append(l)

with_contact = sum(1 for l in listings if l.get("broker"))
with_email   = sum(1 for l in listings if l.get("broker", {}).get("email"))
with_geo     = sum(1 for l in listings if l.get("latitude") is not None)
with_type    = sum(1 for l in listings if l.get("property_type"))
pct = lambda n: 100 * n / len(listings) if listings else 0
print(f"{len(listings)} listings, {with_contact} with a contact "
      f"({with_email} of them with an email), {skipped} skipped (no address)")
print(f"geo {pct(with_geo):.0f}% (expect ~100), type {pct(with_type):.0f}% (expect ~89)")
```

**Check those last two percentages before going any further** — as rates, not raw
counts, so the check means the same thing on a 20-row export and a 500-row one.
Anything far below expectation is a mapping failure, not a thin export:

- **geo well under 100%** — the `Latitude` / `Longitude` columns are absent, which
  means the wrong layout was used. Ask for a re-export rather than proceeding.
- **type well under 89%** — the header calls the column something other than
  `Secondary Type`. Read the printed header and map what is actually there.
  Shipping nulls here is not a small loss: `property_type` is a scored component
  in Step 5, so every null quietly removes part of the score.

A zero on either is the failure this whole mapping exists to prevent, and it is
invisible downstream — the ingest returns a clean count either way.

**Keep `with_contact`** — Step 4 checks the gateway's `contacts` count against it.

### What the layout actually contains

**All 39 columns, with fill rates** measured across three real exports (489 / 25 /
20 rows, Aug 2026 — a guide, not a spec). This table exists because for months
the skill documented only the contact block, and **31 of the 39 columns were read
out of the spreadsheet and discarded on every single run** — including latitude
and longitude, which the design doc simultaneously listed as blocking the
transport-proximity work for want of geo data.

| Column | Fill | Mapped to |
|---|---|---|
| `Property Address` | 100% | `address_raw` — the dedup key |
| `City` / `State` / `Zip` | 100% | as-is |
| `RBA` | 100% | `building_sf` |
| `Land Area (AC)` | 100% | `lot_size_acres` — **gross, not usable** |
| `For Sale Price` | 62% | `asking_price`; blank ⇒ no-price listing (flow3) |
| `Latitude` / `Longitude` | 100% | `latitude` / `longitude` |
| `Secondary Type` | 89% | `property_type` — **not** `Property Type` |
| `Submarket Name` | 100% | `submarket` |
| `Market Name` | 100% | `market` |
| `Days On Market` | 100% | `days_on_market` — 1–709 days, 296 distinct |
| `Year Built` | 100% | `year_built` |
| `Tenancy` | 92% | `tenancy` — Single / Multi |
| `Percent Leased` | 85% | `percent_leased` — points, 100 = 100% |
| `Parking Ratio` | 77% | `parking_ratio` |
| `Last Sale Date` | 56% | `last_sale_date` — **Excel serial**, convert |
| `Last Sale Price` | 49% | `last_sale_price` |
| `Cap Rate` | 11% | `cap_rate` — points, 8 = 8% |
| `Submarket Cluster`, `For Sale Status`, `Rent/SF/Yr`, `Total Available Space (SF)`, `Property Name`, `Year Renovated` | varies | `source_attributes` verbatim |
| the contact block | see below | `broker{}` |

**`Land Area (AC)` is gross acreage.** The market underwrites IOS on *usable*
acres, which CoStar does not publish — it comes from survey, zoning setbacks and
wetlands during diligence. Screening on gross is what everyone does at this
stage; just don't report it as usable.

### The contact columns

The contact block is easy to miss, because none of the names say "broker":

| Column | What it is | Filled |
|---|---|---|
| `Sales Contact` | the listing broker's name | ~83% |
| `Sales Contact Phone` | that broker's phone | ~83% |
| `Sale Company Contact` | duplicate of `Sales Contact` — ignore | ~83% |
| `True Owner Name` | the owning entity (company / trust) | ~71% |
| `True Owner Contact` | a person at the owner | ~47% |
| `True Owner Phone` | the owner's phone | ~66% |
| `Leasing Company Name` / `Contact` | leasing agent, not the seller — ignore | ~30% |

**Read these columns. Never go looking elsewhere for something the spreadsheet
already contains** — including a listing's brochure. A run that ignored this block
discarded 485 broker phone numbers that were sitting in the file.

**Check whether the layout carries email.** That sample had none, but that is a
fact about one saved layout, not about CoStar. The code discovers email columns
from the header and prefers an email when it finds one. If it prints
`email columns found: none in this layout` and you expected otherwise, say so:
adding an email field to the saved layout is the highest-value change available to
this pipeline, because email is the outreach channel.

### Mapping notes

- `For Sale Price` → `asking_price`, `RBA` → `building_sf`, `Land Area (AC)` →
  `lot_size_acres`. Without RBA **and** acres the gateway cannot derive FAR and the
  row can't be screened.
- If `RBA` or `Land Area (AC)` is missing entirely, the **wrong layout** was used —
  almost always the pre-defined Industrial instead of the saved one.
- `adana_screen_costar` takes **`address`**; `adana_ingest_costar_export` takes
  **`address_raw`**. Different schemas — map separately for each call.
- `screen` accepts `null`; `ingest` does **not**. That's what `clean()` is for.

**Five formats that will silently produce wrong data if you take the cell at face
value.** Each was verified against real exports:

1. **`Last Sale Date` is an Excel serial** — `41716` is 2014-03-18, not the year
   41716. Values span 1996–2026. `excel_date()` handles it; sending the raw
   number writes a five-digit integer into a date column.
2. **`Cap Rate` and `Percent Leased` are percentage points**, not fractions. `8`
   means 8%; `100` means 100%. Do not divide by 100 — the columns are documented
   as points on the gateway side too.
3. **`Rent/SF/Yr` is a range string**, not a number — `"$11.78 - 14.39 (Est.)"`.
   It goes to `source_attributes` as text. Never coerce it.
4. **`True Owner City State Zip` is one combined field** —
   `"Lilburn, GA 30047-3497"`. Split it only if you need the parts.
5. **`Sale Company Contact` duplicates `Sales Contact`** (identical fill, 412/489).
   Ignore it; it is not a second person.

**The `Property Type` trap.** This layout has **`Secondary Type`**, and no column
named `Property Type` at all. Mapping the latter returned `None` on every row for
months, leaving 1,300 of 1,760 stored properties with no type and an index on
`(state, property_type)` that could never be used. The values are `Warehouse`,
`Manufacturing`, `Distribution`, `Truck Terminal`, `Service`, `Showroom`,
`Refrigeration/Cold Storage` and similar — and the scoring rubric in Step 5 reads
them, so a null here costs a real component of the score.

## Step 3 — Screen (the gateway derives the ratios)

```
adana_screen_costar(
  gateway_api_key: "${GATEWAY_API_KEY}",
  rows: [ { address, city, asking_price, building_sf, lot_size_acres }, ... ]
)
```

The gateway derives FAR / PLSF / PSFB and applies the land-vs-building bands
(FAR < 10% → PLSF < $17; 10–18% → PLSF < $23; > 18% → PSFB < $120) and dedupes by
address + city.

**Every row lands in exactly one bucket**, and `summary.accounted_for` must equal
`summary.total`:

| Bucket | Meaning |
|---|---|
| `qualifiers` | under the ceiling |
| `near_misses` | within 10% above it |
| `screened_out` | past that — looked at and rejected |
| `no_price` | the source has no price. Expected, not an error — flow3 |
| `incomplete` | **you didn't send enough columns to screen a PRICED row** |

**`incomplete` is your bug, and it is the one to act on.** Each entry names the
missing columns. The Industrial saved layout carries RBA and Land Area (AC) on
every row, so a gap means the mapping dropped them — go back to Step 2, fix it,
and re-screen. Do not proceed with rows in `incomplete`.

`no_price` is the opposite: a fact about the listing that no retry changes. Never
treat it as an error and never try to "fix" it by resending.

Present this **in chat**: name the qualifiers with their FAR band and the metric
that cleared, call out near-misses, give the counts for screened-out and no-price.
Don't restate every property.

Screening is **advisory here** — it tells you what the price says. It does not
decide what gets stored; the gateway re-runs this same screen itself at ingest.

## Step 4 — Ingest (persist via gateway)

Send the `listings` list from Step 2 — priced and no-price together, contacts
already attached:

```
adana_ingest_costar_export(
  gateway_api_key: "${GATEWAY_API_KEY}",
  location: "<saved search name>",
  listings: [ { address_raw, city, state, zip, property_type, building_sf,
                lot_size_acres, asking_price,
                latitude, longitude, submarket, market, days_on_market,
                year_built, tenancy, percent_leased, parking_ratio,
                last_sale_date, last_sale_price, cap_rate, source_attributes,
                broker: { first_name, last_name, email, mobile, company, title, contact_type } }, ... ]
)
```

**Send the whole `listings` list exactly as Step 2 built it.** The gateway accepts
every field above, and the detail block is the reason Step 2 maps 21 columns
instead of 8 — trimming back to the property block here would put the columns
straight back in the bin they were just rescued from. `property_type` must be the
`Secondary Type` value; `last_sale_date` an ISO date, never the Excel serial;
`cap_rate` and `percent_leased` percentage points, never fractions.

On the `broker` object:

- **Send whichever of `email` / `mobile` the export gave you.** The gateway stores
  a contact on either, and a phone-only broker is a real contact — that is the
  usual shape from CoStar, not a degraded one. Omit a field rather than sending
  `""` or `null`.
- **`contact_type`** is `broker` or `owner`; `contact_for()` sets it. It defaults to
  `broker`, which mislabels an owner row if omitted.
- `source_url` / `brochure_url` / `external_id` are accepted, but this layout
  carries none of them — omit rather than invent.

The gateway UPSERTs properties (dedup on normalized address), records a
`property_sources` row per listing, UPSERTs the contact, **screens every row**
and decides what to keep. Relay `{run_id, found, new, updated, contacts,
emailable, kept, rejected, incomplete}`.

**Rejection is normal — expect roughly a quarter of an export.** `rejected`
breaks down by reason, and each means something different:

- **`fails_screen`** — priced above the buy-box ceiling. The permanent verdict.
- **`no_yield_shape`** — no price, and a site shape that has never produced a
  deal (high coverage on real acreage, or anything non-land-play under 2 acres).
- **`no_contact`** — nobody attached, so no enrichment can ever reach it. A later
  export carrying broker columns revives it.

**`incomplete` is NOT normal.** Same meaning as in Step 3: priced rows you sent
without the columns needed to screen them. The gateway deliberately leaves their
existing verdict untouched rather than overwriting it with a guess. Re-read those
rows from the export and call ingest again with the missing columns.

What is kept lands in **`sourced`** — screened, kept, and waiting for your read.
The exception is a no-price listing whose site shape justifies a broker call:
that goes straight onto the enrichment queue, because it can never earn a place
there by being scored.

**Compare `contacts` to `with_contact` from Step 2.** If Step 2 found 485 contacts
and ingest returns `contacts: 0`, the broker objects didn't survive the mapping —
stop and fix it rather than reporting a clean run. A silent zero here is exactly
how 485 contacts were lost once.

A contact with a phone but no email keeps `enrichment_status: pending`. It does
**not** automatically join the enrichment work list: that list is a queue a
property earns, and most of these are still sitting in `sourced` waiting for the
score you are about to give them in Step 5. Skip Step 5 and they wait for ever.

**Mark the file processed only now**, using the snippet from Step 1, and only if
the ingest succeeded. Marking earlier means a run that fails midway is never
retried — the file looks done and its listings are silently lost.

If more files remain in `todo`, go back to Step 2 with the next one.

## Step 5 — Qualify and write back

Two different things happen here, and conflating them is what went wrong before:

- **The `score` is COMPUTED** from the rubric below. It is arithmetic on data you
  already have. The same property scores the same every run, by anyone.
- **The `checks` and the `why` are YOURS** — the strategic read of the site, from
  the CoStar row and the map, which the gateway cannot see.

The score used to be described only as "your conviction, 1–10", with no rubric
anywhere. What happened is instructive: a consistent rule got invented and applied
to 684 properties without anyone specifying it, and under that rule 8, 9 and 10
were arithmetically unreachable — a ten-point scale that only ever produced three
to seven. The rubric replaces guesswork with a stated calculation.

### Ask the gateway what needs scoring — do not work from memory

```
adana_targets_needing_qualification(gateway_api_key: "${GATEWAY_API_KEY}", limit: 40)
```

Returns properties the gateway **kept but nobody has scored**, oldest first, with
the raw columns you need and each row's `source_variant`. The response includes
`more_likely`, which is true when the batch came back full — so you can tell
"batch was capped" from "that was the last of them".

This loop is the point. Working from the Step 3 screen result instead is what
went wrong before: the screen only ever hands you `qualifiers` and `near_misses`,
so "score everything I ingested" silently meant "score everything the screen
surfaced". **466 properties reached the database with no assessment against them
at all**, indistinguishable from ones nobody had reached yet — and because
nothing ever asked what was left over, they stayed that way. The work list is a
question you ask the gateway, not a list you keep in your head.

It also survives a session ending mid-batch, which the old approach did not.

**Keep calling until it returns empty**, which since gateway v2.8.1 it can.
Every row you get back is one to score.

No-price listings are no longer in it. The gateway filters `costar_no_price` out
and returns the count separately as **`no_price_pending`** — report that number,
never work it. Before v2.8.1 they were included, and since the skill is forbidden
to score them the loop could not terminate: measured against production, **all 555
rows in the backlog were no-price and not one was scorable**. The tool was handing
back a work list made entirely of work that had to be refused.

One kind of row still legitimately reappears: **a priced row that came back
`incomplete` at ingest**. It was stored without RBA or acreage, so the screen
never ran, `criteria_notes` carries no verdict, and there is no Basis, Coverage or
Size to compute. **Don't score it and don't guess** — re-send it through Step 4
with the missing columns. It stays in the backlog until they arrive, which is the
system telling you the truth rather than a loop to break.

### The scoring rubric

**Every band below is lower-bound inclusive, upper-bound exclusive** — `[lo, hi)`.
A ratio of exactly 60% scores in the 60–70 row, not the 50–60 one; a site of
exactly 5.0 acres scores in the 5–10 row, not 3–5. State it once and the rubric
is deterministic; leave it implicit and two runs disagree on the boundaries,
which is the whole failure this rubric exists to end.

**Step A — get the ratio the gateway already computed. Never re-derive it.**
Charles's bands, unchanged:

| FAR | Metric | Ceiling |
|---|---|---|
| <10% | PLSF | $17 |
| 10–18% | PLSF | $23 |
| >18% | PSFB | $120 |

**Where the numbers come from depends on which path you are on**, and the backlog
path is the usual one:

- **From the work list** (the normal case) each target carries `criteria_notes`,
  the verdict the gateway computed at ingest — e.g.
  `FAR 10.6% [10-18%] · PLSF $11.86 < $23 ✓ qualifies`. Read the FAR, the band,
  the metric, the value and the ceiling straight out of it.
- **From Step 3's screen result**, when you are scoring rows you just screened,
  each entry already carries `far_pct` / `band` / `metric` / `value` /
  `threshold`.

Either way the ratio is `value ÷ ceiling`. **Do not recompute PLSF or PSFB from
price and acreage** — the gateway is the single deriver of those, and a second
derivation is how two answers to the same question appear.

A property at or above its ceiling was rejected `fails_screen` at ingest — and so
was a near-miss, since the gateway's own screen returns `pass: false` for anything
within 10% above the ceiling too. **Nothing in your work list has a ratio of 100%
or more**, which is why the Basis table stops there.

**Step B — four component scores.**

**Basis — 62.5%.** `ratio = value ÷ ceiling`, as a percentage.

| % of ceiling | Pts | | % of ceiling | Pts |
|---|---|---|---|---|
| 0–10 | 10 | | 50–60 | 5 |
| 10–20 | 9 | | 60–70 | 4 |
| 20–30 | 8 | | 70–80 | 3 |
| 30–40 | 7 | | 80–90 | 2 |
| 40–50 | 6 | | 90–100 | 1 |

**Coverage — 18.75%.** The FAR band, which the screen already assigned.

| FAR | Pts |
|---|---|
| <10% | 10 |
| 10–18% | 6 |
| >18% | 2 |

**Size — 12.5%.** `lot_size_acres`.

| Acres | Pts | | Acres | Pts |
|---|---|---|---|---|
| ≥10 | 10 | | 2–3 | 5 |
| 5–10 | 9 | | 1–2 | 3 |
| 3–5 | 7 | | <1 | 1 |

**Type — 6.25%.** `property_type`, from `Secondary Type`.

| Value | Pts |
|---|---|
| Truck Terminal, Distribution | 10 |
| Warehouse, Manufacturing, Service | 7 |
| Showroom, Freestanding, Food Processing | 4 |
| Data Center, Supermarket, Refrigeration/Cold Storage | 1 |
| unknown / missing | 5 |

**Type is the only component with a fallback**, and it is deliberate. Basis,
Coverage and Size are all guaranteed present: a row that reached your work list
was screened, and it could only be screened because price, RBA and acreage were
all there. `Secondary Type` is 89% filled, so the missing 11% get a neutral 5
rather than a hole. If Basis, Coverage or Size is genuinely absent, you are
looking at an **`incomplete` row** — see below — not a scoring problem.

**Step C — blend and round.**

```
score = round( 0.625×Basis + 0.1875×Coverage + 0.125×Size + 0.0625×Type )
```

Round half up, so 5.5 → 6. The weights sum to exactly 1, so a property scoring
10 on all four scores 10 — which the rule that preceded this one could not do.

**Worked, from real properties:**

> **224 Zander Ln** — FAR 2.8%, 9.0 ac, PLSF $3.66 against $17, type unknown.
> ratio 21.5% → Basis **8** · Coverage **10** · Size **9** · Type **5**
> `5 + 1.875 + 1.125 + 0.3125 = 8.3125` → **score 8**

> **12128 Zion Rd** — FAR 4.5%, 2.5 ac, PLSF $10.68 against $17, Warehouse.
> ratio 62.8% → Basis **4** · Coverage **10** · Size **5** · Type **7**
> `2.5 + 1.875 + 0.625 + 0.4375 = 5.4375` → **score 5**

**Carry the unrounded terms and round once, at the end.** Rounding each term to
two decimals first and adding those makes 8.3125 come out as 8.32 — harmless
here, but on a total sitting near a boundary it moves the score by a whole point.

Note the second one: cheap enough to pass the screen comfortably, but a small
site pulls it down. That is the rubric doing its job — price alone was never the
whole question.

### Show your working

**Put the four component points in the `screen` block** alongside the FAR math:

```
screen: {
  far: 0.028, metric: "PLSF", value: 3.66, threshold: 17, band: "<10%", pass: true,
  basis_pts: 8, coverage_pts: 10, size_pts: 9, type_pts: 5
}
```

This is not bookkeeping. You are computing a four-term weighted average across
dozens of properties in one pass, and arithmetic slips are easy and invisible.
Recording the components makes the total checkable and a wrong score obvious
rather than silent.

### No-price listings get NO score

A `source_variant` of `costar_no_price` means there is no asking price. Every
buy-box measure divides by price, so there is no ratio to grade and **no score to
send**. Do not invent one — a fabricated score is compared against the same
threshold as a measured one, and there is no way to tell them apart afterwards.

Those properties were already routed at ingest on site shape, into broker pricing
outreach (flow3), and since gateway v2.8.1 they no longer appear in the work list
at all — only as a `no_price_pending` count.

**The same rule now covers every unpriced property, Reonomy included.** Gateway
v2.9.0 gates an unpriced property on its shape tier rather than on a score, and
ignores a score sent on one. So there is a single rule: **priced → compute the
score; unpriced → send no score at all.** `reonomy-saved-search` follows it too.

Score **every priced property in the work list**, including ones with no contact.
The score itself is reproducible — that is what a rubric buys — but the `checks`
and the `why` are captured now or lost, because nobody comes back to a property
with the listing and the map open a second time.

```
adana_save_qualification(
  gateway_api_key: "${GATEWAY_API_KEY}",
  items: [{
    address_raw: "<same address you ingested>",   // or property_id
    score: 6,                                     // REQUIRED — COMPUTED from the rubric above
    action: "PURSUE" | "REVIEW" | "PASS",
    why: "Truck Terminal on 11.9 ac in Crosby. FAR 10.6% [10-18%] — PLSF $11.86 < $23, clears the buy-box on basis.",
    checks: [
      { "label": "Significant outdoor storage (stabilized yard)", "pass": true },
      { "label": "Major highway access", "pass": true, "note": "I-10 / SH-146" },
      { "label": "Price in $1-10M range", "pass": true },
      { "label": "Near container seaport", "pass": true, "note": "~5 mi Bayport" },
      { "label": "Near Class I railyard", "pass": true, "note": "UP ~6 mi" },
      { "label": "Redevelopment / vacancy upside", "pass": false }
    ],
    screen: { far: 0.106, metric: "PLSF", value: 11.86, threshold: 23, band: "10-18%", pass: true,
              basis_pts: 5, coverage_pts: 6, size_pts: 10, type_pts: 10 }
  }, ... ]
)
```

**That example is one property throughout, and it checks out** — deliberately, so
it can be used as a template without carrying an error into every row. PLSF
$11.86 ÷ $23 = 51.6% → Basis **5**; FAR 10.6% is the 10–18% band → Coverage **6**;
11.9 acres → Size **10**; Truck Terminal → Type **10**. Blend:
`3.125 + 1.125 + 1.25 + 0.625 = 6.125` → **score 6**. If you change any figure in
a worked example, re-run the arithmetic on the rest.

- **Keep `why` to the deal basis, one sentence.** Property type, acreage, city, FAR
  band, PLSF/PSFB clearance. The strategic read belongs in `checks`, not the prose.
- **Reuse the screen's math — never recompute it.** The FAR/PLSF/PSFB block comes
  straight from the `adana_screen_costar` result; set `far` to the decimal
  (`far_pct ÷ 100`, so 10.5% → `0.105`). Add the four rubric component points
  alongside it.
- **Don't invent the location checks.** Mark `pass: true` only where the CoStar row
  or map actually supports it; otherwise `pass: false` with a short note. An
  unverifiable criterion is a real signal — fabricating one is worse than leaving
  it false.
- **`action` is your read, and it is separate from the score.** All three values
  are in use, so pick deliberately rather than defaulting: **`PURSUE`** when you
  would actually work this property now; **`REVIEW`** when it clears the screen
  but something about the site, the timing or the map says hold; **`PASS`** when
  you would not work it whatever the arithmetic says — a rail-served site with no
  yard, a strip of frontage with no depth, a location you already know. The score
  is arithmetic and cannot see any of that, which is exactly why the action is a
  separate field and not a restatement of the number.
- Batch all rows into one call.

### Scoring is not promoting

A property reaches Gate 1 — where a human approves outreach — only when it carries
a `score`, that score is strong enough, **and** somebody can be reached by EMAIL.
A mobile is stored and valued but is not a substitute: outreach runs on email.
Your overlay is stored either way. The response returns `held` (address + reason)
and `held_by_reason` (counts).

Holds are normal, and each reason means something different:

- **`no_score`** — always your bug. Omitting the score holds the property; it does
  not slip past.
- **`below_score`** — the rubric put it too low to place in front of a human. Not
  a verdict on your read; the arithmetic said so. The system working.
- **`no_contact`** — cleared the floor, but there is no email yet. **This one is
  progress, not a problem**: the property is now queued for enrichment, and the
  address it comes back with carries it straight into Gate 1 without needing
  another read from you.
- **`below_shape`** — you should never see this on a priced property. It is the
  unpriced gate (`reonomy-saved-search`, flow3), and its appearance here means a
  listing you treated as priced was stored without an asking price.

The reasons are checked in that order, and the order is deliberate. Below the
floor, "find a contact" is not the fix that comes first — the lookup would not be
spent either way, so the score is reported as the reason instead. A `no_contact`
hold therefore only ever appears on a property genuinely worth the credit.

**Compute the score; don't aim it.** The rubric is arithmetic, so there is nothing
to reverse-engineer and no discretion to exercise — a property scores what the
formula says, and the cutoff is the gateway's business. Expect a substantial share
of any run to be held; that is the filter working, not a problem to solve by
nudging a component up. If a property feels better than its score, that belongs in
`checks` and `why`, where a human will read it.

## Reporting back

Qualifier count and names, near-misses, ingest counts (`new` / `updated` /
`contacts` / `kept` / `rejected`), and the qualification outcome.

Numbers that are easy to conflate — report them separately:

- **`contacts`** — listings that landed with a contact. Should match `with_contact`.
- **`kept` vs `rejected`** — break the rejections down by reason. *"1,244 ingested,
  679 kept, 565 rejected: 466 above the ceiling, 70 with no contact, 29 on site
  shape."* A quarter of an export being rejected is ordinary.
- **`qualified` vs `saved`** — `saved` is overlays stored; `qualified` is how many
  reached Gate 1. Break holds down by reason: *"scored 684 — 221 clear the floor,
  of which 198 are now queued for enrichment; 463 held below the score floor."*
- **`with_email`** — how many contacts still lack an email. If the layout carried
  no email column, say so: adding one is the single highest-value change available
  to this pipeline.

**Two things to state plainly if they are non-zero**, because both mean work is
outstanding rather than done:

- **`incomplete`** — rows you under-sent, still unscreened. Name the count and say
  they need resending.
- **the backlog** — say whether it drained, and keep three numbers apart. Rows you
  did not reach are outstanding work: name the count and say so. **`no_price_pending`**
  is not outstanding at all — the gateway holds those back by design and hands you
  the count precisely so you can report them without working them. `incomplete`
  rows need columns resent through Step 4, not a score. *"Scored 684, backlog
  drained; 555 no-price held back by design; 9 incomplete and awaiting a resend."*
  One undifferentiated "still 564 unscored" reads as a failed run when almost all
  of it is the system behaving. Never imply the batch is complete when it isn't —
  that is how 466 properties were lost — but don't call a designed skip a
  shortfall either.

## Edge cases

- **Zero qualifiers**: say so plainly and surface the near-misses.
- **Export has only a header**: the saved search returned nothing. Ask the user to
  confirm they opened the search they meant.
- **Nothing new to process**: the normal outcome on a scheduled run in a week
  nobody exported. Say so and stop. Never reprocess an already-marked file to have
  something to report.
- **No `CostarExport*.xlsx` at all**: nothing has ever been placed in `exports/`,
  or downloads are landing in their normal Downloads folder. Give them the Step 1
  recipe.
- **Several new exports at once**: process them oldest-first, one at a time, each
  with its own `location`. Merging them loses which search found what.
- **A re-export with the same filename**: the mtime comparison catches it, so it
  is treated as new. That is deliberate — a corrected re-export must not be
  skipped just because the name matches.
- **`.processed.json` missing or deleted**: every file looks new. Don't blindly
  reprocess the whole folder — say what you see and confirm before ingesting a
  backlog, since re-ingesting old exports re-dates properties that haven't
  actually been re-listed.
- **Expected column missing** (`RBA`, `Sales Contact`): the wrong layout. Ask for a
  re-export; don't work around it, since the missing columns carry price, size and
  contacts.
- **`incomplete` came back non-empty**: priced rows you under-sent. They are stored
  but unscreened, and they will keep appearing in the qualification backlog until
  the columns arrive. Resend them; don't close the run out.
- **Gateway key rejected**: stop and ask the user to re-run
  `/adana-dsa:adana-setup` with a valid `adana_live_…` key.
