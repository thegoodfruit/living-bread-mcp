# Living Bread for VS Code and GitHub Copilot

**Status (2026-10-15): implemented but untested.**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- Six skills in `.github/skills` (also read from `.claude/skills` and `.agents/skills`).
- `.vscode/mcp.json`: note the top level key is `servers`, not `mcpServers`.
- `.github/copilot-instructions.md`: the five skills as repository instructions (labelled adaptation).

## What it does not do
- On Copilot Business and Enterprise the "MCP servers in Copilot" policy is off by default; an organisation admin must turn it on.
- The `vscode:mcp/install` link scheme was not confirmed on the page we read.

## Install
1. Copy `.vscode/mcp.json`, `.github/skills/*` and, if you want it, `.github/copilot-instructions.md` into your repository.
2. Or: `code --add-mcp '{"name":"living-bread","type":"http","url":"https://mcp.living-bread.org/mcp"}'`.

## Update
Copy the new skill folders over the old. A skill whose name does not match its folder fails silently.

## Official documentation
- https://code.visualstudio.com/docs/copilot/customization/agent-skills
- https://code.visualstudio.com/docs/copilot/customization/mcp-servers
- https://docs.github.com/en/copilot/concepts/context/mcp

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
