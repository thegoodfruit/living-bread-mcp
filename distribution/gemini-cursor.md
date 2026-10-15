# Gemini and Cursor: ready to use

Nothing here has been submitted. Status lives in `mcp/src/data/distribution.json`.

## ChatGPT
Already submitted (`chatgpt-plugin-directory`, plugin 1.0.9, `mcp/plugin/`). Nothing more to file until OpenAI answers.

## Gemini CLI (works today)
```
gemini mcp add --transport http living-bread https://mcp.living-bread.org/mcp
```
or in `~/.gemini/settings.json`:
```json
{ "mcpServers": { "living-bread": { "httpUrl": "https://mcp.living-bread.org/mcp" } } }
```
As an extension: `distribution/gemini/gemini-extension.json` is the manifest. Gemini CLI installs an extension from a
GitHub repository, so copy that file to the root of the public mirror (thegoodfruit/living-bread-mcp), then
`gemini extensions install https://github.com/thegoodfruit/living-bread-mcp`. Confirm the current command and any gallery
listing on Google's own extensions page; the public docs found on 2026-10-15 describe install from a repository
URL and do not describe a gallery submission.

## Gemini app (custom connector)
Per third-party write-ups (not Google documentation): the Gemini web app accepts a custom app by server URL. Use
`https://mcp.living-bread.org/mcp`, no authentication. Gemini Enterprise customers add the server themselves.

## Cursor (one click)
Install link (opens Cursor and adds the server):
`cursor://anysphere.cursor-deeplink/mcp/install?name=living-bread&config=eyJ1cmwiOiJodHRwczovL21jcC5saXZpbmctYnJlYWQub3JnL21jcCJ9`

## Docker MCP catalog
Listed through a pull request to the Docker MCP registry repository. Read its current contributing guide first; this
server is remote (Streamable HTTP), so confirm remote servers are accepted before preparing the entry.

## Meta AI
No known submission route. Revisit when Meta publishes one.
