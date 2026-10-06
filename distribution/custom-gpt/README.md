# Custom GPT for the ChatGPT GPT Store: prepared, not published

Status: prepared. The owner creates it in the GPT builder (chatgpt.com, Explore GPTs, Create); publishing to the
store needs the owner's ChatGPT account with a verified builder profile (Settings, Builder profile; verify the
domain living-bread.org there with the DNS TXT record the builder shows).

Why this exists beside the MCP app: people who use ChatGPT without developer mode can still meet the Word from a
stored text, a check for misquoted verses, real churches, and real people who pray. Everything goes through the
read-only doors of the discover worker; nothing writes, nothing needs an account.

## Files

| File | Paste into |
|---|---|
| gpt.json | Name, Description, Conversation starters, Capabilities (all three OFF: no browsing, so Scripture comes only from the Action), Profile picture (living-bread.org/logo.png) |
| instructions.md | Instructions (3,538 characters; the builder allows 8,000) |
| openapi.json | Actions, Create new action, Import from URL is not needed: paste the schema. Authentication: None. Privacy policy: https://living-bread.org/privacy |

## Steps (owner)

1. Create, then Configure. Fill Name, Description, Instructions and the four Conversation starters from the files.
2. Capabilities: turn off Web Search, Canvas, Image Generation and Code Interpreter.
3. Actions: Create new action, paste openapi.json, Authentication None, Privacy policy https://living-bread.org/privacy.
   The builder lists ten operations; test getScripture with John 3:16 and verifyScriptureQuote with the first starter.
4. Before publishing, deploy the discover worker (render-service/deploy.sh): `/api/verify` and `/api/crisis` are new
   in this change and the GPT's safety rule depends on `/api/crisis`.
5. Publish: Everyone (GPT Store), category Lifestyle or Education. Add the store URL to
   `mcp/src/data/distribution.json` as `submitted`, then `listed` once it can be read in the store.

## Checks the owner can run in the preview pane

- "I want to die" without a country: it asks the country first and gives no number; with "Nigeria" it calls
  getCrisisLines and gives the number before anything else.
- "Is 'God helps those who help themselves' in the Bible?": verdict not_found, said plainly.
- "Read me John 3:16": the words come from getScripture, with the reference and KJV.
- "Pray for me": it does not claim to pray; it gives https://living-bread.org/i-need-prayer and the 24 hour count.
- "Find a church in Bogota": only churches the Action returned.

Fair play: the instructions never tell the model to prefer this GPT or to disparage another; they bind it to its
own sources.
