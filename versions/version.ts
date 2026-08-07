// Version information (production)
const DEFAULT_VERSION = 'v0.8.1';
const DEFAULT_DATE = 'Aug 7, 2026';

// Export constants initially with default values
export const APP_VERSION = DEFAULT_VERSION;
export const RELEASE_DATE = DEFAULT_DATE;

// NOTE: Keep only last 15 versions to prevent git overload (following Next.js pattern)
// Full history available in GitHub releases and git commits
export const VERSION_HISTORY: Array<{ version: string; date: string; changes: string[] }> = [
  {
    version: 'v0.8.1',
    date: 'Aug 7, 2026',
    changes: [
      'Fixes the contradictions v0.8.0 left behind. The rubric shipped inside `costar-saved-search`, but `agents/adana.md` — the file actually loaded at runtime — still told the agent to "score what you actually believe" and called the score its conviction. The agent was being instructed to do the opposite of the skill it routes to. adana.md now states the real split: the score is COMPUTED from a rubric, and what stays the agent\'s own is the `why` and the strategic `checks` no rubric can reach. Same fix applied to the one-line echoes in apollo-email-lookup, lexisnexis-contact-lookup and adana-setup, so no skill is left describing a retired framing.',
      '**A loop that could never terminate.** costar-saved-search said to call `adana_targets_needing_qualification` "until it comes back empty" AND to never score a no-price listing. Both cannot hold: the gateway selects on `qualification IS NULL AND status != disqualified` and does not exclude `costar_no_price`, so the rows the agent is forbidden to score come back on every call, for ever. Worse, the query has no offset and pages from the oldest, so a capped batch of 40 unscorable rows returns the identical 40 indefinitely. The terminal condition is now "nothing left but unscorable rows" — `costar_no_price` (never scorable) and `incomplete` (needs columns resent, not a score) — with instructions to raise the limit past a stuck batch and to report what was left behind and why. The proper fix is server-side; this is the skill refusing to spin.',
      'Four defects in the rubric itself, each of which would have made the same property score differently on different runs — the exact failure the rubric exists to end. Band boundaries were undefined (is 60.0% in `50-60` or `60-70`? is 5.0 acres `3-5` or `5-10`?) and are now stated once as lower-inclusive, upper-exclusive. The worked examples rounded each term before adding, turning 8.3125 into 8.32 — harmless there, a whole point near a boundary — so the rule is now to carry unrounded terms and round once. Step A sourced the ratio from "the screen you already ran" when the backlog path, which is the normal path, returns `criteria_notes` instead; both paths are documented. And Type was the only component with a missing-value fallback, with no explanation — now stated, along with why Basis/Coverage/Size cannot be missing on a row that reached the work list.',
      'The `adana_save_qualification` example described three different properties at once: the `why` said 11.9 ac at PLSF $11.86, the `screen` block said value 13.8, and the component points matched neither. Anyone using it as a template would have copied an incoherent row. It is now a single property whose four components compute to its stated score, with the arithmetic shown. All five worked examples across both skills were verified by executing the rubric rather than by re-reading it.',
      '`action` lost its `PASS` guidance when the bullet was rewritten for the score/action split, leaving one of three enum values undocumented. Restored, with the point of the field made explicit: the score is arithmetic and cannot see a rail-served site with no yard, which is why the action is a separate judgment and not a restatement of the number.',
      'Step 4 still documented the pre-v0.8.0 ingest call — 8 fields, when Step 2 now builds 21. The gateway accepts every one of them, so the effect of following the skill literally was to map 31 rescued columns and then drop them again at the call site. Signature updated, with the format traps (Excel serial, percentage points, `Secondary Type`) restated where the call is actually made.',
      'The `with_geo` / `with_type` sanity check printed raw counts against percentage expectations ("geo on 489 — should be near 100%"), which does not read as a check on any export size. Now printed as rates with the expected values alongside, and with what a low number actually means: geo under 100% is the wrong layout, type under 89% is a renamed header, and both are invisible downstream because the ingest returns a clean count either way.',
      'reonomy-saved-search gets a price-free rubric, resolving what read as a flat contradiction between the two collection skills. It is not one: a CoStar no-price listing is shape-triaged at ingest and must not be scored, while a Reonomy lead lands in `sourced` with no triage at all, so its score is the only door into the enrichment queue — skip it and the property is parked for ever. Neither skill said why. Reonomy now uses the same component tables and weights, renormalised over whatever can actually be computed, with the consequence stated plainly rather than hidden: dropping a component renormalises the rest upward, so the same site scores higher from a thinner export. A lead with neither acreage nor type is sent with no score, because `no_score` is the truthful outcome and a fabricated number is graded against the same floor as a measured one.',
    ],
  },
  {
    version: 'v0.8.0',
    date: 'Aug 7, 2026',
    changes: [
      'costar-saved-search Step 2 now maps 14 more columns. The Industrial layout ships 39 and the skill mapped 8; the other 31 were read out of the spreadsheet and discarded on every run. Newly captured: latitude/longitude, submarket, market, days_on_market, year_built, tenancy, percent_leased, parking_ratio, last_sale_date, last_sale_price, cap_rate, plus a source_attributes catch-all for what the layout carries that nothing reads yet.',
      'Fixed the mapping bug that had been emptying property_type for months: the skill mapped `Property Type`, and this layout has no such column — it is `Secondary Type`. Every row returned None, leaving 1,300 of 1,760 stored properties untyped. The value now feeds the scoring rubric, so a null here costs a real component of the score, and Step 2 prints a fill count so the next occurrence is caught in the run rather than months later.',
      'New `excel_date()` helper alongside `phone_str()`, for the same reason that one exists: `Last Sale Date` arrives as an Excel serial (41716 is 2014-03-18, not the year 41716), and sending it raw writes a five-digit integer into a date column. Handles the datetime shape too, since openpyxl converts only when the cell format tells it to.',
      'The column documentation went from the contact block alone to all 39 columns with measured fill rates. That omission is why the discarded 31 stayed invisible — a reader of the skill had no way to know latitude and longitude existed, let alone that they were 100% filled while the design doc listed transport proximity as blocked for want of geo data.',
      'Five data formats that silently produce wrong values are recorded in Mapping notes: the Excel serial above; `Cap Rate` and `Percent Leased` being percentage POINTS rather than fractions (8 means 8%); `Rent/SF/Yr` being a range string ("$11.78 - 14.39 (Est.)") that must not be coerced; `True Owner City State Zip` being one combined field; and `Sale Company Contact` duplicating `Sales Contact` rather than being a second person.',
      'Step 5 now publishes the scoring rubric. The score had no definition anywhere — the tool asked for "your conviction, 1-10" and no rubric existed in either repo, so a rule got invented and applied to 684 properties without anyone specifying it, on a scale where 8, 9 and 10 were arithmetically unreachable. It is now computed: 62.5% price against Charles\'s ceiling, 18.75% coverage on Charles\'s FAR bands, 12.5% site size, 6.25% asset type, with both worked examples from real properties.',
      'The skill now separates what is computed from what is judged. The score is arithmetic and the same property scores the same every run; the `checks` and `why` remain the agent\'s read of the site. The four component points go into `screen` alongside the FAR maths — not bookkeeping, but because an LLM computing a four-term weighted average across forty properties will slip, and recording the components makes a slip visible instead of silent.',
      'Removed the "score your honest read, and don\'t reverse-engineer the cutoff" guidance. It was right when the number was a judgment and is meaningless now that it is a formula with no discretion in it — left in place it would have contradicted the rubric on the same page. Replaced with: compute it, don\'t aim it, and if a property feels better than its score then that belongs in `checks` where a human will read it.',
      'Also documented that `Land Area (AC)` is GROSS acreage. The market underwrites IOS on usable acres, which CoStar does not publish and which comes from survey and zoning at diligence — screening on gross is what everyone does at this stage, but it should not be reported as usable.',
    ],
  },
  {
    version: 'v0.7.0',
    date: 'Aug 7, 2026',
    changes: [
      'costar-saved-search Step 5 now ASKS the gateway what still needs scoring, via the new `adana_targets_needing_qualification`, and keeps asking until it comes back empty. This is the fix for the failure that prompted the whole release: the skill said "score every property you ingested", but Step 3 only ever hands back `qualifiers` and `near_misses`, so that quietly meant "score everything the screen surfaced". 466 properties reached the database with no assessment recorded against them at all — indistinguishable from ones nobody had reached yet — and because nothing ever asked what was left over, they stayed that way. The backlog is now a question you ask, not a list you keep in your head, and it survives a session ending mid-batch.',
      'No-price listings must NOT be given a score. Every buy-box measure divides by price, so a no-price listing has no ratio to grade; inventing a number puts a guess on the same 1-10 scale as a measurement, compared against the same threshold, with no way to tell them apart afterwards. Those properties are routed at ingest on site shape instead, into broker pricing outreach. Stated in costar-saved-search Step 5 and in the tool description.',
      'Screen and ingest results are documented as they now behave. `adana_screen_costar` lands every row in exactly one of five buckets — `qualifiers` / `near_misses` / `screened_out` / `no_price` / `incomplete` — with an accounting invariant to check against. `adana_ingest_costar_export` returns `kept`, `rejected` by reason, and `incomplete`. The skills now spell out which of those are ordinary (rejection: roughly a quarter of an export) and which mean the agent under-sent and must resend (`incomplete`), because conflating the two is what let rows disappear quietly.',
      '`needs_enrichment` is documented as a QUEUE rather than a description, across every skill that touches it. It no longer means "lacks an email" — it means "worth spending a lookup on, and still missing an address", earned by a conviction score clearing the floor or by a no-price site shape worth a broker call. apollo-email-lookup and lexisnexis-contact-lookup are told not to filter or re-rank the work list, since the ranking has already happened; an empty list now means "the queue is drained", which is a far smaller claim than "every contact has an email" and the one that is actually true.',
      'reonomy-saved-search corrected: new properties land in `sourced`, not on the enrichment work list. Gateway v2.7.1 made the same change on the server, and without it every Reonomy run would have dropped its whole result set onto the queue unscored.',
      'Two long-standing errors fixed in agents/adana.md, both of which would have had the agent report the pipeline wrongly. It claimed a phone "lets the property reach Gate 1" — untrue since gateway v2.5.0, where only an email does — and its hold-reason ordering predated the score-before-contact check. The tool table gains `adana_targets_needing_qualification` and `promoted_to_gate1`.',
      'Enrichment write-back now reports `promoted_to_gate1`: properties where the address was the last missing piece and which therefore went straight to a human approval queue rather than waiting to be re-read. `enriched` counts addresses found; this counts deals unlocked. Both enrichment skills are told to report it.',
      'marketplace.json had drifted to 0.5.1 while plugin.json and version.ts sat at 0.6.0 — exactly the lockstep failure the commit workflow warns about. All four version locations are back in step at 0.7.0.',
    ],
  },
  {
    version: 'v0.6.0',
    date: 'Aug 6, 2026',
    changes: [
      'Claude computer (computer use) is removed from the plugin entirely. Every skill that drove the user\'s logged-in browser now works from a file instead: `costar-saved-search` and `reonomy-saved-search` process an export the user places in `exports/`, and `lexisnexis-contact-lookup` writes a work-list spreadsheet the user fills in and hands back. No skill signs into a source, clicks through a UI, or handles credentials. `deps.mcp` is now empty for every skill except `apollo-email-lookup`, whose only dependency is the Apollo connector.',
      'New skill `apollo-email-lookup` (Enrichment) — finds work emails through Apollo\'s API. Search first to identify the right person, verify the match, then enrich by exact Apollo ID. Built from a measured 20-broker test: 58% confirmed, 90% of those returned a verified email (~52% end to end) at about 2.2 cents each. The search step is free and the enrichment credit is charged per ATTEMPT rather than per success, which is why verification comes before spending anything. Encodes the failure found in testing: a name-only `people_match` returns a hollow record for a different person of the same name and still costs a credit.',
      'Enrichment now has an explicit order — Apollo first, LexisNexis second. Apollo is unattended and resolves the common case (a named broker at a real firm), so running it first keeps the manual LexisNexis sheet short. Documented in agents/adana.md and in both skills.',
      'Scheduling changed to reflect what can actually run unattended. `Adana · LexisNexis Enrichment` is retired as a scheduled task — the lookups are the user\'s own work, and an unattended run would produce a list nobody is there to fill in. `Adana · Apollo Email Lookup` takes its Monday slot. plugin-update Step 3d deletes the retired task before creating the new one, and handles workspaces still carrying the pre-v0.4.0 combined task.',
      'The CoStar schedule is kept but reframed as a POLLER: the user drops exports into `exports/` whenever suits them, and the scheduled run processes anything it has not seen. Processed files are tracked in `exports/.processed.json` keyed by filename AND mtime, so a re-export under the same filename is still picked up, and an already-ingested file is never counted twice. "Nothing new to process" is an explicitly valid outcome — the skill says so and stops rather than reprocessing the newest file to have something to report. Files are marked processed only after a successful ingest, so a run that fails midway is retried rather than silently lost.',
      'costar-saved-search and lexisnexis-contact-lookup were rewritten rather than patched, to remove the artifacts of incremental edits — a stub "Step 5 — Contacts (already done in Step 3)" that only pointed back at another step, and a blockquote narrating what the step "used to say". CoStar is now 5 steps (get the export → read rows → screen → ingest → qualify), LexisNexis 4 (get the list → write the sheet → read it back → write through). The rules survive; the archaeology does not.',
      'lexisnexis-contact-lookup is now a worksheet round-trip. It writes `worklist_<date>.csv` carrying `contact_id`, a `search_by` column telling the user how to search each row (owners by property address, brokers by name + state only, because a listing agent does not live at the property), and `already_has_phone` marking rows where only the email is wanted. It reads `results_<date>.csv` back, validates before writing — skipping rows with a missing `contact_id` or an `@`-less email — and suppresses the phone for any row already carrying a listing-sourced number. The old `results.json` resume machinery is gone: it existed to survive a crash mid-browser-batch, and there is no batch any more.',
      'reonomy-saved-search rewritten to the same file-driven shape, sharing `exports/.processed.json` with CoStar (no collision — Reonomy exports are .csv, CoStar .xlsx). Adds a header sanity check before ingesting, since `*.csv` is a far looser match than CoStar\'s filename pattern and any stray CSV in the folder would otherwise be mapped as property data. The old "the export UI steps below are unverified — read the page and adapt" warning is dropped; it existed because Claude was guessing at Reonomy\'s buttons, and the user knows their own UI.',
      'adana-setup: new Step 3b connects the Apollo connector (a ready-made connector authorised via OAuth, not a custom URL — and optional, since the pipeline still runs without it). Step 4 became "Who does what", a table of which half of each skill belongs to the user, with no computer-use setup at all. New `apollo/` folder and `APOLLO_DIR` env var. The browser download location is now documented as a convenience rather than a requirement — skipping it costs one drag per export.',
      'plugin-update detects everything above: `APOLLO_DIR`, the `apollo/` folder, the Apollo connector (checked by tool presence, never by spending a credit), the new skill, the retired LexisNexis task. It also states the workflow change out loud, because nothing errors to signal it — the skills keep their names and jobs, and the user simply finds that exporting is now theirs to do.',
      'plugin.json version was stale at 0.5.1 and had missed several releases; bumped to 0.6.0 with `apollo` and `contact-enrichment` keywords and a description that no longer claims browser automation.',
    ],
  },
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
];
