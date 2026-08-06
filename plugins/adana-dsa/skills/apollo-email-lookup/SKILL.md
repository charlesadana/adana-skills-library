---
name: apollo-email-lookup
description: >-
  Find the missing work EMAIL for Adana's contacts using Apollo, entirely through
  its API — no browser, no logged-in session. Takes the work list from the Adana
  gateway (every contact still without an email), finds each person in Apollo's
  database, confirms it is genuinely the right person before spending a credit,
  pulls the verified work email, and writes it back through the gateway. Use this
  whenever the user wants to "find broker emails", "enrich contacts with Apollo",
  "get emails for the pipeline", or asks why properties in Gate 1 cannot be
  emailed. Run this BEFORE lexisnexis-contact-lookup — it is faster, cheaper and
  unattended, and whatever it cannot resolve is left for the manual LexisNexis pass.
allowed-tools: mcp__gateway__adana_targets_needing_enrichment mcp__gateway__adana_save_contact_lookups mcp__apollo__apollo_mixed_people_api_search mcp__apollo__apollo_people_bulk_match mcp__apollo__apollo_people_match mcp__apollo__apollo_users_api_profile
area: Enrichment
use_for: "Find work emails for contacts missing one, via the Apollo API (no browser): pull the gateway work list, verify each person by search before enriching, bulk-enrich by exact ID, and write the verified emails back."
deps:
  mcp: ["apollo (Apollo.io connector)"]
  gateway: ["adana_targets_needing_enrichment", "adana_save_contact_lookups"]
  files: ["apollo/results_<date>.json (write)"]
  env: ["gateway_api_key", "APOLLO_DIR"]
---

# Apollo email lookup → write back

Adana reaches people by **email**. CoStar exports supply phone numbers, Reonomy
supplies owner shells, and neither reliably supplies an email — so most contacts
arrive reachable-by-phone at best. This skill closes that gap for the contacts
Apollo can resolve: brokers and agents at real firms.

**No browser. No login.** Unlike every other skill in this plugin, this one is a
pure API workflow — which is why it can run unattended and why it should be the
*first* enrichment pass. `lexisnexis-contact-lookup` is slower, manual, and
better at private individuals; run it afterwards on whatever is left.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- The **`apollo` connector** is registered (Cowork → Settings → Connectors → Add
  custom connector), the same way the `gateway` connector is added in
  `/adana-dsa:adana-setup` Step 3. Apollo authenticates via OAuth in that flow;
  there is no API key to paste. If the `apollo` tools are missing, stop and ask
  the user to connect it — do not fall back to guessing emails from a name and a
  company domain.
- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's
  **Credential Loading** section before the first `adana_*` call. Scheduled runs
  do not inject it automatically.

## What a credit costs, and what doesn't

Read this before running anything at scale — it decides how you sequence the run.

| Action | Credits |
|---|---|
| `apollo_mixed_people_api_search` (finding the person) | **none** |
| `apollo_people_match` / `apollo_people_bulk_match` (getting the email) | **1 per person** |

**The enrichment credit is charged per attempt, not per success.** A person Apollo
holds no email for still costs a credit. That is exactly why Step 2 exists: search
is free, so use it to eliminate wrong and missing people *before* paying for them.

Check the balance first with `apollo_users_api_profile` (`include_credit_usage: true`)
and read `lead_credit.left_over`. Credits reset monthly and **do not roll over**.
If the remaining balance is smaller than the work list, say so and agree a `limit`
rather than running until it fails halfway.

**Never set `reveal_phone_number`, `run_waterfall_email` or `run_waterfall_phone`
without asking the user first.** They are asynchronous, cost extra, and waterfall
pricing varies by plan. We already have phones; the email is the job.

## Step 1 — Get the work list

```
adana_targets_needing_enrichment(gateway_api_key: "${GATEWAY_API_KEY}", limit: 100)
```

Returns one entry per contact with no email, least-recently-attempted first:
`{ contact_id, first_name, last_name, contact_type, address, city, state,
has_mobile, already_attempted, property_status }`.

Three fields change how you treat a row:

- **`contact_type: "broker"`** — Apollo's sweet spot. A named agent at a brokerage
  is exactly what its database indexes.
- **`contact_type: "owner"`** — often an LLC, trust or estate rather than a person
  (`Robinson John C & Martha A`, `Mountain Manor, Inc.`). Apollo indexes *people*,
  so expect these to fail. **Don't spend credits on an obvious entity name**; leave
  them for `lexisnexis-contact-lookup`, which searches public records by address.
- **`address` / `city` / `state`** — the **property's** location, not the person's.
  It is still the best disambiguator available, because a listing agent almost
  always works the market the listing is in. Use it to *verify*, not to filter.

Keep the `contact_id` with each person; you need it to write results back. If the
list is empty, say every contact already has an email and stop.

## Step 2 — Find the right person (free, and the step that makes this safe)

**Never enrich on a bare name.** `apollo_people_match` with only a name will
happily return a hollow record — no employer, no employment history, no email —
for a *different* person of the same name, and charge you for it. Verified on
2026-08-05: a name-only match returned a record whose ID matched neither of the
two real people the search then found.

For each contact:

```
apollo_mixed_people_api_search(
  q_keywords: "<first_name> <last_name>",
  person_locations: ["<state name>"],        # or ["<City>, <ST>"] in dense metros
  per_page: 5
)
```

Two rules learned the hard way:

