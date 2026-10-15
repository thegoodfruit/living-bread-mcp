# Platform packages

One folder per surface. Each README says exactly what the package does, what it does not do, how to install and update it, its status (as of 2026-10-15) and the official documentation. Skills and instruction files here are COPIES built from `mcp/skills`; rebuild with `node mcp/scripts/build-packages.mjs` and check with `node mcp/scripts/validate-skills.mjs`.

| Folder | Surface | Status |
|---|---|---|
| `claude-code` | Claude Code plugin (marketplace file is `mcp/.claude-plugin/marketplace.json`) | verified working |
| `claude` | claude.ai, Desktop, mobile (connector steps; skills are the zips) | implemented but untested |
| `skills-zips` | One zip per skill for Claude and ChatGPT personal skills upload | built, not uploaded |
| `chatgpt` | ChatGPT (points at `mcp/plugin`, 1.0.9 submitted) | implemented but untested |
| `codex` | Codex skills, config and AGENTS.md | implemented but untested |
| `cursor` | Cursor skills, mcp.json, rule, plugin | implemented but untested |
| `vscode` | VS Code and GitHub Copilot | implemented but untested |
| `gemini-cli` | Gemini CLI extension | MCP verified by the lead; extension implemented but untested |
| `antigravity` | Antigravity CLI | implemented but untested |
| `gemini-app` | Gemini app (Gem instructions) | blocked for most people |
| `copilot-studio` | Microsoft Copilot Studio (instructions adaptation) | implemented but untested |
| `perplexity` | Perplexity (instructions adaptation) | implemented but untested, documentation search only |
| `microsoft-copilot-consumer` | Microsoft Copilot app | unsupported |

Where a surface has no native skills, the instructions file is a labelled adaptation of the same five skills, not a skill.
