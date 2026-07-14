---
name: reonomy-saved-search
description: >-
  Run a Reonomy saved search for Adana off-market deal sourcing: open it in the
  logged-in Chrome session, export the results, capture each property's owner /
  company and full address, and persist them through the Adana gateway as
  off-market leads (flow2). Use this whenever the user names a Reonomy saved
  search or asks to "pull Reonomy", "run the off-market search", "get owners for
  [area]", or refresh Reonomy results. Drives the user's already-logged-in
  browser via Claude in Chrome.
allowed-tools: Claude in Chrome browser tools (navigate, find, read_page, click, type, screenshot), mcp__gateway__adana_ingest_reonomy, mcp__gateway__adana_save_qualification
area: Collection
use_for: "Run a Reonomy saved search, export it, persist deduped off-market properties + owner contact shells (flow2), and write back a judgment-led qualification."
deps:
  mcp: ["Claude in Chrome"]
  gateway: ["adana_ingest_reonomy", "adana_save_qualification"]
  files: ["exports/*.csv (read)"]
  env: ["gateway_api_key", "ADANA_EXPORT_DIR"]
---

# Reonomy saved-search → export → ingest

Collects **off-market** opportunities (flow2) from Reonomy and persists them
through the **gateway** MCP. The saved-search name (or location/filter set) is
the single parameter.

**Export the result set; never read the results list row-by-row.** A real search
returns far more rows than the browser tools can walk, and that approach does not
complete. The export file is a working artifact — the gateway is the record.

> ⚠️ **The export UI steps below are unverified.** Unlike the CoStar skill, there
> is no battle-tested reference for Reonomy's export flow — the button labels and
> dialog in Step 2 are a best guess at Reonomy's UI. On the first run, **read the
> page and adapt** rather than trusting these labels, and report back what the
> real flow was so this skill can be corrected. Do not fall back to scraping.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- The user is logged into Reonomy in the Chrome instance the browser tools control.
- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's **Credential Loading** section before the first `adana_*` call. Scheduled runs do not inject it automatically.
- Chrome's download location points at the project's `exports/` folder (set by `/adana-dsa:adana-setup` Step 5). Without this the export lands somewhere the skill cannot read.

Confirm the saved-search name (or the search to run) before driving the browser.

## Step 1 — Open the saved search

Use the Claude-in-Chrome tools. Navigate to Reonomy (`https://app.reonomy.com`),
open the user's **Saved Searches**, and run the one they named. Wait for the
results list to settle. Prefer `find` / `read_page` to locate controls by label
rather than fixed coordinates.

Edge case — **no saved search by that name**: list the saved searches that exist
and ask which they meant.

## Step 2 — Export the results

**Export; do not page through the list.** Reonomy offers a CSV/Excel export of a
result set — find it and use it.

Typical path (⚠️ **unverified — read the page and adapt**): with the results
open, look for an **Export** / **Download** control in the results toolbar or
under a "⋯" / "More" menu. Choose **CSV**, include the owner columns if the
dialog offers a column/field selection, and confirm.

Use `find` / `read_page` to locate the control **by label**, not by fixed
coordinates. If you cannot find an export control at all, **stop and tell the
user** — do not silently fall back to reading the list row-by-row, which will not
finish. Report what you actually saw so this step can be corrected.

The file lands in `$ADANA_EXPORT_DIR` (default `exports/`) — the single folder
Chrome's download location points at, shared with CoStar. Read it from there.

## Step 3 — Read the export into rows

Read the newest export and build one row per property. Column names are Reonomy's
and are **not yet confirmed** — inspect the header first and map what's actually
there.

```python
import csv, glob, os

export_dir = os.environ.get("ADANA_EXPORT_DIR", "exports")
files = glob.glob(os.path.join(export_dir, "*.csv"))
if not files:
    raise SystemExit(f"No CSV in {export_dir}/ — did the export land?")
newest = max(files, key=os.path.getmtime)

with open(newest, newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

print(rows[0].keys() if rows else "empty export")   # inspect the real headers first
```

Map onto the gateway's schema — per property:

- `address_raw`, `city`, `state`, `zip`
- `property_type`, and `building_sf` / `lot_size_acres` if present
- `external_id` (Reonomy property id) and `listing_url` if present
- **owner**: `first_name`, `last_name`, `company` (Reonomy surfaces the owning
  entity / reported owner; email + phone are usually absent — they come later via
  LexisNexis enrichment). The gateway's `owner` object *does* accept `email` and
  `mobile`, so pass them if the export happens to carry them.

**The Reonomy schema has no `asking_price`, `source_url` or `brochure_url`** — if
the export carries a price, there is nowhere to put it. Don't invent a field.

## Step 4 — Ingest (persist via gateway)

Call **`adana_ingest_reonomy`**:

```
adana_ingest_reonomy(
  gateway_api_key: "${GATEWAY_API_KEY}",
  location: "<saved search name or location>",
  properties: [ { address_raw, city, state, zip, property_type, building_sf,
                  lot_size_acres, external_id, listing_url,
                  owner: { first_name, last_name, company } }, ... ]
)
```

The gateway UPSERTs properties (dedup on normalized address), records a
`property_sources` row, creates an **owner contact shell**, and sets new
properties to **`needs_enrichment`** (owner email/phone are filled in later by
the LexisNexis skill). Relay the returned `{run_id, found, new, updated}`.

## Step 5 — Qualify & write back (the recommendation)

Off-market Reonomy leads usually have **no list price**, so the FAR/PLSF/PSFB
price screen can't run — the call here is **judgment**: does the site fit the
Adana IOS buy-box on type, size, and location? Write your read back with
**`adana_save_qualification`** (omit the `screen` block when there's no price):

```
adana_save_qualification(
  gateway_api_key: "${GATEWAY_API_KEY}",
  items: [{
    address_raw: "<same address you ingested>",     // or property_id
    score: 1-10,
    action: "PURSUE" | "REVIEW" | "PASS",
    why: "<one short paragraph — owner/asset/location fit, and that pricing is TBD>",
    checks: [ { "label": "Significant outdoor storage (stabilized yard)", "pass": true, "note": "<acres>" }, ... ]
  }, ... ]
)
```

Same honesty rule as CoStar: assert a location check only when the Reonomy record
or the map supports it — don't fabricate one. Pricing is unknown, so most
off-market leads land **`REVIEW`** (pursue the owner for a number) unless the
strategic fit is strong enough for `PURSUE`. The gateway stores it verbatim and
surfaces it on the property card.

## Reporting back

Tight summary: how many owners/properties captured, the ingest counts
(`new` / `updated`), and how many you qualified (`saved`). Note that these are now
queued for contact enrichment (the `lexisnexis-contact-lookup` skill picks them
up via `adana_targets_needing_enrichment`).

## Edge cases

- **Empty result set**: re-check the right search was opened.
- **Gateway key rejected**: stop and ask the user to set a valid `adana_live_…`
  key in the plugin config.
- **Logged out**: if Reonomy shows a sign-in page, stop and ask the user to sign
  in — never enter credentials.
