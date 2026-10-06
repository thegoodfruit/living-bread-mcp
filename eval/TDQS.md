# Tool Definition Quality Score (TDQS), before and after

Glama scores every connector with TDQS, the open framework at
https://github.com/glama-ai/tool-definition-quality-score (spec v1.3, 2026-09-03). Glama scored The
Living Bread on 2026-10-06 at **B, 3.4 / 5.0** across the 45 public tools. This file records how the
rubric works, how we scored ourselves locally, and the result of rewriting every tool definition.

## The rubric

**Per tool.** One LLM call grades six dimensions from 1 to 5. TDQS is their weighted sum, rounded half up to one decimal:

| Dimension | Weight | 5 means |
|---|---|---|
| Purpose Clarity | 25% | A specific verb and resource that sets the tool apart from its siblings |
| Usage Guidelines | 20% | Says when to use it, when not to, and names the alternative tool |
| Behavioral Transparency | 20% | Discloses what the annotations cannot: auth, rate limits, side effects, empty results. Contradicting the annotations scores 1 |
| Parameter Semantics | 15% | Adds meaning beyond the input schema. With schema coverage above 80% the baseline is 3 |
| Conciseness & Structure | 10% | Every sentence earns its place, and the key facts come first |
| Contextual Completeness | 10% | Complete for the tool's complexity. A documented output schema relieves the description; a bare `{"type":"object"}` does not |

Tiers: A is 3.5 or above, B is 3.0 or above, C is 2.0 or above. The description earns no credit for
repeating the schema or the annotations. Hard gates apply: a missing description scores 1.0, and a
tautological one caps Purpose at 2.

**Server.**

- `descriptionQuality = round1(0.6 × mean(TDQS) + 0.4 × min(TDQS))`. The min term means one weak tool drags the whole server down.
- `coherence` is the mean of four 1 to 5 scores from a second LLM call over every name and description: Disambiguation, Naming Consistency (a consistent verb_noun pattern), Tool Count Appropriateness (3 to 15 is ideal, 16 to 25 scores 3, 26 or more scores 2, 50 or more scores 1) and Completeness.
- `overall = round1(0.7 × descriptionQuality + 0.3 × coherence)`.
- A shadowing check flags a tool whose job a much cheaper sibling can do. It reports beside the score and does not change it. None of our tools has more than 2 required fields, so no pair qualifies.

## What Glama published (before)

- Mean TDQS 3.89; minimum 3.1 (pray_for_someone, which scored Behavior 1 for an annotation contradiction); 40 tools A and 5 B.
- Description quality round1(0.6 × 3.89 + 0.4 × 3.1) = 3.6.
- Coherence: Disambiguation 3, Naming 3, Tool Count 2 ("45 tools is well above the comfortable range"), Completeness 4. That gives 3.0.
- Overall round1(0.7 × 3.6 + 0.3 × 3.0) = 3.4 (B).

## How we scored locally

