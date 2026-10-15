# Living Bread for ChatGPT

**Status (2026-10-15): implemented but untested by us. Plugin 1.0.9 (`mcp/plugin`) is submitted to OpenAI and awaiting review; Developer Mode was observed working in earlier tests. No ChatGPT client was run for this release.**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- Points at the existing read only plugin (`mcp/plugin`, tools frozen by `mcp/test/app-profile.lock.json`).
- Provides the six skills as zips for ChatGPT personal Skills (`../skills-zips`), and `custom-gpt-instructions.md` as a labelled adaptation for a custom GPT.

## What it does not do
- It does not change the submitted plugin or its tool list. The new `plan_my_next_step` is denied on `/app` on purpose; handoff fields are extra keys on existing answers.
- Skills in ChatGPT need a Business, Enterprise, Healthcare or Edu workspace (documentation SEARCH ONLY, the help page refused our fetch).
- A custom GPT has Actions, not MCP and not skills, and OpenAI has said custom GPTs will be retired.

## Install
1. Plugin (after OpenAI approves): search "The Living Bread" in Plugins.
2. Before approval, Business or Enterprise: Developer mode, Plugins, +, add the MCP server `https://mcp.living-bread.org/mcp` with no authentication.
3. Skills: Create a skill, Upload from your computer, one zip at a time.

## Update
A new plugin version is a new upload and a new review. MCP tool changes are rescanned daily and new tools stay unavailable until approved. The server URL cannot be changed by the update flow.

## Official documentation
- https://developers.openai.com/apps-sdk/deploy/submission
- https://developers.openai.com/plugins/build/plugins
- https://learn.chatgpt.com/docs/plugins

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
