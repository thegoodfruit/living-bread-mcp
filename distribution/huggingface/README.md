# Hugging Face datasets: prepared, not published

Status: prepared. Publishing needs the owner's Hugging Face account (organisation suggested: `living-bread`).

Three datasets, each with its own card (the README.md in its folder):

| Folder | Hub name (suggested) | Rows at build (2026-10-06) | License |
|---|---|---|---|
| scripture/ | living-bread/scripture | 817,154 verses in 28 configs (KJV default, WEB passages, 26 more languages) | public domain texts; arrangement CC0 |
| verses-for-needs/ | living-bread/verses-for-needs | 941 | CC BY 4.0 (KJV text public domain) |
| church-directory/ | living-bread/church-directory | 120,517 | CC BY 4.0 (Wikidata facts CC0) |

## Build

```
pip install pyarrow            # optional: parquet beside the JSONL
python3 render-service/build-data.py      # only if render-service/assets-data is not built
python3 render-service/build-churches.py  # only if assets-data/churches is not built
python3 mcp/distribution/huggingface/build.py --out /tmp/lb-hf
```

The script reads only files in this repository, types nothing and generates nothing. Held back on purpose: the
Portuguese Biblia Livre (CC BY 3.0 Brazil) and the Ukrainian, Japanese and Korean texts (license status under
review). `out/MANIFEST.json` lists every file written and what was held back.

## Publish (owner)

```
pip install -U huggingface_hub
hf auth login                                          # the owner's token, write scope
hf repos create living-bread/scripture --repo-type dataset
hf upload living-bread/scripture /tmp/lb-hf/scripture . --repo-type=dataset
# the same for verses-for-needs and church-directory (commands per huggingface.co/docs/huggingface_hub/guides/cli, read 2026-10-06)
```

After publishing: add each dataset to `mcp/src/data/distribution.json` as `listed` with the date it was read on the
Hub, and link them from living-bread.org/developers. Never describe download counts we have not read.
