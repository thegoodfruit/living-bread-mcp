---
pretty_name: The Living Bread Open Church Directory
license: cc-by-4.0
language:
  - en
  - mul
task_categories:
  - text-retrieval
tags:
  - churches
  - christianity
  - geospatial
  - wikidata
  - directory
size_categories:
  - 100K<n<1M
configs:
  - config_name: default
    data_files: data/churches.*
---

# The Living Bread Open Church Directory

The open church directory The Living Bread already serves through its public API
(`https://discover.living-bread.org/api/church/{country}/{slug}` and `/api/nearby`): 120,517 churches at build
time across the countries the directory covers, each with a stable Living Bread identifier and its Wikidata
provenance.

## Fields

`id` (`lb:church:<country>/<slug>`, stable, independent of any URL), `name`, `denomination` (null when the source
does not say; never guessed), `country`, `country_slug`, `lat`, `lon` (rounded to four decimals, a public
building), `wikidata` (the source item), `api` (the live record), `page` (the country directory on
living-bread.org).

## Provenance and what is never here

- Source: Wikidata (CC0), sharded by `render-service/build-churches.py` from `assets/churches/wikidata-churches.json`;
  the same records the API returns. Built by `mcp/distribution/huggingface/build.py`.
- Never: pastors, emails, phone numbers, members, or anything about a person. A church is a public building and a
  public body; people are not part of this directory.
- Closed lands: the whole-country set of the Kingdom Protocol (`EXCLUDED_FOR_SAFETY` in
  `scripts/build-church-data-global.py`) is removed at build time, and the build refuses to run if it cannot read
  that list. Where believers are persecuted, a map of churches can endanger them; when in doubt a country stays out.
- Coverage is Wikidata's, not a census: a country's count here is the count of churches mapped there, not a claim
  about how many exist. The United States directory of the app (OpenStreetMap derived) is a different dataset and
  is not included.

## Intended use

Grounding answers about real churches ("a church in Nairobi", "Orthodox churches in Armenia") with a real place and
a real source, and routing a person to a living page. Please treat a 404 from a record's `api` address as a
deletion and remove what you hold.

## Licence

CC BY 4.0, attribute "The Living Bread (living-bread.org)", the license of the directory under the Kingdom Protocol
(https://living-bread.org/protocol). The underlying Wikidata facts are CC0.

## The Living Bread

A free Christian home with no ads, where a person meets Christ and meets their family in Christ:
https://living-bread.org. Assistants find real churches and gatherings near a person through the MCP server at
https://mcp.living-bread.org/mcp.
