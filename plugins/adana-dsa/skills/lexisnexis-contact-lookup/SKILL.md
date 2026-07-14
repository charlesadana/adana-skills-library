---
name: lexisnexis-contact-lookup
description: >-
  Enrich Adana's pending contacts with phone numbers and email addresses using
  LexisNexis Public Records (the SmartLinx Comprehensive Person Report). Pulls
  the work list of contacts still missing details straight from the Adana gateway
  (no input spreadsheet), runs each person through the report in the user's
  logged-in browser, and writes the results back through the gateway. Use this
  whenever the user wants to "enrich contacts", "find owner emails/phones", "run
  LexisNexis / Nexis / SmartLinx / Accurint", or "skip trace" the pending owners
  from Reonomy / no-broker CoStar listings. Drives the user's already-logged-in
  browser via Claude in Chrome.
allowed-tools: Claude in Chrome browser tools (navigate, find, read_page, click, type, screenshot, select_option), mcp__gateway__adana_targets_needing_enrichment, mcp__gateway__adana_save_contact_lookups
area: Enrichment
use_for: "Pull pending contacts from the gateway, look up phones/emails via LexisNexis SmartLinx, and write the results back."
deps:
  mcp: ["Claude in Chrome"]
  gateway: ["adana_targets_needing_enrichment", "adana_save_contact_lookups"]
  files: []
  env: ["gateway_api_key"]
---

# LexisNexis contact lookup → write back

Enriches the contacts Adana already has but can't reach yet — owners from Reonomy
and no-broker CoStar listings (flow2 + flow3). The **work list comes from the
gateway**, not a spreadsheet, and results are **written back through the
gateway**. No CSV is produced.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- Claude in Chrome is connected and a Chrome window is open.
- The user is signed into **LexisNexis / Nexis** with **Public Records** access
  (top nav shows a "Public Records" tab). If not, ask them to sign in — never
  enter credentials.
- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's **Credential Loading** section before the first `adana_*` call. Scheduled runs do not inject it automatically.

A note on responsible use: LexisNexis access is governed by DPPA/GLBA
permissible-use rules the user has already attested to. **Leave the
permissible-use selection on the form exactly as it is** — it is the user's legal
declaration to make, not something to toggle.

## Step 1 — Pull the work list from the gateway

Call **`adana_targets_needing_enrichment`**:

```
adana_targets_needing_enrichment(gateway_api_key: "${GATEWAY_API_KEY}", limit: 100)
```

Returns one entry per pending contact:
`{ contact_id, first_name, last_name, contact_type, address, city, state }`.
This **replaces the input spreadsheet**. Keep the `contact_id` with each person —
you need it to write results back. If the list is empty, tell the user there's
nothing pending and stop.

If the list is large (say >25), tell the user roughly how long it'll take (each
lookup is ~10–20s of browser work) and confirm before charging ahead.

## Step 2 — Open the Person Report form (once)

Get a browser tab, then:

1. Go to `https://advance.lexis.com` (lands on authenticated Nexis home if signed
   in; if it shows the public gateway, the user isn't logged in — stop and ask).
2. Click the **Public Records** tab.
3. Under **People**, click **SmartLinx® Comprehensive Person Report**. This opens
   a Form Search with: SSN, LexID, First Name, Middle, Last Name, Street Address,
   City, State (dropdown), Zip.

Prefer `find` / `read_page` to locate fields by label rather than fixed
coordinates — layouts shift as the page loads. Screenshot to confirm before and
after filling.

## Step 3 — Search each person

For each contact from the work list:

1. Fill **First Name**, **Last Name**, **City**, **Street Address** where you have
   values (from the gateway row's `first_name`/`last_name`/`address`/`city`).
2. Set the **State** dropdown: click it, type the full state name (e.g. `Texas`)
   so the native select jumps to it; verify via screenshot.
3. Click **Search**.
4. On the results list, pick the **top-ranked result** as the primary match.
   Sanity-check it against the input (city/state or nearby metro; middle
   initial). Note how many results came back.
5. Open the full **SmartLinx Person Report**. The **Person Summary** shows a
   primary phone + an **Email** list; click **Phone Summary (N)** in the
   left-hand panel for the full phone table.

Collect, per contact:
- `matched_name` — the full name on the report (e.g. "Sorensen, Nick Hugh")
- `phones` — every number in the Phone Summary, in order
- `emails` — every address in the Email list
- `notes` — a short confidence flag: `"city match"`, `"no city match — verify"`,
  `"no results"`, or `"multiple strong matches"`

Keep a running in-memory list keyed by `contact_id` so a mid-batch failure
doesn't lose progress.

### When the search is messy
- **No results**: record empty phones/emails + `notes: "no results"`; move on.
- **Many results, none clearly right**: take the closest on city/state, flag it
  in `notes`, keep going. Don't silently guess.
- **Masked/restricted data**: record whatever phones/emails are shown.

## Step 4 — Write the results back (gateway)

Once collected, call **`adana_save_contact_lookups`** (batch the whole run):

```
adana_save_contact_lookups(
  gateway_api_key: "${GATEWAY_API_KEY}",
  results: [ { contact_id, phones: [...], emails: [...], matched_name, notes }, ... ]
)
```

The gateway writes the primary email + primary mobile onto each contact, sets
`enrichment_status` (`enriched` if any detail found, else `not_found`), and
promotes the contact's property from `needs_enrichment` → `enriched`. Relay the
returned `{run_id, enriched, not_found}`.

## Reporting back

One-line summary, e.g. "12 of 14 enriched; 2 had no results (flagged)". Don't
dump every number into chat.

## Edge cases

- **Empty work list**: nothing pending — stop.
- **Gateway key rejected**: stop and ask the user to set a valid `adana_live_…`
  key in the plugin config.
- **Logged out of LexisNexis**: stop and ask the user to sign in.
