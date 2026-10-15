# Living Bread for Microsoft Copilot (consumer)

**Status (2026-10-15): unsupported. Microsoft documents only fixed connectors (OneDrive, Outlook.com, Google Drive, Gmail, Calendar) for personal accounts; no custom MCP server or plugin path was found. The Windows app and Edge Copilot Mode are not covered by that page (UNCONFIRMED).**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- Nothing to install. This folder exists so the gap is written down, not hidden.

## What it does not do
- It cannot call Living Bread tools, so no skill or instruction set can make it look up real churches or groups.

## Install
1. Send people to https://living-bread.org, https://living-bread.org/find-a-church and https://living-bread.org/communities. For people who build agents at work, see `../copilot-studio`.

## Update
Re-check the connectors page when Microsoft announces custom connectors for the consumer app.

## Official documentation
- https://support.microsoft.com/en-us/topic/connecting-microsoft-copilot-to-other-services-cc06f6ef-a885-4187-9380-712bb4cabac8

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
