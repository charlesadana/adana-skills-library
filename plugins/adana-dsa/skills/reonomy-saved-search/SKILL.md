---
name: reonomy-saved-search
description: >-
  Process a Reonomy saved-search export for Adana off-market deal sourcing: read
  the CSV the user exported into the project folder, map each property's owner and
  address, persist them through the Adana gateway as off-market leads (flow2), and
  write back a judgment-led qualification. The user runs the Reonomy export
  themselves; this skill takes over from the file. Use this whenever the user names
  a Reonomy saved search or asks to "pull Reonomy", "run the off-market search",
  "get owners for [area]", or says they've dropped a Reonomy export in.
allowed-tools: mcp__gateway__adana_ingest_reonomy mcp__gateway__adana_save_qualification
area: Collection
use_for: "Process a Reonomy export the user has placed in the project folder: persist deduped off-market properties + owner contact shells (flow2), and write back a judgment-led qualification."
deps:
  mcp: []
  gateway: ["adana_ingest_reonomy", "adana_save_qualification"]
  files: ["exports/*.csv (read)", "exports/.processed.json (read+write)"]
  env: ["gateway_api_key", "ADANA_EXPORT_DIR"]
---

# Reonomy export → ingest → qualify

Collects **off-market** opportunities (flow2). **The user exports from Reonomy;
this skill starts at the CSV** in `exports/`. No browser, no login.

Everything is persisted through the **gateway** MCP. The export file is a working
artifact; the gateway is the record.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- A **Reonomy CSV export** in the project's `exports/` folder
  (`$ADANA_EXPORT_DIR`, default `exports/`), including the owner columns.
- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's
  **Credential Loading** section before the first `adana_*` call.

## Step 1 — Get the export

If the user has already exported and said so, go to "Find what's new". Otherwise:

> In Reonomy (`app.reonomy.com`): open **Saved Searches**, run the one you want,
> and use the results toolbar's **Export / Download** control. Choose **CSV**, and
> if it offers a column or field selection, **include the owner columns** — the
> owner is the entire point of this flow. Put the file in this project's
> **`exports/`** folder and tell me which saved search it was.

**Ask which saved search it was.** You need the name for the `location` argument,
and the file doesn't record it.

### Find what's new

Exports accumulate in `exports/`, and this skill may run some time after the file
was dropped, so the question is **"have I already processed it?"** — not "is this
recent?". The marker is shared with the CoStar skill; they don't collide because
Reonomy exports are `.csv` and CoStar's are `.xlsx`.

```python
import csv, glob, json, os, datetime

export_dir = os.environ.get("ADANA_EXPORT_DIR", "exports")
marker = os.path.join(export_dir, ".processed.json")

seen = {}
if os.path.exists(marker):
    with open(marker, encoding="utf-8") as f:
        seen = json.load(f)          # {filename: mtime_when_processed}

files = sorted(glob.glob(os.path.join(export_dir, "*.csv")), key=os.path.getmtime)
todo = [f for f in files
        if seen.get(os.path.basename(f)) != os.path.getmtime(f)]

for f in files:
    mark = "NEW" if f in todo else "done"
    age_h = (datetime.datetime.now().timestamp() - os.path.getmtime(f)) / 3600
    print(f"  [{mark:4}] {os.path.basename(f)} — {age_h:.1f}h old")
print(f"{len(todo)} export(s) to process, {len(files) - len(todo)} already done")
```

**If `todo` is empty, say so and stop.** Never reprocess a marked file to have
something to report — re-ingesting an old export re-dates properties that were
never re-listed.

**`*.csv` is a loose match.** Any stray CSV in `exports/` will appear here, so
confirm the header actually looks like a Reonomy property export before ingesting
anything — an address-like column plus an owner-like column at minimum. If it
doesn't, skip the file and say which one you skipped rather than guessing at a
mapping.

Record a file as processed **only after a successful ingest** (Step 3), never
before:

```python
seen[os.path.basename(path)] = os.path.getmtime(path)
with open(marker, "w", encoding="utf-8") as f:
    json.dump(seen, f, indent=2)
```

## Step 2 — Read the export into rows

Reonomy's column names are **not fixed** and vary with the export configuration.
**Inspect the real header first and map what's actually there** — do not assume
the names below.

```python
with open(path, newline="", encoding="utf-8-sig") as f:   # `path` = a file from Step 1
    rows = list(csv.DictReader(f))

if not rows:
    raise SystemExit("Empty export — the saved search returned nothing.")
print(list(rows[0].keys()))          # the real headers, before mapping anything
```