- **Put only the name in `q_keywords`.** Adding "commercial real estate" or a firm
  name over-constrains the query and returns zero results for people who are
  plainly there. Narrow with `person_locations`, not with keywords.
- **Use the state, not the city, unless the metro is dense.** A broker listing a
  property in Nunnelly TN is based in Nashville.

### Confirming the match

Search returns `title`, `organization.name`, `organization.domain` and
`linkedin_url` at no cost. Accept a candidate only when it holds up:

- **Title or company is real estate.** "Vice President, Industrial Brokerage
  Services", "Commercial Real Estate Broker", or a firm like Colliers, NAI, Lee &
  Associates, Marcus & Millichap. A "System Administrator at a title company" is
  the wrong Frank Martone.
- **Geography agrees** with the property's market.
- **The phone area code agrees**, when you have one. This is the strongest signal
  available and costs nothing: a `+1 239…` contact matching a firm whose number is
  also `239` is near-conclusive for that market.

If several candidates survive, or none is clearly right, **record a miss and move
on**. A confident wrong match is far worse than a gap — it puts Adana's outreach in
front of a stranger. On the reference run, "Ed Brown" returned fourteen people and
not one in real estate; the correct action was to skip him.

Note the Apollo `id` of each confirmed person. That exact id is what Step 3 uses.

## Step 3 — Enrich the confirmed people (this is what costs)

Batch the confirmed ids, **maximum 10 per call**:

```
apollo_people_bulk_match(
  details: [ { id: "<apollo id>" }, ... ]     # ids from Step 2, never from memory
)
```

Pass **only `id`**. Supplying names alongside it invites Apollo to re-match and
undoes the verification you just did.

From each result keep: `email`, `email_status`, `organization.name`,
`organization.domain`, `title`, `linkedin_url`.

- **Prefer `email_status: "verified"`.** Anything else — `unavailable`, `guessed`,
  `unverified` — record but flag; do not treat it as a send-ready address.
- **Check the email domain against the company.** A mismatch (`organization.name`
  says one firm, the email is `@another.com`) usually means a recent move or a
  parent brand, and is worth a note rather than silent acceptance.

Write each batch to `$APOLLO_DIR/results_<date>.json` (default `apollo/`) as you
go, so a long run can be resumed and a human can audit which candidate was chosen
for each contact:

```python
import json, os, datetime
apollo_dir = os.environ.get("APOLLO_DIR", "apollo")
os.makedirs(apollo_dir, exist_ok=True)
path = os.path.join(apollo_dir, f"results_{datetime.date.today().isoformat()}.json")
```

Record the rejects too, with the reason — `no match`, `ambiguous`, `owner entity`.
A run that spent no credits on 40 contacts should be able to show *why*.

## Step 4 — Write the emails back (gateway)

```
adana_save_contact_lookups(
  gateway_api_key: "${GATEWAY_API_KEY}",
  results: [ { contact_id, emails: ["<verified work email>"], matched_name, notes }, ... ]
)
```

**Send `emails` only. Never send `phones`.**

Most of these contacts already carry a phone that came straight off the CoStar
listing — a more reliable number than anything a database will infer. The gateway
takes `phones[0]` as the contact's mobile, so passing a phone here can *replace* a
good listing number with a worse one. `has_mobile: true` on the work-list row is
the signal: that contact is here for the email and nothing else.

Put the firm and the verification basis in `notes`, e.g.
`"Apollo verified · VP Industrial, Lee & Associates · 239 area code matches"`.
That is the audit trail for why this address was believed.

The gateway sets `enrichment_status: enriched` only when an **email** arrives, and
promotes the property out of `needs_enrichment`. Relay the returned
`{run_id, enriched, not_found, phone_only}`.

## Reporting back

Lead with the funnel, because each stage fails for a different reason and each has
a different fix:

> *"120 on the work list → 71 confirmed in Apollo (59%) → 64 verified emails
> (90% of those). 49 not found: 31 no Apollo match, 18 owner entities left for
> LexisNexis. 64 credits spent, 454 remaining."*

Always state:

- **Credits consumed and remaining** — they are finite and reset monthly.
- **How many were left for LexisNexis**, so the manual pass has a known scope.
- **Any `email_status` that was not `verified`**, and any company/domain mismatch.

Reference figures from the 2026-08-05 test of 20 brokers: **58% confirmed**, **90%
of those returned a verified email**, **~52% end to end**, at about **2.2 cents per
email**. Use these to sanity-check a run — a yield far below this usually means the
work list is mostly owner entities rather than brokers, not that Apollo is failing.

## Edge cases

- **Apollo tools missing**: the connector isn't registered. Stop and ask the user
  to add it; never substitute a guessed email pattern.
- **Out of credits** (`lead_credit.left_over` is 0): stop and report how many
  remain unworked. Credits reset monthly; do not switch to waterfall to get around
  it without asking.
- **Search returns 0 for someone who obviously exists**: drop the location filter
  and retry once with the name alone. If still nothing, it's a genuine miss.
- **A common name with no real-estate candidate**: record a miss. Do not pick the
  closest-looking person.
- **Owner entities** (`Smith Family Trust`, `ABC Holdings LLC`): skip without
  spending a credit and note them as LexisNexis work.
- **Empty work list**: every contact already has an email — say so and stop.
- **Gateway key rejected**: stop and ask the user to re-run `/adana-dsa:adana-setup`
  with a valid `adana_live_…` key.
