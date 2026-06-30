---
name: plugin-update
description: >-
  Catch an existing Adana workspace up to the latest plugin version — detects
  gaps since the last setup run and fills only what's missing (idempotent).
area: Setup
use_for: "Run after a git pull to detect and fill any gaps: missing env vars, unregistered MCPs, stale CLAUDE.md embed, new skill requirements."
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

```python
import re

# Installed version — from agents/adana.md Maintenance table
with open("<path_to_agents/adana.md>", encoding="utf-8") as f:
    adana_md = f.read()
version_match = re.search(r'\|\s*Adana\s*\|\s*(v[\S]+)\s*\|', adana_md)
installed_version = version_match.group(1).strip() if version_match else "unknown"

# Last-applied version — from CLAUDE.md stamp
with open("CLAUDE.md", encoding="utf-8") as f:
    claude_md = f.read()
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

Read `.claude/settings.local.json` at the workspace root. Check the `env` block:

| Env var | Required since | Status |
|---|---|---|
| `GATEWAY_API_KEY` | v0.1.0 | present / missing |

If `GATEWAY_API_KEY` is present, do a quick sanity check: verify it starts with `adana_live_` (prefix only — don't call the gateway yet).

### 1b. Gateway connector

Probe the gateway by attempting a low-cost call (`adana_log_run` with a dry-run flag). If the tool is unavailable or returns an auth error, the connector is not registered.

| Item | Status |
|---|---|
| `gateway` connector registered | present / missing |

### 1c. CLAUDE.md

Check `CLAUDE.md` at the workspace root:

| Item | Status |
|---|---|
| File exists | present / missing |
| Contains `<!-- BEGIN agents/adana.md` block | present / missing |
| Version stamp matches installed version | match / stale |

A stale stamp means the CLAUDE.md was written at an older version and needs refreshing — the embedded `adana.md` body may be out of date.

### 1d. New skill requirements

For each skill in `skills-manifest.json`, check whether its `deps.env` and `deps.mcp` entries are already satisfied. Right now all three operational skills share the same requirements (`GATEWAY_API_KEY` + Claude in Chrome), so this reduces to checking 1a and 1b. As new skills are added with different deps, add rows here.

---

## Step 2 — Show the gap report

Show a compact summary before doing anything. Example format:

```
[adana-dsa] Plugin Update — Gap Report
Plugin version: v0.1.0 → v0.2.0

Env vars
  ✅ GATEWAY_API_KEY

MCP
  ✅ gateway registered

CLAUDE.md
  ⚠️  Version stamp stale (v0.1.0 embedded, v0.2.0 installed) — refresh needed

New skills since v0.1.0
  ✅ setup, costar-saved-search, reonomy-saved-search, lexisnexis-contact-lookup
  (no new requirements — existing GATEWAY_API_KEY covers all)

→ 0 required gaps · 1 stale item · ready to refresh?
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

### 3c. CLAUDE.md stale or missing

Re-embed `agents/adana.md` using the same logic as `/adana-dsa:adana-setup` Step 5. Read the current `adana.md`, strip frontmatter, write the block between `BEGIN/END` markers in `CLAUDE.md`, update the version stamp.

Show the user a diff of what's changing before writing. Never overwrite content outside the `BEGIN/END` markers.

### 3d. New skill requirements (future)

When new skills are added that introduce new env vars or MCPs, add fill handlers here that match `/adana-dsa:adana-setup` steps for those specific items. Document the requirement and the version it was introduced. Right now no fill handler is needed beyond 3a–3c.

---

## Step 4 — Re-validate

Test only the items touched in Step 3.

- **GATEWAY_API_KEY** — call `adana_log_run` with a dry-run test entry. If it returns 200, key is valid.
- **Gateway connector** — probe `adana_log_run` again and confirm the connector responds.
- **CLAUDE.md** — read it back and confirm the version stamp matches `installed_version`.

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
