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
allowed-tools: mcp__gateway__adana_screen_costar mcp__gateway__adana_ingest_costar_export mcp__gateway__adana_save_qualification
area: Collection
use_for: "Process a CoStar export the user has placed in the project folder: screen it (FAR/PLSF/PSFB via gateway), persist deduped properties + contacts, and write back the qualification (score + why + buy-box checklist)."
deps:
  mcp: []
  gateway: ["adana_screen_costar", "adana_ingest_costar_export", "adana_save_qualification"]
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
import openpyxl

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

listings, skipped = [], 0
for r in rows[1:]:
    l = clean({
        "address_raw":    cell(r, "Property Address"),
        "city":           cell(r, "City"),
        "state":          cell(r, "State"),
        "zip":            cell(r, "Zip"),
        "property_type":  cell(r, "Property Type"),    # if the layout carries it
        "asking_price":   cell(r, "For Sale Price"),   # blank => no-price listing
        "building_sf":    cell(r, "RBA"),
        "lot_size_acres": cell(r, "Land Area (AC)"),
    })
    if not l.get("address_raw"):        # the dedup key — unusable without it
        skipped += 1
        continue
    c = contact_for(r)
    if c:
        l["broker"] = clean(c)
    listings.append(l)

with_contact = sum(1 for l in listings if l.get("broker"))
with_email   = sum(1 for l in listings if l.get("broker", {}).get("email"))
print(f"{len(listings)} listings, {with_contact} with a contact "
      f"({with_email} of them with an email), {skipped} skipped (no address)")
