---
name: reonomy-saved-search
description: >-
  Run a Reonomy saved search for Adana off-market deal sourcing: open it in the
  logged-in Chrome session, read the results, capture each property's owner /
  company and full address, and persist them through the Adana gateway as
  off-market leads (flow2). Use this whenever the user names a Reonomy saved
  search or asks to "pull Reonomy", "run the off-market search", "get owners for
  [area]", or refresh Reonomy results. Drives the user's already-logged-in
  browser via Claude in Chrome.
allowed-tools: Claude in Chrome browser tools (navigate, find, read_page, click, type, screenshot), mcp__gateway__adana_ingest_reonomy
area: Collection
use_for: "Run a Reonomy saved search and persist deduped off-market properties + owner contact shells (flow2)."
deps:
  mcp: ["Claude in Chrome"]
  gateway: ["adana_ingest_reonomy"]
  files: []
  env: ["gateway_api_key"]
---

# Reonomy saved-search → ingest

Collects **off-market** opportunities (flow2) from Reonomy and persists them
through the **gateway** MCP. The saved-search name (or location/filter set) is
the single parameter. **Nothing is downloaded and no files are written.**

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- The user is logged into Reonomy in the Chrome instance the browser tools control.
- The plugin's `gateway_api_key` is set.

Confirm the saved-search name (or the search to run) before driving the browser.

## Step 1 — Open the saved search

Use the Claude-in-Chrome tools. Navigate to Reonomy (`https://app.reonomy.com`),
open the user's **Saved Searches**, and run the one they named. Wait for the
results list to settle. Prefer `find` / `read_page` to locate controls by label
rather than fixed coordinates.

Edge case — **no saved search by that name**: list the saved searches that exist
and ask which they meant.

## Step 2 — Scrape the results

Read the results list (page through all results). For each property capture:

- `address_raw`, `city`, `state`, `zip`
- `property_type`, and `building_sf` / `lot_size_acres` if shown
- `external_id` (Reonomy property id) and `listing_url` if available
- **owner**: `first_name`, `last_name`, `company` (Reonomy surfaces the owning
  entity / reported owner; email + phone are usually NOT here — they come later
  via LexisNexis enrichment)

Keep the rows in memory.

## Step 3 — Ingest (persist via gateway)

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

## Reporting back

Tight summary: how many owners/properties captured, and the ingest counts
(`new` / `updated`). Note that these are now queued for contact enrichment
(the `lexisnexis-contact-lookup` skill picks them up via
`adana_targets_needing_enrichment`).

## Edge cases

- **Empty result set**: re-check the right search was opened.
- **Gateway key rejected**: stop and ask the user to set a valid `adana_live_…`
  key in the plugin config.
- **Logged out**: if Reonomy shows a sign-in page, stop and ask the user to sign
  in — never enter credentials.
