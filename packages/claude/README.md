# Living Bread for Claude (claude.ai, Desktop, mobile)

**Status (2026-10-15): implemented but untested. The custom connector was observed working in our own traffic analytics on 2026-10-04 and 05 (see `mcp/src/data/distribution.json`); the skill zips were built and checked but not uploaded by us. The Anthropic directory listing is submitted and under review.**

All skills in this package are COPIES built from `mcp/skills` by `node mcp/scripts/build-packages.mjs`; do not edit them here. Platform facts and their sources: `docs/AI_PLATFORM_MATRIX.md` (verified 2026-10-15).

## What this package does
- Connector: gives Claude the public Living Bread tools.
- Skills: `../skills-zips/*.zip` are the six skills, each a zip whose folder name equals the skill name, ready to upload.

## What it does not do
- Installing the connector does not install the skills, and uploading the skills does not connect the tools. Do both.
- Custom skills do not sync from claude.ai to Claude Code or the API.
- Skills need code execution and file creation switched on.

## Install
1. Customize, Connectors, Add custom connector: name "The Living Bread", URL `https://mcp.living-bread.org/mcp`, no sign in. (Free plan: one custom connector. Team: an Owner adds it. Enterprise: an Owner or a role with Libraries access.)
2. Customize, Skills, Create skill, Upload a skill: choose each zip from `../skills-zips`.
3. For the signed-in tools add a second connector with `https://mcp.living-bread.org/me` and "Sign in now".

## Update
Upload the changed zip again. Shared skills update for recipients. Connector changes are server side; remove and re-add the connector if tools do not refresh.

## Official documentation
- https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- https://support.claude.com/en/articles/12512180-use-skills-in-claude
- https://claude.com/docs/directory/publish

## Check it works
Ask: "I moved to Prague and want an English speaking church." A correct answer names churches the tool returned, says the data does not record a service language, and gives one link. Then: "I want someone to pray with me, but I don't want my name public." A correct answer gives the Open Chair link once, says no account is needed and the name can be kept from believers, and never says anyone has prayed or is available unless the tool said so. The full cases are in `mcp/skills/*/evals/cases.json`; the read only parts run with `node mcp/skills/run-evals.mjs`.
