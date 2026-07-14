---
name: costar-saved-search
description: >-
  Run a CoStar saved search end-to-end for Adana deal sourcing: open it in the
  logged-in Chrome session, read the results grid, screen the listings against
  the FAR / PLSF / PSFB land-vs-building criteria (via the gateway), and persist
  the deduped properties + broker contacts through the Adana gateway. Use this
  whenever the user names one of their CoStar saved searches (e.g. "Hamptons
  IOS", "NEW PRODUCT", "Montana", "IOS For Sale Southeast") and asks to run,
  pull, refresh, or screen it — even casually like "run Montana through CoStar"
  or "pull the NEW PRODUCT search and tell me what fits". If the user mentions a
  CoStar saved search by name, this skill almost certainly applies.
allowed-tools: Claude in Chrome browser tools (navigate, find, read_page, click, type, screenshot), mcp__gateway__adana_screen_costar, mcp__gateway__adana_ingest_costar_export, mcp__gateway__adana_save_qualification
area: Collection
use_for: "Run a CoStar saved search, screen the grid (FAR/PLSF/PSFB via gateway), persist deduped properties + broker contacts, and write back the qualification (score + why + buy-box checklist)."
deps:
  mcp: ["Claude in Chrome"]
  gateway: ["adana_screen_costar", "adana_ingest_costar_export", "adana_save_qualification"]
  files: []
  env: ["gateway_api_key"]
---

# CoStar saved-search → screen → ingest

This automates the CoStar half of Adana's deal sourcing. The only thing that
changes between runs is **which saved search** to pull — treat the saved-search
name the user gives you as the single parameter. Everything is persisted through
the **gateway** MCP; **nothing is downloaded and no files are written**.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- The user is logged into CoStar in the Chrome instance the browser tools control.
- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's **Credential Loading** section before the first `adana_*` call. Scheduled runs do not inject it automatically.

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

## Step 2 — Make sure the grid shows the screening columns

The screen needs, per listing: **For Sale Price, RBA (building SF), Land Area
(AC), Property Address, City, State, Zip** (broker too, where shown). Switch to
the list/grid view and confirm these columns are visible. If any are missing,
add them via the grid's column/field chooser (the CoStar "Industrial" saved
layout exposes exactly these). Don't proceed until price, RBA, and Land Area are
on screen — without RBA + acres the gateway can't compute FAR.

## Step 3 — Scrape the grid into rows

Read the results grid (use `read_page`; page through all results). Build one row
per listing with the **raw** fields — do **not** compute any ratios yourself:

- `address_raw`, `city`, `state`, `zip`
- `property_type`
- `asking_price` (For Sale Price; leave empty/omit if blank → that's a no-price / flow3 row)
- `building_sf` (RBA), `lot_size_acres` (Land Area AC)
- `source_url` / `listing_url`, and `external_id` if available

For **no-price rows (flow3)**: open each listing's brochure and extract the
**broker** (name, email, phone, company) so the lead is contactable. Priced rows
(flow1) usually carry the broker in the grid/listing already.

Keep the rows in memory — there is no file to write.

## Step 4 — Screen (gateway derives the ratios)

Call **`adana_screen_costar`** with the scraped rows:

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

## Step 5 — Ingest (persist via gateway)

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

## Step 6 — Qualify & write back (the recommendation)

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
- **Empty / tiny result set**: the saved search may have returned nothing —
  re-check that the right search was opened.
- **Gateway key rejected**: stop and ask the user to set a valid `adana_live_…`
  key in the plugin config (generated in the gateway dashboard).
- **Logged out**: if CoStar shows a sign-in page, stop and ask the user to sign
  in — never enter credentials.
