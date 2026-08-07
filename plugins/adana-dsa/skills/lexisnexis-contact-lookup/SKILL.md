---
name: lexisnexis-contact-lookup
description: >-
  Find the missing EMAIL for Adana's contacts (and any missing phone) using
  LexisNexis Public Records. Writes a work-list spreadsheet from the gateway's
  enrichment queue — contacts without an email, on properties already judged worth
  the lookup — which the user works through in LexisNexis themselves, then
  reads their completed sheet back from the project folder and writes the results
  through the gateway. Use this whenever the user wants to "enrich contacts",
  "find owner emails/phones", "run LexisNexis / Nexis / SmartLinx / Accurint" or
  "skip trace" a list, or says they have finished a batch and want it loaded. Run
  it after apollo-email-lookup, on whatever Apollo could not resolve.
allowed-tools: mcp__gateway__adana_targets_needing_enrichment mcp__gateway__adana_save_contact_lookups
area: Enrichment
use_for: "Emit a work-list sheet of contacts missing an email, then read the user's completed LexisNexis results back from the project folder and write the emails/phones through the gateway."
deps:
  mcp: []
  gateway: ["adana_targets_needing_enrichment", "adana_save_contact_lookups"]
  files: ["lexisnexis/worklist_<date>.csv (write)", "lexisnexis/results_<date>.csv (read)"]
  env: ["gateway_api_key", "LEXISNEXIS_DIR"]
---

# LexisNexis contact lookup → write back

**The job is the email.** Adana reaches people by email, and an email is the one
detail its sources rarely supply — CoStar gives phones, Reonomy gives owner
shells. So this skill works one list: the enrichment queue — contacts with no
email, on properties already judged worth the lookup.

**The user runs the lookups; you handle the list and the write-back.** SmartLinx
is a per-person interactive report that needs a human to judge whether it is
describing the right individual, so the work splits in two:

1. **Out** — you write a work-list spreadsheet: one row per contact, `contact_id`
   included.
2. **Back** — they fill in what they found and save it to the project folder; you
   read it, match on `contact_id`, and write it through the gateway.

`contact_id` is what makes the round trip exact. **Tell the user not to delete,
reorder or edit that column** — a row without it can't be matched to anything.

**Run this after `apollo-email-lookup`.** Apollo is an unattended API call that
resolves brokers at real firms in seconds; this is manual work at 15–20 seconds a
person. Apollo first means the sheet only holds people who genuinely need a human —
typically owner entities and private individuals.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's
  **Credential Loading** section before the first `adana_*` call.
- For the read-back half: the user's completed results file in the project's
  `lexisnexis/` folder (`$LEXISNEXIS_DIR`).
- The user has **LexisNexis / Nexis with Public Records access** for their half.
  Nothing here signs in on their behalf.

LexisNexis access is governed by DPPA/GLBA permissible-use rules the user has
already attested to. **The permissible-use selection on the form is theirs to
make** — never advise them to change it.

## Step 1 — Get the work list

```
adana_targets_needing_enrichment(gateway_api_key: "${GATEWAY_API_KEY}", limit: 100)
```

Returns one entry per contact with no email, least-recently-attempted first:
`{ contact_id, first_name, last_name, contact_type, address, city, state,
has_mobile, already_attempted, property_status }`.

If the list is empty, say the enrichment queue is drained and stop. That does
**not** mean every contact has an email — it means nothing currently in the queue
is missing one. Plenty of contacts elsewhere in the pipeline still lack an
address; they simply have not earned a lookup yet.

**The list is the QUEUE, already shortlisted — do not filter or rank it further.**
It contains only contacts on properties in `needs_enrichment`, and a property
earns that place by clearing the conviction bar, or — for a listing with no asking
price, which can never be scored — by a site shape worth a broker call. Every row
is one somebody has already decided is worth the work.

**Run `apollo-email-lookup` first.** It works this same queue by API, unattended
and at trivial cost, so whatever reaches your sheet is what Apollo could not
resolve: private individuals and owner entities, which is exactly what SmartLinx
is better at. Running it first is what keeps the user's sheet short.

- **`has_mobile: true`** — the phone is already known, so only the email is
  missing. This drives the `already_has_phone` column, which is what stops a good
  listing number being overwritten.
