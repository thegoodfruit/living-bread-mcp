#!/usr/bin/env python3
"""
THE LIVING BREAD MCP, the weekly funnel, from real rows only.

    python3 mcp/scripts/funnel.py              # last 7 days -> docs/MCP_FUNNEL.md
    python3 mcp/scripts/funnel.py --days 28
    python3 mcp/scripts/funnel.py --cf         # also Cloudflare request analytics (uses the wrangler login)

Stages (docs/MCP_EXCELLENCE_BRIEF.md section 9, 11):
  discovery    hub page views and /mcp requests at the edge (Cloudflare, --cf), observed
  connection   MCP initialize per client name per day (mcp_daily_counts, 0840), observed
  first useful calls that returned something, per client name (0840), observed
  journey      opens of ?via=mcp... links and the steps guests took after (share_opens, 0760), observed
  repeat       client NAMES seen on two consecutive days: a property of an integration, never of a person

Our own probes (living-bread-*) are reported apart and never counted as adoption. Nothing here
estimates or extrapolates: an empty stage says "no rows", and a missing table says it is missing.
Reads with the service role from ../.env.local; writes only the markdown file.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "MCP_FUNNEL.md"
INTERNAL = re.compile(r"^living-bread")  # only names our own scripts announce; anything else is reported as external, never guessed


def env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def rest(url: str, key: str, path: str) -> list[dict] | None:
    rows: list[dict] = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        req = urllib.request.Request(f"{url}/rest/v1/{path}{sep}limit=1000&offset={offset}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                batch = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                return None
            raise
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += 1000


def cloudflare(since: dt.date, until: dt.date) -> dict | None:
    cfg = pathlib.Path.home() / "Library/Preferences/.wrangler/config/default.toml"
    if not cfg.exists():
        return None
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', cfg.read_text())
    if not m:
        return None
    tok = m.group(1)

    def api(path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, data=json.dumps(body).encode() if body else None, headers={"authorization": "Bearer " + tok, "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())

    try:
        zid = api("/zones?name=living-bread.org")["result"][0]["id"]
    except Exception:
        return None
    paths: collections.Counter = collections.Counter()
    uas: collections.Counter = collections.Counter()
    day = since
    while day <= until:
        q = """query($z: string!, $s: Time!, $u: Time!) { viewer { zones(filter: {zoneTag: $z}) {
          httpRequestsAdaptiveGroups(limit: 2000, filter: {clientRequestHTTPHost: "mcp.living-bread.org", datetime_geq: $s, datetime_lt: $u}) {
            count dimensions { clientRequestPath clientRequestHTTPMethodName edgeResponseStatus userAgent } } } } }"""
        try:
            r = api("/graphql", {"query": q, "variables": {"z": zid, "s": f"{day}T00:00:00Z", "u": f"{day + dt.timedelta(days=1)}T00:00:00Z"}})
            for g in r["data"]["viewer"]["zones"][0]["httpRequestsAdaptiveGroups"]:
                d = g["dimensions"]
                p = d["clientRequestPath"]
                key = p if p in ("/", "/mcp", "/me", "/app", "/sse", "/sse/message", "/status") else "other"
                paths[(key, d["clientRequestHTTPMethodName"], d["edgeResponseStatus"])] += g["count"]
                if p in ("/mcp", "/me", "/app", "/sse"):
                    uas[(d["userAgent"] or "(empty)").split("/")[0].split(" ")[0][:40]] += g["count"]
        except Exception:
            pass
        day += dt.timedelta(days=1)
    return {"paths": paths, "uas": uas}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--cf", action="store_true")
    a = ap.parse_args()
    e = env()
    url, key = e["EXPO_PUBLIC_SUPABASE_URL"].rstrip("/"), e["SUPABASE_SERVICE_ROLE_KEY"]
    today = dt.datetime.now(dt.timezone.utc).date()
    since = today - dt.timedelta(days=a.days - 1)

    counts = rest(url, key, f"mcp_daily_counts?select=day,client,metric,subject,n&day=gte.{since}&order=day.asc")
    asks = rest(url, key, f"mcp_asks?select=tool,client,answered,hour,lang&hour=gte.{since}T00:00:00Z") or []
    opens = rest(url, key, f"share_opens?select=day,guest_action,share:shares!inner(token,kind,object_id)&share.kind=eq.mcp_journey&day=gte.{since}")

    L: list[str] = []
    L.append("# MCP funnel")
    L.append("")
    L.append(f"Window: {since} to {today} (UTC), {a.days} days. Generated {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC by `mcp/scripts/funnel.py` from real rows only. Our own probes are shown apart and never counted as adoption.")
    L.append("")

    # connection, first useful, repeat
    L.append("## Connection, first useful result, repeat (mcp_daily_counts, migration 0840)")
    L.append("")
    if counts is None:
        L.append("The table does not exist yet: migration 0840 has not been applied, or MCP_METRICS is still 0. No numbers are shown rather than guessed.")
    elif not counts:
        L.append("No rows in the window.")
    else:
        by = collections.defaultdict(lambda: collections.Counter())
        days_seen = collections.defaultdict(set)
        for r in counts:
            by[r["client"]][r["metric"]] += r["n"]
            if r["metric"] in ("connection", "call"):
                days_seen[r["client"]].add(r["day"])
        L.append("| Client name | Internal | Connections | Calls | Useful | Empty | Errors | Days seen | Repeat (two consecutive days) |")
        L.append("|---|---|---|---|---|---|---|---|---|")
        for client, c in sorted(by.items(), key=lambda kv: -kv[1]["connection"]):
            ds = sorted(dt.date.fromisoformat(d) for d in days_seen[client])
            repeat = any((ds[i + 1] - ds[i]).days == 1 for i in range(len(ds) - 1))
            L.append(f"| {client} | {'yes' if INTERNAL.match(client) else 'no'} | {c['connection']} | {c['call']} | {c['useful']} | {c['empty']} | {c['error']} | {len(ds)} | {'yes' if repeat else 'no'} |")
        ext = {k: v for k, v in by.items() if not INTERNAL.match(k)}
        calls = sum(v["call"] for v in ext.values())
        useful = sum(v["useful"] for v in ext.values())
        L.append("")
        L.append(f"External (non-internal) calls: {calls}; useful: {useful}{f' ({useful * 100 // calls}%)' if calls else ''}. Note: many external client names are registry crawlers and probes, not people.")
        tools = collections.Counter()
        empty = collections.Counter()
        for r in counts:
            if r["metric"] == "call" and not INTERNAL.match(r["client"]):
                tools[r["subject"]] += r["n"]
            if r["metric"] == "empty" and not INTERNAL.match(r["client"]):
                empty[r["subject"]] += r["n"]
        if tools:
            L.append("")
            L.append("Top tools (external): " + ", ".join(f"{t} {n}" + (f" ({empty[t]} empty)" if empty[t] else "") for t, n in tools.most_common(12)))
    L.append("")

    # journeys walked
    L.append("## Journeys walked (share_opens on the ?via=mcp... tokens, migration 0760)")
    L.append("")
    if opens is None:
        L.append("share_opens could not be read.")
    elif not opens:
        L.append("No opens of a journey link in the window. (Opens are recorded only on pages that load the app; the static pages count nothing.)")
    else:
        j = collections.defaultdict(collections.Counter)
        for r in opens:
            j[r["share"]["object_id"]][r["guest_action"]] += 1
        L.append("| Journey | Opened | Listened | Prayed | Amen | Replied | Carried | Signed up |")
        L.append("|---|---|---|---|---|---|---|---|")
        for name, c in sorted(j.items()):
            L.append(f"| {name} | {c['opened']} | {c['listened']} | {c['prayed']} | {c['amen']} | {c['replied']} | {c['carried']} | {c['signed_up']} |")
        done = sum(c[k] for c in j.values() for k in ("listened", "prayed", "amen", "replied", "carried", "signed_up"))
        L.append("")
        L.append(f"Completed journeys (a step after the open): {done}. Each is one person per step per day (share_opens deduplicates).")
    L.append("")

    # asks
    L.append("## What was asked (mcp_asks, six public discovery tools)")
    L.append("")
    if not asks:
        L.append("No rows in the window.")
    else:
        ext = [r for r in asks if not INTERNAL.match((r.get("client") or "").lower())]
        L.append(f"{len(asks)} rows; {len(ext)} from clients other than our own probes. Answered: {sum(1 for r in ext if r['answered'])} of {len(ext)}.")
        L.append("")
        L.append("By client: " + ", ".join(f"{c or 'unknown'} {n}" for c, n in collections.Counter(r.get("client") for r in asks).most_common(12)))
        L.append("")
        L.append("By tool: " + ", ".join(f"{t} {n}" for t, n in collections.Counter(r["tool"] for r in asks).most_common()))
    L.append("")

    if a.cf:
        cf = cloudflare(since, today)
        L.append("## At the edge (Cloudflare analytics, mcp.living-bread.org)")
        L.append("")
        if not cf:
            L.append("Not reachable with the local wrangler login.")
        else:
            hub = sum(n for (p, m, s), n in cf["paths"].items() if p == "/" and m == "GET" and s == 200)
            mcp = sum(n for (p, m, s), n in cf["paths"].items() if p in ("/mcp", "/me", "/app", "/sse") and m == "POST")
            L.append(f"Hub page views (GET / 200): {hub}. MCP POSTs (all endpoints): {mcp}.")
            L.append("")
            L.append("User agents on the MCP endpoints (first token): " + ", ".join(f"{u} {n}" for u, n in cf["uas"].most_common(25)))
        L.append("")

    L.append("## Reading this honestly")
    L.append("")
    L.append("- Observed: every number above is a row or an edge log. Nothing is inferred or extrapolated.")
    L.append("- A client name is not a person: one name can be thousands of people or one crawler.")
    L.append("- The North Star (weekly people completing a useful faith journey that began in an assistant) is the 'Completed journeys' line. Until it is above zero, adoption is not claimed.")
    L.append("")
    OUT.write_text("\n".join(L), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
