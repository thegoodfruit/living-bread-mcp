# Living Bread for Gemini CLI

**Status (2026-10-15): MCP connection: verified working by the lead on this Mac (we did not repeat it). The extension in this folder, with skills and a context file: implemented but untested. Note: Google replaced Gemini CLI with Antigravity CLI on 2026-06-18 for unpaid and Google One users (documentation SEARCH ONLY).**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- `extension/`: a Gemini CLI extension (`gemini-extension.json` with the `httpUrl` MCP entry, `GEMINI.md` context, six skills).

## What it does not do
- It does not submit to any extension gallery (publishing requirements are UNCONFIRMED).
- It does not support the signed-in endpoint without a browser for OAuth.

## Install
1. MCP only: `gemini mcp add --transport http living-bread https://mcp.living-bread.org/mcp`
2. Extension: `gemini extensions install <github url of the repository with this folder at its root>` or `gemini extensions link mcp/packages/gemini-cli/extension` for local testing.
3. Skills only: `gemini skills install <git url> --path packages/gemini-cli/extension/skills`.

## Update
`gemini extensions update living-bread`; bump `version` in `gemini-extension.json` first.

## Official documentation
- https://geminicli.com/docs/cli/skills/
- https://geminicli.com/docs/extensions/reference/
- https://geminicli.com/docs/tools/mcp-server/

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
