---
name: lexisnexis-contact-lookup
description: >-
  Find the missing EMAIL for Adana's contacts (and any missing phone) using
  LexisNexis Public Records (the SmartLinx Comprehensive Person Report). Takes
  the work list from the Adana gateway — every contact that still has no email,
  whatever its property's pipeline status — or from a spreadsheet the user names,
  runs each person through the report in the user's logged-in browser, writes the
  results back through the gateway, and drops a CSV deliverable. Use this whenever
  the user wants to "enrich contacts", "find owner emails/phones", "run LexisNexis
  / Nexis / SmartLinx / Accurint", or "skip trace" a list. Drives the user's
  already-logged-in browser via Claude computer (computer use).
allowed-tools: mcp__gateway__adana_targets_needing_enrichment mcp__gateway__adana_save_contact_lookups
area: Enrichment
use_for: "Pull every contact still missing an email from the gateway (or a spreadsheet), look up emails/phones via LexisNexis SmartLinx, write the results back, and produce a CSV."
deps:
  mcp: ["Claude computer (computer use)"]
  gateway: ["adana_targets_needing_enrichment", "adana_save_contact_lookups"]
  files: ["lexisnexis/results.json (read+write)", "lexisnexis/output_<date>.csv (write)"]
  env: ["gateway_api_key", "LEXISNEXIS_DIR"]
---

# LexisNexis contact lookup → write back

**The job is the email.** Adana reaches people by email through Instantly, and an
email is the one detail its sources rarely supply — CoStar gives phones, Reonomy
gives owner shells. So this skill works one list: **every contact that still has
no email**, whether that's a Reonomy owner, a no-contact CoStar listing, or a
broker whose phone is already known. Results are **written back through the
gateway**, and a CSV deliverable is left in the working folder.

Read `agents/adana.md` first for the gateway connection rules and the
`${GATEWAY_API_KEY}` convention.

## Prerequisites

- Claude computer (computer use) is connected and a browser window is open on the controlled computer.
- The user is signed into **LexisNexis / Nexis** with **Public Records** access
  (top nav shows a "Public Records" tab). If not, ask them to sign in — never
  enter credentials.
- `GATEWAY_API_KEY` is loaded — run `load_credentials()` from CLAUDE.md's
  **Credential Loading** section before the first `adana_*` call. Scheduled runs
  do not inject it automatically.

A note on responsible use: LexisNexis access is governed by DPPA/GLBA
permissible-use rules the user has already attested to. **Leave the
permissible-use selection on the form exactly as it is** — it is the user's legal
declaration to make, not something to toggle.

## Step 1 — Get the work list

**Default — from the gateway.** Call `adana_targets_needing_enrichment`:

```
adana_targets_needing_enrichment(gateway_api_key: "${GATEWAY_API_KEY}", limit: 100)
```

Returns one entry per contact still missing an email, least-recently-attempted
first:
`{ contact_id, first_name, last_name, contact_type, address, city, state,
has_mobile, already_attempted, property_status }`.
Keep the `contact_id` with each person — you need it to write results back. If the
list is empty, say there's nothing pending and stop.

**The work list is "no email yet" — nothing to do with pipeline status.** A
property can already be `qualified` (it had a phone, which is enough to reach
Gate 1) and still appear here, because Instantly sends email and it hasn't got
one. That is intended: the goal is an email for every contact. Disqualified
properties are the only ones excluded.

- **`has_mobile: true`** — the phone is already known, so **only the email is
  missing**. Don't spend the run re-collecting numbers; if the report shows no
  email, that person's lookup added nothing.
- **`already_attempted: true`** — a previous run looked and found no email. These
  sort to the back and are retried, so a long run may revisit people. Pass
  `include_attempted: false` to work only fresh contacts.

**Alternative — from a spreadsheet**, when the user names one (an ad-hoc list not
yet in the pipeline). Read the xlsx/csv and map its columns onto
`first_name, middle, last_name, address, city, state`, being forgiving about
header spelling and case (`First`, `first_name`, `FName`…). Keep the original row
order. Spreadsheet rows have **no `contact_id`**, so they can't be written back to
the gateway — they produce the CSV only. Say so before starting.

