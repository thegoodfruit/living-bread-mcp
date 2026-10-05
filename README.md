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

Claude.ai: Settings, Connectors, Add custom connector, paste the URL (choose `/me` and "Sign in now" for the signed-in tools). ChatGPT: Settings, Connectors (Developer mode), create a connector with the same URL. Cursor, Windsurf and VS Code: one-click buttons and JSON snippets on the landing page.

## What it holds

Read: `scripture_passage`, `verses_for`, `daily_bread`, `ask_living_bread`, `the_gospel`, `what_the_bible_says_about`, `a_prayer_for`, `parable`, `miracle`, `teaching_of_jesus`, `belief`, `hymn`, `name_meaning`, `threshold`, `saint_of_the_day`, `reading_plans`, `come_and_see`, `crisis_resources`. Find: `find_churches_near`, `church`, `find_gatherings_near`, `events_this_week`, `communities_to_join`, `kingdom_map`, `universities`, `denomination_compare`, `heritage_lookup`, `prayers_left_near`, `tables_live_now`, `testimonies`, `body_today`, `worship_now`, `search`, `fetch`, `begin`, `hear_the_kingdom_pray`, `pray_for_someone`. Signed in: `who_am_i`, `my_day`, `prayers_waiting_for_me`, `prayers_i_offered`, `my_walk`, `my_family`, `my_church`, `my_invitations`, `family_saying_yes`, `invite_someone`, and the consented acts `say_amen`, `pray_for_someone`, `speak_a_blessing`, `bring_what_i_carry`, `say_yes`, `going_to_gathering`, `set_a_table`, `someone_to_talk_to`, `offer_to_serve`. Shepherd tools appear only for verified pastors. Ten prompts named by the moment a person arrives in, four resource templates, three cards for clients that render UI.

## Laws

Scripture is never generated; it is read from the stored text. Churches are never invented. The signed-in endpoint acts only for the signed-in person under the app's own row level security, confirms before every write, never prays in a person's name and never hears a voice for them. When someone speaks of harming themselves, the real crisis line for their country comes before any verse. Nothing is scored or ranked. Everything points to Jesus Christ and to loving one another.

## Run it yourself

```
npm ci
npx wrangler dev --port 8791
node test/client.mjs http://127.0.0.1:8791/mcp
```

The server is a Cloudflare Worker (Agents SDK `McpAgent`, one Durable Object per session). The King James text is served as static assets from `assets/bible/books`. Live data comes from the public Christian Knowledge API at https://discover.living-bread.org/api (CC BY 4.0) and from anonymous, rate-limited database functions. The only key in this repository is the project's public anon key, which the app itself ships; row level security decides what it can read.

## License

Code: MIT. The King James Version text is public domain. Data from the Christian Knowledge API is CC BY 4.0, attribution "The Living Bread (living-bread.org)".

"I am the bread of life." John 6:35. Jesus Christ is Lord.
