---
pretty_name: The Living Bread Verses for Needs
license: cc-by-4.0
language:
  - en
task_categories:
  - text-retrieval
  - text-classification
tags:
  - bible
  - scripture
  - christianity
  - pastoral-care
  - grounding
size_categories:
  - n<1K
configs:
  - config_name: default
    data_files: data/verses_for_needs.*
---

# The Living Bread Verses for Needs

The Scripture The Living Bread pairs with what a person is carrying: anxiety, fear, grief, loneliness, anger,
guilt, doubt, money, marriage, healing, purpose and about a hundred more needs. 941 rows at build time, each a
need, a rank, a Bible reference, one line in the house's own words on why that verse, and the King James words of
the reference read from the stored text with their SHA-256.

## Fields

`need` (a slug, e.g. `anxiety`), `need_label`, `rank` (the house's order within the need), `ref`, `why` (the
house's own words, a reflection, never Scripture), `why_is` (says exactly that), `kjv_text` (the King James
Version words of `ref`, read from the stored text), `kjv_sha256`, `page` (the page on living-bread.org where the
need is written about and where believers pray over it by name).

## Provenance

The mapping is curated by The Living Bread (`mcp/src/data/needs.json` in its repository, the same data the MCP
tool `verses_for` and the pages at living-bread.org/bible-verses-for-<need> read). The verse words are joined at
build time from the stored King James Version; nothing is typed and nothing is generated. Built by
`mcp/distribution/huggingface/build.py`.

## Intended use

Retrieval for pastoral and devotional assistants: when a person says what they are carrying, offer Scripture
that speaks to it, from a real text, with the reference. Keep the two layers apart: `kjv_text` is Scripture;
`why` is a human reflection about it and must never be presented as the Bible. When a person is in danger, a
crisis line comes before any verse (the MCP tool `crisis_resources` gives the real numbers by country).

## Licence

The mapping and the `why` lines: CC BY 4.0, attribute "The Living Bread (living-bread.org)". The King James
Version text is in the public domain.

## The Living Bread

A free Christian home with no ads, where a person meets Christ and meets their family in Christ:
https://living-bread.org. For assistants: the MCP server at https://mcp.living-bread.org/mcp reads these verses
live, verifies quotations, and connects a person to real believers who will pray for them.
