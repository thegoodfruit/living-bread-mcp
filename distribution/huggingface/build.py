#!/usr/bin/env python3
"""
THE LIVING BREAD, open data for the people who build AI: three Hugging Face dataset packages.

  scripture/          every verse of the public-domain Bibles The Living Bread holds, one row per verse,
                      with a SHA-256 of the verse exactly as stored (the same hash /api/verify and the MCP
                      tool verify_scripture_quote return, so a model's quotation can be checked offline)
  verses-for-needs/   the house's mapping of about a hundred human needs (anxiety, grief, loneliness...) to
                      Scripture references, each with the KJV words read from the stored text and its hash
  church-directory/   the open church directory the discover API already serves (/api/church/{country}/{slug}),
                      Wikidata provenance on every row

Run from anywhere:  python3 mcp/distribution/huggingface/build.py [--out DIR]
Writes DIR/<dataset>/data/*.jsonl, and *.parquet as well when pyarrow is installed (pip install pyarrow),
and copies each dataset card (README.md) beside its data. Nothing here is uploaded: publishing needs the
owner's Hugging Face account (see README.md in this folder).

Sources, all read from this repository, nothing typed and nothing fetched:
  assets/bible/books/*.json                    King James Version (the text the app ships)
  render-service/assets-data/books-<code>/     the other held translations (regenerate with
                                               render-service/build-data.py and build-bible-*.py)
  render-service/assets-data/churches/*.json   the open church directory (build-churches.py)
  mcp/src/data/needs.json, mcp/src/data/web.json
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
KJV_DIR = ROOT / "assets" / "bible" / "books"
ASSETS = ROOT / "render-service" / "assets-data"
NEEDS = ROOT / "mcp" / "src" / "data" / "needs.json"
WEB = ROOT / "mcp" / "src" / "data" / "web.json"

# Only translations the repository's own build scripts record as public domain are published. Biblia Livre
# (pt) is CC BY 3.0 Brazil, and uk, ja and ko are recorded with an unresolved status, so they are left out
# until the owner confirms each license.
PUBLIC_DOMAIN = {
    "es": ("Reina-Valera 1909", "es"), "fr": ("Bible Darby", "fr"), "zh": ("Chinese Union Version", "zh"),
    "ar": ("Smith and Van Dyck (1865)", "ar"), "hi": ("Hindi Bible (traditional)", "hi"), "ru": ("Synodal Translation (1876)", "ru"),
    "tl": ("Ang Dating Biblia (1905)", "tl"), "de": ("Elberfelder (1905)", "de"), "vi": ("Kinh Thanh (1934)", "vi"),
    "it": ("Giovanni Diodati (1649)", "it"), "nl": ("Statenvertaling", "nl"), "pl": ("Biblia Gdanska (1881)", "pl"),
    "hu": ("Karoli", "hu"), "cs": ("Bible kralicka", "cs"), "fi": ("Biblia (1776)", "fi"), "el": ("Vamvas", "el"),
    "sv": ("Bibeln (1917)", "sv"), "da": ("Bibelen", "da"), "hr": ("Biblija", "hr"), "la": ("Vulgata Clementina", "la"),
    "eo": ("La Sankta Biblio", "eo"), "sr": ("Danicic-Karadzic", "sr"), "sq": ("Bibla", "sq"),
    "ml": ("Sathyavedapusthakam (1910)", "ml"), "my": ("Judson (1835)", "my"), "sw": ("Biblia Takatifu (Krapf 1850), New Testament", "sw"),
}
HELD_BACK = {"pt": "Biblia Livre, CC BY 3.0 Brazil (not public domain)", "uk": "Ohienko, license status under review",
             "ja": "Kougo-yaku, license status under review", "ko": "Gaeyeok, license status under review"}


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def kjv_order():
    man = json.loads((ASSETS / "manifest" / "verses.json").read_text(encoding="utf-8")) if (ASSETS / "manifest" / "verses.json").is_file() else None
    if man:
        return [(b["asset"], b["name"]) for b in man["books"]]
    # without the render-service manifest, canonical order is not knowable from file names alone
    sys.exit("render-service/assets-data/manifest/verses.json is missing: run render-service/build-data.py first")


def scripture_rows():
    order = kjv_order()
    for bi, (asset, _name) in enumerate(order):
        data = json.loads((KJV_DIR / f"{asset}.json").read_text(encoding="utf-8"))
        name = data["n"]
        for ci, ch in enumerate(data["c"]):
            for vi, t in enumerate(ch):
                if isinstance(t, str) and t.strip():
                    text = t.strip()
                    yield "KJV", {"id": f"lb:scripture:verse-{slug(name)}-{ci + 1}-{vi + 1}", "translation": "KJV",
                                  "translation_name": "King James Version", "language": "en", "book_id": asset,
                                  "book": name, "book_order": bi + 1, "chapter": ci + 1, "verse": vi + 1, "text": text,
                                  "sha256": sha(text), "license": "Public domain"}
    for code, (tname, lang) in PUBLIC_DOMAIN.items():
        man_p = ASSETS / "manifest" / f"verses-{code}.json"
        if not man_p.is_file():
            print(f"  skip {code}: {man_p} not built")
            continue
        man = json.loads(man_p.read_text(encoding="utf-8"))
        books = man if isinstance(man, list) else man.get("books", [])
        for bi, b in enumerate(books):
            p = ASSETS / f"books-{code}" / f"{b['asset']}.json"
            if not p.is_file():
                continue
            data = json.loads(p.read_text(encoding="utf-8"))
            for ci, ch in enumerate(data.get("c", [])):
                for vi, t in enumerate(ch or []):
                    if isinstance(t, str) and t.strip():
                        text = t.strip()
                        yield code, {"id": f"lb:scripture:{code}:{b['asset']}-{ci + 1}-{vi + 1}", "translation": code,
                                     "translation_name": tname, "language": lang, "book_id": b["asset"],
                                     "book": b.get("name", data.get("n")), "book_order": bi + 1, "chapter": ci + 1,
                                     "verse": vi + 1, "text": text, "sha256": sha(text), "license": "Public domain"}
    web = json.loads(WEB.read_text(encoding="utf-8"))
    for key, v in web.items():
        m = re.match(r"^([a-z0-9]+)\.(\d+)\.(\d+)-(\d+)$", key)
        if not m:
            continue
        text = v["text"].strip()
        yield "WEB", {"id": f"lb:scripture:web:{m.group(1)}-{m.group(2)}-{m.group(3)}" + (f"-{m.group(4)}" if m.group(4) != m.group(3) else ""),
                      "translation": "WEB", "translation_name": "World English Bible (passages cached by The Living Bread)",
                      "language": "en", "book_id": m.group(1), "book": v["ref"].rsplit(" ", 1)[0], "book_order": None,
                      "chapter": int(m.group(2)), "verse": int(m.group(3)), "text": text, "sha256": sha(text), "license": "Public domain"}


def kjv_lookup():
    by_name = {}
    books = {}
    for asset, _ in kjv_order():
        data = json.loads((KJV_DIR / f"{asset}.json").read_text(encoding="utf-8"))
        books[asset] = data
        by_name[data["n"].lower().replace(" ", "")] = asset
    by_name["psalm"] = "psalms"
    by_name["songofsongs"] = "songofsolomon"

    def read(ref):
        m = re.match(r"^(.*?)\s+(\d+):(\d+)(?:-(\d+))?$", ref.strip())
        if not m:
            return None
        asset = by_name.get(m.group(1).lower().replace(" ", ""))
        if not asset:
            return None
        ch = books[asset]["c"][int(m.group(2)) - 1]
        a, b = int(m.group(3)), int(m.group(4) or m.group(3))
        verses = [t.strip() for t in ch[a - 1:b] if isinstance(t, str)]
        return " ".join(verses).rstrip(",;:") if verses else None
    return read


def needs_rows():
    read = kjv_lookup()
    needs = json.loads(NEEDS.read_text(encoding="utf-8"))
    for slug_, n in needs.items():
        for rank, r in enumerate(n.get("refs", []), 1):
            text = read(r["ref"])
            yield {"need": slug_, "need_label": n.get("label"), "rank": rank, "ref": r["ref"],
                   "why": r.get("why"), "why_is": "the house's own words (reflection), never Scripture",
                   "kjv_text": text, "kjv_sha256": sha(text) if text else None, "page": n.get("page")}


def closed_lands():
    """The whole-country closed set of the Kingdom Protocol (scripts/build-church-data-global.py EXCLUDED_FOR_SAFETY)."""
    import ast
    src = (ROOT / "scripts" / "build-church-data-global.py").read_text(encoding="utf-8")
    m = re.search(r"EXCLUDED_FOR_SAFETY\s*=\s*(\[.*?\])", src, re.S)
    if not m:
        sys.exit("cannot read EXCLUDED_FOR_SAFETY: refusing to publish a church directory without the closed-land guard")
    return {c.strip().lower() for c in ast.literal_eval(m.group(1)) if "(" not in c}


def church_rows():
    closed = closed_lands()
    d = ASSETS / "churches"
    if not d.is_dir():
        print("  skip church-directory: render-service/assets-data/churches is not built")
        return
    for f in sorted(d.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        country, cslug = data.get("country"), data.get("slug")
        if str(country or "").strip().lower() in closed:
            print(f"  closed land left out: {country}")
            continue
        for c in data.get("churches", []):
            qid = c.get("id") if str(c.get("id", "")).startswith("Q") else None
            yield {"id": f"lb:church:{cslug}/{c['slug']}", "name": c.get("name"), "denomination": c.get("denomination"),
                   "country": country, "country_slug": cslug,
                   "lat": round(c["lat"], 4) if isinstance(c.get("lat"), (int, float)) else None,
                   "lon": round(c["lon"], 4) if isinstance(c.get("lon"), (int, float)) else None,
                   "wikidata": f"https://www.wikidata.org/wiki/{qid}" if qid else None,
                   "api": f"https://discover.living-bread.org/api/church/{cslug}/{c['slug']}",
                   "page": f"https://living-bread.org/churches/{cslug}"}


def write(out, name, rows_by_file):
    data = out / name / "data"
    data.mkdir(parents=True, exist_ok=True)
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        pa = None
    total = 0
    for fname, rows in rows_by_file.items():
        with open(data / f"{fname}.jsonl", "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        total += len(rows)
        if pa is not None:
            pq.write_table(pa.Table.from_pylist(rows), data / f"{fname}.parquet")
    shutil.copy(HERE / name / "README.md", out / name / "README.md")
    print(f"  {name}: {total} rows in {len(rows_by_file)} file(s){'' if pa else ' (JSONL only; pip install pyarrow for parquet)'}")
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "out"))
    out = pathlib.Path(ap.parse_args().out)
    print(f"building into {out}")
    by = {}
    for code, row in scripture_rows():
        by.setdefault(code, []).append(row)
    write(out, "scripture", by)
    write(out, "verses-for-needs", {"verses_for_needs": list(needs_rows())})
    churches = list(church_rows())
    if churches:
        write(out, "church-directory", {"churches": churches})
    manifest = {name: sorted(str(p.relative_to(out)) for p in (out / name).rglob("*") if p.is_file()) for name in ("scripture", "verses-for-needs", "church-directory") if (out / name).is_dir()}
    (out / "MANIFEST.json").write_text(json.dumps({"held_back": HELD_BACK, "files": manifest}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
