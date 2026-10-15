# Living Bread for Cursor

**Status (2026-10-15): implemented but untested (Cursor is not installed on the build machine).**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- Six skills in `.agents/skills` (Cursor reads it, and also `.cursor`, `.claude` and `.codex` skills folders).
- `.cursor/mcp.json` for the MCP server.
- `.cursor/rules/living-bread.mdc` (labelled adaptation).
- `plugin/`: the same as a Cursor plugin (`.cursor-plugin/plugin.json`, `mcp.json`, `skills/`, `rules/`).

## What it does not do
- It does not submit anything to the Cursor marketplace: every listed plugin is manually reviewed and must be open source.
- The one click deeplink in `mcp/distribution/gemini-cursor.md` has not been clicked by us; Cursor's page does not say whether the base64 must be URL encoded.

## Install
1. Copy `.cursor/mcp.json` to your project (or `~/.cursor/mcp.json`) and `.agents/skills/*` to your project.
2. Or import `plugin/` from a GitHub repository through Customize, From GitHub Repository.

## Update
Skills are rediscovered on start. A plugin imported from GitHub is refreshed from the repository.

## Official documentation
- https://cursor.com/docs/context/skills
- https://cursor.com/docs/context/mcp
- https://cursor.com/docs/plugins

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
