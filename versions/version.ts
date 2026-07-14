// Version information (production)
const DEFAULT_VERSION = 'v0.2.4';
const DEFAULT_DATE = 'Jul 14, 2026';

// Export constants initially with default values
export const APP_VERSION = DEFAULT_VERSION;
export const RELEASE_DATE = DEFAULT_DATE;

// NOTE: Keep only last 15 versions to prevent git overload (following Next.js pattern)
// Full history available in GitHub releases and git commits
export const VERSION_HISTORY: Array<{ version: string; date: string; changes: string[] }> = [
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
