# mcp.so, mcpservers.org, PulseMCP, Glama connectors

All words: `listing.md`. Checked against each site on 2026-10-05.

## mcp.so
- Form: https://mcp.so/submit, tab **Remote Server**.
- Name: The Living Bread. URL: `https://mcp.living-bread.org/mcp`. Repository: https://github.com/thegoodfruit/living-bread-mcp.
- Description: the short description. Tags: as listed.
- The paid "publish immediately" option is not needed; the free review is fine.
- Needs: the owner's account. Status: prepared.

## mcpservers.org (wong2/awesome-mcp-servers)
- The list does not accept pull requests; it takes https://mcpservers.org/submit.
- Name, URL, repository, short description as above. Category: Knowledge or Other.
- Status: prepared.

## PulseMCP
- Submissions paused since 2026-09-03; PulseMCP says it will ingest the official MCP Registry when it reopens.
- Nothing to do: the registry entry `org.living-bread.mcp/living-bread` is active. Re-check https://www.pulsemcp.com/submit monthly.
- Status: blocked on PulseMCP reopening.

## Glama
- Server listing (from the repository): live at https://glama.ai/mcp/servers/thegoodfruit/living-bread-mcp.
- Connector listing (remote servers): not found in the connector search on 2026-10-05. Glama ingests registry entries; if it does
  not appear within a week of the 1.2.0 registry publish, the owner adds it with "Add Connector" at https://glama.ai/mcp/connectors
  (URL `https://mcp.living-bread.org/mcp`, no auth). Its badge then unlocks `awesome-remote-mcp-servers.md`.
- Optional: a `glama.json` at the mirror's root, `{"$schema":"https://glama.ai/mcp/schemas/server.json","maintainers":["thegoodfruit"]}`,
  claims the server listing for the owner's GitHub account.
