// Version information (production)
const DEFAULT_VERSION = 'v0.2.2';
const DEFAULT_DATE = 'Jun 30, 2026';

// Export constants initially with default values
export const APP_VERSION = DEFAULT_VERSION;
export const RELEASE_DATE = DEFAULT_DATE;

// NOTE: Keep only last 15 versions to prevent git overload (following Next.js pattern)
// Full history available in GitHub releases and git commits
export const VERSION_HISTORY: Array<{ version: string; date: string; changes: string[] }> = [
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
