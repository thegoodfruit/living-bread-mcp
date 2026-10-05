# Smithery

Method (Smithery docs, https://smithery.ai/docs/build/publish, checked 2026-10-05): paste the HTTPS URL at
https://smithery.ai/new, or with the CLI:

```
smithery mcp publish "https://mcp.living-bread.org/mcp" -n @living-bread/living-bread
```

- No `smithery.yaml` is needed for publishing a URL. The server speaks Streamable HTTP, which Smithery requires.
- If Smithery's automatic scan cannot read the tools, it asks for `/.well-known/mcp/server-card.json`; the server does not
  serve one yet (add only if the scan fails, from `/server.json` and the tool list).
- Display name, descriptions, tags, examples, logo: `listing.md`. Logo: `mcp/plugin/assets/logo-512.png`.
- Needs: the owner's Smithery account (namespace `@living-bread` if available). Status: prepared.