Map onto the gateway's schema, per property:

- `address_raw`, `city`, `state`, `zip`
- `property_type`, and `building_sf` / `lot_size_acres` where present
- `external_id` (Reonomy property id) and `listing_url` where present
- **owner**: `first_name`, `last_name`, `company`. Reonomy surfaces the owning
  entity or reported owner; email and phone are usually absent and arrive later
  from enrichment. The `owner` object does accept `email` and `mobile` — pass them
  if the export happens to carry them, since either one makes the contact reachable.

**Reonomy has no `asking_price`, `source_url` or `brochure_url` in this schema.**
If the export carries a price there is nowhere to put it — don't invent a field.

Omit empty values rather than sending `null`: `ingest` accepts a missing key but
rejects an explicit null.

## Step 3 — Ingest (persist via gateway)

```
adana_ingest_reonomy(
  gateway_api_key: "${GATEWAY_API_KEY}",
  location: "<saved search name>",
  properties: [ { address_raw, city, state, zip, property_type, building_sf,
                  lot_size_acres, external_id, listing_url,
                  owner: { first_name, last_name, company } }, ... ]
)
```

The gateway UPSERTs properties (dedup on normalized address), records a
`property_sources` row, creates an **owner contact shell**, and sets new properties
to **`needs_enrichment`** — owner email and phone are filled in later. Relay
`{run_id, found, new, updated}`.

**Mark the file processed now**, using the snippet from Step 1, and only if the
ingest succeeded. If more files remain in `todo`, return to Step 2 with the next
one — each with its own `location`.

## Step 4 — Qualify and write back

Off-market leads usually have **no list price**, so the FAR/PLSF/PSFB screen can't
run. The call is **judgment**: does the site fit the Adana IOS buy-box on type,
size and location?

```
adana_save_qualification(
  gateway_api_key: "${GATEWAY_API_KEY}",
  items: [{
    address_raw: "<same address you ingested>",     // or property_id
    score: 1-10,                                    // REQUIRED
    action: "PURSUE" | "REVIEW" | "PASS",
    why: "<one short paragraph — owner/asset/location fit, and that pricing is TBD>",
    checks: [ { "label": "Significant outdoor storage (stabilized yard)", "pass": true, "note": "<acres>" }, ... ]
  }, ... ]
)
```

Omit the `screen` block when there's no price.

Same honesty rule as CoStar: assert a location check only where the Reonomy record
or the map supports it. Pricing is unknown, so most off-market leads land `REVIEW`
— pursue the owner for a number — unless the strategic fit is strong enough for
`PURSUE`.

**Expect every one of these back in `held` with reason `no_contact`.** The owner
shell has no email or phone, and the gateway will not promote a property to
`qualified` without a usable contact, so it stores your overlay and leaves the
status at `needs_enrichment`. That is the designed path for off-market leads, not
an error: score them now, while the record is in front of you, and they enter
Gate 1 after enrichment.

**Still send a real `score`.** Once enrichment supplies a contact, the score is
what decides whether the property surfaces to a human at all — a missing one holds
it (`no_score`). Off-market leads with no price are genuinely hard to call: score
them honestly low rather than inflating to keep them moving. **The judgment is
yours; the cutoff is the gateway's**, and you are not told where it sits — that is
what keeps the score a measurement rather than a target.

## Reporting back

How many properties captured, the ingest counts (`new` / `updated`), and how many
you scored (`saved`) — with `held` alongside, which for Reonomy will normally equal
`saved` and be entirely `no_contact`.

Say plainly that these are scored but **not yet in Gate 1**: they are queued for
contact enrichment (`apollo-email-lookup` first, then `lexisnexis-contact-lookup`)
and enter Gate 1 once a contact lands, if the conviction score clears the cutoff.

## Edge cases

- **Nothing new to process**: normal if the user hasn't exported since the last
  run. Say so and stop.
- **No CSV in `exports/`**: nothing has been placed there, or downloads are landing
  in their normal Downloads folder. Give them the Step 1 recipe.
- **A CSV that isn't a Reonomy export**: skip it and name it. Don't guess a mapping
  onto an unfamiliar header.
- **Empty export**: the saved search returned nothing. Ask them to confirm they ran
  the search they meant.
- **No owner columns**: the export was configured without them. The properties are
  still worth ingesting, but say that every one will land as `needs_enrichment`
  with no contact at all — and that re-exporting with owner columns included is
  worth more than any enrichment run.
- **Gateway key rejected**: stop and ask the user to re-run
  `/adana-dsa:adana-setup` with a valid `adana_live_…` key.
