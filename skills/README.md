# Living Bread skills (canonical source)

Six folders, one `SKILL.md` each, in the open Agent Skills format (https://agentskills.io/specification). Everything under `mcp/packages/` is built from here; do not edit a copy.

| Skill | Use when |
|---|---|
| `find-your-family-in-christ` | lonely, new to a place, wants Christian friends, a church or a group |
| `pray-with-someone` | "can someone pray with me", wants prayer, wants to pray for someone |
| `meet-christ-in-the-word` | understand a passage, Scripture for a need, reflect on faith |
| `take-one-step-together` | live out faith, a group's week, serve a verified need |
| `bring-your-people-together` | a pastor, leader or friend creates or brings a group; a group goes quiet |
| `living-bread` | umbrella: the laws for using the tools well (also the ChatGPT plugin's onboarding skill, kept byte equal) |

The fifth skill folds in "care for your community" from the original brief (welcoming, prayer rhythm, check ins, reconnecting) with the later "bring your people together" entry point.

## Check and build

```
node mcp/scripts/validate-skills.mjs          # parse, tool names, modes, dashes, forbidden phrases, evals, copies
node mcp/scripts/validate-skills.mjs --live   # also against the live tools/list
node mcp/scripts/validate-skills.mjs --write  # re-insert the shared house rules block
node mcp/scripts/build-packages.mjs           # refresh every platform copy and the upload zips
node mcp/skills/run-evals.mjs                 # the read only parts of the evals, live
```

## The evaluation files

`<skill>/evals/cases.json`: `{ skill, cases: [ ... ] }`. Each case:

| Field | Meaning |
|---|---|
| `id`, `category`, `input` | The person's words (the five owner scenarios appear verbatim) and the kind of case: skill selection, tool selection, empty result, stale result, missing permission, expired authentication, network failure, duplicate submission, prompt injection, sensitive information, unsupported action, language and location, safety, tone |
| `expected_skill`, `expected_tool_calls` | What a good assistant would pick and call, with the arguments that matter |
| `steps` | Real READ calls the runner makes against the endpoint, each with `assert` rules. A step with `requires: "for_my_need"` is skipped until the endpoint advertises that mode. A step may never call a writing tool; the validator and the runner refuse |
| `mocked` | The unit tests (or scripts) that cover what cannot be done live, such as hostile text in a church name or an expired sign in |
| `expected_behaviours`, `forbidden_behaviours` | What the assistant says and does. A model has to judge these; the runner counts them and does not pretend |

Assertion rules: `p` is a path (`s.` structured content, `t` all text, `r.isError`), with `[*]` for each item, plus one of `equals`, `in`, `gte`, `length`, `includes`, `matches`, `notMatches`, `type`, `absent`; or `urls: "hosts"` (every link is https on a Living Bread, store or listed host) or `urls: "noPrivate"` with `words`.

Results (statuses PASS, FAIL, SKIP, MOCKED, RUBRIC) are described at the top of `run-evals.mjs`. The report that accompanied this work lists what was run and what was not.
