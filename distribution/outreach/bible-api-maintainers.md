# DRAFT, NOT SENT: to a maintainer of a Bible data or API project

Subject: An evidence label for AI-quoted Scripture, offered back

Hi [name],

Thank you for [their project]. We use public domain Bible text and the OpenBible.info cross references in The Living Bread, a
free Christian community platform, and we wanted to share one small thing back in case it is useful to you.

When an AI assistant quotes Scripture through our MCP server, each answer carries a label: translation, canon coverage, a
corpus version (a SHA-256 over the stored book files), attribution, retrieval time, and a SHA-256 of the exact text returned. Anyone
can recompute it against the public text. The format is in our source (MIT):
https://github.com/thegoodfruit/living-bread-mcp (src/evidence.ts).

If a shared convention for labelling AI-quoted Scripture would help the projects you work with, we would gladly follow yours
rather than ours. No reply is needed if not.

Grace and peace,
[owner name]
