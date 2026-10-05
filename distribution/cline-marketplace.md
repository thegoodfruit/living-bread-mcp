# Cline MCP Marketplace

Method (https://github.com/cline/mcp-marketplace, checked 2026-10-05): open a new issue with the repository URL, a 400 by 400 PNG
logo, and why it should be added; confirm Cline can set it up from the README.

**Issue title:** Add The Living Bread (remote, no key): Scripture with evidence labels and real Christian community

**Issue body:**

> Repository: https://github.com/thegoodfruit/living-bread-mcp
>
> The Living Bread is a free remote MCP server (Streamable HTTP, no key): https://mcp.living-bread.org/mcp
>
> Why add it: Bible passages read word for word from a stored public domain text with an evidence label on every answer
> (translation, corpus version, SHA-256 of the text), keyword search over every verse, cross references (OpenBible.info, CC BY),
> and real churches, gatherings and prayer groups near any place with honest freshness. Read-only on the public endpoint.
>
> Setup in Cline (from the README): MCP Servers, Remote Servers, or `cline_mcp_settings.json`:
> `{"mcpServers":{"living-bread":{"type":"streamableHttp","url":"https://mcp.living-bread.org/mcp","disabled":false,"autoApprove":[]}}}`
>
> I have tested that Cline can connect using these instructions: [the owner ticks this only after trying it]

Logo: make the 400 by 400 PNG from `mcp/plugin/assets/logo-512.png` (see `README.md`) and attach it.

Before filing: the marketplace was built around repositories Cline installs locally; a remote-only server is not addressed in its
rules. File it from the owner's GitHub account, honestly marked as remote. Status: prepared.
