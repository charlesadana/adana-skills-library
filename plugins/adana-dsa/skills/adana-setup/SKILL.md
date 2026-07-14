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

This file is what the skills actually read at runtime — via the `load_credentials()` snippet that Step 5 embeds into `CLAUDE.md`. Scheduled runs do not inject env vars automatically, so **both halves are required**: the key here, and the loader there. Setting one without the other leaves the Monday collection run with no `GATEWAY_API_KEY`.

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

### 5b. Strip frontmatter and extract the version

Strip the YAML frontmatter — it is a plugin-loader directive and has no meaning inside `CLAUDE.md`:

```python
import re, datetime

body = re.sub(r'^---\s*\n.*?\n---\s*\n', '', adana_md_content, count=1, flags=re.DOTALL).lstrip()

version_match = re.search(r'\|\s*Adana\s*\|\s*(v[\S]+)\s*\|\s*([^|\n]+)\s*\|', adana_md_content)
version = version_match.group(1).strip() if version_match else "unknown"
version_date = version_match.group(2).strip() if version_match else "unknown"
embed_date = datetime.date.today().isoformat()
```

### 5c. Write CLAUDE.md

Build the workspace block below and write it to `CLAUDE.md` at the workspace root. Substitute `{BODY}` (the stripped `adana.md` body from 5b), `{version}`, `{version_date}`, and `{embed_date}`.

If `CLAUDE.md` already exists, replace everything between the `BEGIN`/`END` markers and leave content outside them untouched. If the markers aren't present, append the whole block. If the file doesn't exist, create it.

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
````

Show the user a preview before writing and confirm.

### 5d. Verify

Read back `CLAUDE.md` and confirm:
- the `BEGIN`/`END` markers are present and the version stamp matches `adana.md`'s Maintenance version
- the `## Credential Loading` section with the `load_credentials()` snippet is present

> ✅ CLAUDE.md created — the Adana agent and the credential loader will load automatically on every session, including scheduled runs.

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
- CLAUDE.md created — Adana agent embedded + credential loader
- Weekly collection scheduled for Mondays

The pipeline is live. Properties flow in Monday → qualify Tuesday (gateway cron) → Gate 1 review → outreach.