If the list is large (say >25), tell the user roughly how long it'll take (each
lookup is ~10–20s of browser work) and confirm before charging ahead — each report
may incur account usage. **The list can be hundreds** now that CoStar contributes
a contact per listing; at ~15s each, 100 people is ~25 minutes and 500 is over
two hours. Agree a `limit` up front rather than starting an open-ended run. The
ordering is least-recently-attempted first, so a capped run always works the
most-neglected contacts and the rest come round on the next run.

### Resume a previous run

`results.json` exists so a crash at person #97 doesn't lose the first 96 — a
batch of 100 is 20–30 minutes of browser work, and on a scheduled run nobody is
watching.

**It must not outlive the run it belongs to.** The work list now *deliberately*
returns people a previous run failed to find an email for, so they get another
try. A `results.json` that persists across runs would put every one of them in
`done` and skip them forever — silently defeating the retry. So the file is
**rotated when it's stale**: an entry from a run that has already finished is
archived rather than treated as done.

```python
import json, os, datetime

STALE_AFTER_HOURS = 6      # longer than any single batch, shorter than any gap between runs

# work_list = the people from Step 1 (gateway targets, or the spreadsheet rows)
lex_dir = os.environ.get("LEXISNEXIS_DIR", "lexisnexis")
os.makedirs(lex_dir, exist_ok=True)
results_path = os.path.join(lex_dir, "results.json")

results = []
if os.path.exists(results_path):
    age_h = (datetime.datetime.now().timestamp() - os.path.getmtime(results_path)) / 3600
    if age_h > STALE_AFTER_HOURS:
        # A finished run, not an interrupted one — archive it and start clean, or
        # everyone it already tried would be skipped for good.
        stamp = datetime.datetime.fromtimestamp(os.path.getmtime(results_path)).strftime("%Y%m%d_%H%M")
        os.rename(results_path, os.path.join(lex_dir, f"results_{stamp}.json"))
        print(f"Archived results.json from {stamp} ({age_h:.0f}h old) — starting a fresh run.")
    else:
        with open(results_path, encoding="utf-8") as f:
            results = json.load(f)

done = {r.get("contact_id") for r in results if r.get("contact_id")}
todo = [p for p in work_list if p.get("contact_id") not in done]
if results:
    print(f"Resuming — {len(done)} already done this run, {len(todo)} to go.")
```

Spreadsheet rows have no `contact_id`, so they can't be deduped this way — a
re-run repeats them. Say so if the user resumes a spreadsheet batch.

## Step 2 — Open the Person Report form (once)

Open a browser window on the controlled computer, then:

