---
name: plugin-update
description: >-
  Catch an existing Adana workspace up to the latest plugin version — detects
  gaps since the last setup run and fills only what's missing (idempotent).
area: Setup
use_for: "Run after a git pull to detect and fill any gaps: missing env vars, unregistered connectors, export folders + Chrome download location, stale CLAUDE.md embed, new skill requirements."
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

If `GATEWAY_API_KEY` is present, do a quick sanity check: verify it starts with `adana_live_` (prefix only — don't call the gateway yet).

### 1a-2. Working folders + Chrome download location (v0.3.0)

v0.3.0 replaced grid-scraping with **exports** — the old approach never completed on a real saved search. That makes the export folder load-bearing.

| Item | Required since | Status |
|---|---|---|
| `exports/` exists | v0.3.0 | present / missing |
| `lexisnexis/` exists | v0.3.0 | present / missing |
| Chrome's download location points at `exports/` | v0.3.0 | **ask the user — cannot be probed** |

The Chrome setting lives on the user's machine, not in the sandbox — there is no way to read it from here. Ask:

> Is Chrome's download location (Settings → Downloads → Location) set to this project's `exports/` folder, with "Ask where to save each file" turned **off**?

**This is the gap most likely to be silently wrong**, and it fails on a Monday morning with nobody watching: CoStar exports fine, the file lands in the user's normal Downloads folder, and the skill sees an empty directory.

### 1b. Gateway connector

Probe the gateway by attempting a low-cost call (`adana_log_run` with a dry-run flag). If the tool is unavailable or returns an auth error, the connector is not registered.

| Item | Status |
|---|---|
| `gateway` connector registered | present / missing |

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
| `costar-saved-search` | `GATEWAY_API_KEY`, `ADANA_EXPORT_DIR`, Chrome download location, Claude in Chrome | 1a, 1a-2, 1b |
| `reonomy-saved-search` | `GATEWAY_API_KEY`, `ADANA_EXPORT_DIR`, Chrome download location, Claude in Chrome | 1a, 1a-2, 1b |
| `lexisnexis-contact-lookup` | `GATEWAY_API_KEY`, `LEXISNEXIS_DIR`, Claude in Chrome | 1a, 1a-2, 1b |

As new skills are added with different deps, add rows here.

### 1e. Scheduled tasks

Scheduled tasks cannot be probed — they live in Cowork's scheduler only. Ask the user what they see under Cowork → Scheduled.

As of **v0.4.0** there are **two** separate weekly tasks. The single combined `Adana · Weekly Collection` was split: CoStar and LexisNexis now run as their own staggered Monday jobs, and Reonomy is no longer scheduled.

> In Cowork → Scheduled, do you see **"Adana · CoStar Collection"** and **"Adana · LexisNexis Enrichment"**? And is the old combined **"Adana · Weekly Collection"** still listed?

| Item | Required since | Status |
|---|---|---|
| `Adana · CoStar Collection` scheduled | v0.4.0 | present / missing |
| `Adana · LexisNexis Enrichment` scheduled | v0.4.0 | present / missing |
| Legacy `Adana · Weekly Collection` removed | v0.4.0 | removed / **still present** |

A workspace set up before v0.4.0 has the single combined task and neither of the two new ones — that's the migration Step 3d handles. The old task must be **deleted**, not left alongside the new ones: it keeps Reonomy on a schedule and re-runs the whole pipeline in one Monday block, double-collecting.

---

## Step 2 — Show the gap report

Show a compact summary before doing anything. Example format:

```
[adana-dsa] Plugin Update — Gap Report
Plugin version: v0.2.2 → v0.4.0

Env vars
  ✅ GATEWAY_API_KEY
  ❌ ADANA_EXPORT_DIR / LEXISNEXIS_DIR   (new in v0.3.0)

Connector
  ✅ gateway registered

Working folders
  ❌ exports/ · lexisnexis/ — not created
  ❓ Chrome download location — needs your confirmation

CLAUDE.md
  ⚠️  Version stamp stale (v0.2.2 embedded, v0.4.0 installed)
  ❌ Workspace Defaults / Workspace Structure missing (new in v0.3.0)

Scheduled tasks
  ❌ Adana · CoStar Collection · Adana · LexisNexis Enrichment   (split in v0.4.0)
  ⚠️  legacy "Adana · Weekly Collection" still scheduled — delete it (Step 3d)

Skills changed since v0.2.2
  ⚠️  costar-saved-search, reonomy-saved-search — now EXPORT instead of scraping
      the results grid (the old approach never completed on a real search).
      Requires the export folder + Chrome download location above. (v0.3.0)
  ⚠️  lexisnexis-contact-lookup — now resumable via lexisnexis/results.json,
      and orders phones by listing name so a relative's number can't become the
      primary contact. (v0.3.0)
  ⚠️  scheduling split into two staggered Monday tasks; Reonomy is now manual.
      Delete the old combined task and create the two above. (v0.4.0)

→ 5 required gaps · 1 legacy task to remove · 1 stale item · ready to fix?
```

Ask:
> Want me to fill these gaps now? I'll skip anything you say "skip" to.

If nothing to do: report clean and stop.

---

## Step 3 — Fill gaps interactively

Walk through each ❌ or ⏭ item. Skip anything already ✅. Accept "skip" at any point.

### 3a. GATEWAY_API_KEY missing

Delegate to `/adana-dsa:adana-setup` Step 2. Ask the user to paste the key; write it to `.claude/settings.local.json`.

### 3b. Gateway connector not registered

Delegate to `/adana-dsa:adana-setup` Step 3. Walk the user through Settings → Connectors → Add custom connector.

### 3b-2. Working folders / Chrome download location missing (v0.3.0)

Delegate to `/adana-dsa:adana-setup` Step 5 in full — create the two folders, write the two env vars, walk the user through Chrome → Settings → Downloads → Location, and **run the round-trip check** (have them download a file, then confirm it appears in `exports/` from the sandbox).

Do not skip the round-trip check just because the folders exist. A folder that exists but that Chrome isn't pointing at looks identical from here, and is exactly the failure that breaks the Monday run.

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

### 3d. Scheduled tasks missing or not yet split (v0.4.0)

The two weekly tasks are created by `/adana-dsa:adana-setup` Step 7. Fill whichever is missing, and migrate any workspace still on the old combined task.

**First, if the legacy `Adana · Weekly Collection` task still exists (pre-v0.4.0 workspace):** it must be deleted before creating the replacements — otherwise it keeps running Reonomy on a schedule and re-collecting the whole pipeline in one Monday block. `/schedule` cannot delete tasks, so this is a manual step for the user:

> You still have the old **"Adana · Weekly Collection"** task. Open Cowork → Scheduled, delete it, then tell me — I'll set up the two replacement tasks.

Wait for the user to confirm the deletion before creating the new tasks, so the workspace never ends up with all three scheduled at once.

**Then create the two tasks**, exactly as `adana-setup` Step 7 does — invoke `/schedule` once per task. Create only the one(s) missing; skip any the user already has:

- `Adana · CoStar Collection` — **Weekly, Monday**, first time (default 9 AM) → runs `/adana-dsa:costar-saved-search`.
- `Adana · LexisNexis Enrichment` — **Weekly, Monday**, a later time (default 2 PM, staggered after CoStar) → runs `/adana-dsa:lexisnexis-contact-lookup`.

**Reonomy is not scheduled** — it runs on demand via `/adana-dsa:reonomy-saved-search`, and its output is picked up by the next LexisNexis run. Do not recreate a Reonomy task.

### 3e. New skill requirements (future)

When new skills are added that introduce new env vars or MCPs, add fill handlers here that match `/adana-dsa:adana-setup` steps for those specific items. Document the requirement and the version it was introduced. Right now no fill handler is needed beyond 3a–3d.

---

## Step 4 — Re-validate

Test only the items touched in Step 3.

- **GATEWAY_API_KEY** — call `adana_log_run` with a dry-run test entry. If it returns 200, key is valid.
- **Gateway connector** — probe `adana_log_run` again and confirm the connector responds.
- **CLAUDE.md** — read it back and confirm the version stamp matches `installed_version`, and that `## Credential Loading`, `## Workspace Defaults` and `## Workspace Structure` are all present.
- **Working folders** — confirm both exist and both env vars are set.
- **Chrome download location** — run the round-trip check: have the user download any small file, then confirm it appears in `exports/` from the sandbox (`os.listdir("exports")`). Asking is not enough; this is the one that silently breaks the scheduled run.
- **Scheduled tasks** — ask the user to confirm both `Adana · CoStar Collection` and `Adana · LexisNexis Enrichment` now appear in Cowork → Scheduled, and that the legacy `Adana · Weekly Collection` is gone.

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
