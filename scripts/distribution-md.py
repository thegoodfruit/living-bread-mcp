#!/usr/bin/env python3
"""Render docs/DISTRIBUTION_TRACKER.md from mcp/src/data/distribution.json (the same data /distribution.json serves).
Edit the JSON, then run:  python3 mcp/scripts/distribution-md.py"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
data = json.loads((ROOT / "mcp/src/data/distribution.json").read_text())
L = [
    "# Distribution tracker: everywhere Christians use AI",
    "",
    f"Generated from `mcp/src/data/distribution.json` (served live at https://mcp.living-bread.org/distribution.json and as the",
    f"public compatibility table on the hub). Updated {data['updated']}. Statuses mean exactly this:",
    "",
]
for k, v in data["statuses"].items():
    L.append(f"- **{k}**: {v}")
L += ["", "| Destination | Category | Method | Requirement | Friction | Status | Dependency or alternative | Owner | Last verified |", "|---|---|---|---|---|---|---|---|---|"]
cell = lambda s: str(s or "").replace("|", "/").replace("\n", " ")
for d in data["destinations"]:
    dep = d.get("dependency") or d.get("alternative") or d.get("detail") or ""
    name = f"[{cell(d['name'])}]({d['url']})" if d.get("url") else cell(d["name"])
    L.append(f"| {name} | {cell(d['category'])} | {cell(d['method'])} | {cell(d['requirement'])} | {cell(d['friction'])} | {cell(d['status'])} | {cell(dep)} | {cell(d['owner'])} | {cell(d['last_verified'])} |")
counts = {}
for d in data["destinations"]:
    counts[d["status"]] = counts.get(d["status"], 0) + 1
L += ["", "Totals: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) + ".", "",
      "Submission packages: `mcp/distribution/`. Outreach drafts (never sent, never implying a partnership): `mcp/distribution/outreach/`.",
      "The plan: `docs/DISTRIBUTION_PLAN.md`. Adoption is never claimed from this table: it says where the server CAN be used; the funnel (`docs/MCP_FUNNEL.md`) says whether it IS.", ""]
(ROOT / "docs/DISTRIBUTION_TRACKER.md").write_text("\n".join(L), encoding="utf-8")
print("wrote docs/DISTRIBUTION_TRACKER.md")
