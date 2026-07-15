// Version information (production)
const DEFAULT_VERSION = 'v0.4.0';
const DEFAULT_DATE = 'Jul 15, 2026';

// Export constants initially with default values
export const APP_VERSION = DEFAULT_VERSION;
export const RELEASE_DATE = DEFAULT_DATE;

// NOTE: Keep only last 15 versions to prevent git overload (following Next.js pattern)
// Full history available in GitHub releases and git commits
export const VERSION_HISTORY: Array<{ version: string; date: string; changes: string[] }> = [
  {
    version: 'v0.4.0',
    date: 'Jul 15, 2026',
    changes: [
      'Scheduling split into two separate, staggered weekly Cowork tasks. adana-setup Step 7 now creates "Adana · CoStar Collection" (Mon, default 9 AM) and "Adana · LexisNexis Enrichment" (Mon, default 2 PM, staggered after CoStar) instead of one combined "Adana · Weekly Collection". LexisNexis enriches whatever CoStar has already queued into needs_enrichment, so it must run after collection finishes — the same-day stagger matches the needs_enrichment → enriched pipeline order.',
      'Reonomy is no longer scheduled — run /adana-dsa:reonomy-saved-search on demand; its output lands in the same needs_enrichment queue and the next LexisNexis run (scheduled or manual) picks it up.',
      'plugin-update migrates pre-v0.4.0 workspaces: Step 1e now probes the two new tasks and detects the legacy combined task; Step 3d has the user delete the old task (Cowork /schedule cannot delete) BEFORE creating the two replacements, so the workspace never ends up double-collecting; Step 2 gap report and Step 4 re-validate updated for the two-task model.',
      'costar-saved-search: adana_save_qualification `why` is now basis-only — one sentence stating property type, acreage, city, FAR band, and the PLSF/PSFB clearance. Strategic / submarket / IOS-thesis commentary and any action-override reason move to a `checks` note, keeping the dashboard prose to the deal basis.',
    ],
  },
  {
    version: 'v0.3.0',
    date: 'Jul 14, 2026',
    changes: [
      'BREAKING — re-run /adana-dsa:adana-setup. Export replaces grid-scraping across both collection skills.',
      'The collection skills did not work. costar-saved-search and reonomy-saved-search read the results grid row-by-row, which never completes on a real saved search. This was mandated by the spec (adana-dsa.md §8.1.3 "Scrape the results grid", §8.1.6 "No CSV/xlsx written") and was never live-tested — the design doc marked S3/S5 "(pending live run)".',
      'costar-saved-search now exports via the Industrial SAVED layout (not the pre-defined one) as the docs/ref-skills baseline did for months, reads the xlsx, and sends raw asking_price/building_sf/lot_size_acres to adana_screen_costar. transform.js is unnecessary — the layout already carries the raw columns the gateway derives FAR/PLSF/PSFB from.',
      'reonomy-saved-search now exports too. Its export UI steps are UNVERIFIED (no ref-skill exists for Reonomy) and are marked as such — read the page and adapt on first run.',
      'New: single exports/ folder as Chrome\'s download location, plus lexisnexis/ working dir. One folder, not one per source — Chrome has a single global download location and cannot be set per-site. adana-setup Step 5 creates them, points Chrome at exports/, and verifies the round-trip (a folder Chrome is not actually pointing at looks identical from the sandbox).',
      'CLAUDE.md now carries ## Workspace Defaults + ## Workspace Structure, so a scheduled run resolves the folder paths with zero lookups.',
      'lexisnexis-contact-lookup: FIXED a path to contacting the wrong person. The SmartLinx phone table lists relatives\' numbers alongside the subject\'s; the gateway takes phones[0] as the contact\'s only mobile and later bulk-loads it into the Instantly campaign. Phones are now ordered by listing name so index 0 is the subject\'s own number, and flagged when none match.',
      'lexisnexis-contact-lookup: restored the ref-skill\'s resume mechanism (lexisnexis/results.json, appended per person) — a 100-contact run that died at #97 previously lost all 97. Also restored the output CSV and optional spreadsheet input.',
      'costar-saved-search: brokers now come from the export when the layout carries them, else the brochure. The gateway\'s test is literally hasBroker = !!broker.email, so a broker without an email is no broker at all — such rows fall through to enrichment, which is the correct destination.',
      'agents/adana.md: dropped the "No CSV/xlsx, no downloads" hard rule that forbade the fix; added the phones[0] hazard and the Chrome download-location prerequisite.',
    ],
  },
  {
    version: 'v0.2.4',
    date: 'Jul 14, 2026',
    changes: [
      'Aligned the CLAUDE.md embed with brand-setup Step 9 / plugin-update Step 3h exactly — v0.2.3 had diverged in three ways',
      'adana-setup 5c: when markers are absent, PREPEND the workspace block (was: append) — the agent identity must lead the file',
      'Legacy migration: v0.2.0–v0.2.2 wrote a bare block marked "(embedded by setup)" with no ## Agent Identity heading and no Credential Loading section. Both skills now detect that marker and rebuild the block from scratch rather than swapping the marker — such workspaces cannot authenticate on scheduled runs',
      'plugin-update 3c: replaced prose with the explicit re-embed code, including the lambda m: new_block guard that stops re.sub from interpreting backslashes in the embedded body',
      'plugin-update 1c: gap report now detects the legacy shape and the missing Agent Identity heading',
      'Credential Loading block is inserted directly under Agent Identity, not appended at end-of-file',
    ],
  },
  {
    version: 'v0.2.3',
    date: 'Jul 14, 2026',
    changes: [
      'Adopted the fiveagents-marketplace path + credential conventions across all skills',
      'CLAUDE.md now embeds a ## Credential Loading block with load_credentials() — scheduled runs do NOT inject env vars from .claude/settings.local.json, so the Monday collection run previously would have started with no GATEWAY_API_KEY',
      'adana-setup Step 5a: agent-file lookup now globs $CLAUDE_CONFIG_DIR first (Cowork sandbox is Ubuntu regardless of host), with Windows/macOS fallbacks and an ask-the-user escape hatch',
      'plugin-update Step 0: replaced the literal <path_to_agents/adana.md> placeholder with the real Cowork-first locator; Step 1a now searches up from cwd for settings.local.json; Step 1c checks for the Credential Loading block; Step 3c re-embeds adana.md unconditionally every run',
      'Fixed version drift — plugin.json and marketplace.json were stuck at 0.1.0 across three releases; all four version files now bump in lockstep (enforced in workflow/commit-to-git.md)',
    ],
  },
  {
    version: 'v0.2.2',
    date: 'Jul 14, 2026',
    changes: [
      'adana-setup: added Step 6 — schedule weekly Monday collection via Cowork /schedule (CoStar → Reonomy → LexisNexis); includes "computer must be on" warning aligned with liangzai-setup pattern',
      'plugin-update: added Step 1e scheduled task check (ask user), gap report row, Step 3d fill handler, Step 4 re-validate for Adana · Weekly Collection',
    ],
  },
  {
    version: 'v0.2.1',
    date: 'Jun 30, 2026',
    changes: [
      'Renamed setup skill to adana-setup',
      'Fixed setup skill: replaced all "Claude Code" references with "Cowork"; replaced claude mcp add CLI command with Settings → Connectors → Add custom connector UI flow',
      'Fixed plugin-update skill: replaced claude mcp list CLI check with adana_log_run probe; updated all /adana-dsa:setup references to /adana-dsa:adana-setup',
    ],
  },
  {
    version: 'v0.2.0',
    date: 'Jun 30, 2026',
    changes: [
      'Added setup skill — first-time workspace onboarding: gateway API key, MCP registration, Claude in Chrome check, CLAUDE.md creation with adana.md embedded',
      'Added plugin-update skill — idempotent gap detector after git pull: checks env vars, gateway MCP, CLAUDE.md version stamp, new skill requirements',
      'Removed inline Setup section from agents/adana.md (moved to setup skill)',
      'Updated skills table in adana.md, SKILLS.md, and skills-manifest.json (3 → 5 skills)',
    ],
  },
  {
    version: 'v0.1.0',
    date: 'Jun 29, 2026',
    changes: [
      'Initial adana-skills-library — Claude Code plugin marketplace (adana-dsa plugin) for Adana automated deal sourcing',
      'Routing agent agents/adana.md; remote gateway MCP declared in .mcp.json (gateway.adanacap.com/api/mcp)',
      'Skills (browser collection, persist via gateway MCP — no CSV): costar-saved-search, reonomy-saved-search, lexisnexis-contact-lookup',
      'Generated registry (skills-manifest.json + SKILLS.md + adana.md domain map) via scripts/gen_skills_index.py; CI drift gate',
    ],
  },
];
