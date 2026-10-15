# Living Bread for Perplexity

**Status (2026-10-15): implemented but untested. The Perplexity help pages were NOT fetched (search snippets only), so every fact here is lower confidence.**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- `space-instructions.md`: the five skills condensed (labelled adaptation; skills support is UNCONFIRMED).
- The connection steps below.

## What it does not do
- Free accounts cannot add custom connectors. Enterprise admins control and disable them by default.
- Comet, Spaces and mobile support for custom connectors are UNCONFIRMED.

## Install
1. Pro, Max or Enterprise: Plugins (or Customize, Connectors), Add custom, MCP connector, Remote: name "The Living Bread", URL `https://mcp.living-bread.org/mcp`, authentication None.
2. Paste `space-instructions.md` into a Space's instructions.

## Update
Remove and re-add the connector to refresh its tools.

## Official documentation
- https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors (search only)

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
