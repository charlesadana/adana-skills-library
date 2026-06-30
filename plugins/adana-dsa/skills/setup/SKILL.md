---
name: setup
description: >-
  First-time setup for the Adana deal-sourcing plugin — configure the gateway
  API key, register the gateway MCP, confirm Claude in Chrome, and create the
  workspace CLAUDE.md so adana.md loads automatically on every session.
area: Setup
use_for: "Run once to wire up the Adana plugin in a new workspace: gateway API key, MCP registration, Claude in Chrome check, and CLAUDE.md creation."
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

## Step 1 — Verify you're in the right project

Ask the user:
> Are you running this inside the Claude Code project you want to use for Adana day-to-day? Setup will create a `CLAUDE.md` here that loads the Adana agent automatically on every session.

If they say no, ask them to open the correct project first, then re-run `/adana-dsa:setup`.

## Step 2 — Gateway API key

Ask:
> Go to **[gateway.adanacap.com](https://gateway.adanacap.com)** → **Settings → API Keys** → generate a new key (starts with `adana_live_…`). Paste it here.

Once they paste the key, write it to `.claude/settings.local.json` under `env`. Preserve any existing keys — only add or update `GATEWAY_API_KEY`:

```json
{
  "env": {
    "GATEWAY_API_KEY": "adana_live_…"
  }
}
```

If the file doesn't exist, create it. Confirm: "Gateway API key saved."

## Step 3 — Gateway MCP

The gateway must be registered as an MCP server so Claude can call `adana_*` tools. Check by running:

```bash
claude mcp list
```

If `gateway` is not in the list, register it:

```bash
claude mcp add gateway --url https://gateway.adanacap.com/api/mcp
```

Tell the user: "Restart Claude Code after this step, then re-run `/adana-dsa:setup` to continue from Step 4."

If `gateway` is already registered, confirm and move on.

## Step 4 — Claude in Chrome

All three skills drive the user's already-logged-in Chrome session via **Claude in Chrome**. Ask:
> Is the Claude in Chrome extension installed in Chrome, and is a Chrome window currently open?

If not, direct them to install the Claude in Chrome extension from the Chrome Web Store, open Chrome, and come back.

Also confirm they know each skill needs the relevant source already signed in before it runs — Claude never enters credentials:

| Skill | Must be signed into |
|---|---|
| `costar-saved-search` | CoStar — `product.costar.com` |
| `reonomy-saved-search` | Reonomy — `app.reonomy.com` |
| `lexisnexis-contact-lookup` | LexisNexis — `advance.lexis.com` (Public Records access) |

## Step 5 — Create workspace CLAUDE.md

This is the step that makes the Adana agent load automatically on every session. Read `agents/adana.md` from the adana-skills-library, strip its YAML frontmatter, and embed it into `CLAUDE.md` at the workspace root.

### 5a. Locate adana.md

Find the absolute path to `agents/adana.md` in the adana-skills-library. It will be inside the plugin folder wherever the skills library is installed on this machine.

### 5b. Read the content

```python
import re

with open("<absolute_path_to_agents/adana.md>", encoding="utf-8") as f:
    content = f.read()

# Strip YAML frontmatter
body = re.sub(r'^---\s*\n.*?\n---\s*\n', '', content, count=1, flags=re.DOTALL).lstrip()

# Extract version from Maintenance table
version_match = re.search(r'\|\s*Adana\s*\|\s*(v[\S]+)\s*\|', content)
version = version_match.group(1).strip() if version_match else "unknown"
```

### 5c. Write CLAUDE.md

If `CLAUDE.md` already exists at the workspace root, check whether it already has an Adana block (look for `<!-- BEGIN agents/adana.md -->`). If yes, replace it. If no, append it. Never overwrite unrelated content.

```python
import datetime

embed_date = datetime.date.today().isoformat()

block = f"""<!-- BEGIN agents/adana.md (embedded by setup) -->
<!-- adana.md version: {version} | Embedded: {embed_date} -->

{body}
<!-- END agents/adana.md -->"""
```

If `CLAUDE.md` doesn't exist, create it with just the block. Show the user a preview of what will be written and confirm before writing.

### 5d. Verify

Read back `CLAUDE.md` and confirm the block is present and the version stamp matches. Tell the user:

> ✅ CLAUDE.md created — the Adana agent will load automatically on every session in this project. You're all set.

## Done

Summarise what was configured:
- Gateway API key saved to `.claude/settings.local.json`
- Gateway MCP registered
- Claude in Chrome confirmed
- CLAUDE.md created with Adana agent embedded

Skills are ready to run. Start with `/adana-dsa:costar-saved-search` to pull your first saved search.
