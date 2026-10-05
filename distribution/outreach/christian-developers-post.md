# DRAFT, NOT POSTED: for a Christian technology community (only where such posts are welcome)

Title: An open MCP server for Scripture you can check and real Christian community

We have opened a free remote MCP server for The Living Bread, and we would value your critique more than your applause.

- Scripture is never generated. Every passage is read from a stored King James text, and every answer carries an evidence
  label: translation, canon, a corpus version (SHA-256 over the 66 book files), retrieval time, and a SHA-256 of the exact text
  returned. Text, interpretation and reflection are labelled separately.
- `scripture_context`, `scripture_search` and `cross_references` (OpenBible.info, CC BY) help an assistant read a verse in its place.
- Churches, gatherings and prayer groups come from real rows, city level only, each with freshness: scheduled, recently
  observed, or verified live. A posted time is never called "happening now".
- Retrieved content is treated as data, never as instructions.
- An evaluation set of [N] cases runs against production; the results are published as they come out:
  https://github.com/thegoodfruit/living-bread-mcp/blob/main/eval/RESULTS.md

Endpoint: https://mcp.living-bread.org/mcp (no key). Hub: https://mcp.living-bread.org/. Source: MIT.

What would make it more trustworthy for your church or your users? What is missing?
