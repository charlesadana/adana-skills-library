---
name: reonomy-saved-search
description: >-
  Process a Reonomy saved-search export for Adana off-market deal sourcing: read
  the CSV the user exported into the project folder, map each property's owner and
  address, persist them through the Adana gateway as off-market leads (flow2), and
  write back the strategic read (no score — unpriced leads are gated on site shape). The user runs the Reonomy export
  themselves; this skill takes over from the file. Use this whenever the user names
  a Reonomy saved search or asks to "pull Reonomy", "run the off-market search",
  "get owners for [area]", or says they've dropped a Reonomy export in.
allowed-tools: mcp__gateway__adana_ingest_reonomy mcp__gateway__adana_save_qualification
area: Collection
use_for: "Process a Reonomy export the user has placed in the project folder: persist deduped off-market properties + owner contact shells (flow2), which the gateway triages on site shape at ingest, then write back the strategic read — action, why and checks, with NO score."
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
  from enrichment. The `owner` object does accept `email` and `mobile` — pass
  whichever the export carries. Either one makes the contact worth **storing**;
  only an **email** makes the property reachable, since outreach runs on email.

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
`property_sources` row, creates an **owner contact shell**, and — since gateway
v2.9.0 — **triages each new lead on site shape**. Relay
`{run_id, found, new, updated, queued}`.

**`queued` is the number that matters.** FAR and acreage decide it: a promising
shape (HIGH/MED) lands straight in `needs_enrichment`, the queue where a lookup
gets spent; everything else waits in `sourced` for a human read. This is the same
door, with the same tiers, that a no-price CoStar listing already used.

**`queued: 0` on a real export is worth saying out loud.** It means no lead in the
file had both the acreage and the coverage to clear the bar — often because the
export carried no `building_sf`, without which FAR cannot be derived and every row
falls to LOW. Check the header before concluding the search was bad.

**Mark the file processed now**, using the snippet from Step 1, and only if the
ingest succeeded. If more files remain in `todo`, return to Step 2 with the next
one — each with its own `location`.

## Step 4 — Qualify and write back

Off-market leads have **no list price**, so the FAR/PLSF/PSFB screen cannot run
and there is no score to send. **Do not compute one.**

### Why there is no Reonomy score

Every buy-box measure divides by price. What is computable without one is the
*shape* of the site — FAR and acreage — and the gateway measured exactly how good
a signal that is: against 1,150 priced properties where the answer is known, the
best shape segment clears the Gate 1 floor 46.7% of the time against a 19.2% base
rate. That is a real 2.4x lift, worth ordering work by, and nowhere near precise
enough to put on the same 1–10 scale the price screen produces. Putting a coin
flip into `score` makes the gateway's floor compare a measurement against a guess.

So shape is used as **shape**, not laundered into a number:

| | Priced (CoStar flow1) | Unpriced (Reonomy, CoStar no-price) |
|---|---|---|
| Gate | the computed score, against the floor | the shape tier, decided at ingest |
| You send | `score` + `action` + `why` + `checks` | `action` + `why` + `checks`, **no score** |
| Held as | `no_score` / `below_score` | `below_shape` |

**Gateway v2.9.0 does the triage for you at ingest** — HIGH/MED land in
`needs_enrichment`, everything else waits in `sourced`. `adana_ingest_reonomy`
returns `queued` with the count. Nothing here needs a number from you, and a score
sent anyway is ignored rather than graded on.

An earlier version of this skill did derive a score from coverage, size and type
with the price component dropped and the rest renormalised. It is gone. It scored
a **thinner export higher than a fuller one** — losing `building_sf` removed the
coverage term and pushed the remaining weights up — and it cleared a floor of 8
more easily than a sound priced warehouse could. That is the failure mode the
gateway's own triage module had warned about in writing before it was written.

```
adana_save_qualification(
  gateway_api_key: "${GATEWAY_API_KEY}",
  items: [{
    address_raw: "<same address you ingested>",     // or property_id
                                                    // NO `score` — see above
    action: "PURSUE" | "REVIEW" | "PASS",
    why: "<one short paragraph — owner/asset/location fit, and that pricing is TBD>",
    checks: [ { "label": "Significant outdoor storage (stabilized yard)", "pass": true, "note": "<acres>" }, ... ]
  }, ... ]
)
```

**Omit `score` and omit the `screen` block.** There is no price, so there is no
FAR/PLSF/PSFB result and no component points. Sending a score here does not help:
the gateway ignores it on an unpriced property and gates on shape regardless. Your
work is the `why` and the `checks`.

Same honesty rule as CoStar: assert a location check only where the Reonomy record
or the map supports it. Pricing is unknown, so most off-market leads land `REVIEW`
— pursue the owner for a number — unless the strategic fit is strong enough for
`PURSUE`.

**Expect these back in `held`, and the reason tells you what happened.** The owner
shell has no email, and the gateway never promotes a property to `qualified`
without one — outreach runs on email.

- **`no_contact`** — the shape cleared the bar, so the property is **queued for
  enrichment**. The good outcome: once a lookup supplies the address it goes
  straight into Gate 1, with no second read needed from you.
- **`below_shape`** — FAR and acreage put it below the yield base rate, so it
  stays in `sourced` and no credit is spent on it. Also correct, and **not
  something a better write-up can change** — it is a verdict on the site, not on
  your read of it.

You should never see `no_score` or `below_score` here. If you do, the property was
stored with an asking price and is being gated as a priced listing — check the
ingest rather than adding a score to make the message go away.

Either way the overlay is stored, so write it now, while the record is in front of
you. The shape tier is reproducible; the `checks` and the `why` are not.

## Reporting back

How many properties captured, the ingest counts (`new` / `updated` / **`queued`**),
and how many overlays you wrote (`saved`) — with `held` alongside, which for
Reonomy will normally equal `saved`, since the owner shell has no email.

**Lead with `queued`.** It is the one number that says how much of the export was
worth a lookup, and it is decided at ingest before you write anything.

**Break the holds down, because the two mean opposite things.** `no_contact` is
the shape clearing the bar — those are queued for enrichment and will reach Gate 1
as soon as an address lands. `below_shape` did not clear it, so no lookup will be
spent and the property waits in `sourced`. Reporting a single `held` total
hides which of your reads actually moved anything.

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
  still worth ingesting, but say that every one lands in `sourced` with an empty
  owner shell — nobody to look up, so no enrichment can ever reach them.
  Re-exporting with owner columns included is worth more than any enrichment run.
- **Gateway key rejected**: stop and ask the user to re-run
  `/adana-dsa:adana-setup` with a valid `adana_live_…` key.
