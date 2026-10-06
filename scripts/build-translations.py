#!/usr/bin/env python3
"""
THE LIVING BREAD MCP, the shelf of Bibles: every stored translation, the original
languages, the Strong's lexicon and the versification maps the Worker reads.

Nothing here is typed. Every word is read from a source whose public domain status
or free license PERMITS redistribution, and that statement is copied verbatim into
the manifest. A translation whose license cannot be verified is left out and listed.

Sources
  1. The repository's own validated Bibles (assets/bible-<lang>/books, the same text the
     site served), reused byte for byte where the translation is public domain and its
     status is clear (each README is quoted verbatim).
  2. eBible.org (https://ebible.org/Scriptures/<id>_usfm.zip). The license statement is
     read from https://ebible.org/<id>/copyright.htm at build time and copied verbatim;
     a translation is taken only when that page says Public Domain, or names a Creative
     Commons Attribution (or Attribution ShareAlike) license with no NonCommercial or
     NoDerivatives term.
  3. Original languages: the Westminster Leningrad Codex with the Open Scriptures Hebrew
     Bible lemma and morphology (eBible hboWLC), the Robinson-Pierpont Byzantine Greek New
     Testament (eBible grcbyz, with the parsing codes of the byztxt project, Unlicense),
     and Scrivener's Textus Receptus (eBible grctr).
  4. The King James words tagged with Strong's numbers (eBible eng-kjv2006), used ONLY to
     show which English words render which original word.
  5. Strong's dictionaries (assets/lexicon, scripts/fetch-strongs.py), public domain.
  6. Versification maps: the Copenhagen Alliance versification mappings (CC BY-SA 4.0).

Writes
  assets/bible/shelf/t/<id>/<book>.json     {n, c}: c[chapter][verse] is the verse text,
                                            "" when the translation joins it to the verse
                                            before, null when the translation has no such verse.
  assets/bible/shelf/orig/<wlc|byz>/<book>.json  {n, c}: c[chapter][verse] = [[word, strong, morph], ...]
  assets/bible/shelf/kjvs/<book>.json       {c}: c[chapter][verse] = [[english words, [strong, ...]], ...]
  assets/bible/shelf/lex/<h|g>/<bucket>.json Strong's entries, 200 per bucket
  assets/bible/shelf/vrs/<scheme>.json      {to: {kjv ref: scheme ref}, from: {scheme ref: kjv ref}}
  mcp/src/data/translations.json            the manifest the Worker bundles

Run:  python3 mcp/scripts/build-translations.py [--cache DIR] [--no-probe]
The downloads are cached in --cache (default $TMPDIR/lb-bible-cache), never in the repo.
"""
from __future__ import annotations

import argparse
import hashlib
import html as _html
import io
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile
from collections import OrderedDict

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHELF = ROOT / "assets" / "bible" / "shelf"
KJV_DIR = ROOT / "assets" / "bible" / "books"
LEX_DIR = ROOT / "assets" / "lexicon"
MANIFEST = ROOT / "mcp" / "src" / "data" / "translations.json"
SITE = "https://living-bread.org"
UA = {"User-Agent": "Mozilla/5.0 (The Living Bread shelf builder; living-bread.org)"}

# --------------------------------------------------------------------------------------- books
# USFM code, our id, English name. The first 66 are the ids the app and the KJV files use.
BOOKS = [
    ("GEN", "genesis", "Genesis"), ("EXO", "exodus", "Exodus"), ("LEV", "leviticus", "Leviticus"), ("NUM", "numbers", "Numbers"),
    ("DEU", "deuteronomy", "Deuteronomy"), ("JOS", "joshua", "Joshua"), ("JDG", "judges", "Judges"), ("RUT", "ruth", "Ruth"),
    ("1SA", "1samuel", "1 Samuel"), ("2SA", "2samuel", "2 Samuel"), ("1KI", "1kings", "1 Kings"), ("2KI", "2kings", "2 Kings"),
    ("1CH", "1chronicles", "1 Chronicles"), ("2CH", "2chronicles", "2 Chronicles"), ("EZR", "ezra", "Ezra"), ("NEH", "nehemiah", "Nehemiah"),
    ("EST", "esther", "Esther"), ("JOB", "job", "Job"), ("PSA", "psalms", "Psalm"), ("PRO", "proverbs", "Proverbs"),
    ("ECC", "ecclesiastes", "Ecclesiastes"), ("SNG", "songofsolomon", "Song of Solomon"), ("ISA", "isaiah", "Isaiah"), ("JER", "jeremiah", "Jeremiah"),
    ("LAM", "lamentations", "Lamentations"), ("EZK", "ezekiel", "Ezekiel"), ("DAN", "daniel", "Daniel"), ("HOS", "hosea", "Hosea"),
    ("JOL", "joel", "Joel"), ("AMO", "amos", "Amos"), ("OBA", "obadiah", "Obadiah"), ("JON", "jonah", "Jonah"),
    ("MIC", "micah", "Micah"), ("NAM", "nahum", "Nahum"), ("HAB", "habakkuk", "Habakkuk"), ("ZEP", "zephaniah", "Zephaniah"),
    ("HAG", "haggai", "Haggai"), ("ZEC", "zechariah", "Zechariah"), ("MAL", "malachi", "Malachi"),
    ("MAT", "matthew", "Matthew"), ("MRK", "mark", "Mark"), ("LUK", "luke", "Luke"), ("JHN", "john", "John"), ("ACT", "acts", "Acts"),
    ("ROM", "romans", "Romans"), ("1CO", "1corinthians", "1 Corinthians"), ("2CO", "2corinthians", "2 Corinthians"), ("GAL", "galatians", "Galatians"),
    ("EPH", "ephesians", "Ephesians"), ("PHP", "philippians", "Philippians"), ("COL", "colossians", "Colossians"),
    ("1TH", "1thessalonians", "1 Thessalonians"), ("2TH", "2thessalonians", "2 Thessalonians"), ("1TI", "1timothy", "1 Timothy"),
    ("2TI", "2timothy", "2 Timothy"), ("TIT", "titus", "Titus"), ("PHM", "philemon", "Philemon"), ("HEB", "hebrews", "Hebrews"),
    ("JAS", "james", "James"), ("1PE", "1peter", "1 Peter"), ("2PE", "2peter", "2 Peter"), ("1JN", "1john", "1 John"),
    ("2JN", "2john", "2 John"), ("3JN", "3john", "3 John"), ("JUD", "jude", "Jude"), ("REV", "revelation", "Revelation"),
    # deuterocanonical and Septuagint books, held only where a translation holds them
    ("TOB", "tobit", "Tobit"), ("JDT", "judith", "Judith"), ("ESG", "esthergreek", "Esther (Greek)"), ("WIS", "wisdom", "Wisdom"),
    ("SIR", "sirach", "Sirach"), ("BAR", "baruch", "Baruch"), ("LJE", "letterofjeremiah", "Letter of Jeremiah"),
    ("S3Y", "songofthethree", "Song of the Three Young Men"), ("SUS", "susanna", "Susanna"), ("BEL", "belandthedragon", "Bel and the Dragon"),
    ("1MA", "1maccabees", "1 Maccabees"), ("2MA", "2maccabees", "2 Maccabees"), ("3MA", "3maccabees", "3 Maccabees"),
    ("4MA", "4maccabees", "4 Maccabees"), ("1ES", "1esdras", "1 Esdras"), ("2ES", "2esdras", "2 Esdras"),
    ("MAN", "prayerofmanasseh", "Prayer of Manasseh"), ("PS2", "psalm151", "Psalm 151"), ("DAG", "danielgreek", "Daniel (Greek)"),
]
CODE_TO_ID = {c: i for c, i, _ in BOOKS}
ID_TO_CODE = {i: c for c, i, _ in BOOKS}
ID_NAME = {i: n for _, i, n in BOOKS}
ORDER = [i for _, i, _ in BOOKS]
PROTESTANT = ORDER[:66]
OT = ORDER[:39]
NT = ORDER[39:66]
# byztxt file names
BYZTXT = {"MAT": "MAT", "MRK": "MAR", "LUK": "LUK", "JHN": "JOH", "ACT": "ACT", "ROM": "ROM", "1CO": "1CO", "2CO": "2CO", "GAL": "GAL",
          "EPH": "EPH", "PHP": "PHP", "COL": "COL", "1TH": "1TH", "2TH": "2TH", "1TI": "1TI", "2TI": "2TI", "TIT": "TIT", "PHM": "PHM",
          "HEB": "HEB", "JAS": "JAM", "1PE": "1PE", "2PE": "2PE", "1JN": "1JO", "2JN": "2JO", "3JN": "3JO", "JUD": "JUD", "REV": "REV"}

