---
name: plugin-update
description: >-
  Catch an existing Adana workspace up to the latest plugin version — detects
  gaps since the last setup run and fills only what's missing (idempotent).
area: Setup
use_for: "Run after a git pull to detect and fill any gaps: missing env vars, unregistered connectors, export folders + browser download location, stale CLAUDE.md embed, new skill requirements."
deps:
  mcp: []
  gateway: []
  files: []
  env: []
---

# Plugin Update — Catch Existing Workspaces Up to Latest Plugin Version

You are the upgrade agent for the Adana plugin. The user has already run `/adana-dsa:adana-setup` at some earlier plugin version, and the plugin has since added new skills or changed requirements. Detect what's missing and fill **only the gaps** — never re-run steps that are already complete.

This skill is **idempotent**. Running it twice in a row produces a clean "nothing to do" report on the second pass.

## When to invoke

- After pulling a new version of the adana-skills-library (`git pull`)
- When a skill errors with a missing env var or unregistered MCP
- User says "update", "upgrade", "catch up", "what's missing", "plugin-update"

## How this differs from setup

| Aspect | `adana-setup` | `plugin-update` |
|---|---|---|
| When | First time | After a plugin upgrade |
| Greenfield | Yes — writes everything | No — fills gaps only |
| Re-asks for known data | Yes | No — reuses what's on disk |

If `CLAUDE.md` doesn't exist at the workspace root, exit and tell the user to run `/adana-dsa:adana-setup` first.

---

## Step 0 — Determine version gap

Read the **installed** plugin version from `agents/adana.md` (the Maintenance table `Version` column). Then read the **last-applied** version from the `CLAUDE.md` stamp at the workspace root.

Locate `agents/adana.md` with the same Cowork-first search `adana-setup` Step 6a uses — `$CLAUDE_CONFIG_DIR` glob, then host-OS fallbacks, then ask the user for an absolute path.

```python
import glob, os, re

config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
patterns = []
if config_dir:
    patterns.append(os.path.join(config_dir, "**/agents/adana.md"))
patterns.extend([
    os.path.expanduser("~/.claude/**/agents/adana.md"),
    os.path.expandvars(r"%APPDATA%\Claude\**\agents\adana.md"),
    os.path.expanduser("~/Library/Application Support/Claude/**/agents/adana.md"),
])
found = [f for p in patterns for f in glob.glob(p, recursive=True)]
if not found:
    raise SystemExit("Could not locate agents/adana.md — ask the user for the full absolute "
                     "path (in Cowork: echo $CLAUDE_CONFIG_DIR).")

adana_md_path = os.path.abspath(os.path.realpath(found[0]))
adana_md = open(adana_md_path, encoding="utf-8").read()

# Installed version — from the agents/adana.md Maintenance table
version_match = re.search(r'\|\s*Adana\s*\|\s*(v[\S]+)\s*\|', adana_md)
installed_version = version_match.group(1).strip() if version_match else "unknown"

# Last-applied version — from the CLAUDE.md stamp at the workspace root
claude_md = open("CLAUDE.md", encoding="utf-8").read()
stamp_match = re.search(r'<!--\s*adana\.md version:\s*(v[\S]+)\s*\|', claude_md)
last_applied = stamp_match.group(1).strip() if stamp_match else "unknown"
```

If `last_applied == installed_version`, the plugin is already current. Report that and stop.

If `last_applied == "unknown"`, treat as `v0.0.0` (full audit).

Show the user:
> Plugin version: `{last_applied}` → `{installed_version}`

Then read each skill's frontmatter `name` from `skills-manifest.json` to know which skills exist now vs. what was present at `last_applied`. Skills with no version tracking are noted as "introduced in this version" if they didn't appear in `last_applied`.

---

## Step 1 — Detect current state (read-only)

Inspect silently — no prompts yet, just look. Tag each item as ✅ / ❌ / ⏭.

### 1a. Env vars

Read `.claude/settings.local.json` (**search up from cwd** — same lookup the `load_credentials()` snippet performs). Check the `env` block:

| Env var | Required since | Status |
|---|---|---|
| `GATEWAY_API_KEY` | v0.1.0 | present / missing |
| `ADANA_EXPORT_DIR` | v0.3.0 | present / missing |
| `LEXISNEXIS_DIR` | v0.3.0 | present / missing |
| `APOLLO_DIR` | v0.6.0 | present / missing |