No ANTHROPIC_API_KEY is held, so no external API was called. Each judgement was made by a Claude
subagent given the verbatim Appendix A system prompt. It saw each tool's exact `tools/list` entry in the
spec's user-message template, with the context signals and sibling names. The aggregation code is the
spec's own integer `round1`. The production `tools/list` was scored as "before" and the local `wrangler
dev` build as "after", by the same judge with the same prompt.

**Calibration.** On the production definitions the local judge reproduced Glama's server numbers: mean
3.9, minimum 3.2 against Glama's 3.1, description quality 3.6 and overall 3.4 (B). Single tools differ
by up to about 0.5 in either direction. For example, the local judge did not repeat Glama's
annotation-contradiction finding on pray_for_someone. Read the per-tool numbers as an estimate and the
server rollup as well calibrated.

## Results

| | Glama before | Local before | Local after |
|---|---|---|---|
| Mean TDQS | 3.89 | 3.9 | **4.7** |
| Minimum TDQS | 3.1 | 3.2 | **4.4** |
| Tiers | 40 A, 5 B | 42 A, 3 B | **45 A** |
| Description quality | 3.6 | 3.6 | **4.6** |
| Coherence | 3.0 | 2.8 (D3 N2 C2 Co4) | 3.0 (D4 N2 C2 Co4) |
| Overall | 3.4 B | 3.4 B | **4.1 A** (4.2 if Glama keeps naming at 3) |

### Per dimension (mean over 45 tools)

| Dimension (weight) | Glama before | Local before | Local after |
|---|---|---|---|
| Purpose Clarity (25%) | 4.33 | 4.51 | 5.00 |
| Usage Guidelines (20%) | 3.71 | 3.60 | 5.00 |
| Behavioral Transparency (20%) | 3.89 | 3.64 | 4.40 |
| Parameter Semantics (15%) | 3.27 | 3.29 | 4.00 |
| Conciseness & Structure (10%) | 3.53 | 3.69 | 4.09 |
| Contextual Completeness (10%) | 4.18 | 4.04 | 5.00 |

### Per tool

"Glama before" lists the tier, the TDQS and then the six dimensions in the order P U B Pa C Co: Purpose,
Usage, Behavior, Parameters, Conciseness and Completeness.

| Tool | Glama before | Local before | Local after | After P U B Pa C Co |
|---|---|---|---|---|
| scripture_passage | A 4.3 (5 4 4 4 4 4) | A 3.8 | A 4.6 | 5 5 4 4 4 5 |
| verses_for | A 4.0 (4 4 4 4 4 4) | A 3.8 | A 4.6 | 5 5 4 4 4 5 |
| daily_bread | A 4.3 (5 4 4 3 5 5) | A 4.0 | A 4.6 | 5 5 4 4 4 5 |
| ask_living_bread | A 3.9 (4 4 4 3 4 4) | A 3.8 | A 4.4 | 5 5 4 3 4 5 |
| find_churches_near | A 3.8 (4 4 4 3 3 4) | A 4.0 | A 4.6 | 5 5 4 4 4 5 |
| church | A 3.5 (4 3 3 3 4 4) | A 3.8 | A 4.5 | 5 5 4 3 5 5 |
| find_gatherings_near | A 3.8 (4 4 4 3 3 4) | A 3.9 | A 4.8 | 5 5 5 4 4 5 |
| communities_to_join | A 4.1 (5 4 4 3 4 4) | A 4.0 | A 4.6 | 5 5 4 4 4 5 |
| heritage_lookup | A 4.1 (5 4 4 3 4 4) | A 4.2 | A 4.6 | 5 5 4 4 4 5 |
| pray_for_someone | B 3.1 (4 4 1 3 3 3) | A 3.6 | A 4.8 | 5 5 5 4 4 5 |
| hear_the_kingdom_pray | A 3.7 (4 4 3 4 3 4) | B 3.3 | A 4.7 | 5 5 4 4 5 5 |
| begin | A 3.8 (4 4 3 4 4 4) | A 3.7 | A 4.7 | 5 5 4 4 5 5 |
| search | B 3.4 (4 2 4 3 4 3) | B 3.2 | A 4.8 | 5 5 5 4 4 5 |
| fetch | A 3.9 (4 3 4 4 4 5) | A 4.2 | A 4.6 | 5 5 4 4 4 5 |
| the_gospel | A 4.0 (4 4 4 4 4 4) | A 3.9 | A 4.6 | 5 5 4 4 4 5 |
| christianity_and_other_faiths | A 3.6 (4 4 3 3 3 4) | A 4.2 | A 4.8 | 5 5 5 4 4 5 |
| crisis_resources | A 4.6 (5 5 5 3 4 5) | A 4.8 | A 4.9 | 5 5 5 5 4 5 |
| tables_live_now | A 3.7 (4 3 4 4 3 4) | A 4.0 | A 4.6 | 5 5 4 4 4 5 |
| prayers_left_near | A 3.9 (4 4 4 3 4 4) | A 3.7 | A 4.8 | 5 5 5 4 4 5 |
| needs_near | A 4.3 (5 4 4 3 5 5) | A 3.6 | A 4.8 | 5 5 5 4 4 5 |
| body_today | A 3.9 (4 4 4 4 3 4) | A 3.5 | A 4.8 | 5 5 5 4 4 5 |
| worship_now | B 3.4 (4 3 4 2 3 4) | A 3.6 | A 4.8 | 5 5 5 4 4 5 |
| a_prayer_for | A 3.8 (4 3 5 3 3 4) | A 4.0 | A 4.8 | 5 5 5 4 4 5 |
| what_the_bible_says_about | A 3.8 (5 3 4 3 3 4) | A 3.6 | A 4.8 | 5 5 5 4 4 5 |
| parable | A 3.8 (4 4 4 3 3 4) | A 3.6 | A 4.8 | 5 5 5 4 4 5 |
| miracle | A 3.6 (4 3 4 3 3 4) | A 3.6 | A 4.8 | 5 5 5 4 4 5 |
| teaching_of_jesus | A 3.6 (4 3 4 3 3 4) | A 3.6 | A 4.8 | 5 5 5 4 4 5 |
| belief | A 3.6 (4 3 4 3 3 4) | A 3.6 | A 4.6 | 5 5 4 4 4 5 |
| hymn | A 4.0 (5 4 4 3 3 4) | A 3.6 | A 4.6 | 5 5 4 4 4 5 |
| name_meaning | A 4.2 (5 4 4 3 4 5) | A 3.8 | A 4.6 | 5 5 4 4 4 5 |
| faith_in_a_hard_season | B 3.2 (3 3 4 3 2 4) | A 3.6 | A 4.6 | 5 5 4 4 4 5 |
| saint_of_the_day | A 4.1 (5 4 4 3 4 4) | A 3.9 | A 4.6 | 5 5 4 4 4 5 |
| denomination_compare | A 3.9 (4 4 4 3 4 4) | A 3.9 | A 4.8 | 5 5 5 4 4 5 |
| events_this_week | A 4.1 (5 4 4 3 4 4) | A 3.9 | A 4.6 | 5 5 4 4 4 5 |
| kingdom_map | A 3.8 (4 4 4 3 3 4) | A 3.7 | A 4.8 | 5 5 5 4 4 5 |
| testimonies | A 3.8 (4 4 4 3 3 4) | A 3.7 | A 4.8 | 5 5 5 4 4 5 |
| universities | B 3.4 (4 3 3 3 3 4) | B 3.4 | A 4.6 | 5 5 4 4 4 5 |
| reading_plans | A 3.8 (4 4 4 3 3 4) | A 4.2 | A 4.6 | 5 5 4 4 4 5 |
| gatherings_tonight | A 3.8 (4 4 4 3 3 4) | A 4.2 | A 4.8 | 5 5 5 4 4 5 |
| where_can_i_serve_publicly | A 3.8 (4 4 4 3 3 4) | A 4.1 | A 4.6 | 5 5 4 4 4 5 |
| kingdom_protocol_lookup | A 4.2 (5 3 4 4 4 5) | A 4.3 | A 4.6 | 5 5 4 4 4 5 |
| scripture_context | A 4.4 (5 4 4 4 4 5) | A 4.4 | A 4.7 | 5 5 4 4 5 5 |
| scripture_search | A 4.4 (5 4 4 4 4 5) | A 4.4 | A 4.6 | 5 5 4 4 4 5 |
| cross_references | A 4.4 (5 4 4 4 4 5) | A 4.2 | A 4.6 | 5 5 4 4 4 5 |
| journey_next_steps | A 4.6 (5 4 5 4 4 5) | A 4.3 | A 4.7 | 5 5 4 5 4 5 |

## What changed

- **Every description** now leads with a verb, a resource and a scope, followed by when to use it, when not to use it and the sibling to use instead. It then states the data source and when it is read, the caps, the matching rules, what an empty result looks like and what is logged. Devotional closing sentences and paraphrased verses came out; references stay. The "never answer from memory" steering came out of every description.
- **Siblings now draw boundaries in both directions.** The pairs and groups are:
  - search, ask_living_bread and fetch
  - find_churches_near and church
  - find_gatherings_near, events_this_week and gatherings_tonight
  - verses_for, what_the_bible_says_about and scripture_search
  - scripture_passage, scripture_context and cross_references
  - needs_near and where_can_i_serve_publicly
  - the nine house-page tools
- **pray_for_someone (public)** now says it sends and records nothing and returns a link. That ends the contradiction with readOnlyHint that earned Behavior 1. The same fix went into hear_the_kingdom_pray and begin.
- **Every input parameter** has a description with its format, range, default and examples. Coverage is now 100% on every tool; before, limit, kind, query, id, language and radius_km had none.
- **Every output field** is described (Glama had 0 of N). `out()` in src/shared.ts also declares the envelope that `finish` adds to every answer: ok, result_state, ids, source_url, freshness, visibility, next_actions, evidence, content_layers, content_flags, attribution and license.
- **One access line per tool**, generated in `tool()`: no sign-in on /mcp, or the signed-in connection on /me and /app, plus the real limit of 300 requests a minute per IP from src/index.ts.
- **The /me and /app tools** were rewritten the same way. Each write tool states the two-step `confirmed` flow and idempotency once. Glama does not score these tools, because it reads /mcp.
- **src/instructions.ts** has one routing line for the close tool groups, consistent with the descriptions.

## What the rubric rewards that we cannot honestly give

- **Tool Count Appropriateness, 2 of 5.** The rubric wants 3 to 15 tools; 45 scores 2. Merging tools would remove names that connected clients and the OpenAI listing call, so this change does not do it. Folding the nine house-page readers into one tool would reach 37 tools, which still scores 2. Only 25 or fewer would score 3.
- **Naming Consistency, 2 or 3 of 5.** The names mix verb_noun (find_churches_near), bare nouns (parable, hymn) and phrases (a_prayer_for, where_can_i_serve_publicly). The fix is renaming, which breaks clients, so this is reported rather than done.
- **Disambiguation stays at 4, not 5,** while events_this_week remains a fixed seven-day view of the same data as find_gatherings_near. The descriptions now say so honestly. Retiring it, or making it a pure alias, is the remaining lever.
- **The ceiling with today's names and count.** If every tool scored 5.0, the overall would be round1(0.7 × 5.0 + 0.3 × 3.75) = 4.6. **5.0 is not reachable** without consolidating to 15 or fewer tools under one naming pattern.
- **Parameter Semantics** stops at 4 for most tools. When the schema already documents every parameter, the rubric gives the description little left to add, and padding would cost Conciseness. **Conciseness** sits at 4 because covering when-not, alternatives and behavior makes descriptions dense, at about 750 characters on average.