1. Go to `https://advance.lexis.com` (lands on authenticated Nexis home if signed
   in; if it shows the public gateway, the user isn't logged in — stop and ask).
2. Click the **Public Records** tab.
3. Under **People**, click **SmartLinx® Comprehensive Person Report**. This opens
   a Form Search with: SSN, LexID, First Name, Middle Name/Initial, Last Name,
   Street Address, City, State (dropdown), Zip.

Locate each field visually from a fresh screenshot and click it before typing,
rather than reusing pixel coordinates across steps — layouts shift as the page
loads, and stale coordinates are the #1 cause of mis-typed forms. Screenshot to
confirm before and after filling.

## Step 3 — Search each person

### First: is this an owner or a broker?

The work list returns `contact_type`, and it changes how you search. **The
`address` field is always the *property's* address, not the person's.**

- **`owner`** — the property address is a genuine signal (they own it, often live
  at or near it). Use it. This is the case the workflow was designed for.
- **`broker`** — a listing agent does **not** live at the property. Filling the
  Street Address field with it produces confident-looking wrong matches. Search
  on **name + state only**, treat the result as low confidence, and set `notes`
  to `"broker — address is the listing, not the person"`.

**Run both types — the goal is an email for every contact.** Don't skip brokers.
Do set expectations: a Public Records person report indexes *individuals*, so it
finds personal emails well and brokerage work emails poorly. If broker rows come
back consistently empty, say so and suggest the brokerage website as a better
source for those — but that's a recommendation to the user, not a reason to leave
them un-attempted.

### `has_mobile: true` — do not overwrite a good phone

Most contacts arrive with a phone already (CoStar supplies one per listing) and
are here **only** for the email. For those, `phones[0]` from a person report can
*replace* a number that came straight off the listing — a clear downgrade if the
match is imperfect.

So when `has_mobile` is true: **omit `phones` from the write-back entirely**
unless the report's phone is both listing-name-matched to the contact and clearly
the same person. Send the email and nothing else. Record the phones in
`results.json` and the CSV either way — that costs nothing and keeps the audit
trail.

### Then, for each contact still on the list:

1. Fill **First Name**, **Last Name**, **City**, **Street Address** where you have
   values — and **Middle Name/Initial** when you have one. More fields mean fewer
   false matches. *(The gateway work list carries no middle name — `contacts` has
   no such column — so this only applies to spreadsheet input.)* Per the rule
   above, **skip Street Address entirely for `broker` rows.**
2. Set the **State** dropdown: click it, type the full state name (e.g. `Texas`)
   so the native select jumps to it; verify via screenshot.
3. Click **Search**.
4. On the results list, pick the **top-ranked result** as the primary match.
   Sanity-check it against the input before opening: does the city/state or a
   nearby metro match? Does the middle name/initial line up? **Note how many
   results came back** — that count is a confidence signal.
5. Open the full **SmartLinx Person Report**. The **Person Summary** shows name,
   address, a primary phone, and an **Email** list. Click **Phone Summary (N)** in
   the left-hand "Content Included in Report" panel for the full phone table —
   each row carries the number, an active date range, line type, the **listing
   name** (who it's registered to), and carrier.

### Whose phone is it? — read this before recording anything

The Phone Summary is **not** a list of the target's phones. The primary person's
own numbers usually carry their name; **relatives' numbers — spouse, children,
anyone sharing the report — carry other names.** The listing-name column is what
tells them apart.

This matters far more here than it did on the old spreadsheet workflow. The
gateway stores exactly **one** `mobile` per contact and takes **`phones[0]`**, and
that number is what any SMS outreach would use. If a spouse's number is first in
your list, Adana cold-contacts the spouse — and per the rule above, on a
`has_mobile` contact it would also have destroyed a good number to do it.

So:
- Record **every** phone on the report, but **order them so numbers whose listing
  name matches the contact come first.** Index 0 must be the person's own number.
- If **no** phone's listing name matches the contact, still record them, and set
  `notes` to `"phones may belong to relatives — verify"`. Do not silently promote
  a stranger's number to primary.
- Keep the listing name alongside each phone in `results.json` so a human can
  audit the choice later.

Collect, per person:
- `matched_name` — the full name on the report (e.g. "Sorensen, Nick Hugh")
- `phones` — every number, **best-match-first** per the rule above
- `phone_listings` — the listing name for each phone, same order (for the audit trail)
- `emails` — every address in the Email list
- `result_count` — how many results the search returned
- `notes` — a short confidence flag: `"city match"`, `"no city match — verify"`,
  `"no results"`, `"multiple strong matches"`, `"phones may belong to relatives — verify"`

**Append to `results.json` after each person** — not at the end. That file is the
resume point.

```python
def record(person, found):
    entry = {**person, **found}
    results.append(entry)
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
```

### When the search is messy
- **No results**: record empty phones/emails + `notes: "no results"`; move on.
  Don't retry variations unless asked.
- **Many results, none clearly right**: take the closest on city/state, flag it in
  `notes`, keep going. Don't silently guess.
- **Masked/restricted data**: some fields are masked depending on permissible use.
  Phones and emails are normally visible; record what's shown.

## Step 4 — Write the results back (gateway)

For everyone with a `contact_id` (i.e. from the gateway work list), call
**`adana_save_contact_lookups`** — batch the whole run:

```
adana_save_contact_lookups(
  gateway_api_key: "${GATEWAY_API_KEY}",
  results: [ { contact_id, phones: [...], emails: [...], matched_name, notes }, ... ]
)
```

`phones[0]` and `emails[0]` become the contact's primary mobile and email — which
is why Step 3's ordering rule is load-bearing. Fold the `result_count` into
`notes` when it signals low confidence (e.g. a single weak match, or dozens);
the gateway has no separate field for it.

**Omit a field you didn't find rather than sending an empty list.** The gateway
only writes the values you supply, so leaving `phones` off preserves the phone
CoStar already provided; sending a phone you're unsure about overwrites it.

The gateway writes what you supply onto each contact and promotes the contact's
property from `needs_enrichment` → `enriched`. Relay the returned
`{run_id, enriched, not_found, phone_only}`.

**`enrichment_status` becomes `enriched` only when an EMAIL was found.** A
phone-only result counts as `phone_only`: real progress, but the contact stays on
the work list for a future attempt, because the email is still missing. Report
`phone_only` explicitly — *"9 enriched, 3 found phones only (still no email), 2
no results"* — rather than folding it into the enriched count.

Spreadsheet-sourced rows have no `contact_id` — skip them here; they still land in
the CSV.

## Step 5 — Write the CSV deliverable

One row per person; phone and email columns fan out to whoever has the most, so
the sheet stays rectangular.

```python
import csv, datetime

FIXED = [("first_name", "First Name"), ("last_name", "Last Name"),
         ("middle", "Middle"), ("address", "Address"), ("city", "City"),
         ("state", "State"), ("matched_name", "Matched Name"),
         ("result_count", "Result Count"), ("notes", "Notes")]

def as_list(v):
    if v is None:
        return []
    if isinstance(v, str):
        v = [v]
    return [str(x).strip() for x in v if x is not None and str(x).strip()]

max_p = max((len(as_list(r.get("phones"))) for r in results), default=0)
max_e = max((len(as_list(r.get("emails"))) for r in results), default=0)

header = [label for _, label in FIXED]
header += [f"Phone {i}" for i in range(1, max_p + 1)]
header += [f"Email {i}" for i in range(1, max_e + 1)]

out = os.path.join(lex_dir, f"output_{datetime.date.today().isoformat()}.csv")
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(header)
    for r in results:
        row = ["" if r.get(k) is None else str(r.get(k, "")) for k, _ in FIXED]
        phones, emails = as_list(r.get("phones")), as_list(r.get("emails"))
        row += phones + [""] * (max_p - len(phones))
        row += emails + [""] * (max_e - len(emails))
        w.writerow(row)

print(f"Wrote {out}: {len(results)} people, "
      f"{sum(1 for r in results if as_list(r.get('phones')) or as_list(r.get('emails')))} with at least one contact.")
```

Phones are already best-match-first, so `Phone 1` is the person's own number
wherever the listing name allowed that call.

## Reporting back

One-line summary built from the gateway's counts, e.g. *"14 looked up: 9 emails
found, 3 phones only (still no email, back on the list), 2 no results; 1 has
phones that may belong to relatives — flagged in Notes."* Name the CSV path.
Don't dump every number into chat.

Two things to state explicitly rather than bury:
- **`phone_only`** — these did not get what they came for and remain on the work
  list. Reporting them as "enriched" overstates the run.
- **the relatives flag**, if it fired — that's the one that puts outreach in
  front of the wrong person.

If you worked a capped list, say how many contacts are still outstanding so the
user knows another run is due.

## Edge cases

- **Empty work list**: every contact already has an email — stop and say so.
- **`results.json` already covers the whole list**: this run is finished. Just
  regenerate the CSV; don't re-look-up. To force a fresh pass, delete the file.
- **A run that finds no emails at all**: not necessarily a failure — it may mean
  the list is mostly brokers, whose work emails Public Records doesn't index. Say
  which contact types you worked before concluding the tool is broken.
- **Gateway key rejected**: stop and ask the user to re-run
  `/adana-dsa:adana-setup` with a valid `adana_live_…` key.
- **Logged out of LexisNexis**: stop and ask the user to sign in.