# --------------------------------------------------------------------------------------- the shelf
# id, source ("repo:<lang>" or "ebible:<id>"), name, BCP-47 language, language name, note
SHELF_LIST = [
    # English
    ("bsb", "ebible:engbsb", "Berean Standard Bible", "en", "English", None),
    ("web", "ebible:engwebp", "World English Bible", "en", "English", None),
    ("asv", "ebible:eng-asv", "American Standard Version (1901)", "en", "English", None),
    ("ylt", "ebible:engylt", "Young's Literal Translation", "en", "English", None),
    ("dra", "ebible:engDRA", "Douay-Rheims (Challoner revision, 1899 American edition)", "en", "English",
     "The Catholic Bible in English, translated from the Latin Vulgate, with the deuterocanonical books. Psalms and some other books follow the Vulgate numbering; references are read in the standard (KJV) numbering and mapped."),
    ("brenton", "ebible:eng-Brenton", "Brenton's English Septuagint (1851)", "en", "English",
     "The Greek Old Testament (Septuagint) in English, the Old Testament of the Orthodox churches, with the books the Septuagint adds. Old Testament only."),
    # Romance and Germanic
    ("rv1909", "repo:es", "Reina-Valera 1909", "es", "Spanish", None),
    ("blivre", "ebible:porbr2018", "Bíblia Livre (Almeida, Textus Receptus edition)", "pt", "Portuguese", None),
    ("lsg", "ebible:fraLSG", "Louis Segond 1910", "fr", "French", None),
    ("darby", "repo:fr", "Bible Darby (French)", "fr", "French", None),
    ("luther1912", "ebible:deu1912", "Luther Bibel 1912", "de", "German", None),
    ("elb1905", "repo:de", "Elberfelder 1905", "de", "German", None),
    ("diodati", "repo:it", "Giovanni Diodati Bible", "it", "Italian", None),
    ("statenvertaling", "repo:nl", "Statenvertaling", "nl", "Dutch", None),
    ("vulgate", "ebible:latVUC", "Clementine Vulgate (1598)", "la", "Latin", None),
    ("sv1917", "repo:sv", "Bibeln 1917", "sv", "Swedish", None),
    ("fi1776", "repo:fi", "Biblia 1776", "fi", "Finnish", None),
    ("esperanto", "repo:eo", "La Sankta Biblio (Esperanto)", "eo", "Esperanto", None),
    # Slavic, Greek, Hungarian
    ("synodal", "repo:ru", "Russian Synodal Translation (1876)", "ru", "Russian", None),
    ("kulish", "ebible:ukr1871", "Ukrainian Bible, Kulish and Puluj (1905)", "uk", "Ukrainian", None),
    ("gdanska", "repo:pl", "Biblia Gdańska (1881)", "pl", "Polish", None),
    ("kralicka", "repo:cs", "Bible kralická", "cs", "Czech", None),
    ("danicic", "repo:sr", "Daničić-Karadžić (Cyrillic)", "sr", "Serbian", None),
    ("vamvas", "repo:el", "Vamvas Bible (Modern Greek, 1850)", "el", "Greek", None),
    ("karoli", "repo:hu", "Károli Bible", "hu", "Hungarian", None),
    # Middle East, Asia
    ("vandyck", "repo:ar", "Smith and Van Dyck Arabic Bible (1865)", "ar", "Arabic", None),
    ("hebmodern", "ebible:heb", "Hebrew Bible with Delitzsch New Testament", "he", "Hebrew", None),
    ("opv", "ebible:pesOPV", "Persian Old Version", "fa", "Persian", None),
    ("irv-hi", "ebible:hin2017", "Hindi Indian Revised Version", "hi", "Hindi", None),
    ("irv-bn", "ebible:benirv", "Bengali Indian Revised Version", "bn", "Bengali", None),
    ("irv-ta", "ebible:tam2017", "Tamil Indian Revised Version", "ta", "Tamil", None),
    ("irv-te", "ebible:tel2017", "Telugu Indian Revised Version", "te", "Telugu", None),
    ("irv-mr", "ebible:mar", "Marathi Indian Revised Version", "mr", "Marathi", None),
    ("irv-gu", "ebible:guj2017", "Gujarati Indian Revised Version", "gu", "Gujarati", None),
    ("irv-pa", "ebible:pan", "Punjabi Indian Revised Version", "pa", "Punjabi", None),
    ("irv-ur", "ebible:urd", "Urdu Indian Revised Version", "ur", "Urdu", None),
    ("irv-kn", "ebible:kanirv", "Kannada Indian Revised Version", "kn", "Kannada", None),
    ("ml1910", "repo:ml", "Sathyavedapusthakam (Malayalam, 1910)", "ml", "Malayalam", None),
    ("ulb-ne", "ebible:npiulb", "Nepali Unlocked Literal Bible", "ne", "Nepali", None),
    ("cuv", "repo:zh", "Chinese Union Version (Simplified)", "zh-Hans", "Chinese (Simplified)", None),
    ("cuvt", "ebible:cmn-cu89t", "Chinese Union Version (Traditional)", "zh-Hant", "Chinese (Traditional)", None),
    ("kor1910", "ebible:kor", "Korean Bible 1910", "ko", "Korean", None),
    ("jfb", "ebible:jpnm", "Japanese Freedom Bible", "ja", "Japanese",
     "eBible.org describes this as a draft translation."),
    ("vie1934", "repo:vi", "Kinh Thánh 1934", "vi", "Vietnamese", None),
    ("adb1905", "repo:tl", "Ang Dating Biblia (1905)", "tl", "Tagalog", None),
    ("judson", "repo:my", "Judson Burmese Bible", "my", "Burmese", None),
    ("cebuano", "ebible:cebulb", "Cebuano Unlocked Literal Bible", "ceb", "Cebuano", None),
    # Africa
    ("neno", "ebible:swhonen", "Neno: Bibilia Takatifu (Open Kiswahili Contemporary Version)", "sw", "Swahili", None),
    ("krapf", "repo:sw", "Biblia Takatifu, Krapf (1850), New Testament", "sw", "Swahili",
     "A partial historical New Testament: 26 of 27 books (Philippians was never translated), no Old Testament."),
    ("hausa", "ebible:hausa", "Littafi Mai Tsarki, Sabon Rai Don Kowa (Hausa)", "ha", "Hausa", None),
    ("yoruba", "ebible:yor", "Bíbélì Mímọ́ ní Èdè Yorùbá Òde-Òní", "yo", "Yoruba", None),
    ("igbo", "ebible:ibo", "Igbo Bible (Biblica Open)", "ig", "Igbo", None),
    ("shona", "ebible:sna", "Shona Bible (Biblica Open)", "sn", "Shona", None),
    ("chichewa", "ebible:nya", "Chichewa Bible (Biblica Open)", "ny", "Chichewa", None),
    ("lingala", "ebible:lin", "Lingala Bible (Biblica Open)", "ln", "Lingala", None),
    ("twi", "ebible:twi", "Akuapem Twi Bible (Biblica Open)", "ak", "Twi", None),
    ("kikuyu", "ebible:kik", "Kikuyu Bible (Biblica Open)", "ki", "Kikuyu", None),
    ("luganda", "ebible:lug", "Luganda Bible (Biblica Open)", "lg", "Luganda", None),
    # the original languages
    ("wlc", "ebible:hboWLC", "Westminster Leningrad Codex (Hebrew Old Testament)", "hbo", "Biblical Hebrew", None),
    ("byz", "ebible:grcbyz", "Byzantine Majority Text, Robinson-Pierpont (Greek New Testament)", "grc", "Koine Greek", None),
    ("tr", "ebible:grctr", "Textus Receptus, Scrivener 1894 (Greek New Testament)", "grc", "Koine Greek",
     "The Greek text behind the King James New Testament."),
]