- **`already_attempted: true`** — a previous sheet found no email for them. These
  sort to the back and come round again. Pass `include_attempted: false` to send
  out only never-attempted contacts.

**If the user is returning with a completed sheet**, skip to Step 3 — there's no
need to generate new work first.

**Agree a size before writing the sheet.** Each lookup is 15–20 seconds of the
user's time: 100 people is about half an hour, 500 is most of an afternoon. Ask
what they want to take on and pass it as `limit`. Ordering is
least-recently-attempted first, so a capped list always holds the most neglected
contacts.

An ad-hoc list of their own is fine to help with, but those rows have no
`contact_id` and **cannot be written back**. Say so before they spend time on it.

## Step 2 — Write the work-list sheet

```python
import csv, os, datetime

lex_dir = os.environ.get("LEXISNEXIS_DIR", "lexisnexis")
os.makedirs(lex_dir, exist_ok=True)
today = datetime.date.today().isoformat()
worklist_path = os.path.join(lex_dir, f"worklist_{today}.csv")

BLANKS = ["email", "phone", "phone_listed_to", "matched_name", "notes"]
COLS = ["contact_id", "first_name", "last_name", "contact_type",
        "property_address", "city", "state", "already_has_phone", "search_by"] + BLANKS

with open(worklist_path, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(COLS)
    for p in work_list:                                  # from Step 1
        w.writerow([
            p["contact_id"], p.get("first_name") or "", p.get("last_name") or "",
            p.get("contact_type") or "", p.get("address") or "",
            p.get("city") or "", p.get("state") or "",
            "yes" if p.get("has_mobile") else "no",
            "name + address" if p.get("contact_type") == "owner" else "name + state only",
        ] + [""] * len(BLANKS))

print(f"Wrote {worklist_path}: {len(work_list)} people to look up.")
```

Then tell them where it is and what the columns mean — **especially the two that
stop results being wrong**:

> `lexisnexis/worklist_{today}.csv` is ready — {n} people.
>
> - Fill in **`email`** wherever you find one. That's the column that matters; the rest are a bonus.
> - **`search_by`** tells you how to search each row. Owners: use the property address, they usually live at or near it. Brokers: **name + state only** — a listing agent doesn't live at the property, and putting that address in the form produces confident-looking wrong matches.
> - **`already_has_phone: yes`** means we already have a good number from the listing. Leave `phone` blank for those unless you're certain the report's number is the same person — otherwise we'd replace a better number with a worse one.
> - **Don't touch `contact_id`** — it's how results get matched back.
> - Save it as **`lexisnexis/results_{today}.csv`** when you're done and tell me.

### Whose phone is it? — pass this on

If they intend to fill in `phone` at all, they need this, because the consequence
lands on Adana's outreach rather than on them.

The SmartLinx **Phone Summary** is not a list of the target's phones. The person's
own numbers usually carry their name; **relatives' numbers — spouse, children,
anyone sharing the report — carry other names**, and the listing-name column is
what tells them apart. The gateway stores exactly one `mobile` per contact, so a
spouse's number recorded here is the number Adana would contact.

So `phone` should be the number whose **listing name matches the contact**, with
`phone_listed_to` recording whose name it was under. If none match, leave `phone`
blank and put `phones may belong to relatives` in `notes`.

## Step 3 — Read the completed sheet back

```python
import csv, glob, os

lex_dir = os.environ.get("LEXISNEXIS_DIR", "lexisnexis")
files = glob.glob(os.path.join(lex_dir, "results_*.csv"))
if not files:
    raise SystemExit(f"No results_*.csv in {lex_dir}/ — ask the user where they saved it.")
newest = max(files, key=os.path.getmtime)

with open(newest, newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

def val(r, k):
    v = (r.get(k) or "").strip()
    return v or None

filled     = [r for r in rows if val(r, "contact_id")]
with_email = [r for r in filled if val(r, "email")]
print(f"{os.path.basename(newest)}: {len(rows)} rows, {len(with_email)} with an email")
```

**Validate before writing anything back.** The sheet has been through a
spreadsheet application and a human, so check rather than assume:

- **Missing or altered `contact_id`** — skip the row and count it. It can't be
  matched, and guessing from the name risks writing an email onto the wrong
  contact.
- **An `email` with no `@`** — skip it. A note like "not found" typed into that
  column would otherwise be stored as a live address and mailed.
