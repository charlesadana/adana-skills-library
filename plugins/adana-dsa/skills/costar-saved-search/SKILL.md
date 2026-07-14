---
name: costar-saved-search
description: >-
  Run a CoStar saved search end-to-end for Adana deal sourcing: open it in the
  logged-in Chrome session, export it with the Industrial saved layout, screen
  the listings against the FAR / PLSF / PSFB land-vs-building criteria (via the
  gateway), and persist the deduped properties + broker contacts through the
  Adana gateway. Use this whenever the user names one of their CoStar saved
  searches (e.g. "Hamptons IOS", "NEW PRODUCT", "Montana", "IOS For Sale
  Southeast") and asks to run, pull, export, refresh, or screen it — even
  casually like "run Montana through CoStar" or "pull the NEW PRODUCT search and
  tell me what fits". If the user mentions a CoStar saved search by name, this
  skill almost certainly applies.
allowed-tools: Claude in Chrome browser tools (navigate, find, read_page, click, type, screenshot), mcp__gateway__adana_screen_costar, mcp__gateway__adana_ingest_costar_export, mcp__gateway__adana_save_qualification
area: Collection
use_for: "Run a CoStar saved search, export it (Industrial saved layout), screen it (FAR/PLSF/PSFB via gateway), persist deduped properties + broker contacts, and write back the qualification (score + why + buy-box checklist)."
deps:
  mcp: ["Claude in Chrome"]
  gateway: ["adana_screen_costar", "adana_ingest_costar_export", "adana_save_qualification"]
  files: ["exports/CostarExport*.xlsx (read)"]
  env: ["gateway_api_key", "ADANA_EXPORT_DIR"]
---

# CoStar saved-search → export → screen → ingest

This automates the CoStar half of Adana's deal sourcing. The only thing that
changes between runs is **which saved search** to pull — treat the saved-search
name the user gives you as the single parameter.

**Export the result set; never read the grid row-by-row.** A real saved search
returns far more rows than the browser tools can walk, and that approach does not
complete. Everything is persisted through the **gateway** MCP — the export file
is a working artifact, not the record.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- The user is logged into CoStar in the Chrome instance the browser tools control.
- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's **Credential Loading** section before the first `adana_*` call. Scheduled runs do not inject it automatically.
- Chrome's download location points at the project's `exports/` folder (set by `/adana-dsa:adana-setup` Step 5). Without this the export lands somewhere the skill cannot read.

Set up a task list and **confirm the saved-search name** before driving the browser.

## Step 1 — Open the saved search

Use the Claude-in-Chrome tools. Identify/create a tab, then:

1. Go to the **Properties** → **All Properties** search page
   (`https://product.costar.com/search/all-properties`).
2. Click **Save** in the search toolbar. A dropdown lists saved searches under
   "OPEN SAVED SEARCH".
3. Click the saved search whose name matches the user's request.

The map/results re-render and the property count settles. The count can flash a
huge number (e.g. "17,001") mid-load — wait for it to settle to the real count.

Tip: screenshots occasionally time out and toolbar buttons can scroll off the
right edge. The `find` tool is reliable for locating controls by description;
fall back to it whenever a screenshot fails or a button isn't visible.

Edge case — **no saved search by that name**: the Save dropdown shows what
exists. If the requested name isn't there, list the available ones and ask which
they meant.

## Step 2 — Export with the Industrial saved layout

**Export the result set; do not read the grid.** A real saved search returns far
more rows than `read_page` can walk, and a row-by-row read will never finish.
The export is the only approach that works at real result-set sizes.

1. Click **More** → **Export**. The "Export Data" dialog opens.
2. Open the **Selected Field Layout** dropdown. It has a "PRE-DEFINED LAYOUTS"
   section AND, lower down, a separate **"SAVED LAYOUTS"** section. Scroll down
   and choose **Industrial under SAVED LAYOUTS — not the pre-defined one.** The
   saved layout is the one that produces the columns this skill expects: Last
   Sale Date, For Sale Price, Cap Rate, Property Address, City, State, Zip, RBA,
   Land Area (AC).
3. Leave **File type** as "Microsoft Excel File". Click **Export**.

Chrome drops the file into the project's export folder (`$ADANA_EXPORT_DIR`,
default `exports/`) — `adana-setup` Step 5 pointed Chrome's download
location there. It lands as `CostarExport.xlsx`, or `CostarExport (N).xlsx` if
earlier copies exist.