```

**Keep `with_contact`** — Step 4 checks the gateway's `contacts` count against it.

### The contact columns

The Industrial saved layout ships ~39 columns and the contact block is easy to
miss, because none of the names say "broker". Fill rates are from one 534-row run
(Aug 2026) — a guide, not a spec:

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

## Step 3 — Screen (the gateway derives the ratios)

```
adana_screen_costar(
  gateway_api_key: "${GATEWAY_API_KEY}",
  rows: [ { address, city, asking_price, building_sf, lot_size_acres }, ... ]
)
```

The gateway derives FAR / PLSF / PSFB and applies the land-vs-building bands
(FAR < 10% → PLSF < $17; 10–18% → PLSF < $23; > 18% → PSFB < $120), dedupes by
address + city, and returns `qualifiers`, `near_misses` (within 10% of the
ceiling) and `no_price`.

Present this **in chat**: name the qualifiers with their FAR band and the metric
that cleared, call out near-misses, note how many rows had no price. Don't restate
every property.

## Step 4 — Ingest (persist via gateway)

Send the `listings` list from Step 2 — priced and no-price together, contacts
already attached:

```
adana_ingest_costar_export(
  gateway_api_key: "${GATEWAY_API_KEY}",
  location: "<saved search name>",
  listings: [ { address_raw, city, state, zip, property_type, building_sf,
                lot_size_acres, asking_price,
                broker: { first_name, last_name, email, mobile, company, title, contact_type } }, ... ]
)
```

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
`property_sources` row per listing, UPSERTs the contact, and sets status
(contactable → `sourced`; no contact → `needs_enrichment`). Relay
`{run_id, found, new, updated, contacts}`.

**Compare `contacts` to `with_contact` from Step 2.** If Step 2 found 485 contacts
and ingest returns `contacts: 0`, the broker objects didn't survive the mapping —
stop and fix it rather than reporting a clean run. A silent zero here is exactly
how 485 contacts were lost once.

A contact with a phone but no email keeps `enrichment_status: pending` and stays on
the enrichment work list. That's correct — outreach needs the email.

**Mark the file processed only now**, using the snippet from Step 1, and only if
the ingest succeeded. Marking earlier means a run that fails midway is never
retried — the file looks done and its listings are silently lost.

If more files remain in `todo`, go back to Step 2 with the next one.

## Step 5 — Qualify and write back

Screening only tells you whether the **price** clears the buy-box. The
recommendation — a graded conviction score, the *why*, and the strategic checklist
— is **yours**: you have the CoStar row and the map, none of which the gateway
sees. Score **every** property you ingested, including ones with no contact. That
judgment is captured now or lost.

```
adana_save_qualification(
  gateway_api_key: "${GATEWAY_API_KEY}",
  items: [{
    address_raw: "<same address you ingested>",   // or property_id
    score: 1-10,                                  // REQUIRED — your conviction, not the screen's 10/0
    action: "PURSUE" | "REVIEW" | "PASS",
    why: "<one sentence — deal basis only: property type, acreage, city, FAR band, and the PLSF/PSFB clearance. e.g. 'Laydown Yard on 11.9 ac in Crosby. FAR 10.6% [10-18%] — PLSF $11.86 < $23, clears the buy-box on basis.'>",
    checks: [
      { "label": "Significant outdoor storage (stabilized yard)", "pass": true },
      { "label": "Major highway access", "pass": true, "note": "I-10 / SH-146" },
      { "label": "Price in $1-10M range", "pass": true },
      { "label": "Near container seaport", "pass": true, "note": "~5 mi Bayport" },
      { "label": "Near Class I railyard", "pass": true, "note": "UP ~6 mi" },
      { "label": "Redevelopment / vacancy upside", "pass": false }
    ],
    screen: { far: 0.105, metric: "PLSF", value: 13.8, threshold: 23, band: "10-18%", pass: true }
  }, ... ]
)
```

- **Keep `why` to the deal basis, one sentence.** Property type, acreage, city, FAR
  band, PLSF/PSFB clearance. The strategic read belongs in `checks`, not the prose.
- **Reuse the screen's math — never recompute it.** The `screen` block comes
  straight from the `adana_screen_costar` result; set `far` to the decimal
  (`far_pct ÷ 100`, so 10.5% → `0.105`).
- **Don't invent the location checks.** Mark `pass: true` only where the CoStar row
  or map actually supports it; otherwise `pass: false` with a short note. An
  unverifiable criterion is a real signal — fabricating one is worse than leaving
  it false.
- **`action` mirrors the screen by default**, but you may override on strategic
  grounds (a price near-miss that's a strong port-adjacent play can be `PURSUE`) as
  long as the `screen` block stays honest. Put the reason in a `checks` note.
- Batch all rows into one call.

### Scoring is not promoting

A property reaches Gate 1 — where a human approves outreach — only when it has a
usable contact, carries a `score`, and that score is strong enough. Your overlay is
stored either way; the property keeps its current status. The response returns
`held` (address + reason) and `held_by_reason` (counts).

Holds are normal. Each reason means something different:

- **`no_contact`** — no email and no mobile. Should be *small* once Step 2 maps the
  contact columns. **A `no_contact` count near your item count means the contact
  mapping didn't work** — go back and fix it rather than accepting the holds.
- **`no_score`** — always your bug. Omitting the score holds the property; it does
  not slip past.
- **`below_score`** — the conviction score was too low to put in front of a human.
  The system working.

**Score your honest read, and don't reverse-engineer the cutoff.** The threshold is
deliberately not published here or in the tool schema, so the score stays a
*measurement* rather than a target. A score chosen to get a property through is
worthless — it destroys the one signal standing between a weak listing and
someone's time. Expect a substantial share of any run to be held.

## Reporting back

Qualifier count and names, near-misses, no-price count, ingest counts
(`new` / `updated` / `contacts`), and the qualification outcome.

Three numbers that are easy to conflate — report them separately:

- **`contacts`** — listings that landed with a contact. Should match `with_contact`.
- **`qualified` vs `saved`** — `saved` is overlays stored; `qualified` is how many
  reached Gate 1. Break holds down by reason: *"scored 181 — 32 in Gate 1; 142 held
  on conviction score, 7 awaiting a contact."*
- **`with_email`** — how many contacts still lack an email, and so remain on the
  enrichment work list. If the layout carried no email column, say that adding one
  would remove most of that work.

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
- **Several exports at once** (multiple saved searches): process one at a time,
  each with its own `location`. Merging them loses which search found what.
- **Gateway key rejected**: stop and ask the user to re-run
  `/adana-dsa:adana-setup` with a valid `adana_live_…` key.