- **Entirely blank rows** — a legitimate "looked, found nothing". Count them.
- **`contact_id`s that weren't on the work list you wrote** — flag it. Usually an
  older sheet, which risks writing stale results over newer data.

### If they ask how to run the lookups

Relay this; don't do it for them:

> In LexisNexis (`advance.lexis.com`) → **Public Records** tab → under **People**,
> **SmartLinx® Comprehensive Person Report**. Fill First Name, Last Name, City and
> State — plus Street Address only for `owner` rows. On the results list take the
> top-ranked match, sanity-check the city/state, then open the report: **Person
> Summary** carries the email list, and **Phone Summary (N)** in the left panel has
> the full phone table with the listing name for each number.

Public Records indexes **individuals**, so it finds personal emails well and
brokerage work emails poorly. If broker rows come back empty that's expected — say
so, and note that `apollo-email-lookup` is the better tool for those.

## Step 4 — Write the results back

```python
payload = []
for r in filled:
    email = val(r, "email")
    if email and "@" not in email:       # a note typed into the email column
        continue
    phone = val(r, "phone")
    entry = {"contact_id": r["contact_id"]}
    if email:
        entry["emails"] = [email]
    # Only send a phone when one was recorded AND we didn't already have one.
    if phone and (r.get("already_has_phone") or "").strip().lower() != "yes":
        entry["phones"] = [phone]
    if val(r, "matched_name"):
        entry["matched_name"] = val(r, "matched_name")
    if val(r, "notes"):
        entry["notes"] = val(r, "notes")
    if len(entry) > 1:                   # something was actually found
        payload.append(entry)
```

```
adana_save_contact_lookups(
  gateway_api_key: "${GATEWAY_API_KEY}",
  results: payload
)
```

`phones[0]` and `emails[0]` become the contact's primary mobile and email.

**Omit a field the user didn't fill rather than sending an empty list.** The
gateway writes only what you supply, so leaving `phones` off preserves the number
CoStar already provided — which is exactly what the `already_has_phone` filter
above does. Sending an uncertain phone would overwrite a listing-sourced number
with a person-report guess.

The gateway advances the contact's property out of `needs_enrichment` and returns
`{run_id, enriched, phone_only, not_found, promoted_to_gate1}`.

**`promoted_to_gate1` is the number that matters.** A property that had already
earned Gate 1 and was only missing an address goes straight to `qualified` rather
than waiting to be re-read. `enriched` counts addresses found; this counts deals
unlocked. Report both.

**`enrichment_status` becomes `enriched` only when an EMAIL was found.** A
phone-only result counts as `phone_only`: real progress, but the contact stays on
the work list, because the email is still missing.

## Reporting back

One line from the gateway's counts, e.g. *"40 on the sheet: 22 emails found, 3
phones only (still no email, back on the list), 15 blank; 2 rows skipped — one had
no contact_id, one had text in the email column."*

State explicitly rather than bury:

- **`phone_only`** — these didn't get what they came for and remain on the list.
  Reporting them as enriched overstates the run.
- **skipped rows and why.** A silently dropped row looks identical to one the user
  simply couldn't find anything for.
- **the relatives warning**, if they flagged any — that's the one that puts
  outreach in front of the wrong person.

If the work list was capped, say how many contacts are still outstanding.

## Edge cases

- **Empty work list**: the enrichment queue is drained — stop and say so. Do not
  report it as "every contact has an email"; it means nothing currently queued is
  missing one, which is a much smaller claim.
- **No `results_*.csv` yet**: they haven't finished, or saved it elsewhere. Ask —
  don't reprocess an older sheet.
- **Results file older than the work list you just wrote**: they saved over a
  previous batch, or you're looking at the wrong file. Confirm before writing;
  stale results can overwrite newer data.
- **`contact_id` column missing entirely**: the sheet was rebuilt in a way that
  dropped it. Nothing can be matched — ask them to redo it from the work-list file
  rather than guessing by name.
- **No emails found at all**: not necessarily failure. If the sheet was mostly
  brokers, Public Records doesn't index their work emails. Say which contact types
  were on it, and suggest `apollo-email-lookup` for those.
- **Gateway key rejected**: stop and ask the user to re-run
  `/adana-dsa:adana-setup` with a valid `adana_live_…` key.
