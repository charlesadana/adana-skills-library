---
name: adana-setup
description: >-
  First-time setup for the Adana deal-sourcing plugin — configure the gateway
  API key, register the gateway and Apollo connectors, create the working folders,
  point the browser's download location at the export folder, confirm Claude
  computer for the one skill that still drives a browser, and write the workspace
  CLAUDE.md so adana.md loads automatically on every session.
area: Setup
use_for: "Run once to wire up the Adana plugin in a new workspace: gateway API key, connector registration (gateway + Apollo), working folders, browser download location, and CLAUDE.md creation."
deps:
  mcp: []
  gateway: []
  files: []
  env: []
---

# Adana — First-Time Setup

Walk the user through each step in order. Confirm completion before moving to the next. This only needs to run once per workspace.

## When to invoke

- User says "set up", "setup", "configure", "install", or "first time"
- Any skill errors because `GATEWAY_API_KEY` is missing or rejected

## Arguments

| Argument | Meaning |
|---|---|
| `-- project created` | User is already inside the project session. **Skip the project-creation prompt** and begin at Step 2. |

## Step 1 — Cowork project

All skill runs happen inside a **Cowork project**. This is required — setup cannot complete without an active project session. Every later step (folders in Step 5, `.claude/settings.local.json`, `CLAUDE.md` in Step 6) writes relative to whatever directory the current session is rooted in — nothing re-checks that later. If this session isn't rooted in the user's real Adana working folder, those writes land in the wrong place, and simply re-running setup afterward won't find or repair a misplaced `CLAUDE.md` or `exports/` folder — it will just write another copy wherever the new session happens to be rooted.

If this invocation includes `-- project created`, the user has already completed the steps below in the correct session — skip straight to Step 2.

Otherwise, ask the user:
> Are you running this inside the Cowork project you want to use for Adana day-to-day? Setup will write config here that loads the Adana agent automatically on every session.

A bare "yes" is not enough on its own — if there's any doubt this is a real, already-created project session (e.g. this looks like the first message in a fresh default session, or the user seems unsure what a Cowork project is), treat it as "no."

If they say no, or you're unsure, walk them through creating one:

> Let's get your project set up. In Cowork:
> 1. Look for **Projects** just below the chat input area
> 2. Click **"Create a new Project"** → **"Use an existing folder"** (point it at their Adana working folder)
> 3. Name the project (e.g. "Adana")

Once the project is created, ask the user to:
1. Click the project name to **open its session**
2. Inside that project session, run:
   ```
   /adana-dsa:adana-setup -- project created
   ```

**Do not continue in this session.** This session's working directory cannot be trusted once the user has needed to create a new project — every write from Step 5 onward depends on being rooted in the correct folder, and setup will resume correctly from Step 2 once re-invoked inside the right session.

## Step 2 — Gateway API key

The gateway dashboard is **invite-only**. If the user has never signed in, they need an invite before this step can proceed — ask a gateway admin to send one, then come back.