# Default translation per language (the primary subtag, or a full tag where script matters)
LANGUAGE_DEFAULT = {
    "en": "kjv", "es": "rv1909", "pt": "blivre", "fr": "lsg", "de": "luther1912", "it": "diodati", "nl": "statenvertaling",
    "la": "vulgate", "sv": "sv1917", "fi": "fi1776", "eo": "esperanto", "ru": "synodal", "uk": "kulish", "pl": "gdanska",
    "cs": "kralicka", "sr": "danicic", "el": "vamvas", "hu": "karoli", "ar": "vandyck", "he": "hebmodern", "iw": "hebmodern",
    "fa": "opv", "hi": "irv-hi", "bn": "irv-bn", "ta": "irv-ta", "te": "irv-te", "mr": "irv-mr", "gu": "irv-gu", "pa": "irv-pa",
    "ur": "irv-ur", "kn": "irv-kn", "ml": "ml1910", "ne": "ulb-ne", "zh": "cuv", "zh-hans": "cuv", "zh-cn": "cuv", "zh-sg": "cuv",
    "zh-hant": "cuvt", "zh-tw": "cuvt", "zh-hk": "cuvt", "zh-mo": "cuvt", "ja": "jfb", "ko": "kor1910", "vi": "vie1934",
    "tl": "adb1905", "fil": "adb1905", "my": "judson", "ceb": "cebuano", "sw": "neno", "ha": "hausa", "yo": "yoruba",
    "ig": "igbo", "sn": "shona", "ny": "chichewa", "ln": "lingala", "ak": "twi", "tw": "twi", "ki": "kikuyu", "lg": "luganda",
    "hbo": "wlc", "grc": "byz",
}

