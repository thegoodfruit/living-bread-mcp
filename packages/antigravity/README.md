# Living Bread for Antigravity CLI (agy)

**Status (2026-10-15): implemented but untested (not installed on the build machine). Documentation READ on 2026-10-15.**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- `mcp_config.json` with `serverUrl` (Antigravity rejects `url` and `httpUrl` for remote servers).
- Six skills in `.agents/skills`.

## What it does not do
- It is not a plugin: a plugin would need its own `plugin.json` and has not been built.

## Install
1. Copy `mcp_config.json` to `~/.gemini/config/mcp_config.json` (or `.agents/mcp_config.json` in a workspace) and `.agents/skills/*` to the workspace.

## Update
Copy the new folders over the old.

## Official documentation
- https://antigravity.google/docs/skills/
- https://antigravity.google/docs/mcp/

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
