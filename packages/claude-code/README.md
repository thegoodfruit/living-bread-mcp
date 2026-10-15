# Living Bread for Claude Code

**Status (2026-10-15): verified working. In four real Claude Code 2.1.299 sessions on 2026-10-15 the plugin loaded with `--plugin-dir`, the six skills were discovered as `living-bread:<skill>`, the Living Bread MCP tools were called against the live server and the answers followed the skills. `claude plugin validate` passed for the plugin and the marketplace, and `claude plugin marketplace add` plus `claude plugin install` ran successfully in an isolated Claude config folder. The new `for_my_need` mode is not on the live server yet, so that call fell back to the existing tools.**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- Adds six skills (find-your-family-in-christ, pray-with-someone, meet-christ-in-the-word, take-one-step-together, bring-your-people-together, living-bread).
- Connects the public MCP server `https://mcp.living-bread.org/mcp` (no sign in, read only).

## What it does not do
- It does not connect the signed-in `/me` endpoint (acts as a person). Add that yourself with `claude mcp add --transport http living-bread-me https://mcp.living-bread.org/me` and sign in through `/mcp`.
- It does not send, create or join anything.
- Claude may choose not to load a skill; in one of four runs it answered correctly from the tools without one.

## Install
1. One session, nothing installed: `claude --plugin-dir mcp/packages/claude-code/plugin`
2. Installed: `claude plugin marketplace add <path to the mcp folder or thegoodfruit/living-bread-mcp>` then `claude plugin install living-bread@living-bread` (Claude Code 2.1.275 or later also accepts `/plugin install living-bread --marketplace thegoodfruit/living-bread-mcp`).
3. The marketplace file is `mcp/.claude-plugin/marketplace.json`, which points here. It must be at the root of the public repository for the repository form to work.

## Update
Bump `version` in `plugin/.claude-plugin/plugin.json`, then `claude plugin update living-bread@living-bread`. Claude Code keeps the old copy if the version is unchanged.

## Official documentation
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/plugins-reference
- https://code.claude.com/docs/en/plugin-marketplaces

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