If `GATEWAY_API_KEY` is present, do a quick sanity check: verify it starts with `adana_live_` (prefix only — don't call the gateway yet).

### 1a-2. Working folders + browser download location (v0.3.0)

Everything now moves between the user and the skills as files in these folders, which makes them load-bearing.

| Item | Required since | Status |
|---|---|---|
| `exports/` exists | v0.3.0 | present / missing |
| `lexisnexis/` exists | v0.3.0 | present / missing |
| `apollo/` exists | v0.6.0 | present / missing |
| the browser's download location points at `exports/` | v0.3.0 | **ask the user — cannot be probed** |

`lexisnexis/` is now a two-way workspace (worklist out, results back) rather than a
scratch folder, and `apollo/` is a run log — neither is a download target.

The browser setting lives on the user's machine, not in the sandbox — there is no way to read it from here. Ask:

> Is your browser's download location (Settings → Downloads → Location) set to this project's `exports/` folder, with "Ask where to save each file" turned **off**?

As of v0.6.0 this is a **convenience** for CoStar rather than a requirement: the user exports by hand, so if downloads go elsewhere they can simply move the file into `exports/`. It is still **required for `reonomy-saved-search`**, where Claude drives the download unattended and cannot dismiss a native save dialog.

Either way, establish which it is. The failure looks the same from inside the sandbox — the export "worked" and the folder is empty — and it surfaces on a Monday with nobody watching.

### 1b. Connectors

Probe the gateway by attempting a low-cost call (`adana_log_run` with a dry-run flag). If the tool is unavailable or returns an auth error, the connector is not registered.

For Apollo, just check whether the `mcp__apollo__*` tools are present in this session — do **not** spend a credit probing it.

| Item | Required since | Status |
|---|---|---|
| `gateway` connector registered | v0.1.0 | present / missing |
| `apollo` connector registered | v0.6.0 | present / missing / **not applicable** |

**Apollo is optional.** If the user has no Apollo subscription, record it as ⏭ not ❌ and move on — the pipeline still runs, with `lexisnexis-contact-lookup` doing all enrichment by hand. Only flag it as a gap if they say they do have Apollo.

If the tools are missing but the user insists the connector is connected, the likely cause is the tool-name prefix: `apollo-email-lookup` assumes `mcp__apollo__*`, and a connector registered under a longer label produces something else. Check the real names before concluding it isn't set up.

### 1c. CLAUDE.md

Check `CLAUDE.md` at the workspace root:

| Item | Required since | Status |
|---|---|---|
| File exists | v0.2.0 | present / missing |
| Contains `<!-- BEGIN agents/adana.md` block | v0.2.0 | present / missing |
| Block uses the current `(embedded by adana-setup)` marker | v0.2.3 | current / **legacy** |
| Contains `## Agent Identity` heading | v0.2.3 | present / missing |
| Contains `## Credential Loading` block with the `load_credentials()` snippet | v0.2.3 | present / missing |
| Contains `## Workspace Defaults` naming the folders | v0.3.0 | present / missing |
| Contains `## Workspace Structure` | v0.3.0 | present / missing |
| Version stamp matches installed version | v0.2.0 | match / stale |

A stale stamp means the CLAUDE.md was written at an older version and needs refreshing — the embedded `adana.md` body may be out of date.

**A missing Credential Loading block is a required gap, not cosmetic.** Scheduled runs do not inject env vars from `.claude/settings.local.json`. Without the loader, the Monday collection run starts with no `GATEWAY_API_KEY` and every `adana_*` call fails.

**Legacy shape (v0.2.0–v0.2.2).** Those versions wrote a bare block marked `<!-- BEGIN agents/adana.md (embedded by setup) -->` — `setup`, not `adana-setup` — with no `## Agent Identity` heading and no Credential Loading section. Detecting that marker means all three rows above are gaps at once, and the workspace's scheduled runs cannot authenticate. Step 3c rebuilds it from scratch rather than swapping the marker.

### 1d. New skill requirements

For each skill in `skills-manifest.json`, check whether its `deps.env`, `deps.mcp` and `deps.files` entries are satisfied. As of v0.3.0:

| Skill | Needs | Checked in |
|---|---|---|
| `costar-saved-search` | `GATEWAY_API_KEY`, `ADANA_EXPORT_DIR` | 1a, 1a-2 |
| `reonomy-saved-search` | `GATEWAY_API_KEY`, `ADANA_EXPORT_DIR` | 1a, 1a-2 |
| `lexisnexis-contact-lookup` | `GATEWAY_API_KEY`, `LEXISNEXIS_DIR` | 1a, 1a-2 |
| `apollo-email-lookup` *(new in v0.6.0)* | `GATEWAY_API_KEY`, `APOLLO_DIR`, `apollo` connector | 1a, 1a-2, 1b |

**No skill requires Claude computer (computer use) any more** (v0.6.0). Every skill up to v0.5.x that drove the user's browser now works from a file instead: CoStar and Reonomy from exports the user places in `exports/`, LexisNexis from a work-list spreadsheet they fill in. Apollo was API-only from the start.

Nothing needs uninstalling — computer use simply stops being used. But **tell the user**, because the change is in their habits rather than in the config: they now export from CoStar and Reonomy themselves, and run the LexisNexis lookups themselves. Nothing will error to signal it; the first sign would otherwise be a scheduled run reporting "nothing new to process" week after week.

As new skills are added with different deps, add rows here.

### 1e. Scheduled tasks

Scheduled tasks cannot be probed — they live in Cowork's scheduler only. Ask the user what they see under Cowork → Scheduled.

As of **v0.6.0** the two scheduled tasks are **CoStar Collection** and **Apollo Email Lookup**. The rule is now explicit: *only jobs that can run with nobody watching get a schedule.*

**`Adana · LexisNexis Enrichment` is retired as a scheduled task** (it was introduced in v0.4.0). It drives a logged-in browser and needs a human present — to keep the session alive and to judge ambiguous matches. Left on a schedule it stalls on a sign-in prompt, or saves a confident wrong match with nobody watching. It becomes an on-demand skill, and Apollo takes its slot for the part that genuinely automates.

> In Cowork → Scheduled, do you see **"Adana · CoStar Collection"** and **"Adana · Apollo Email Lookup"**? And are either of the older **"Adana · LexisNexis Enrichment"** or **"Adana · Weekly Collection"** still listed?

| Item | Required since | Status |
|---|---|---|
| `Adana · CoStar Collection` scheduled | v0.4.0 | present / missing |
| `Adana · Apollo Email Lookup` scheduled | v0.6.0 | present / missing / ⏭ no Apollo |
| `Adana · LexisNexis Enrichment` **removed** | v0.6.0 | removed / **still present** |
| Legacy `Adana · Weekly Collection` removed | v0.4.0 | removed / **still present** |

Two migrations can be outstanding at once. A workspace last set up at **v0.2.x** has the single combined task and none of the current ones. A workspace at **v0.4.0–v0.5.x** has CoStar plus the LexisNexis task that now needs deleting. Step 3d handles both.

Leaving the LexisNexis task scheduled is not harmless: it runs unattended every Monday, blocks on the browser, and writes a `reply_sync`-style failed run — or worse, records a wrong-person match nobody reviewed.

---

## Step 2 — Show the gap report

Show a compact summary before doing anything. Example format:

```
[adana-dsa] Plugin Update — Gap Report
Plugin version: v0.5.2 → v0.6.0

Env vars
  ✅ GATEWAY_API_KEY · ADANA_EXPORT_DIR · LEXISNEXIS_DIR
  ❌ APOLLO_DIR                          (new in v0.6.0)

Connectors
  ✅ gateway registered
  ❌ apollo not connected                (new in v0.6.0 — optional)

Working folders
  ✅ exports/ · lexisnexis/
  ❌ apollo/ — not created
  ❓ browser download location — needs your confirmation

CLAUDE.md
  ⚠️  Version stamp stale (v0.5.2 embedded, v0.6.0 installed)
  ⚠️  Workspace Defaults missing apollo/  (new in v0.6.0)

Scheduled tasks
  ✅ Adana · CoStar Collection
  ❌ Adana · Apollo Email Lookup          (new in v0.6.0)
  ⚠️  "Adana · LexisNexis Enrichment" still scheduled — retired, delete it (Step 3d)

Skills changed since v0.5.2
  🆕 apollo-email-lookup — finds work emails through Apollo's API. No browser,
      no login, ~2c per contact, so it can run unattended. Run it BEFORE
      LexisNexis; the manual pass then only handles what Apollo can't. (v0.6.0)
  ⚠️  NO skill drives your browser any more. (v0.6.0)
      costar-saved-search / reonomy-saved-search — YOU export into exports/,
        the skill picks up anything it hasn't processed yet.
      lexisnexis-contact-lookup — it writes you a worklist CSV, you run the
        lookups, it reads your results back.
  ⚠️  LexisNexis is no longer scheduled — the lookups are your own work.
      It stays available on demand. (v0.6.0)

→ 2 required gaps · 1 optional connector · 1 retired task to remove · ready to fix?
```

**Say the workflow change out loud in the report.** The two skills above still have
the same names and still do the same job, so nothing errors — the user simply finds
that Monday now needs an export from them. Discovering that when a scheduled run
reports "no export found" is a bad way to learn it.

Ask:
> Want me to fill these gaps now? I'll skip anything you say "skip" to.

If nothing to do: report clean and stop.

---

## Step 3 — Fill gaps interactively

Walk through each ❌ or ⏭ item. Skip anything already ✅. Accept "skip" at any point.

### 3a. GATEWAY_API_KEY missing

Delegate to `/adana-dsa:adana-setup` Step 2. Ask the user to paste the key; write it to `.claude/settings.local.json`.

### 3b. Connector not registered

- **Gateway** — delegate to `/adana-dsa:adana-setup` Step 3: Settings → Connectors → Add custom connector.
- **Apollo** (v0.6.0) — delegate to `/adana-dsa:adana-setup` Step 3b. It is a ready-made connector, not a custom URL, and authorises via OAuth with no key to paste. Skip without complaint if the user has no Apollo subscription.

### 3b-2. Working folders / browser download location missing (v0.3.0)

Delegate to `/adana-dsa:adana-setup` Step 5 in full — create the two folders, write the two env vars, walk the user through the browser's Settings → Downloads → Location, and **run the round-trip check** (have them download a file, then confirm it appears in `exports/` from the sandbox).

Do not skip the round-trip check just because the folders exist. A folder that exists but that the browser isn't pointing at looks identical from here, and is exactly the failure that breaks the Monday run.

### 3c. CLAUDE.md

**Always re-embed the full `agents/adana.md` body between the `BEGIN`/`END` markers — unconditionally, every run, regardless of whether any other CLAUDE.md gap was found.** Refreshing the stamp comment alone is wrong: after a `git pull` that adds skills or changes the gateway rules, the stamp would read the new version while the embedded body still describes the old one. Always replace the body too.

```python
import glob, os, re, datetime

# adana_md_path / adana_md were already resolved in Step 0 — reuse them.
body = re.sub(r'^---\s*\n.*?\n---\s*\n', '', adana_md, count=1, flags=re.DOTALL).lstrip()

version_match = re.search(r'\|\s*Adana\s*\|\s*(v[\S]+)\s*\|\s*([^|\n]+)\s*\|', adana_md)
version = version_match.group(1).strip() if version_match else "unknown"
version_date = version_match.group(2).strip() if version_match else "unknown"
embed_date = datetime.date.today().isoformat()

new_block = (
    f"<!-- BEGIN agents/adana.md (embedded by adana-setup) -->\n"
    f"<!-- adana.md version: {version} | Last Changed: {version_date} | Embedded: {embed_date} -->\n"
    f"\n"
    f"{body}\n"
    f"\n"
    f"<!-- END agents/adana.md -->"
)

claude_md = open("CLAUDE.md", encoding="utf-8").read()

# Case 1 — current format: replace everything between (and including) the markers.
if "<!-- BEGIN agents/adana.md (embedded by adana-setup) -->" in claude_md:
    claude_md_new = re.sub(
        r'<!-- BEGIN agents/adana\.md \(embedded by adana-setup\) -->.*?<!-- END agents/adana\.md -->',
        lambda m: new_block,   # lambda avoids re.sub's backslash interpretation in `body`
        claude_md, count=1, flags=re.DOTALL,
    )

# Case 2 — LEGACY format (v0.2.0–v0.2.2): marker said "(embedded by setup)", there was no
# "## Agent Identity" heading and no Credential Loading section. Such a workspace has no
# credential loader, so its scheduled runs cannot authenticate. Rebuild it from scratch via
# the full adana-setup Step 6c workspace block — do NOT just swap the marker.
elif "<!-- BEGIN agents/adana.md (embedded by setup) -->" in claude_md:
    claude_md_new = re.sub(
        r'<!-- BEGIN agents/adana\.md \(embedded by setup\) -->.*?<!-- END agents/adana\.md -->',
        lambda m: "__ADANA_FULL_WORKSPACE_BLOCK__",   # full Step 6c block, not just new_block
        claude_md, count=1, flags=re.DOTALL,
    )

# Case 3 — markers absent: do not partial-write here. Fall through to "missing entirely"
# and PREPEND the full Step 6c workspace block above all existing content.
else:
    claude_md_new = claude_md

if claude_md_new != claude_md:
    open("CLAUDE.md", "w", encoding="utf-8").write(claude_md_new)   # show the diff first
```

**Then patch any remaining gaps:**
- **Missing entirely** → create from scratch via the full `adana-setup` Step 6c flow.
- **Missing `## Credential Loading` block** → insert it **directly under the Agent Identity block**, verbatim from `adana-setup` Step 6c. Not at end-of-file — it must be adjacent to the identity it serves.
- **Missing `## Workspace Defaults` / `## Workspace Structure`** (pre-v0.3.0) → append both, verbatim from `adana-setup` Step 6c, naming `exports/` and `lexisnexis/`. Without them a scheduled run has no folder paths in context and must fall back to the env vars.

Show the user a unified diff before writing. Never overwrite content outside the managed markers.

**Verify after re-embed:** confirm the stamp matches `adana.md`'s current Maintenance version, and that a string unique to that version appears in the embedded body. If it doesn't, the body didn't get replaced — re-read the full text and retry.

### 3d. Scheduled tasks — migrate, then fill (v0.6.0)

The two current tasks are created by `/adana-dsa:adana-setup` Step 7. **Delete the retired tasks first**, so the workspace is never running old and new side by side. `/schedule` cannot delete, so both removals are manual steps for the user.

**First, any retired task still present:**

> Open Cowork → Scheduled and delete these if you see them, then tell me:
> - **"Adana · LexisNexis Enrichment"** — no longer scheduled. It needs someone at the browser, so an unattended run either stalls on a sign-in prompt or saves a match nobody checked. Run it by hand instead, on whatever Apollo couldn't resolve.
> - **"Adana · Weekly Collection"** — the pre-v0.4.0 combined task. It re-runs the whole pipeline in one block and keeps Reonomy on a schedule.

Wait for confirmation before creating anything, so the workspace never ends up with three or four tasks at once.

**Then create the two current tasks**, exactly as `adana-setup` Step 7 does — `/schedule` once per task. Create only what's missing:

- `Adana · CoStar Collection` — **Weekly, Monday**, first time (default 9 AM) → runs `/adana-dsa:costar-saved-search`.
- `Adana · Apollo Email Lookup` — **Weekly, Monday**, a later time (default 11 AM, after CoStar) → runs `/adana-dsa:apollo-email-lookup`. **Skip if the user has no Apollo subscription**, and tell them enrichment is then entirely manual.

**Neither Reonomy nor LexisNexis is scheduled** — both need a person at the browser. `/adana-dsa:reonomy-saved-search` and `/adana-dsa:lexisnexis-contact-lookup` run on demand. Do not recreate a task for either.

### 3e. New skill requirements (future)

When new skills are added that introduce new env vars or MCPs, add fill handlers here that match `/adana-dsa:adana-setup` steps for those specific items. Document the requirement and the version it was introduced. Right now no fill handler is needed beyond 3a–3d.

---

## Step 4 — Re-validate

Test only the items touched in Step 3.

- **GATEWAY_API_KEY** — call `adana_log_run` with a dry-run test entry. If it returns 200, key is valid.
- **Gateway connector** — probe `adana_log_run` again and confirm the connector responds.
- **CLAUDE.md** — read it back and confirm the version stamp matches `installed_version`, and that `## Credential Loading`, `## Workspace Defaults` and `## Workspace Structure` are all present.
- **Working folders** — confirm all three exist and all three env vars are set.
- **Apollo connector** — confirm the `mcp__apollo__*` tools are visible. Do not spend a credit proving it.
- **Browser download location** — run the round-trip check: have the user download any small file, then confirm it appears in `exports/` from the sandbox (`os.listdir("exports")`). Asking is not enough; this is the one that silently breaks the scheduled run.
- **Scheduled tasks** — ask the user to confirm `Adana · CoStar Collection` and `Adana · Apollo Email Lookup` now appear in Cowork → Scheduled, and that **both** retired tasks (`Adana · LexisNexis Enrichment`, `Adana · Weekly Collection`) are gone.

Show a result table:

| Item | Action | Status |
|---|---|---|
| GATEWAY_API_KEY | saved | ✅ validated |
| gateway MCP | registered | ✅ confirmed |
| CLAUDE.md | refreshed | ✅ stamp matches v0.2.0 |

---

## Step 5 — Record version stamp

The version stamp in `CLAUDE.md` is the record of what was last applied. Step 3c already updates it as part of the re-embed. Confirm the stamp is correct and report done:

> ✅ adana-dsa is up to date at `{installed_version}`. All skills are ready to run.