# Translations considered and left out, with the reason (reported in the manifest, honestly).
EXCLUDED = [
    {"name": "NIV, ESV, NLT, NASB, CSB, NKJV, AMP, The Message", "reason": "Copyrighted; never redistributed to assistants."},
    {"name": "Any text read through the app's API.Bible key", "reason": "Licensed for in-app display only, never for the MCP."},
    {"name": "Swahili Union Version (SUV)", "reason": "Copyrighted by the Bible Societies; no public domain or free license."},
    {"name": "Japanese Kougo-yaku (1955), the repository's Japanese text", "reason": "Likely public domain under Japanese law, but no primary source verifying it was found, so it is left out."},
    {"name": "Korean 개역 (the repository's Korean text)", "reason": "The exact edition behind the source could not be verified; the 1910 Korean Bible (public domain on eBible.org) is held instead."},
    {"name": "Ukrainian Ohienko (the repository's Ukrainian text)", "reason": "Ohienko died in 1972; the public domain status of his translation is unclear. Kulish and Puluj (1905) is held instead."},
    {"name": "Hindi Old Version (the repository's Hindi text)", "reason": "Its source edition and status could not be verified; the Hindi Indian Revised Version (CC BY-SA 4.0) is held instead."},
    {"name": "Danish, Croatian and Albanian texts in the repository", "reason": "The edition behind each source could not be identified, so their status is unclear."},
    {"name": "Portuguese Almeida Revista e Corrigida / Atualizada", "reason": "Held under copyright by the Bible Society of Brazil; Bíblia Livre, an Almeida-based text under CC BY 4.0, is held instead."},
    {"name": "Rahlfs Septuagint (Greek)", "reason": "Its status is disputed (Deutsche Bibelgesellschaft); Brenton's English Septuagint is held instead."},
    {"name": "Nestle-Aland 28 / UBS 5 Greek", "reason": "Copyrighted; the Robinson-Pierpont Byzantine text and Scrivener's Textus Receptus are held instead."},
    {"name": "Indonesian Alkitab Yang Terbuka (AYT)", "reason": "Its license is NonCommercial."},
    {"name": "Turkish YTC", "reason": "CC BY-ND, and described by its publisher as still under review."},
]

LICENSE_OVERRIDE = {
    # verified on the publisher's own site, copied verbatim (https://berean.bible/terms.htm)
    "bsb": "The Berean Bible and Majority Bible texts are officially dedicated to the public domain as of April 30, 2023. All uses are freely permitted.",
}
SOURCE_PAGE_OVERRIDE = {"bsb": "https://berean.bible/terms.htm"}

