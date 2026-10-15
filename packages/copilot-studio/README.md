# Living Bread for Microsoft Copilot Studio

**Status (2026-10-15): implemented but untested (no Copilot Studio license here).**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- `agent-instructions.md`: the five skills condensed into agent instructions (a labelled adaptation: skills support is UNCONFIRMED).
- The connection steps below.

## What it does not do
- It does not use SSE (Copilot Studio supports Streamable HTTP only; our server offers it).
- It does not publish an agent: a trial license cannot publish, and a Power Platform data policy may block MCP servers.

## Install
1. In your agent: Tools, Add a tool, New tool, Model Context Protocol. Server name "The Living Bread", description "Real churches, communities, gatherings, prayer doors and Scripture from a stored Bible", URL `https://mcp.living-bread.org/mcp`, authentication None.
2. Paste `agent-instructions.md` into the agent instructions. Generative orchestration must be on: the agent picks tools by name and description.

## Update
Refresh the tool in Tools when the server changes; edit the instructions in place.

## Official documentation
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-licensing-subscriptions

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
