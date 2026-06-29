#!/usr/bin/env python3
"""
gen_skills_index.py — the skill-registry "Refresh button".

Source of truth = each skill's own SKILL.md frontmatter (`area`, `use_for`, `deps`).
This script reads all skills and regenerates THREE artifacts:

  1. plugins/adana-dsa/skills-manifest.json   (machine-readable registry)
  2. plugins/adana-dsa/SKILLS.md              (full human-readable per-skill table)
  3. a compact DOMAIN MAP inside agents/adana.md, between the markers
     <!-- BEGIN skills-table (generated) --> / <!-- END skills-table (generated) -->

Usage:
  python scripts/gen_skills_index.py            # regenerate all three artifacts in place
  python scripts/gen_skills_index.py --check     # exit 1 if any artifact is stale (no writes)

stdlib only. Frontmatter list values are JSON arrays so no PyYAML is needed.

WHERE THIS RUNS: it's a maintainer/CI tool — run it in this repo when adding/editing
skills (commit-to-git regenerate step). It does NOT run in the end-user's Claude
session; consumers just READ the committed skills-manifest.json.

Frontmatter contract (every skills/<name>/SKILL.md):
---
name: <slug>
description: <free text>
allowed-tools: <free text>            # optional, unchanged
area: <Collection|Enrichment>
use_for: "<one-line summary, JSON-quoted>"
deps:
  mcp:     [ ... ]    # JSON arrays of strings; "" if none. Keep " (opt)" suffix on optional deps.
  gateway: [ ... ]
  files:   [ ... ]
  env:     [ ... ]
---
"""

import json
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = PLUGIN_ROOT / "skills"
MANIFEST_PATH = PLUGIN_ROOT / "skills-manifest.json"
SKILLS_MD_PATH = PLUGIN_ROOT / "SKILLS.md"
AGENT_MD_PATH = PLUGIN_ROOT / "agents" / "adana.md"

BEGIN_MARK = "<!-- BEGIN skills-table (generated) -->"
END_MARK = "<!-- END skills-table (generated) -->"

# Canonical area order for grouping the map / table.
AREA_ORDER = ["Collection", "Enrichment"]
DEP_GROUPS = [("mcp", "MCP"), ("gateway", "Gateway"), ("files", "Files"), ("env", "Env")]


def _split_frontmatter(text):
    """Return (frontmatter_str, body_str). Frontmatter is between the first two '---' lines."""
    if not text.startswith("---"):
        return "", text
    end = text.find("\n---", 3)
    if end == -1:
        return "", text
    fm = text[text.find("\n") + 1:end]
    body = text[end + len("\n---"):]
    return fm, body


def parse_frontmatter(fm):
    """Minimal parser for our fixed schema. Scalars + a nested `deps:` block of JSON arrays."""
    data = {"deps": {"mcp": [], "gateway": [], "files": [], "env": []}}
    lines = fm.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("deps:"):
            i += 1
            while i < len(lines) and (lines[i].startswith("  ") or lines[i].strip() == ""):
                sub = lines[i].strip()
                if sub and ":" in sub:
                    k, v = sub.split(":", 1)
                    k, v = k.strip(), v.strip()
                    if k in data["deps"]:
                        data["deps"][k] = json.loads(v) if v else []
                i += 1
            continue
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            k, v = k.strip(), v.strip()
            if k == "use_for":
                data[k] = json.loads(v) if v.startswith('"') else v
            elif k in ("name", "description", "area"):
                data[k] = v
        i += 1
    return data


def skill_version(body):
    """Best-effort: first `| Adana | vX.Y.Z | ... |` row in the Maintenance table."""
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("| Adana | v"):
            parts = [p.strip() for p in s.strip("|").split("|")]
            if len(parts) >= 2:
                return parts[1]
    return None


def load_skills():
    records = []
    for d in sorted(SKILLS_DIR.iterdir()):
        sk = d / "SKILL.md"
        if not d.is_dir() or not sk.exists():
            continue
        fm, body = _split_frontmatter(sk.read_text(encoding="utf-8"))
        meta = parse_frontmatter(fm)
        name = meta.get("name", d.name)
        area = meta.get("area")
        if not area:
            raise SystemExit(
                f"ERROR: {sk.relative_to(PLUGIN_ROOT)} is missing required frontmatter `area`. "
                f"Add area/use_for/deps to its SKILL.md frontmatter."
            )
        records.append({
            "name": name,
            "area": area,
            "use_for": meta.get("use_for", ""),
            "description": meta.get("description", ""),
            "deps": meta["deps"],
            "version": skill_version(body),
        })
    records.sort(key=lambda r: (AREA_ORDER.index(r["area"]) if r["area"] in AREA_ORDER else 99,
                                r["name"]))
    return records