Downloading is the intent here, so it's fine to proceed.

If nothing appears in the folder, Chrome's download location is wrong — stop and
have the user re-run `/adana-dsa:adana-setup` Step 5 rather than falling back to
scraping the grid.

## Step 3 — Read the export into rows

Read the **newest** `CostarExport*.xlsx` from the export folder and build one row
per listing with the **raw** columns. Do **not** compute FAR, PSFB or PLSF — the
gateway derives them.

```python
import glob, os
import openpyxl

export_dir = os.environ.get("ADANA_EXPORT_DIR", "exports")
files = glob.glob(os.path.join(export_dir, "CostarExport*.xlsx"))
if not files:
    raise SystemExit(f"No CostarExport*.xlsx in {export_dir}/ — did the export land?")
newest = max(files, key=os.path.getmtime)

ws = openpyxl.load_workbook(newest, data_only=True).active
rows = list(ws.iter_rows(values_only=True))
if len(rows) < 2:
    raise SystemExit("Export has only a header — the saved search returned nothing.")

header = rows[0]
idx = {name: i for i, name in enumerate(header) if name}
print(list(idx))   # inspect the real columns — Step 5 checks these for broker fields

def cell(r, col):
    i = idx.get(col)
    return r[i] if i is not None else None

listings = []
for r in rows[1:]:
    listings.append({
        "address_raw":    cell(r, "Property Address"),
        "city":           cell(r, "City"),
        "state":          cell(r, "State"),
        "zip":            cell(r, "Zip"),
        "property_type":  cell(r, "Property Type"),    # if the layout carries it
        "asking_price":   cell(r, "For Sale Price"),   # blank => no-price (flow3)
        "building_sf":    cell(r, "RBA"),
        "lot_size_acres": cell(r, "Land Area (AC)"),
    })
```

Print the header before mapping. Column names vary with the saved layout, and
Step 5 needs to know whether broker columns came down with the export. If `RBA`
or `Land Area (AC)` is missing entirely, the **wrong layout** was chosen — almost
always the pre-defined Industrial rather than the one under SAVED LAYOUTS.

Drop any field the export doesn't have rather than sending `null` — `ingest`
rejects nulls.

Map the columns exactly as above — `For Sale Price` → `asking_price`, `RBA` →
`building_sf`, `Land Area (AC)` → `lot_size_acres`. Without RBA **and** acres the
gateway cannot derive FAR, and the row can't be screened.

**Two schema quirks worth knowing**, because the gateway is strict:
- `adana_screen_costar` takes **`address`**; `adana_ingest_costar_export` takes
  **`address_raw`**. They are different schemas — map separately for each call.
- `screen` accepts `null`; `ingest` does **not** — omit a field rather than
  sending `null` to ingest.

## Step 4 — Screen (gateway derives the ratios)

Call **`adana_screen_costar`** with the rows read from the export (note: `address`,
not `address_raw`):

```
adana_screen_costar(
  gateway_api_key: "${GATEWAY_API_KEY}",
  rows: [ { address, city, asking_price, building_sf, lot_size_acres }, ... ]
)
```

The gateway derives FAR / PLSF / PSFB from the raw columns and applies the
land-vs-building bands (FAR < 10% → PLSF < $17; 10–18% → PLSF < $23; > 18% →
PSFB < $120), dedupes by address+city, and returns `qualifiers`, `near_misses`
(within 10% of the ceiling), and `no_price`. Present this summary **in chat** —
name the qualifiers with their FAR band and the metric that cleared, call out
near-misses, and note how many rows had no price. Don't restate every property.

## Step 5 — Brokers (browser)

The Industrial saved layout carries the **listing**, not the broker. So broker
details come from one of two places:

1. **From the export**, if the saved layout happens to include broker columns
   (e.g. "Listing Broker Name" / "Listing Broker Phone"). Check the header you
   printed in Step 3 — if they're there, use them and skip the browser.
2. **From the brochure**, otherwise. Open the listing in CoStar, open its
   brochure, and read off `first_name`, `last_name`, **`email`**, `mobile`,
   `company`. Capture the `brochure_url` too.

**The email is the only field that counts.** The gateway's test is literally
`hasBroker = !!broker.email` — a broker with a name and phone but no email is
treated as *no broker at all*. So a broker record without an email buys nothing.

**This is a graceful fallback, not a failure.** Any property with no broker email
is set to `needs_enrichment` and picked up by `lexisnexis-contact-lookup`, which
is exactly where a hard-to-reach lead should go. So:

- **Don't open every brochure.** Prioritise the rows worth contacting — the
  qualifiers and near-misses from Step 4. Rows that didn't clear the screen can go
  to enrichment without a brochure visit.
- Say how many brochures you're about to open and roughly how long it'll take
  before charging ahead. At ~10–20s each this dominates the run.

If the user would rather avoid brochure visits entirely, tell them: adding the
broker columns to the **Industrial saved layout** in CoStar makes them come down
with the export, and this step disappears.

## Step 6 — Ingest (persist via gateway)

Call **`adana_ingest_costar_export`** with the full listing set (priced +
no-price), including broker contacts:

```
adana_ingest_costar_export(
  gateway_api_key: "${GATEWAY_API_KEY}",
  location: "<saved search name or location>",
  listings: [ { address_raw, city, state, zip, property_type, building_sf,
                lot_size_acres, asking_price, source_url, brochure_url,
                external_id, broker: { first_name, last_name, email, mobile, company } }, ... ]
)
```

The gateway UPSERTs properties (dedup on normalized address), records a
`property_sources` row per listing, UPSERTs broker contacts, and sets statuses
(flow1 → `sourced`; flow3 with no broker → `needs_enrichment`). Relay the
returned `{run_id, found, new, updated}` so the user can confirm the data landed.

## Step 7 — Qualify & write back (the recommendation)

Screening (Step 4) only tells you whether the **price** clears the buy-box. The
recommendation — a graded conviction score, the *why*, and the strategic buy-box
checklist — is **yours to produce**: you have the full CoStar row, the listing,
the brochure, and the map, none of which the gateway sees. Build one
qualification per property you ingested and write it back with
**`adana_save_qualification`**:

```
adana_save_qualification(
  gateway_api_key: "${GATEWAY_API_KEY}",
  items: [{
    address_raw: "<same address you ingested>",    // or property_id
    score: 1-10,                                     // your conviction, not the screen's 10/0
    action: "PURSUE" | "REVIEW" | "PASS",
    why: "<one short paragraph>",
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

Rules:
- **Reuse the screen's math — never recompute it.** The `screen` block comes
  straight from the `adana_screen_costar` result for that row (`metric`, `value`,
  `threshold`, `band` as returned); set `far` to the **decimal** (`far_pct ÷ 100`,
  so 10.5% → `0.105`). FAR/PLSF/PSFB are the gateway's to compute, not yours.
- **Don't invent the location checks.** Mark a check `pass: true` only when the
  listing / brochure / map actually supports it; otherwise `pass: false` with a
  short `note`. A thin or unverifiable criterion is a real signal — fabricating
  one is worse than leaving it false.
- **`action` mirrors the screen by default, but you may override it on strategic
  grounds** — e.g. a price near-miss that's a strong port-adjacent redevelopment
  play can be `PURSUE` — as long as the `screen` block stays honest and the `why`
  explains the override.
- The gateway stores this verbatim; your overlay **supersedes the gateway's own
  deterministic screen** on the dashboard card. Batch all rows into one call.

## Reporting back

Tight summary: qualifier count + names, near-misses, no-price count, the ingest
counts (`new` / `updated`), and how many properties you qualified (`saved`).
Mention that no-price/no-broker rows were routed to enrichment (the LexisNexis
skill picks them up).

## Edge cases

- **Zero qualifiers**: say so plainly and surface the near-misses.
- **Export has only a header**: the saved search returned nothing — re-check that
  the right search was opened, rather than reporting "0 properties" as a result.
- **No `CostarExport*.xlsx` in the folder**: Chrome's download location isn't
  pointing at `exports/`. Stop and have the user re-run
  `/adana-dsa:adana-setup` Step 5. **Do not fall back to reading the grid** — it
  will not finish.
- **Expected column missing** (e.g. no `RBA`): the wrong layout was chosen —
  almost always the *pre-defined* Industrial rather than the one under **SAVED
  LAYOUTS**. Re-export with the saved layout.
- **A save dialog appears instead of a download**: Chrome's "Ask where to save
  each file" is on. That's a native OS dialog and cannot be clicked from here —
  stop and have the user switch it off.
- **Gateway key rejected**: stop and ask the user to re-run
  `/adana-dsa:adana-setup` with a valid `adana_live_…` key.
- **Logged out**: if CoStar shows a sign-in page, stop and ask the user to sign
  in — never enter credentials.
