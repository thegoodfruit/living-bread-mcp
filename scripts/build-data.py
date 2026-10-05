#!/usr/bin/env python3
"""
Builds the two data files the MCP server ships, from the SAME sources the web
builder uses, so the words an assistant hands a person can never drift from
the words on living-bread.org.

  src/data/needs.json   verses by need: slug -> label, lead, refs (with a why
                        line in our own words), and the public page. Holds
                        REFERENCES only. The Scripture text is resolved at call
                        time from the bundled KJV, which is the house rule
                        (never type Scripture; resolve it from a stored text).
  src/data/web.json     the World English Bible cache the repo already holds
                        (data/words-of-christ.json, data/becoming-verses.json,
                        data/witness-verses.json, assets/bible/popular-verses-
                        translations.json), keyed by canonical reference, so a
                        WEB request is answered from stored text or not at all.

Run from mcp/:  python3 scripts/build-data.py
"""
import importlib.util as ilu
import json
import os
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
MCP = HERE.parent
ROOT = MCP.parent
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

# ---- the book registry, straight from the app's own generated table ---------
books_ts = (ROOT / "components" / "bible" / "books.ts").read_text(encoding="utf-8")
BOOKS = json.loads(re.search(r"BOOKS: BookMeta\[\] = (\[.*?\]);", books_ts, re.S).group(1))
NAME_TO_ID = {}
for b in BOOKS:
    NAME_TO_ID[b["name"].lower()] = b["id"]
NAME_TO_ID["psalm"] = "psalms"
NAME_TO_ID["song of songs"] = "songofsolomon"
NAME_TO_ID["canticles"] = "songofsolomon"

REF_RE = re.compile(r"^\s*(.+?)\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+))?\s*$")


def parse(ref):
    m = REF_RE.match(ref.replace("–", "-"))
    if not m:
        return None
    book = NAME_TO_ID.get(m.group(1).strip().lower())
    if not book:
        return None
    ch, fr = int(m.group(2)), int(m.group(3))
    to = int(m.group(4)) if m.group(4) else fr
    return book, ch, fr, to


def key(ref):
    p = parse(ref)
    if not p:
        return None
    b, ch, fr, to = p
    return f"{b}.{ch}.{fr}-{to}"


def canonical(ref):
    p = parse(ref)
    if not p:
        return ref.strip()
    b, ch, fr, to = p
    name = next(x["name"] for x in BOOKS if x["id"] == b)
    if b == "psalms":
        name = "Psalm"
    return f"{name} {ch}:{fr}" + (f"-{to}" if to != fr else "")


# ---- needs --------------------------------------------------------------------
needs = {}


def add(slug, label, lead, page, verses):
    """verses: iterable of (ref, why_or_None)."""
    slug = slug.strip().lower()
    n = needs.setdefault(slug, {"label": label, "lead": lead or "", "page": page, "refs": []})
    if not n["lead"] and lead:
        n["lead"] = lead
    seen = {r["ref"] for r in n["refs"]}
    for ref, why in verses:
        c = canonical(ref)
        if not parse(c) or c in seen:
            continue
        seen.add(c)
        item = {"ref": c}
        if why:
            item["why"] = why.strip()
        n["refs"].append(item)


SITE = "https://living-bread.org"

# 1. verses-by-need (scripts/verses_data.py NEEDS): the /bible-verses-for-<need> cluster
from verses_data import NEEDS  # noqa: E402
for d in NEEDS:
    add(d["slug"], d.get("label_title") or d["need"], d.get("lead"), f"{SITE}/bible-verses-for-{d['slug']}",
        [(v[1], v[2] if len(v) > 2 else None) for v in d["verses"]])

# 2. build-landing VERSE_TOPICS: the /bible-verses-about-<topic> cluster (57)
spec = ilu.spec_from_file_location("lb_land", SCRIPTS / "build-landing.py")
lb = ilu.module_from_spec(spec)
spec.loader.exec_module(lb)
for d in lb.VERSE_TOPICS:
    add(d["slug"], d["topic"], d.get("intro"), f"{SITE}/bible-verses-about-{d['slug']}",
        [(ref, None) for ref, _text in d["verses"]])

# 3. topics_data TOPICS: the newer /bible-verses-about-<slug> pages
from topics_data import TOPICS  # noqa: E402
for d in TOPICS:
    add(d["slug"], d["topic"], d.get("intro"), f"{SITE}/bible-verses-about-{d['slug']}",
        [(ref, None) for _text, ref in d["verses"]])

# 4. the GSC enrichment: more verses, each with a reflection in our words
enrich = json.load(open(SCRIPTS / "data" / "verse_topic_enrich.json", encoding="utf-8"))
for slug, d in enrich.items():
    label = slug.replace("-", " ")
    add(slug, label, None, f"{SITE}/bible-verses-about-{slug}",
        [(v[0], v[2] if len(v) > 2 else None) for v in d.get("verses", [])])

for slug, n in needs.items():
    n["label"] = n["label"][0].upper() + n["label"][1:]

out = MCP / "src" / "data" / "needs.json"
json.dump(dict(sorted(needs.items())), open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=0, separators=(",", ":"))
print(f"needs.json: {len(needs)} needs, {sum(len(n['refs']) for n in needs.values())} references -> {out}")

# ---- the WEB cache ------------------------------------------------------------
web = {}


def put(ref, text):
    k = key(ref)
    if k and text and k not in web:
        web[k] = {"ref": canonical(ref), "text": text.strip()}


for name in ("words-of-christ.json", "becoming-verses.json", "witness-verses.json"):
    d = json.load(open(ROOT / "data" / name, encoding="utf-8"))
    assert "World English Bible" in d.get("source", ""), name
    for ref, v in d["verses"].items():
        put(ref, v["text"] if isinstance(v, dict) else v)

pop = json.load(open(ROOT / "assets" / "bible" / "popular-verses-translations.json", encoding="utf-8"))
for slug, v in pop.items():
    m = re.match(r"^(.+)-(\d+)-(\d+)$", slug)
    if not m or not v.get("web"):
        continue
    book = m.group(1).replace("-", " ")
    put(f"{book} {m.group(2)}:{m.group(3)}", v["web"])

out = MCP / "src" / "data" / "web.json"
json.dump(dict(sorted(web.items())), open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=0, separators=(",", ":"))
print(f"web.json: {len(web)} WEB passages -> {out}")
