# Living Bread for Gemini app (consumer)

**Status (2026-10-15): blocked for most people. Custom apps are for people 18 and over, in the United States, with a personal Google account, English only, set up on the web. No skills. `mcp/src/data/distribution.json` entry `gemini-app` is `blocked`.**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- `gem-instructions.md`: the five skills condensed into the instructions of a Gem (labelled adaptation, not skills).
- Steps below to add the custom app.

## What it does not do
- A Gem does not connect tools; without the custom app connected the instructions tell the model to say it cannot look things up and to give the public pages.
- Gemini Enterprise custom MCP (admin, Streamable HTTP, SEARCH ONLY) is not packaged.

## Install
1. gemini.google.com, Settings, Connected Apps, Custom apps: add `https://mcp.living-bread.org/mcp` (no authentication).
2. Create a Gem and paste `gem-instructions.md`.

## Update
Edit the Gem. The connection is server side.

## Official documentation
- https://support.google.com/gemini/answer/17209137

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
