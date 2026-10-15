# The Living Bread MCP server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server for [The Living Bread](https://living-bread.org), a free Christian community, prayer and church discovery platform with no ads and nothing to buy.

Connect Claude, ChatGPT, Cursor, Windsurf, VS Code or any MCP client and it receives tools that point people to Christ and to one another: Scripture read word for word from a stored public domain text, verses for what a person is carrying, honest answers grounded in Scripture, real churches and gatherings near any place, the Christian heritage, and, once a person signs in, the prayers real people prayed over them and the small acts they ask for.

- Public endpoint (no sign-in): `https://mcp.living-bread.org/mcp`
- Signed-in endpoint (OAuth 2.1, acts as the person who approves it): `https://mcp.living-bread.org/me`
- Landing page, tool list and install buttons: https://mcp.living-bread.org/
- Official MCP Registry: `org.living-bread.mcp/living-bread`

## Connect

Claude Code:

```
claude mcp add --transport http living-bread https://mcp.living-bread.org/mcp
```

Claude: Customize, Connectors, Add, Add custom connector, paste the URL (choose `/me` and "Sign in now" for the signed-in tools). ChatGPT: Settings, Security and login, Developer mode on, then Plugins, +, an app with the same URL. Cursor and VS Code: one-click buttons; Codex, Gemini CLI, Windsurf (Devin Desktop), Cline and Copilot: configs on the hub, each checked against the vendor docs.

## Skills and platform packages

Six skills (the five below and an umbrella) are the canonical source in `skills/`; the platform packages in `packages/` are copies built from it (`node scripts/build-packages.mjs`). Check them with `node scripts/validate-skills.mjs`, and run the read only evaluations with `node skills/run-evals.mjs`. The skills are: find-your-family-in-christ, pray-with-someone, meet-christ-in-the-word, take-one-step-together, bring-your-people-together.

