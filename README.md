# adana-skills-library

Claude Code **plugin marketplace** for Adana Capital's automated deal sourcing (DSA). One plugin — **`adana-dsa`** — holds the browser skills that run CoStar / Reonomy saved searches and LexisNexis contact enrichment **under Adana's own authenticated Chrome logins**, persisting everything through the [adana-gateway](https://github.com/charlesadana/adana-gateway) remote MCP server.

This is **repo #2** of the two-repo design (see `adana-gateway/docs/adana-dsa.md`):

| Repo | Role |
|---|---|
| **adana-skills-library** *(this repo)* | Skills + routing agent + generated registry. Skills only drive the browser and call gateway MCP tools — **no local scripts, no CSV output.** |
| **adana-gateway** | Remote MCP server (Vercel) exposing Supabase-backed `adana_*` tools; owns the schema + service-role key; cron agents; gate dashboards. |

## Layout

```
.claude-plugin/marketplace.json          # lists the one plugin (adana-dsa)
plugins/adana-dsa/
  .claude-plugin/plugin.json             # metadata + userConfig (gateway_api_key)
  .mcp.json                              # remote gateway MCP server (url)
  settings.json                          # default agent = adana
  agents/adana.md                        # routing agent "Adana" (read first by every skill)
  skills/
    costar-saved-search/SKILL.md         # flow1 + flow3 — grid scrape → screen → ingest
    reonomy-saved-search/SKILL.md        # flow2 — grid scrape → ingest
    lexisnexis-contact-lookup/SKILL.md   # flow2 + flow3 — pull targets → SmartLinx → write back
  scripts/gen_skills_index.py            # registry generator (source of truth = SKILL.md frontmatter)
  skills-manifest.json                   # GENERATED
  SKILLS.md                              # GENERATED
.github/workflows/skills-registry-check.yml  # CI drift gate
```

## Install

```
/plugin marketplace add charlesadana/adana-skills-library
/plugin install adana-dsa@adana-skills-library
```

Then set the plugin's `gateway_api_key` (an `adana_live_…` key from the gateway dashboard → Settings → API keys). Each skill passes it on every `adana_*` tool call as `${GATEWAY_API_KEY}`.

## Configuration

| Key | Sensitive | Description |
|---|---|---|
| `gateway_api_key` | yes | `adana_live_…` key generated in the gateway dashboard |

**Gateway URL:** `.mcp.json` points at `https://gateway.adanacap.com/api/mcp`. This subdomain must be assigned by the client and added as a custom domain on the Vercel `adana-gateway` project; until then it will not resolve (the working alias is `https://adana-gateway.vercel.app/api/mcp`). Vercel **Deployment Protection** must be off on the gateway so the skills can reach `/api/mcp`.

## Editing skills

Each skill's `SKILL.md` frontmatter (`area`, `use_for`, `deps`) is the source of truth for the registry. After editing any skill, regenerate:

```
python plugins/adana-dsa/scripts/gen_skills_index.py
```

CI (`skills-registry-check`) fails if the committed registry is out of sync.
