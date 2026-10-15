# Living Bread for OpenAI Codex

**Status (2026-10-15): implemented but untested (Codex is not installed on the build machine).**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- Six skills in `.agents/skills`, the folder Codex reads.
- `config.toml.snippet`: the MCP server entry.
- `AGENTS.md`: the five skills as plain instructions (a labelled adaptation; the official AGENTS.md page returned 404 on our fetch, so prefer the skills).

## What it does not do
- It does not use `.codex` as a skills folder (Codex does not read one).
- It does not install anything for you.

## Install
1. Copy `.agents/skills/*` into your repository's `.agents/skills` or `~/.agents/skills`.
2. Add the snippet to `~/.codex/config.toml`, or run `codex mcp add living-bread --url https://mcp.living-bread.org/mcp`.
3. Skill changes are detected automatically; restart Codex if one does not show.

## Update
Copy the new folders over the old. Same-name skills are not merged, so remove the old folder first.

## Official documentation
- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
