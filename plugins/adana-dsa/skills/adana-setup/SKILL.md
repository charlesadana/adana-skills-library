---
name: adana-setup
description: >-
  First-time setup for the Adana deal-sourcing plugin — configure the gateway
  API key, register the gateway connector, confirm Claude in Chrome, and create
  the workspace CLAUDE.md so adana.md loads automatically on every session.
area: Setup
use_for: "Run once to wire up the Adana plugin in a new workspace: gateway API key, connector registration, Claude in Chrome check, and CLAUDE.md creation."
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

## Step 1 — Cowork project

All skill runs happen inside a **Cowork project**. This is required — setup cannot complete without an active project session.

Ask the user:
> Are you running this inside the Cowork project you want to use for Adana day-to-day? Setup will write config here that loads the Adana agent automatically on every session.

If they say no, ask them to:
1. Look for **Projects** just below the chat input area in Cowork
2. Click **"Create a new Project"** → **"Use an existing folder"** (point it at their Adana working folder)
3. Open that project session, then re-run `/adana-dsa:adana-setup`

**Do not continue until the user confirms they are inside the right project.**

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

## Step 3 — Gateway connector

The Adana gateway must be registered as a custom connector so Claude can call `adana_*` tools.

Ask the user to add it in Cowork:
1. Go to **Settings → Connectors → "Add custom connector"**
2. **Name:** `gateway`
3. **URL:** `https://gateway.adanacap.com/api/mcp`
4. Click **Connect**

Ask: "Have you added the gateway connector?" Wait for confirmation before moving on.

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

Find the absolute path to `agents/adana.md`. In Cowork, start from `$CLAUDE_CONFIG_DIR` (the env var Cowork sets to point at the mounted plugin tree):

```python
import os, glob

config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
patterns = []
if config_dir:
    patterns.append(os.path.join(config_dir, "**/agents/adana.md"))
patterns.append(os.path.expanduser("~/.claude/**/agents/adana.md"))

found = [f for p in patterns for f in glob.glob(p, recursive=True)]
adana_md_path = os.path.abspath(found[0]) if found else None

if not adana_md_path:
    raise RuntimeError("Could not locate agents/adana.md — ask the user for the full path.")
```

### 5b. Read and strip frontmatter

```python
import re

with open(adana_md_path, encoding="utf-8") as f:
    content = f.read()

body = re.sub(r'^---\s*\n.*?\n---\s*\n', '', content, count=1, flags=re.DOTALL).lstrip()

version_match = re.search(r'\|\s*Adana\s*\|\s*(v[\S]+)\s*\|', content)
version = version_match.group(1).strip() if version_match else "unknown"
```

### 5c. Write CLAUDE.md

If `CLAUDE.md` already exists at the workspace root, check for an existing Adana block (`<!-- BEGIN agents/adana.md -->`). If found, replace it. If not, append. Never overwrite content outside the markers.

```python
import datetime

embed_date = datetime.date.today().isoformat()

block = (
    f"<!-- BEGIN agents/adana.md (embedded by setup) -->\n"
    f"<!-- adana.md version: {version} | Embedded: {embed_date} -->\n"
    f"\n"
    f"{body}\n"
    f"<!-- END agents/adana.md -->"
)
```

Show the user a preview before writing and confirm. If `CLAUDE.md` doesn't exist, create it with just the block.

### 5d. Verify

Read back `CLAUDE.md` and confirm the block is present and the version stamp matches. Tell the user:

> ✅ CLAUDE.md created — the Adana agent will load automatically on every session in this project. You're all set.

## Step 6 — Schedule weekly collection

Collection runs every **Monday** — CoStar → Reonomy → LexisNexis. Create the scheduled task now with Cowork's own scheduler.

**Use Cowork's `/schedule` — do not ask the user to click through settings.** Invoke `/schedule` directly and give it the task name, frequency, and prompt. Cowork asks them to confirm, and the task appears on its Scheduled page.

Ask what time on Monday they want it to run (default: **9 AM**). Then create:

**Task — `Adana · Weekly Collection`** · frequency **Weekly, Monday** at their chosen time:

```
Run the Adana weekly collection pipeline in sequence:
1. /adana-dsa:costar-saved-search
2. /adana-dsa:reonomy-saved-search
3. /adana-dsa:lexisnexis-contact-lookup

Run each skill to completion before starting the next. After all three complete, summarise the counts returned by the gateway (new properties found, updated, contacts enriched).
```

**The schedule lives in Cowork only.** To see or change when it runs, open Cowork → Scheduled. There is no other copy.

Then tell the user plainly:

> These jobs only run while this computer is on and Cowork is running. If it's off on Monday, the run is missed — and there's no catch-up for properties that aged off CoStar or Reonomy in the meantime. So: **keep an eye on the gateway → Runs page.** If a Monday goes by with no new run logged, something is wrong — open Cowork and check the Scheduled tab.

## Done

Summarise what was configured:
- Gateway API key saved to `.claude/settings.local.json`
- Gateway connector registered
- Claude in Chrome confirmed
- CLAUDE.md created with Adana agent embedded
- Weekly collection scheduled for Mondays

The pipeline is live. Properties flow in Monday → qualify Tuesday (gateway cron) → Gate 1 review → outreach.