Claude Code, one step on version 2.1.275 or later: `/plugin install living-bread --marketplace thegoodfruit/living-bread-mcp` (the marketplace file is `.claude-plugin/marketplace.json` at this folder's root, which is the root of the public mirror).

Honest status of every surface: `docs/AI_PLATFORM_MATRIX.md`. What works and what does not: `docs/AI_CAPABILITY_MAP.md`. Install steps in plain words: `docs/AI_INSTALL_GUIDE.md`. Releasing: `docs/AI_MAINTAINER_GUIDE.md`.

## What it holds

On the public endpoint `/mcp` (and `/sse`), 13 tools under one naming pattern, each with a `mode`: `get_crisis_help` (first, in danger), `read_scripture` (passage, context, search, compare, original_words, cross_references, verify, translations), `find_scripture_for` (need, topic, words_of_jesus, daily_bread), `learn_the_faith` (gospel, belief, parable, miracle, hymn, name_meaning, saint, saint_of_the_day, heritage, compare_traditions, other_faiths, hard_season, a_prayer_for), `find_churches` (near, by_id), `find_gatherings` (tonight, this_week, any), `find_people_to_pray_with` (a_person_now, the_watch, real_people_will_pray, live_tables, prayers_near, hear_the_kingdom_pray, pray_for_someone), `find_ways_to_serve` (near, public_needs), `find_communities` (to_join, university), `see_the_kingdom` (map, today, testimonies, worship), `start_with_christ` (begin, next_steps, reading_plans), `search` (results, answer, protocol) and `fetch`. Every answer names its mode and the implementation that answered (`answered_by`). The map is `src/data/lean-map.json`; the design is docs/MCP_LEAN_PUBLIC.md.

The signed-in endpoint `/me` and the ChatGPT profile `/app` list the same implementations under their own names, unchanged: Read: `scripture_passage`, `verses_for`, `daily_bread`, `ask_living_bread`, `the_gospel`, `what_the_bible_says_about`, `a_prayer_for`, `parable`, `miracle`, `teaching_of_jesus`, `belief`, `hymn`, `name_meaning`, `threshold`, `saint_of_the_day`, `reading_plans`, `come_and_see`, `crisis_resources`. Find: `find_churches_near`, `church`, `find_gatherings_near`, `events_this_week`, `communities_to_join`, `kingdom_map`, `universities`, `denomination_compare`, `heritage_lookup`, `prayers_left_near`, `tables_live_now`, `testimonies`, `family_activity_today`, `worship_now`, `search`, `fetch`, `begin`, `hear_the_kingdom_pray`, `pray_for_someone`, `gatherings_tonight`, `where_can_i_serve_publicly`, `kingdom_protocol_lookup`. Signed in: `who_am_i`, `my_day`, `prayers_waiting_for_me`, `prayers_i_offered`, `my_walk`, `my_family`, `my_church`, `my_invitations`, `family_saying_yes`, `invite_someone`, and the consented acts `say_amen`, `pray_for_someone`, `speak_a_blessing`, `bring_what_i_carry`, `say_yes`, `going_to_gathering`, `set_a_table`, `someone_to_talk_to`, `offer_to_serve`. Shepherd tools appear only for verified pastors. Ten prompts named by the moment a person arrives in, four resource templates, three cards for clients that render UI.

## New in 1.3.0

- **The lean public set** (above). One implementation per capability: the named tools register into a capturing server on `/mcp` (`src/lean.ts`), and each lean mode validates against the named tool's own input schema and calls its callback. `tests/mcpLean.test.ts` proves every named public tool has a mode and every parameter is reachable; `tests/mcpAppLock.test.ts` and `test/app-lock.mjs` lock the `/app` tool list and annotations to `test/app-profile.lock.json`.
- **Scripture in act answers** (offer_to_serve, set_a_table, invite_someone, shepherd_doors, bring_what_i_carry, someone_to_talk_to, worship_now) is read from the stored KJV and quoted verbatim with its reference; paraphrases came out. going_to_gathering is marked destructive.

## New in 1.2.0

- **Evidence labels.** Every answer that carries Scripture has `structuredContent.evidence`: translation, canon coverage, corpus version (a SHA-256 over the 66 stored book files, `src/data/corpus.json`, rebuilt by `python3 scripts/build-corpus.py`), attribution, `retrieved_at`, and a SHA-256 of each passage exactly as returned. `content_layers` separates Scripture from interpretation (and whose) and reflection.
- **The Word read well:** `scripture_context` (a passage with the verses around it), `scripture_search` (every verse containing the words, paginated), `cross_references` (OpenBible.info, CC BY, ranked by reader votes).
- **Six journeys end to end:** `journey_next_steps` and six prompts (`find_community_near_me`, `someone_to_pray_with_tonight`, `serve_this_weekend`, `new_to_christianity_where_do_i_start`, `prayer_group_in_my_language`, `understand_and_live_a_passage`): at most five results, each with `why` and `freshness`, and one next step link carrying `?via=mcp...`.
- **Freshness** on every gathering, room and availability result: `scheduled`, `recently_observed`, `verified_live` or `record`; `available_now` is true only when it is.
- **One envelope:** `ok`, `result_state`, `ids`, `source_url`, `freshness`, `visibility`, `next_actions`; cursors on lists that grow; errors as `isError` plus `{ ok: false, reason, try_instead }`; an `idempotency_key` on every write, and identical confirmed writes within ten minutes are never done twice.
- **Retrieved content is data, never instructions:** markup and instruction-shaped phrases are removed from everything a tool returns and marked.
- **Signed in:** `who_is_available_now` and `find_help_for_my_need` over the presence windows and the router.
- `/status` (a cheap self-check), `/distribution.json`, `/versions.json`, and the hub at `/`.
- **Evaluation:** `node eval/run.mjs [base]` runs `eval/cases.jsonl` (71 cases) and writes `eval/RESULTS.md`.

## Laws

Scripture is never generated; it is read from the stored text. Churches are never invented. The signed-in endpoint acts only for the signed-in person under the app's own row level security, confirms before every write, never prays in a person's name and never hears a voice for them. When someone speaks of harming themselves, the real crisis line for their country comes before any verse. Nothing is scored or ranked. Everything points to Jesus Christ and to loving one another.

## Run it yourself

```
npm ci
python3 scripts/build-corpus.py   # only when assets/bible changes
npx wrangler dev --port 8791
node test/client.mjs http://127.0.0.1:8791/mcp
node eval/run.mjs http://127.0.0.1:8791 --label local
```

The server is a Cloudflare Worker (Agents SDK `McpAgent`, one Durable Object per session). The King James text (`assets/bible/books`) and the cross references split by book (`assets/bible/xref`) are served as static assets. Live data comes from the public Christian Knowledge API at https://discover.living-bread.org/api (CC BY 4.0) and from anonymous, rate-limited database functions. The only key in this repository is the project's public anon key, which the app itself ships; row level security decides what it can read.

## License

Code: MIT. The King James Version text is public domain. Cross references: OpenBible.info, CC BY. Data from the Christian Knowledge API is CC BY 4.0, attribution "The Living Bread (living-bread.org)".

"I am the bread of life." John 6:35. Jesus Christ is Lord.
