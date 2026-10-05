#!/usr/bin/env python3
"""
THE LIVING BREAD MCP, the evidence manifest for the stored Scripture.

Writes, from the files the app itself ships (never from memory):

  mcp/src/data/corpus.json
      The corpus version: a SHA-256 over every bundled King James book file
      (assets/bible/books/<id>.json), each book's own SHA-256, its chapter
      and verse counts, and the same for the cross-reference dataset. The
      Worker hashes each book again when it reads it and says so if the two
      ever disagree, so an evidence label can never quietly go stale.

  assets/bible/xref/<book>.json
      The OpenBible.info cross-references (assets/bible/cross-references.json,
      CC BY, fetched once by scripts/fetch-cross-references.py) split by book,
      so the Worker reads one small file instead of 9.7 MB. Only links readers
      voted up (votes >= 1) and at most 12 per verse, strongest first: the
      same "most helpful first" order the web's cross-reference pages use.

  assets/bible/.assetsignore
      Keeps the 9.7 MB source file and the translations file out of the
      Worker's static assets (the Worker reads books/ and xref/ only).

Run from the repo root or anywhere:  python3 mcp/scripts/build-corpus.py
"""
from __future__ import annotations

import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOKS = ROOT / "assets" / "bible" / "books"
XREF_SRC = ROOT / "assets" / "bible" / "cross-references.json"
XREF_OUT = ROOT / "assets" / "bible" / "xref"
MANIFEST = ROOT / "mcp" / "src" / "data" / "corpus.json"
IGNORE = ROOT / "assets" / "bible" / ".assetsignore"

MAX_PER_VERSE = 12
MIN_VOTES = 1


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> None:
    books = {}
    roll = hashlib.sha256()
    total_verses = 0
    for f in sorted(BOOKS.glob("*.json")):
        raw = f.read_bytes()
        data = json.loads(raw)
        chapters = data.get("c") or []
        verses = sum(len(c) for c in chapters)
        total_verses += verses
        h = sha(raw)
        roll.update(f.stem.encode() + b":" + h.encode() + b"\n")
        books[f.stem] = {"sha256": h, "chapters": len(chapters), "verses": verses}
    if len(books) != 66:
        raise SystemExit(f"expected 66 books, found {len(books)}")

    raw = XREF_SRC.read_bytes()
    xref = json.loads(raw)
    XREF_OUT.mkdir(parents=True, exist_ok=True)
    by_book: dict[str, dict[str, list]] = {}
    links = 0
    for key, targets in xref.items():
        book, rest = key.split(".", 1)
        kept = [t for t in sorted(targets, key=lambda t: -t[2]) if t[2] >= MIN_VOTES][:MAX_PER_VERSE]
        if not kept:
            continue
        by_book.setdefault(book, {})[rest] = kept
        links += len(kept)
    for old in XREF_OUT.glob("*.json"):
        old.unlink()
    for book, verses in sorted(by_book.items()):
        (XREF_OUT / f"{book}.json").write_text(json.dumps(verses, separators=(",", ":"), sort_keys=True), encoding="utf-8")

    IGNORE.write_text("# The MCP Worker reads books/ and xref/ only (mcp/scripts/build-corpus.py).\ncross-references.json\npopular-verses-translations.json\n", encoding="utf-8")

    manifest = {
        "translation": "KJV",
        "translation_name": "King James Version",
        "license": "Public domain",
        "canon": "Protestant canon: 66 books (39 Old Testament, 27 New Testament). The deuterocanonical books (Apocrypha) are not held.",
        "books": len(books),
        "verses": total_verses,
        "corpus_version": "kjv-" + roll.hexdigest()[:16],
        "corpus_sha256": roll.hexdigest(),
        "source": "assets/bible/books in the Living Bread repository: the same text the app ships",
        "book_files": books,
        "cross_references": {
            "source": "OpenBible.info cross references",
            "license": "CC BY 4.0",
            "attribution": "Cross-reference data from OpenBible.info, used under CC BY.",
            "url": "https://www.openbible.info/labs/cross-references/",
            "source_sha256": sha(raw),
            "source_verses": len(xref),
            "verses_with_links": sum(len(v) for v in by_book.values()),
            "links_kept": links,
            "rule": f"links with at least {MIN_VOTES} reader vote, at most {MAX_PER_VERSE} per verse, strongest first",
        },
    }
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"corpus {manifest['corpus_version']}: {len(books)} books, {total_verses} verses; xref {links} links over {manifest['cross_references']['verses_with_links']} verses")


if __name__ == "__main__":
    main()