Ask:
> Go to **[gateway.adanacap.com](https://gateway.adanacap.com)** → sign in → **Settings → API Keys** → generate a new key (starts with `adana_live_…`). Paste it here.

If they hit the login wall, stop here — there is no way around it and the rest of setup is pointless without a key.

Once they paste the key, write it to `.claude/settings.local.json` at the workspace root, under `env`. Read the existing file first and preserve every other key — only add or update `GATEWAY_API_KEY`. Never overwrite the file wholesale.

```json
{
  "env": {
    "GATEWAY_API_KEY": "adana_live_…"
  }
}
```

If the file doesn't exist, create it. Confirm: "Gateway API key saved."

This file is what the skills actually read at runtime — via the `load_credentials()` snippet that Step 6 embeds into `CLAUDE.md`. Scheduled runs do not inject env vars automatically, so **both halves are required**: the key here, and the loader there. Setting one without the other leaves the Monday collection run with no `GATEWAY_API_KEY`.

## Step 3 — Gateway connector

The Adana gateway must be registered as a custom connector so Claude can call `adana_*` tools.

Ask the user to add it in Cowork:
1. Go to **Settings → Connectors → "Add custom connector"**
2. **Name:** `gateway`
3. **URL:** `https://gateway.adanacap.com/api/mcp`
4. Click **Connect**

Ask: "Have you added the gateway connector?" Wait for confirmation before moving on.

### 3b. Apollo connector (for email lookup)

`apollo-email-lookup` finds broker emails through Apollo's API. Apollo ships as a
**ready-made connector** — it is not a custom URL like the gateway. Ask the user to:

1. Go to **Settings → Connectors**
2. Find **Apollo.io** in the available connectors and click **Connect**
3. Complete the Apollo sign-in / authorisation prompt

There is no API key to paste — Apollo authorises via OAuth in that flow.

> **Check the tool names once it's connected.** The skill's `allowed-tools` assume
> the tools arrive as `mcp__apollo__*`. Connectors are sometimes registered under a
> longer label, which would make them `mcp__apollo_io__*` or similar. If the skill
> reports the Apollo tools as missing while the connector is plainly connected,
> that prefix is why — check the real names and correct the skill's frontmatter.

This connector is **optional**: skip it if the user doesn't have an Apollo
subscription. Everything else still works, and contact enrichment falls back to
`lexisnexis-contact-lookup` alone — slower and manual, but functional.

## Step 4 — Who does what

Set expectations here. **Nothing in this plugin drives a browser** — Claude never
signs into a source, never clicks through a UI, and never enters credentials. Work
arrives as files, and the only automated calls go to the gateway and Apollo APIs.

| Skill | Where its input comes from | Who does what |
|---|---|---|
| `costar-saved-search` | CoStar export in `exports/` | **You export; the skill processes the file** |
| `reonomy-saved-search` | Reonomy CSV in `exports/` | **You export; the skill processes the file** |
| `lexisnexis-contact-lookup` | a worksheet in `lexisnexis/` | **The skill writes the list; you run the lookups; the skill reads your results back** |
| `apollo-email-lookup` | the Apollo API | Fully automatic — no file, no login |

So the sign-ins that matter are **theirs**, in their own browser, on their own time:

- **CoStar** (`product.costar.com`) — to produce the export.
- **Reonomy** (`app.reonomy.com`) — to produce the off-market export, if they use it.
- **LexisNexis** (`advance.lexis.com`, Public Records access) — to run the person lookups.

There is no computer-use or browser-automation setup to do. If they have used an
earlier version of this plugin, say so explicitly — it used to drive their browser,
and that is the one habit that has changed.

## Step 5 — Project working folders + browser download location

Everything moves between the user and the skills as **files in the project folder**. CoStar exports arrive there, LexisNexis work lists leave and come back there, and Apollo writes its run log there.

This is the step with a foot in two worlds: **the user's browser runs on their own machine; the skills run in the Cowork sandbox.** The project folder is visible to both, so that's the handover point — and getting it wrong is why a file "downloaded fine" but the skill can't see it.

### 5a. Create the folders

Create these under the project root (cwd — the same folder that holds `CLAUDE.md` and `.claude/`):

```python
import os
for d in ("exports", "lexisnexis", "apollo"):
    os.makedirs(d, exist_ok=True)
```

```
exports/      — CoStar .xlsx (the user exports), Reonomy .csv (Claude downloads)
lexisnexis/   — worklist_<date>.csv out to the user, results_<date>.csv back
apollo/       — results_<date>.json: which candidate was matched to each contact, and why
```

Only `exports/` receives browser downloads. `lexisnexis/` is a two-way workspace
between the user and the skill, and `apollo/` is a run log the skill writes for
auditing.

**One export folder, not one per source.** The browser has a *single* global download location — it cannot be set per-site. So CoStar and Reonomy files both land in `exports/`, and the skills tell them apart by filename (`CostarExport*.xlsx` vs Reonomy's `.csv`).

### 5b. Record the paths

Write them into `.claude/settings.local.json` under `env`. Read the file first and preserve every other key — only add or update these:

```json
{
  "env": {
    "ADANA_EXPORT_DIR": "exports",
    "LEXISNEXIS_DIR": "lexisnexis",
    "APOLLO_DIR": "apollo"
  }
}
```

They are also written into `CLAUDE.md` under `## Workspace Defaults` in Step 6 — that copy is what a scheduled run reads with zero lookups. Both are required; `settings.local.json` is the fallback.

### 5c. Point the browser at the export folder

This is a **convenience, not a requirement**: with it set, their exports land in
`exports/` by themselves instead of having to be moved out of Downloads each time.
Skipping it costs them one drag per export and nothing else.

Get the **host-side absolute path** to the project's `exports/` — the path as the user's own machine sees it, not the sandbox path. Ask them for it if you can't determine it (in Cowork the project was created from an existing folder, so they know where it is).

Then:
> In your browser: **Settings → Downloads → Location** → set it to `<host path>/exports`
>
> Also turn **"Ask where to save each file" OFF**, so downloads don't stop on a save dialog each time.

**This is a global browser setting**, so everything they download from now on lands there — not just Adana exports. Say so plainly; don't let them discover it later. If they'd rather not change it, that's fine — they just move the export into `exports/` by hand after each download.

It applies to Reonomy exports too — both sources download into the same folder.

### 5d. Confirm the round-trip

Do not take this on trust — a file that "downloaded fine" but landed somewhere the sandbox can't see is the most common way a run fails, and it looks identical to an empty search.

Ask the user to download any small file in the browser. Then check that it appears in the export folder from the sandbox:

```python
import os
print(os.listdir(os.environ.get("ADANA_EXPORT_DIR", "exports")))
```

If the file isn't there, the download location is pointing at a folder the sandbox can't see. Fix it now, or agree that they will move exports in by hand — but establish which, because the skills will report "no export found" either way.

## Step 6 — Create workspace CLAUDE.md

This is the step that makes the Adana agent load automatically on every session. Read `agents/adana.md` from the adana-skills-library, strip its YAML frontmatter, and embed it into `CLAUDE.md` at the workspace root.

### 6a. Locate adana.md

The agent definition ships with the plugin. The skill runs inside the **Cowork sandbox** (Ubuntu Linux VM, regardless of host OS), so the canonical search location is `$CLAUDE_CONFIG_DIR/**/agents/adana.md`. The host-OS patterns are fallbacks for the rare case this runs outside Cowork.

```python
import glob, os

# Cowork-first: $CLAUDE_CONFIG_DIR is the canonical plugin root inside the sandbox
# (e.g. /sessions/<name>/mnt/.claude). $HOME/.claude is a secondary location.
config_dir = os.environ.get("CLAUDE_CONFIG_DIR")

patterns = []
if config_dir:
    patterns.append(os.path.join(config_dir, "**/agents/adana.md"))
patterns.extend([
    os.path.expanduser("~/.claude/**/agents/adana.md"),                              # Linux / Cowork sandbox $HOME
    os.path.expandvars(r"%APPDATA%\Claude\**\agents\adana.md"),                      # Windows host
    os.path.expanduser("~/Library/Application Support/Claude/**/agents/adana.md"),   # macOS host
])

found = [f for p in patterns for f in glob.glob(p, recursive=True)]

if found:
    adana_md_path = os.path.abspath(os.path.realpath(found[0]))
    adana_md_content = open(adana_md_path, encoding="utf-8").read()
else:
    adana_md_path = ""
    adana_md_content = ""
```

**Why `$CLAUDE_CONFIG_DIR` first:** Cowork runs all skill code inside a sandboxed Ubuntu VM. The Windows and macOS patterns can never match inside the sandbox (they point at the user's host OS, which isn't reachable from skill code). `$CLAUDE_CONFIG_DIR` is the env var Cowork sets to point at the mounted plugin tree, so it's the only pattern guaranteed to find `adana.md` inside Cowork. The `~/.claude` pattern works in some Cowork configurations via bindfs mounts but isn't reliable.

If the search returns empty, ask the user:
> I couldn't auto-detect `agents/adana.md`. Can you paste the **full absolute path** to it? (Hint: in Cowork, run `echo $CLAUDE_CONFIG_DIR` and look under that directory.)

After they paste a path, normalize, validate, and read:

```python
user_path = os.path.abspath(os.path.expanduser(os.path.expandvars(user_input.strip().strip('"').strip("'"))))
assert os.path.isfile(user_path), f"File not found: {user_path}"
adana_md_path = user_path
adana_md_content = open(adana_md_path, encoding="utf-8").read()
```

### 6b. Strip frontmatter and extract the version

Strip the YAML frontmatter — it is a plugin-loader directive and has no meaning inside `CLAUDE.md`:

```python
import re, datetime

body = re.sub(r'^---\s*\n.*?\n---\s*\n', '', adana_md_content, count=1, flags=re.DOTALL).lstrip()

version_match = re.search(r'\|\s*Adana\s*\|\s*(v[\S]+)\s*\|\s*([^|\n]+)\s*\|', adana_md_content)
version = version_match.group(1).strip() if version_match else "unknown"
version_date = version_match.group(2).strip() if version_match else "unknown"
embed_date = datetime.date.today().isoformat()
```

### 6c. Write CLAUDE.md

Build the workspace block below and write it to `CLAUDE.md` at the workspace root. Substitute `{BODY}` (the stripped `adana.md` body from 6b), `{version}`, `{version_date}`, and `{embed_date}`.

We embed the **full content** of `agents/adana.md` rather than a path reference, so the workspace is self-contained — scheduled runs and fresh clones still get the agent identity, because Claude auto-loads `CLAUDE.md` at session start.

````markdown
# Adana Capital — Workspace Instructions

## Agent Identity (auto-loaded every session)

The full content of `agents/adana.md` is embedded below. It defines the gateway connection rules, the pipeline, the hard rules, and the working discipline. All skill runs depend on it.

<!-- BEGIN agents/adana.md (embedded by adana-setup) -->
<!-- adana.md version: {version} | Last Changed: {version_date} | Embedded: {embed_date} -->

{BODY}

<!-- END agents/adana.md -->

---

## Credential Loading (REQUIRED — read this first on every run)

Scheduled and automated runs do **not** automatically inject environment variables from `.claude/settings.local.json`. You must load them manually at the start of every skill run using this snippet:

    import os, json
    from pathlib import Path

    def load_credentials():
        search = Path(os.getcwd())
        for p in [search] + list(search.parents):
            settings_file = p / ".claude" / "settings.local.json"
            if settings_file.exists():
                data = json.loads(settings_file.read_text())
                for k, v in data.get("env", {}).items():
                    if not os.environ.get(k):
                        os.environ[k] = v
                return True
        return False

    load_credentials()

Run this **before** reading `GATEWAY_API_KEY`. Every `adana_*` tool call takes it as its first argument. If it is still missing after this step, stop and tell the user to re-run `/adana-dsa:adana-setup` — do not proceed and do not silently skip persistence.

---

## Workspace Defaults

Hardcoded here at setup time so any session — including a scheduled run — has them immediately, with no env lookup. They are also mirrored into `.claude/settings.local.json` `env` as a fallback.

- **Exports:** `exports/` (env: `ADANA_EXPORT_DIR`) — **the browser's download location points here.** Both CoStar and Reonomy exports land in this one folder; the browser has only a single global download location, so they are told apart by filename.
- **LexisNexis working dir:** `lexisnexis/` (env: `LEXISNEXIS_DIR`)
- **Apollo working dir:** `apollo/` (env: `APOLLO_DIR`)

**Fallback rule:** if a value above looks empty or stale (e.g. this `CLAUDE.md` was copied from another workspace), run the credential loader and read from env instead:

    export_dir = os.environ.get("ADANA_EXPORT_DIR", "exports")

## Workspace Structure

    exports/            — the browser's download location
      ├─ CostarExport*.xlsx   — CoStar, exported by you (Industrial saved layout)
      ├─ *.csv                — Reonomy
      └─ .processed.json      — which exports have already been ingested
    lexisnexis/         — the two-way workspace for person lookups
      ├─ worklist_<date>.csv  — written for you: who still needs an email
      └─ results_<date>.csv   — what you found, read back and written to the gateway
    apollo/
      └─ results_<date>.json  — which Apollo person was matched to each contact, and why
    .claude/settings.local.json  — GATEWAY_API_KEY + the folder paths above

All paths are **relative to the project root** (cwd). Nothing here is the source of truth — the gateway is. These are working artifacts.

Exports accumulate — nothing is deleted automatically, so an old file sits there looking exactly like a fresh one. `.processed.json` is how the CoStar skill tells them apart: it records which exports have already been ingested, so a scheduled run picks up only what's new and never double-counts. **Don't delete it** unless you intend the whole folder to be treated as unprocessed.
````

**If `CLAUDE.md` already exists:**
- If it contains the markers `<!-- BEGIN agents/adana.md (embedded by adana-setup) -->` and `<!-- END agents/adana.md -->`, replace everything between (and including) them with the freshly read `{BODY}` wrapped in the same markers **and a refreshed version stamp**. Leave the rest of the file untouched.
- **Legacy format (v0.2.0–v0.2.2):** those versions wrote a bare block marked `<!-- BEGIN agents/adana.md (embedded by setup) -->` — note `setup`, not `adana-setup` — with no `## Agent Identity` heading and no Credential Loading section. If you find that marker, replace the entire legacy block with the full workspace block above. A workspace left in the legacy shape has no credential loader, so its scheduled runs cannot authenticate.
- Otherwise, **prepend** the new workspace block above all existing content. The agent identity must lead the file.

**If `CLAUDE.md` does not exist:** create it with the full workspace block above.

Show the user a unified diff before writing.

### 6d. Verify

Read back `CLAUDE.md` and confirm:
- the `BEGIN`/`END` markers are present and the version stamp matches `adana.md`'s Maintenance version
- the `## Credential Loading` section with the `load_credentials()` snippet is present
- the `## Workspace Defaults` and `## Workspace Structure` sections are present and name the three folders

> ✅ CLAUDE.md created — the Adana agent, the credential loader, and the folder paths will load automatically on every session, including scheduled runs.

## Step 7 — Schedule the two weekly jobs

From here, two jobs run on their own as **separate** Cowork tasks, staggered on the same Monday:

- **CoStar collection** — exports the CoStar saved search and ingests it (properties land in `needs_enrichment`).
- **Apollo email lookup** — finds work emails via API for the contacts CoStar just queued.

They are separate on purpose and run in that order, because the second depends on the first: there is nothing to enrich until collection has created the contacts. One combined task would force enrichment to run inside the same block as the collection it depends on.

**Apollo is the only job that is fully unattended.** It is a plain API call — seconds per contact, no browser, no login, nothing to place beforehand. It runs whether or not anyone did anything that morning.

**The CoStar task is a poller.** It doesn't log into CoStar; it checks `exports/` and processes anything it hasn't seen before. Explain it that way:

> Drop your CoStar exports into `exports/` whenever you like — Monday morning, or across the week. The scheduled job checks that folder and processes anything new. If nothing new is there it just says so and stops, and it never reprocesses a file it has already done. Several exports waiting is fine: it takes them one at a time.

That is why the export doesn't have to be timed to the job. The skill tracks what it has already ingested in `exports/.processed.json`, so the schedule is simply how often it looks.

**LexisNexis is not scheduled.** The lookups are the user's own work — 15–20 seconds a person, judging each match — so there is nothing for a scheduled job to do beyond writing a list nobody is there to work. Run `/adana-dsa:lexisnexis-contact-lookup` by hand, and expect the list to be short now that Apollo runs first.

**Reonomy is not scheduled either.** Run `/adana-dsa:reonomy-saved-search` on demand when you want off-market owners; its output flows into the same enrichment queue.

**What puts a property into Gate 1 is the CoStar run itself**, not a later cron. `costar-saved-search` scores each property as it ingests it (its "Qualify and write back" step), and the gateway promotes the ones that have a contact and a strong enough conviction score. The gateway's Tuesday screen only refreshes the deterministic price baseline — it does not qualify anything. So if a week's CoStar run doesn't happen, nothing new reaches Gate 1 that week; there is no cron that will catch up on the judgment for you.

**Use Cowork's `/schedule` — do not ask the user to click through settings.** Invoke `/schedule` directly **once per task**, giving it the name, frequency, and prompt. Cowork asks them to confirm, and each task appears on its Scheduled page.

Ask the user for **two** times on Monday (defaults: **CoStar 9 AM**, **Apollo 11 AM**). Leave a couple of hours between them so collection has finished before the lookup starts. Then create both:

**Task 1 — `Adana · CoStar Collection`** · frequency **Weekly, Monday** at the first time:

```
Run /adana-dsa:costar-saved-search to completion. It checks exports/ for any CoStar export not yet processed and ingests each one.
If nothing new is there, say so and stop — never reprocess a file already recorded in exports/.processed.json.
Then summarise the counts returned by the gateway (new properties found, updated, contacts, queued for enrichment).
```

**Task 2 — `Adana · Apollo Email Lookup`** · frequency **Weekly, Monday** at the second time:

```
Run /adana-dsa:apollo-email-lookup to completion. It works the gateway's list of contacts that still have no email — whatever CoStar queued this morning, plus anything still outstanding from previous weeks.
Then summarise: how many were confirmed and enriched, how many are left for a manual LexisNexis pass, and how many Apollo credits remain.
```

If the user has no Apollo subscription, create Task 1 only and say plainly that enrichment is then entirely manual.

**Both schedules live in Cowork only.** To see or change when they run, open Cowork → Scheduled. There is no other copy.

Then tell the user plainly:

> These jobs only run while this computer is on and Cowork is running. If it's off on Monday, that week's run is missed — and there's no catch-up for properties that aged off CoStar in the meantime. So: **keep an eye on the gateway → Runs page.** If a Monday goes by with no new CoStar or Apollo run logged, something is wrong — open Cowork and check the Scheduled tab.

## Done

Summarise what was configured:
- Gateway API key saved to `.claude/settings.local.json`
- Gateway connector registered; Apollo connector registered (or skipped)
- No browser automation to configure — every skill works from files or APIs
- Working folders created (`exports/`, `lexisnexis/`, `apollo/`); browser downloads land in `exports/` (round-trip verified)
- CLAUDE.md created — Adana agent + credential loader + workspace defaults
- Two weekly tasks scheduled for Mondays: `Adana · CoStar Collection`, then `Adana · Apollo Email Lookup`
- Run on demand: `/adana-dsa:reonomy-saved-search` for off-market owners, `/adana-dsa:lexisnexis-contact-lookup` for whatever Apollo can't resolve

Then set the rhythm out plainly, because **one part of it is theirs**:

> **You, whenever:** drop CoStar exports into `exports/`. No need to time it to the job.
> **Monday 9 AM:** the CoStar job picks up anything new — properties in, scored, the strong ones into Gate 1. Nothing new, nothing happens.
> **Monday 11 AM:** Apollo looks up the missing emails on its own.
> **When you have time:** run LexisNexis on whatever Apollo couldn't resolve, and Reonomy if you want off-market owners.
> **Then:** review Gate 1 and approve outreach.

Two things worth stating so they aren't discovered later:

- **The judgment is the skill's, not a cron's.** The gateway decides *which* scored properties reach Gate 1, but it never scores one itself. No CoStar run that week means nothing new to review that week.
- **Nothing catches up.** A missed Monday is a missed week; properties that aged off CoStar in the meantime are simply gone.
