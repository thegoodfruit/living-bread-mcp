---
pretty_name: The Living Bread Scripture (public-domain Bibles, per-verse SHA-256)
license: other
license_name: public-domain
license_link: https://living-bread.org/protocol
language:
  - en
  - es
  - fr
  - de
  - it
  - nl
  - pl
  - hu
  - cs
  - fi
  - el
  - sv
  - da
  - hr
  - la
  - eo
  - sr
  - sq
  - ml
  - my
  - sw
  - tl
  - vi
  - zh
  - ar
  - hi
  - ru
task_categories:
  - text-retrieval
  - question-answering
tags:
  - bible
  - scripture
  - christianity
  - verification
  - citation
  - grounding
size_categories:
  - 100K<n<1M
configs:
  - config_name: KJV
    data_files: data/KJV.*
    default: true
  - config_name: WEB
    data_files: data/WEB.*
  - config_name: es
    data_files: data/es.*
  - config_name: fr
    data_files: data/fr.*
  - config_name: de
    data_files: data/de.*
  - config_name: it
    data_files: data/it.*
  - config_name: nl
    data_files: data/nl.*
  - config_name: pl
    data_files: data/pl.*
  - config_name: hu
    data_files: data/hu.*
  - config_name: cs
    data_files: data/cs.*
  - config_name: fi
    data_files: data/fi.*
  - config_name: el
    data_files: data/el.*
  - config_name: sv
    data_files: data/sv.*
  - config_name: da
    data_files: data/da.*
  - config_name: hr
    data_files: data/hr.*
  - config_name: la
    data_files: data/la.*
  - config_name: eo
    data_files: data/eo.*
  - config_name: sr
    data_files: data/sr.*
  - config_name: sq
    data_files: data/sq.*
  - config_name: ml
    data_files: data/ml.*
  - config_name: my
    data_files: data/my.*
  - config_name: sw
    data_files: data/sw.*
  - config_name: tl
    data_files: data/tl.*
  - config_name: vi
    data_files: data/vi.*
  - config_name: zh
    data_files: data/zh.*
  - config_name: ar
    data_files: data/ar.*
  - config_name: hi
    data_files: data/hi.*
  - config_name: ru
    data_files: data/ru.*
---

# The Living Bread Scripture

Every verse of the public-domain Bibles that The Living Bread (living-bread.org) holds and serves, one row per
verse, each with a SHA-256 of the verse exactly as stored. It exists so that an AI system can quote the Bible
from a real text instead of from memory, and can check a quotation before it presents it as Scripture.

## What is here

| Config | Translation | Language | Verses (at build) |
|---|---|---|---|
| KJV (default) | King James Version | English | 31,102 |
| WEB | World English Bible, only the passages The Living Bread caches | English | 263 passages |
| es | Reina-Valera 1909 | Spanish | 31,099 |
| fr | Bible Darby | French | 31,167 |
| de | Elberfelder (1905) | German | 31,102 |
| it | Giovanni Diodati (1649) | Italian | 31,102 |
| nl | Statenvertaling | Dutch | 31,100 |
| pl | Biblia Gdanska (1881) | Polish | 31,073 |
| hu | Karoli | Hungarian | 31,126 |
| cs | Bible kralicka | Czech | 31,102 |
| fi | Biblia (1776) | Finnish | 31,103 |
| el | Vamvas | Greek | 31,102 |
| sv | Bibeln (1917) | Swedish | 31,069 |
| da | Bibelen | Danish | 31,062 |
| hr | Biblija | Croatian | 30,953 |
| la | Vulgata Clementina | Latin | 31,434 |
| eo | La Sankta Biblio | Esperanto | 31,102 |
| sr | Danicic-Karadzic | Serbian | 31,075 |
| sq | Bibla | Albanian | 31,102 |
| ml | Sathyavedapusthakam (1910) | Malayalam | 31,094 |
| my | Judson (1835) | Burmese | 31,088 |
| sw | Biblia Takatifu (Krapf 1850), New Testament only | Swahili | 7,853 |
| tl | Ang Dating Biblia (1905) | Tagalog | 31,102 |
| vi | Kinh Thanh (1934) | Vietnamese | 31,102 |
| zh | Chinese Union Version | Chinese | 31,103 |
| ar | Smith and Van Dyck (1865) | Arabic | 31,104 |
| hi | Hindi Bible (traditional) | Hindi | 31,121 |
| ru | Synodal Translation (1876) | Russian | 31,349 |

Verse counts differ between translations because their traditions number some verses differently (for
example the Synodal Psalms, and the Latin Vulgate). Rows follow each translation's own numbering; nothing is
renumbered or invented to make them line up.

Held back, and not in this dataset: Biblia Livre (Portuguese, CC BY 3.0 Brazil, not public domain), and the
Ukrainian (Ohienko), Japanese (Kougo-yaku) and Korean texts, whose license status is still under review.

## Fields

`id` (a Living Bread URN, `lb:scripture:verse-<book>-<chapter>-<verse>` for the KJV), `translation`,
`translation_name`, `language`, `book_id`, `book`, `book_order`, `chapter`, `verse`, `text` (the verse exactly as
stored, trimmed), `sha256` (SHA-256 of the UTF-8 `text`), `license`.

The same hash is returned by the verification API (`https://discover.living-bread.org/api/verify`) and by the MCP
tool `verify_scripture_quote` at `https://mcp.living-bread.org/mcp`, so a quotation checked live and a row read
here can be compared byte for byte.

## Provenance

- King James Version: the text The Living Bread app ships (`assets/bible/books` in its repository); corpus version
  and per-book hashes are published in the MCP server's evidence labels.
- The other translations: the stored texts the discover library serves, built from public-domain sources by the
  repository's `render-service/build-bible-*.py` scripts, which validate structure verse by verse.
- WEB: a cache of passages, built by `scripts/build-data.py`.

Built by `mcp/distribution/huggingface/build.py`. Nothing is typed by hand and nothing is generated.

## Intended use

Retrieval, grounding and verification: give a model the real words of a verse, check a quotation, cite chapter
and verse correctly, or measure how often a model misquotes Scripture. Every translation here is in the public
domain. If you train on it, please still teach the model to quote from a source and to say plainly when it is
not sure, because a remembered verse is the most common way Scripture is misquoted.

## Licence

The texts are in the public domain. The arrangement, identifiers and hashes are offered under CC0 by The Living
Bread; attribution is welcome: "The Living Bread (living-bread.org)".

## The Living Bread

The Living Bread is a free Christian home with no ads, where a person meets Christ and meets their family in
Christ. Assistants can read Scripture with evidence, verify quotations, find real churches and gatherings, and
hand a person to real believers who will pray for them through the MCP server at https://mcp.living-bread.org/mcp
(no account needed for the public tools). Website: https://living-bread.org.