def _areas_in_order(records):
    seen = [a for a in AREA_ORDER if any(r["area"] == a for r in records)]
    extra = sorted({r["area"] for r in records} - set(seen))
    return seen + extra


def deps_cell(deps):
    groups = []
    for key, label in DEP_GROUPS:
        items = deps.get(key) or []
        if items:
            groups.append(f"{label}: " + ", ".join(items))
    return " · ".join(groups) if groups else "—"


def render_manifest(records):
    return json.dumps(records, indent=2, ensure_ascii=False) + "\n"


def render_domain_map(records):
    """Compact map for adana.md: areas + counts + names only."""
    lines = [f"**{len(records)} skills across {len(_areas_in_order(records))} areas.**"]
    for area in _areas_in_order(records):
        names = [r["name"] for r in records if r["area"] == area]
        lines.append(f"- **{area}** ({len(names)}): " + " · ".join(f"`{n}`" for n in names))
    return "\n".join(lines)


def render_skills_md(records):
    """Full human-readable per-skill table — its own file."""
    out = [
        "<!-- Generated by scripts/gen_skills_index.py from each skill's SKILL.md frontmatter.",
        "     Do not hand-edit — change the skill's frontmatter and re-run the generator. -->",
        "",
        "# adana-dsa — full skill catalog",
        "",
        "Generated from each `skills/<name>/SKILL.md` frontmatter (`area` / `use_for` / `deps`). "
        "The machine-readable version is `skills-manifest.json`; the compact domain map lives in "
        "`agents/adana.md`.",
        "",
        "| Skill | Area | Use For | Deps |",
        "|---|---|---|---|",
    ]
    for r in records:
        out.append(f"| `{r['name']}` | {r['area']} | {r['use_for']} | {deps_cell(r['deps'])} |")
    return "\n".join(out) + "\n"


def splice_map(agent_md, domain_map):
    """Insert/replace the generated domain-map block between markers."""
    block = f"{BEGIN_MARK}\n{domain_map}\n{END_MARK}"
    if BEGIN_MARK in agent_md and END_MARK in agent_md:
        pre = agent_md[:agent_md.index(BEGIN_MARK)]
        post = agent_md[agent_md.index(END_MARK) + len(END_MARK):]
        return pre + block + post
    raise SystemExit(
        "ERROR: skills-map markers not found in agents/adana.md. Add this under the '## Skills' "
        f"heading:\n{BEGIN_MARK}\n{END_MARK}"
    )


def main():
    check = "--check" in sys.argv
    records = load_skills()
    manifest = render_manifest(records)
    skills_md = render_skills_md(records)
    agent_md = AGENT_MD_PATH.read_text(encoding="utf-8")
    new_agent_md = splice_map(agent_md, render_domain_map(records))

    if check:
        stale = []
        if not MANIFEST_PATH.exists() or MANIFEST_PATH.read_text(encoding="utf-8") != manifest:
            stale.append("skills-manifest.json")
        if not SKILLS_MD_PATH.exists() or SKILLS_MD_PATH.read_text(encoding="utf-8") != skills_md:
            stale.append("SKILLS.md")
        if agent_md != new_agent_md:
            stale.append("agents/adana.md (domain map)")
        if stale:
            print("STALE — run `python scripts/gen_skills_index.py`:\n  - " + "\n  - ".join(stale))
            sys.exit(1)
        print(f"OK — {len(records)} skills; manifest + SKILLS.md + adana.md map in sync.")
        return

    MANIFEST_PATH.write_text(manifest, encoding="utf-8")
    SKILLS_MD_PATH.write_text(skills_md, encoding="utf-8")
    AGENT_MD_PATH.write_text(new_agent_md, encoding="utf-8")
    print(f"Wrote skills-manifest.json + SKILLS.md and refreshed adana.md domain map "
          f"({len(records)} skills across {len(_areas_in_order(records))} areas).")


if __name__ == "__main__":
    main()