# ------------------------------------------------------------------------------------- download
def cache_dir(args) -> pathlib.Path:
    d = pathlib.Path(args.cache or os.path.join(tempfile.gettempdir(), "lb-bible-cache"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def fetch(url: str, dest: pathlib.Path) -> bytes:
    if dest.exists() and dest.stat().st_size > 0:
        return dest.read_bytes()
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return data


def page_text(raw: bytes) -> str:
    t = raw.decode("utf-8", "replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    t = _html.unescape(t)
    return re.sub(r"\s+", " ", t).strip()


def license_of(ebid: str, cache: pathlib.Path) -> tuple[str, str, str]:
    """(verbatim statement, short license, kind) from the eBible copyright page, or raise."""
    raw = fetch(f"https://ebible.org/{ebid}/copyright.htm", cache / "copr" / f"{ebid}.htm")
    t = page_text(raw)
    # drop the navigation header: "<title> ^ < > <button> <title> ..." keeps from the second title on
    title, sep, rest = t.partition(" ^ < > ")
    if sep:
        j = rest.find(title.strip())
        t = rest[j:] if j >= 0 else rest
    t = re.sub(r"\s*(\d{4}-\d{2}-\d{2} )?HTML generated with Haiola.*$", "", t)
    low = t.lower()
    if re.search(r"non-?commercial|noncommercial|no ?derivatives|noderivatives|by-nc|by-nd|cc-nd|cc-nc", low):
        raise ValueError("license has a NonCommercial or NoDerivatives term")
    if "public domain" in low:
        kind, short = "public-domain", "Public domain"
    elif "creative commons" in low and ("share-alike" in low or "sharealike" in low or "by-sa" in low):
        kind, short = "cc-by-sa", "CC BY-SA 4.0" if "4.0" in t or "4‪.0" in t else "CC BY-SA"
    elif "creative commons" in low and ("atribuição" in low or "attribution" in low):
        kind, short = "cc-by", "CC BY 4.0" if "4.0" in t else "CC BY"
    else:
        raise ValueError("no public domain or free license statement found")
    statement = t[:3000].strip()
    return statement, short, kind


# ---------------------------------------------------------------------------------------- USFM
STRIP_BLOCKS = [r"\\f\s.*?\\f\*", r"\\fe\s.*?\\fe\*", r"\\x\s.*?\\x\*", r"\\fig\s.*?\\fig\*", r"\\rq\s.*?\\rq\*",
                r"\\vp\s.*?\\vp\*", r"\\va\s.*?\\va\*", r"\\ca\s.*?\\ca\*", r"\\cp\s[^\\\n]*"]
HEADING_LINES = re.compile(r"^\\(id|ide|h|toc\d|mt\d?|mte\d?|ms\d?|mr|s\d?|sr|r|d|sp|cl|cd|rem|is\d?|ip|ipi|im|imi|ipq|imq|ipr|iq\d?|ib|ili\d?|iot|io\d?|ior|iex|imt\d?|ie|qa|sts|usfm|lit)\b.*$", re.M)


# Invisible format characters that are not part of any word (zero width space, LRM, RLM, BOM). The joiners
# ZWJ and ZWNJ are kept: Persian, Hindi, Bengali, Nepali and Malayalam spell words with them.
FORMAT_MARKS = re.compile("[\u200b\u200e\u200f\ufeff]")
# The getbible export of a few repository texts carries its own markup (<FO>...<Fo> marks an Old Testament
# quotation, <FI>...<Fi> an added word); it is not part of the text and is removed.
GETBIBLE_MARKUP = re.compile(r"<(?:FO|Fo|FI|Fi|RF|Rf|CM|CL|TS|Ts)>")

CHAR_MARKERS = {"add", "nd", "wj", "qs", "qac", "bk", "sc", "it", "em", "bd", "bdit", "no", "tl", "k", "pn", "png", "sig", "sls", "w",
                "ord", "dc", "addpn", "rb", "wg", "wh", "wa", "ior", "iqt", "fv", "jmp", "ndx", "pro", "lik", "liv", "litl", "sup"}


def clean_text(s: str) -> str:
    s = re.sub(r"\\\+?w\s+([^|\\]*?)(?:\|[^\\]*?)?\\\+?w\*", r"\1", s)
    s = re.sub(r"\\\+?[a-z]+\d*\*", "", s)          # closing character markers
    # opening markers: a character marker (\add, \wj, \nd ...) vanishes, a paragraph marker is a space
    s = re.sub(r"\\(\+?)([a-z]+)(\d*)\s?", lambda m: "" if (m.group(1) or m.group(2) in CHAR_MARKERS) else " ", s)
    s = s.replace("¶", " ")
    s = FORMAT_MARKS.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_usfm(raw: str, keep_words: bool = False):
    """{chapter: {verse: text}} and, with keep_words, {chapter: {verse: [[word, strong, morph]]}}; plus names."""
    raw = raw.replace("\r\n", "\n")
    names = {}
    for key in ("toc2", "h", "toc1"):
        m = re.search(rf"^\\{key}\s+(.+)$", raw, re.M)
        if m and m.group(1).strip():
            names[key] = m.group(1).strip()
    for pat in STRIP_BLOCKS:
        raw = re.sub(pat, "", raw, flags=re.S)
    i = raw.find("\\c ")
    if i < 0:
        return {}, {}, names, {}
    raw = raw[i:]
    raw = HEADING_LINES.sub(" ", raw)
    chapters: dict[int, dict[int, str]] = OrderedDict()
    words: dict[int, dict[int, list]] = OrderedDict()
    joined: dict[int, dict[int, int]] = {}
    ch = 0
    cur = None
    for part in re.split(r"(\\c\s+\d+|\\v\s+\d+[a-z]?(?:-\d+[a-z]?)?)", raw):
        if not part:
            continue
        mc = re.fullmatch(r"\\c\s+(\d+)", part)
        if mc:
            ch = int(mc.group(1)); chapters.setdefault(ch, OrderedDict()); words.setdefault(ch, OrderedDict()); cur = None
            continue
        mv = re.fullmatch(r"\\v\s+(\d+)[a-z]?(?:-(\d+)[a-z]?)?", part)
        if mv:
            cur = int(mv.group(1))
            last = int(mv.group(2)) if mv.group(2) else cur
            chapters[ch].setdefault(cur, "")
            for extra in range(cur + 1, last + 1):
                joined.setdefault(ch, {})[extra] = cur
            continue
        if ch and cur is not None:
            if keep_words:
                for m in re.finditer(r"\\\+?w\s+([^|\\]*?)\|([^\\]*?)\\\+?w\*", part):
                    attrs = dict(re.findall(r'([a-z-]+)="([^"]*)"', m.group(2)))
                    words[ch].setdefault(cur, []).append([m.group(1).strip(), attrs.get("strong", ""), attrs.get("x-morph", "")])
            t = clean_text(part)
            if t:
                chapters[ch][cur] = (chapters[ch][cur] + " " + t).strip()
    return chapters, (words if keep_words else {}), names, joined


def to_c(chapters: dict, joined: dict) -> list:
    out = []
    if not chapters:
        return out
    for ch in range(1, max(chapters) + 1):
        vs = chapters.get(ch, {})
        n = max(list(vs.keys()) + list(joined.get(ch, {}).keys()) or [0])
        row = []
        for v in range(1, n + 1):
            if v in vs and vs[v]:
                row.append(vs[v])
            elif v in joined.get(ch, {}):
                row.append("")      # joined to an earlier verse in this translation
            else:
                row.append(None)    # this translation has no such verse
        out.append(row)
    return out


def ebible_books(ebid: str, cache: pathlib.Path, keep_words=False):
    data = fetch(f"https://ebible.org/Scriptures/{ebid}_usfm.zip", cache / "zip" / f"{ebid}_usfm.zip")
    z = zipfile.ZipFile(io.BytesIO(data))
    books, words, skipped = {}, {}, []
    for name in sorted(z.namelist()):
        if not name.lower().endswith((".usfm", ".sfm")):
            continue
        raw = z.read(name).decode("utf-8-sig", "replace")
        m = re.search(r"^\\id\s+([0-9A-Z]{3})", raw, re.M)
        if not m:
            continue
        code = m.group(1)
        bid = CODE_TO_ID.get(code)
        if not bid:
            if code not in ("FRT", "BAK", "GLO", "INT", "CNC", "TDX", "OTH", "XXA", "XXB", "XXC", "XXD", "XXE", "XXF", "XXG"):
                skipped.append(code)
            continue
        chapters, w, names, joined = parse_usfm(raw, keep_words)
        c = to_c(chapters, joined)
        if not c or not any(any(v for v in ch) for ch in c):
            continue
        books[bid] = {"n": names.get("toc2") or names.get("h") or ID_NAME[bid], "c": c}
        if keep_words:
            wc = []
            for ch in range(1, len(c) + 1):
                wc.append([w.get(ch, {}).get(v, []) for v in range(1, len(c[ch - 1]) + 1)])
            words[bid] = wc
    return books, words, skipped


# ---------------------------------------------------------------------------------- versification
def ref_parse(s: str):
    m = re.fullmatch(r"([1-4A-Z]{3}) (\d+):(\d+)(?:-(\d+))?", s)
    if not m:
        return None
    a = int(m.group(3)); b = int(m.group(4)) if m.group(4) else a
    return m.group(1), int(m.group(2)), list(range(a, b + 1))


def load_scheme(name: str, cache: pathlib.Path):
    base = "https://raw." + "githubusercontent.com/Copenhagen-Alliance/versification-specification/master/versification-mappings/standard-mappings"
    d = json.loads(fetch(f"{base}/{name}.json", cache / "vrs" / f"{name}.json"))
    to_org = {}
    for k, v in d["mappedVerses"].items():
        a, b = ref_parse(k), ref_parse(v)
        if not a or not b or len(a[2]) != len(b[2]):
            continue
        for x, y in zip(a[2], b[2]):
            to_org[(a[0], a[1], x)] = (b[0], b[1], y)
    maxv = {code: [int(x) for x in arr] for code, arr in d["maxVerses"].items()}
    return to_org, maxv


def build_schemes(cache):
    names = ["eng", "org", "vul", "lxx", "rso", "rsc"]
    S = {n: load_scheme(n, cache) for n in names}
    eng_to_org = S["eng"][0]
    out = {}
    for n in names:
        to_org, _ = S[n]
        org_to_s = {}
        for k, v in to_org.items():
            org_to_s.setdefault(v, k)
        to, frm = {}, {}
        # every eng verse that maps somewhere other than itself
        keys = set(eng_to_org.keys()) | set(org_to_s.keys()) | set(to_org.keys())
        for k in sorted(keys):
            if k[2] == 0 or k[0] not in CODE_TO_ID:
                continue
            org = eng_to_org.get(k, k)
            tgt = org_to_s.get(org, org if org not in to_org else None)
            if tgt is None or tgt[2] == 0 or tgt[0] not in CODE_TO_ID:
                continue
            if tgt != k:
                to[f"{CODE_TO_ID[k[0]]}.{k[1]}.{k[2]}"] = f"{CODE_TO_ID[tgt[0]]}.{tgt[1]}.{tgt[2]}"
        for a, b in to.items():
            frm.setdefault(b, a)
        out[n] = {"to": to, "from": frm, "max": S[n][1]}
    return out


KJV_COUNTS = {f.stem: [len(ch) for ch in json.loads(f.read_bytes())["c"]] for f in KJV_DIR.glob("*.json")}


def sniff_book(b: dict, code: str, schemes: dict, bid: str = "") -> str:
    """The scheme whose chapter and verse counts this one book matches best. The King James counts as
    shipped are the baseline: a book that matches them as well as any scheme is read as is (eng)."""
    def score_of(mv):
        return sum(1 for i, ch in enumerate(b["c"]) if i < len(mv) and mv[i] == len(ch)) - abs(len(mv) - len(b["c"]))
    kjv = KJV_COUNTS.get(bid)
    best, score = ("eng", score_of(kjv)) if kjv else ("eng", -1)
    for n in [k for k in schemes if k != "eng"] if kjv else ["eng"] + [k for k in schemes if k != "eng"]:
        mv = schemes[n]["max"].get(code)
        if not mv:
            continue
        sc = score_of(mv)
        if sc > score:
            best, score = n, sc
    return best


def sniff(books: dict, schemes: dict) -> tuple[str, dict]:
    """(the scheme most books follow, {book: scheme} for the books that differ from it)."""
    per = {bid: sniff_book(b, ID_TO_CODE[bid], schemes, bid) for bid, b in books.items()}
    counts: dict[str, int] = {}
    for v in per.values():
        counts[v] = counts.get(v, 0) + 1
    main = max(counts, key=lambda k: (counts[k], k == "eng")) if counts else "eng"
    return main, {b: v for b, v in per.items() if v != main}


# ------------------------------------------------------------------------------------- writing
def dump(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def write_books(tid: str, books: dict[str, dict] | None = None, copy_from: pathlib.Path | None = None):
    d = SHELF / "t" / tid
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    files = {}
    if copy_from:
        for f in sorted(copy_from.glob("*.json")):
            if f.stem not in CODE_TO_ID.values():
                continue
            raw = f.read_bytes()
            text = raw.decode("utf-8")
            if GETBIBLE_MARKUP.search(text) or FORMAT_MARKS.search(text):
                data = json.loads(raw)
                data["c"] = [[re.sub(r"\s+", " ", FORMAT_MARKS.sub("", GETBIBLE_MARKUP.sub("", v))).strip() if isinstance(v, str) else v for v in ch] for ch in data["c"]]
                (d / f.name).write_bytes(dump({"n": data["n"], "c": data["c"]}))
            else:
                shutil.copyfile(f, d / f.name)  # byte for byte, so git stores it once
            files[f.stem] = (d / f.name).read_bytes()
    else:
        for bid, b in books.items():
            raw = dump({"n": b["n"], "c": b["c"]})
            (d / f"{bid}.json").write_bytes(raw)
            files[bid] = raw
    return files


def summarize(files: dict[str, bytes]):
    roll = hashlib.sha256()
    meta = {}
    verses = 0
    for bid in ORDER:
        if bid not in files:
            continue
        raw = files[bid]
        data = json.loads(raw)
        h = sha(raw)
        roll.update(bid.encode() + b":" + h.encode() + b"\n")
        held = sum(1 for ch in data["c"] for v in ch if isinstance(v, str) and v)
        verses += held
        meta[bid] = {"sha256": h, "chapters": len(data["c"]), "name": data["n"]}
    return roll.hexdigest(), meta, verses


def canon_of(book_ids: list[str]) -> tuple[str, str]:
    ot = [b for b in OT if b in book_ids]
    nt = [b for b in NT if b in book_ids]
    dc = [b for b in ORDER[66:] if b in book_ids]
    parts = []
    if len(ot) == 39:
        parts.append("the 39 books of the Old Testament")
    elif ot:
        parts.append(f"{len(ot)} of the 39 Old Testament books")
    if len(nt) == 27:
        parts.append("the 27 books of the New Testament")
    elif nt:
        parts.append(f"{len(nt)} of the 27 New Testament books")
    if dc:
        parts.append(f"{len(dc)} deuterocanonical or Septuagint books ({', '.join(ID_NAME[b] for b in dc)})")
    if not nt:
        parts.append("no New Testament")
    if not ot:
        parts.append("no Old Testament")
    kind = "protestant-66" if len(ot) == 39 and len(nt) == 27 and not dc else (
        "with-deuterocanon" if dc and nt else "septuagint-ot" if dc and not nt else "nt-only" if not ot else "ot-only" if not nt else "partial")
    return kind, "Holds " + ", ".join(parts) + "."


RTL = {"ar", "he", "fa", "ur", "hbo", "iw"}


def probe(url: str) -> int:
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TheLivingBread-MCP-build/1.0"}), timeout=30)
        return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


# ---------------------------------------------------------------------------------- the lexicon
def build_lexicon():
    out_root = SHELF / "lex"
    if out_root.exists():
        shutil.rmtree(out_root)
    count = 0
    for lang, fname in (("h", "strongs-hebrew.json"), ("g", "strongs-greek.json")):
        entries = json.load(open(LEX_DIR / fname, encoding="utf-8"))
        buckets: dict[int, dict] = {}
        for e in entries:
            num = int(e["num"])
            rec = {"w": e.get("word", ""), "tr": e.get("translit", ""), "pr": e.get("pron", ""), "pos": e.get("pos", ""),
                   "def": e.get("definition", ""), "der": e.get("derivation", ""), "use": e.get("usage", ""), "lang": e.get("sublang", "")}
            buckets.setdefault(num // 200, {})[e["id"]] = rec
            count += 1
        (out_root / lang).mkdir(parents=True, exist_ok=True)
        for b, recs in buckets.items():
            (out_root / lang / f"{b}.json").write_bytes(dump(recs))
    return count


def strip_marks(s: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", s) if not unicodedata.combining(ch))


def norm_strong(s: str) -> str:
    m = re.match(r"([HG])0*(\d+)([a-z]?)", s.strip())
    return f"{m.group(1)}{m.group(2)}{m.group(3)}" if m else ""


# ------------------------------------------------------------------------------------------ main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache")
    ap.add_argument("--no-probe", action="store_true")
    ap.add_argument("--only", help="comma list of ids to rebuild (others are read back from the manifest)")
    args = ap.parse_args()
    cache = cache_dir(args)
    SHELF.mkdir(parents=True, exist_ok=True)

    print("versification schemes ...")
    schemes = build_schemes(cache)
    (SHELF / "vrs").mkdir(parents=True, exist_ok=True)
    for n, s in schemes.items():
        (SHELF / "vrs" / f"{n}.json").write_bytes(dump({"to": s["to"], "from": s["from"]}))

    # the KJV, as the app ships it (never rewritten here)
    kjv_files = {f.stem: f.read_bytes() for f in KJV_DIR.glob("*.json")}
    kjv_hash, kjv_meta, kjv_verses = summarize(kjv_files)

    old = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    old_by = {t["id"]: t for t in old.get("translations", [])}
    only = set(args.only.split(",")) if args.only else None

    held, excluded = [], list(EXCLUDED)
    orig_words = {}
    for tid, src, name, lang, lang_name, note in SHELF_LIST:
        if only and tid not in only and tid in old_by:
            held.append(old_by[tid]); continue
        kind, _, ref = src.partition(":")
        try:
            if kind == "repo":
                readme = (ROOT / "assets" / f"bible-{ref}" / "README.md").read_text(encoding="utf-8").strip()
                statement = re.sub(r"\s+", " ", readme)
                low = statement.lower()
                lic_short = "CC BY 3.0" if "attribution" in low else "Public domain"
                lic_kind = "cc-by" if "attribution" in low else "public-domain"
                files = write_books(tid, copy_from=ROOT / "assets" / f"bible-{ref}" / "books")
                source_url = f"repository: assets/bible-{ref}/books (the text living-bread.org served), README quoted verbatim"
                books = {k: json.loads(v) for k, v in files.items()}
                skipped = []
            else:
                if tid in LICENSE_OVERRIDE:
                    statement, lic_short, lic_kind = LICENSE_OVERRIDE[tid], "Public domain (CC0 dedication)", "public-domain"
                    try:
                        license_of(ref, cache)
                    except Exception:
                        pass
                else:
                    statement, lic_short, lic_kind = license_of(ref, cache)
                keep = tid in ("wlc", "byz")
                books, words, skipped = ebible_books(ref, cache, keep_words=keep)
                if keep:
                    orig_words[tid] = (books, words)
                files = write_books(tid, books=books)
                source_url = f"https://ebible.org/Scriptures/{ref}_usfm.zip"
        except Exception as e:  # noqa: BLE001
            excluded.append({"name": f"{name} ({src})", "reason": f"left out at build: {e}"})
            print("  EXCLUDED", tid, e)
            continue
        corpus, meta, verses = summarize(files)
        if verses == 0:
            excluded.append({"name": f"{name} ({src})", "reason": "no verses could be read"}); continue
        scheme, scheme_books = sniff(books, schemes)
        canon_kind, canon = canon_of(list(meta.keys()))
        rec = OrderedDict(
            id=tid, name=name, language=lang, language_name=lang_name, direction="rtl" if lang.split("-")[0] in RTL else "ltr",
            license=lic_short, license_kind=lic_kind, license_statement=statement,
            license_source=SOURCE_PAGE_OVERRIDE.get(tid) or (f"https://ebible.org/{ref}/copyright.htm" if kind == "ebible" else f"assets/bible-{ref}/README.md"),
            source=source_url, canon=canon_kind, canon_coverage=canon, versification=scheme, versification_books=scheme_books,
            corpus_version=corpus, verses=verses, books={b: [m["chapters"], m["sha256"], m["name"]] for b, m in meta.items()},
        )
        if note:
            rec["note"] = note
        if tid == "wlc":
            rec["attribution"] = "Westminster Leningrad Codex, public domain. Lemma and morphology from the Open Scriptures Hebrew Bible project (credit: Open Scriptures Hebrew Bible Project), Creative Commons Attribution."
        if tid == "byz":
            rec["attribution"] = "Robinson-Pierpont Byzantine Majority Text, public domain; parsing codes from the byztxt project, released into the public domain (Unlicense)."
        if lic_kind.startswith("cc-"):
            rec["attribution"] = rec.get("attribution") or f"{name}. {statement[:240]}"
        if skipped:
            rec["books_not_held"] = sorted(set(skipped))
        held.append(rec)
        print(f"  {tid:16} {lang:8} {scheme:4} {len(meta):3} books {verses:6} verses  {lic_short}  {scheme_books if scheme_books else ''}")

    # ---- the original language words, aligned per verse ---------------------------------------
    print("original language words ...")
    orig_root = SHELF / "orig"
    if orig_words:
        if orig_root.exists():
            shutil.rmtree(orig_root)
        # the byztxt parsing codes, zipped onto the eBible words where the two agree word for word
        parse = {}
        base = "https://raw." + "githubusercontent.com/byztxt/byzantine-majority-text/master/csv-unicode/strongs/with-parsing"
        for code, fname in BYZTXT.items():
            raw = fetch(f"{base}/{fname}.csv", cache / "byztxt" / f"{fname}.csv").decode("utf-8")
            for line in raw.splitlines()[1:]:
                m = re.match(r"(\d+),(\d+),(.*)$", line)
                if not m:
                    continue
                toks = re.findall(r"(\S+) (\d+)(?: \d+)? \{([^}]+)\}", m.group(3))
                parse[(CODE_TO_ID[code], int(m.group(1)), int(m.group(2)))] = toks
        agree = total = 0
        for tid, (books, words) in orig_words.items():
            d = orig_root / tid
            d.mkdir(parents=True)
            for bid, wc in words.items():
                out = []
                for ci, ch in enumerate(wc):
                    row = []
                    for vi, ws in enumerate(ch):
                        items = [[w, norm_strong(s.split()[0]) if s else "", m] for w, s, m in ws]
                        if tid == "byz":
                            # the byztxt words are the authority (every word, its Strong's number and parsing);
                            # the accented form is taken from the eBible text when the two agree word for word
                            toks = parse.get((bid, ci + 1, vi + 1))
                            total += 1
                            if toks:
                                plain = books[bid]["c"][ci][vi] if ci < len(books[bid]["c"]) and vi < len(books[bid]["c"][ci]) else None
                                accented = [x for x in (re.sub(r"[.,;:·!?()\[\]\u0387\u00b7\u2014\u2013\u201c\u201d\u2018]", " ", plain or "").split()) if x]
                                same = len(accented) == len(toks) and all(strip_marks(a).lower().replace("\u1fbd", "").replace("'", "") .startswith(strip_marks(t[0])[:2]) for a, t in zip(accented, toks))
                                items = [[accented[i] if same else t[0], f"G{int(t[1])}", t[2]] for i, t in enumerate(toks)]
                                agree += 1 if same else 0
                        row.append(items)
                    out.append(row)
                (d / f"{bid}.json").write_bytes(dump({"n": books[bid]["n"], "c": out}))
        print(f"  byz: byztxt words on {total} verses, accented form matched on {agree}")

    # ---- the KJV words tagged with Strong's numbers ---------------------------------------------
    print("KJV Strong's alignment ...")
    kjvs_root = SHELF / "kjvs"
    if kjvs_root.exists():
        shutil.rmtree(kjvs_root)
    kjvs_root.mkdir(parents=True)
    _, kw, _ = ebible_books("eng-kjv2006", cache, keep_words=True)
    for bid, wc in kw.items():
        if bid not in PROTESTANT:
            continue
        out = [[[[w, sorted({norm_strong(x) for x in s.split() if norm_strong(x)})] for w, s, _ in ws if s] for ws in ch] for ch in wc]
        (kjvs_root / f"{bid}.json").write_bytes(dump({"c": out}))
    kjvs_license, _, _ = license_of("eng-kjv2006", cache)

    print("Strong's lexicon ...")
    lex_count = build_lexicon()

    # ---- doors: only a page that answered 200 is ever offered ---------------------------------
    doors = old.get("doors", {})
    if not args.no_probe:
        doors = {}
        for lang in sorted({t["language"].split("-")[0].lower() for t in held} - {"en", "hbo", "grc"}):
            url = f"{SITE}/{lang}"
            if probe(url) == 200:
                doors[lang] = url
        doors["en"] = f"{SITE}/bible"
        print("  doors:", ", ".join(sorted(doors)))

    # ---- the manifest ------------------------------------------------------------------------
    total_files = sum(1 for _ in SHELF.rglob("*.json"))
    total_bytes = sum(f.stat().st_size for f in SHELF.rglob("*.json"))
    manifest = OrderedDict(
        generated_by="mcp/scripts/build-translations.py",
        rule="Every text here is public domain or under a license that permits redistribution; each statement is copied verbatim from its source. Nothing is typed.",
        kjv=OrderedDict(id="kjv", name="King James Version", language="en", language_name="English", license="Public domain",
                        license_statement="King James Version (1769 Oxford edition), public domain. Read verbatim from the text The Living Bread app ships (assets/bible/books).",
                        canon="protestant-66", canon_coverage="Holds the 66 books of the Protestant canon. The Apocrypha printed in the 1611 edition is not held.",
                        versification="eng", corpus_version=kjv_hash, verses=kjv_verses),
        translations=held,
        language_default=LANGUAGE_DEFAULT,
        books=[[i, n, ID_TO_CODE[i]] for _, i, n in BOOKS],
        excluded=excluded,
        doors=doors,
        versification=OrderedDict(
            source="Copenhagen Alliance versification mappings (https://github.com/Copenhagen-Alliance/versification-specification)",
            license="Creative Commons Attribution-ShareAlike 4.0 (data)",
            rule="A reference is read in the standard (King James) numbering and mapped to the translation's own numbering through the original-text numbering. When a verse does not exist in a translation, the answer says so; nothing is substituted.",
        ),
        original=OrderedDict(
            lexicon="Strong's Exhaustive Concordance dictionaries (James Strong, 1890), public domain. Hebrew entries as encoded by the Open Scriptures HebrewLexicon project (CC BY 4.0; credit the Open Scriptures Hebrew Bible Project); Greek entries from Strong's Dictionary in XML with real Greek (Ulrik Sandborg-Petersen, CC0).",
            lexicon_entries=lex_count,
            kjv_alignment=f"King James words tagged with Strong's numbers, eBible.org eng-kjv2006: {kjvs_license[:300]}",
            hebrew="wlc", greek="byz",
        ),
        assets=OrderedDict(files=total_files, bytes=total_bytes),
    )
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n{len(held)} translations held (+ KJV), {len(excluded)} excluded; shelf {total_files} files, {total_bytes / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
