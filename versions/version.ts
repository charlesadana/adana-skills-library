// Version information (production)
const DEFAULT_VERSION = 'v0.5.4';
const DEFAULT_DATE = 'Aug 6, 2026';

// Export constants initially with default values
export const APP_VERSION = DEFAULT_VERSION;
export const RELEASE_DATE = DEFAULT_DATE;

// NOTE: Keep only last 15 versions to prevent git overload (following Next.js pattern)
// Full history available in GitHub releases and git commits
export const VERSION_HISTORY: Array<{ version: string; date: string; changes: string[] }> = [
  {
    version: 'v0.5.4',
    date: 'Aug 6, 2026',
    changes: [
      'States the division of responsibility explicitly in agents/adana.md: the skill owns the judgment (conviction score, the WHY, the strategic buy-box checks), the gateway owns the filter (contact present, score present, score high enough). Previously the agent was told its overlay "advances pipeline_status", which framed scoring as a way to move a property along rather than as an assessment.',
      'The gateway now applies a minimum conviction score before a property reaches Gate 1 (adana-gateway v2.4.0), and the skills deliberately DO NOT state what that threshold is. An earlier draft of this change named it; that was withdrawn, because telling the scorer the cutoff turns the score from a measurement into a target and it would drift to the threshold within a run or two. The same value was also stripped from the gateway\'s MCP tool description, which is read by the agent at runtime on every call — removing it from the skills alone would have achieved nothing.',
      'What the agent IS told: that a cutoff exists, that holds are a normal outcome, and the reason for each hold (`no_contact` / `no_score` / `below_score`), so it can report a run accurately. Plus an explicit instruction never to inflate a score to move a property along, and that a score chosen to clear a threshold carries no information.',
      '`score` is now documented as required in costar-saved-search and reonomy-saved-search: omitting it holds the property (`no_score`) rather than letting it through. Reporting guidance updated to lead with `qualified` and break holds down by `held_by_reason`, rather than reporting `saved` — which counts overlays stored, not properties that reached a human.',
      'adana-setup no longer claims the Tuesday cron qualifies. It does not: as of gateway v2.4.0 the deterministic price screen only refreshes the criteria_* baseline and never changes a status. The Step 7 scheduling text and the closing pipeline summary now say that the CoStar collection run is what puts properties into Gate 1, and warn that a missed week means no new targets that week — there is no cron that catches up on the judgment.',
      'reonomy-saved-search: off-market leads are expected back as `no_contact` holds (owner shells carry no email or phone), and should still be scored honestly low rather than inflated, since once enrichment supplies a contact the score alone decides whether they surface.',
    ],
  },
  {
    version: 'v0.5.3',
    date: 'Aug 6, 2026',
    changes: [
      'costar-saved-search read 8 columns out of a 39-column export and dropped the rest — including the entire contact block. The Aug 5 exports carried `Sales Contact` (~83% filled), `Sales Contact Phone` (~83%), `True Owner Name` (~71%), `True Owner Contact` (~47%) and `True Owner Phone` (~66%), and none of it was mapped. Step 3 now extracts a contact per listing: the listing broker when the export names one with a way to reach them, the owner otherwise. Verified by executing the skill\'s own code block against the three original export files — 18 of 20 listings on the smallest, 485 of 516 across all three.',
      'Step 5 was the instruction that caused it. It claimed "the Industrial saved layout carries the listing, not the broker" and sent the agent to open a brochure per row for data that was already in the spreadsheet — and it named columns ("Listing Broker Name" / "Listing Broker Phone") that do not exist in the layout. It is now a no-browser step that documents the real column names and explicitly forbids visiting a brochure for contacts.',
      'Corrected an overgeneralisation introduced while fixing the above: "CoStar exports carry phones and never emails" was a claim about ONE saved layout observed in one 534-row sample, not a property of CoStar. Layouts are configurable. The code now discovers email columns from the actual header (`EMAIL_COLS`, classified broker/owner/other), prefers an email when it finds one since email is the outreach channel, and prints `email columns found: none in this layout` rather than assuming. The skill notes that adding an email field to the saved layout is the highest-value change available to this pipeline.',
      'Three bugs in the new Step 3 code, caught by a top-to-bottom re-read and fixed before shipping: phone columns come back from Excel as int or float, so `str()` on a float produced "7702998083.0" — a non-phone that would have been stored on hundreds of contacts (now normalised to E.164, matching the gateway); the sample code built dicts full of `None` from missing columns while the surrounding prose warned that ingest rejects nulls (added `clean()`, since the schema accepts a missing key but not an explicit null); and `split_name(None)` yielded the literal string "None" as a first name. Rows with no address are now skipped rather than sent.',
      'Step 6 now documents the `contacts` count the gateway returns and instructs the agent to compare it against the count Step 3 printed — a silent zero is exactly how 485 contacts were lost. Its example no longer advertises an `email` field the layout may not have, or `source_url`/`brochure_url`/`external_id` which the Industrial layout does not carry. Stale references to having "the brochure" open were removed from Step 7 and the Reporting section, since Step 5 now forbids opening one.',
      'lexisnexis-contact-lookup: the work list is no longer "pending contacts" but "every contact that still has no email", regardless of pipeline status — a property that reached `qualified` on the strength of a mobile still needs an email. Documents the new `has_mobile`, `already_attempted` and `property_status` fields, the `include_attempted` flag, and the `phone_only` count, which must be reported separately rather than folded into `enriched`.',
      'Fixed a bug that patch introduced: `results.json` skips anyone already in it, which is right for resuming a crashed run but wrong across runs — the widened work list deliberately returns people a previous run failed to find an email for, and every one of them would have been in `done` and skipped forever, silently defeating the retry. The file now rotates: older than 6 hours means a finished run, so it is archived and everyone gets another pass. Both branches verified by executing the skill\'s code.',
      'Reversed the "prioritise owner rows, skip brokers" advice added in the same pass — it contradicted the goal of finding an email for every contact. Both types are now worked; the skill instead sets expectations that Public Records indexes individuals and so finds brokerage work emails poorly, and suggests the brokerage website as a better source without leaving anyone un-attempted.',
      'New rule for `has_mobile` contacts: most now arrive with a phone and are on the list only for the email, so `phones[0]` from a person report could REPLACE a number that came straight off the listing. The skill now says to omit `phones` from the write-back unless the report\'s number is listing-name-matched to the contact. Also corrected a pre-existing inaccuracy — the stored mobile feeds SMS, not the Instantly email campaign.',
      'agents/adana.md: "drive the browser for a broker\'s email on a brochure" replaced with "read the whole export before going anywhere else for data"; adds that a phone is a contact and that column layouts must be read, never assumed.',
    ],
  },
  {
    version: 'v0.5.2',
    date: 'Aug 5, 2026',
    changes: [
      'Documents the gateway\'s new Gate 1 precondition (adana-gateway v2.3.0): entering `qualified` requires a usable contact, so `adana_save_qualification` stores the overlay but holds the promotion for a property with no email and no mobile, returning it in a new `held` array. This closes a contradiction inside this plugin: costar-saved-search Step 7 said "build one qualification per property you ingested" and write it back immediately, while adana-setup Step 7 and agents/adana.md describe the pipeline as needs_enrichment → enriched → qualified with the gateway qualifying after enrichment. On Aug 5 a CoStar run followed Step 7 literally and promoted 181 contactless properties straight into Gate 1.',
      'costar-saved-search: new "Scoring is not promoting — expect `held`" section under Step 7. Keeps the instruction to score every ingested property — the agent is the only reader who ever has the CoStar row, listing, brochure and map open at once, so that judgment is captured then or lost — but states plainly that scoring does not move a property into Gate 1, that a high `held` count on a no-broker run is the correct outcome rather than a failure, and that the `pipeline_status` override is gated too so there is nothing to work around.',
      'costar-saved-search "Reporting back": `saved` and `held` must now be reported separately, never as one number — `saved - held` is what actually reached Gate 1. Reporting `saved` alone implies a Gate 1 queue that does not exist, which is exactly how the 181 went unnoticed.',
      'reonomy-saved-search: Step 5 now states that every off-market lead should be expected back in `held` — Reonomy ingest creates an owner contact shell with no email or phone, so the hold is the designed path for flow2, not an error. Reporting back updated to say these are scored but not yet in Gate 1.',
      'agents/adana.md: the pipeline section now states that the arrows are the gateway\'s to enforce, not the agent\'s to shortcut, and the adana_save_qualification row in the tool table documents the hold and the `held` return.',
      'No behavioural change to the browser-driving steps; computer use is unchanged in this release.',
    ],
  },
  {
    version: 'v0.5.1',
    date: 'Aug 5, 2026',
    changes: [
      'Plugin schema compatibility audit: plugin.json `agents` field changed from a bare directory string to the required array-of-paths form ("./agents/adana.md") — `claude plugin validate .` was rejecting the string form.',
      'plugin.json userConfig.gateway_api_key now declares the required `type` ("string") and `title` fields, and adds `required: true` since the plugin cannot authenticate against the gateway without it.',
      '.mcp.json gateway server: transport `type` changed from the non-standard "url" to "http" to match the current MCP transport schema.',
      'costar-saved-search, reonomy-saved-search, lexisnexis-contact-lookup: `allowed-tools` frontmatter trimmed to only the real mcp__gateway__* tool names — the prose "Claude computer (computer use — screenshot, mouse, keyboard)" entry was not a resolvable tool identifier there. Computer-use remains fully documented in each skill\'s body, prerequisites, deps.mcp, and agents/adana.md; allowed-tools only pre-approves tools for a turn and does not gate capability, so this is not a functional change.',
    ],
  },
  {
    version: 'v0.5.0',
    date: 'Jul 18, 2026',
    changes: [
      'Switched every browser-driving skill from the Claude in Chrome extension to Claude computer (computer use). The extension drove the user\'s real Chrome via DOM tools (find / read_page / tabs_context); computer use operates the machine via screenshots + mouse/keyboard. Applied across costar-saved-search, reonomy-saved-search, lexisnexis-contact-lookup, the adana routing agent, and the docs/ref-skills copies (costar-saved-search-screen, lexisnexis-contact-lookup).',
      'DOM-tool guidance flipped to screenshot-driven: "prefer find/read_page to locate controls by label rather than coordinates" became "work from a fresh screenshot, locate visually, then click" — since computer use is inherently screenshot + coordinate based.',
      'adana-setup Step 4 rewritten — computer use has no browser extension to install: instead of "install the Claude in Chrome extension from the Chrome Web Store", it now confirms computer use is connected and a browser is open on the controlled computer. Step 5 and every "Chrome download location" reference generalized to "browser download location" (the global download-location prerequisite is unchanged).',
      'plugin-update, SKILLS.md, skills-manifest.json (deps.mcp), README, and skill frontmatter (allowed-tools / deps.mcp) updated in lockstep; registry regenerated. Note: these skills still assume the controlled computer\'s browser is already signed into CoStar / Reonomy / LexisNexis — the "never enter credentials" guardrail is unchanged.',
    ],
  },
  {
    version: 'v0.4.1',
    date: 'Jul 17, 2026',
    changes: [
      'adana-setup Step 1 hardened into a mandatory Cowork-project gate, matching brand-setup\'s (fiveagents-marketplace) Step 1a/1b pattern. Previously it only asked "are you in the right project?" — a bare "yes" satisfied it even from the wrong session, and every downstream write (exports/, lexisnexis/, CLAUDE.md) is relative to whatever cwd that session happens to be rooted in, with nothing re-checking it later. Now: an `## Arguments` table adds a `-- project created` resume flag, and Step 1 unconditionally instructs creating/opening the project and re-invoking from inside it — with an explicit "Do not continue in this session" stop — before any file is written.',
    ],
  },
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
