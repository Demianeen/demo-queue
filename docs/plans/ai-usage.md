---
title: AI usage logging and estimated spend
status: COMPLETE
tier: Tier 2
created: 2026-10-30
updated: 2026-10-30
---

# AI usage logging and estimated spend

## Outcome

Every OpenAI call the app makes (AI summaries and AI shuffle, retries and
rejected replies included) is logged with its tokens, and organisers get an
"AI usage" page under Workspace that shows what a month cost, as an estimate
from the logged tokens and OpenAI's list prices.

Branch `codex/dq-ai-usage`, from `17a2c4e` (the tip of
`codex/dq-new-behaviour`). The PR is stacked on that branch.

## Decisions (Demian's exact words)

| Date | Decision | Words |
| --- | --- | --- |
| 30 Oct 2026 | Build it as a follow-up PR | "add the usage logging as a follow-up PR" |

## What was built

- `aiUsage` table (additive): one row per model call with organisation,
  event, submission, feature, the model OpenAI reported, service tier, input,
  cached input, output and reasoning tokens, the result and the time. No
  prompt or reply text is stored.
- Results: `saved`, `retried`, `rejected`, `discarded`, `failed`, `error`.
  A call that threw before any reply is `error` and has no tokens; a reply the
  app could not use is `failed` and keeps its tokens.
- `lib/ai-prices.ts`: prices per model with an effective-from day, in USD per
  1M tokens for input, cached input and output. Cost is worked out when usage
  is read, never stored, so a corrected price corrects past months.
- `aiUsage.monthSummary` and `aiUsage.monthCalls`: organisers of the
  organisation only.
- `/ai-usage`: month picker in the address (`?month=2026-10`), Download CSV,
  KPI tiles, spend by UTC day, by event with summary runs today against the
  cap, a read-only "How the cost is worked out" card, and every model call
  with Show all. Loading, empty, error and partial states.

## How cost is worked out

`(input - cached) x input price + cached x cached price + output x output
price`, divided by 1M. Reasoning tokens are already inside OpenAI's output
tokens, so they are shown but never added again (a unit test pins this).
Once a call's input passes 272K tokens the whole call uses the long context
rate. A call on a model or service tier without a price shows "price unknown"
and is left out of the totals, which say so.

## Prices

| Model | From | Input | Cached input | Output | Over 272K input |
| --- | --- | --- | --- | --- | --- |
| gpt-5.4 | 5 Mar 2026 | $2.50 | $0.25 | $15.00 | $5.00 / $0.50 / $22.50 |

Standard tier, checked 30 Oct 2026 at
https://developers.openai.com/api/docs/pricing and
https://developers.openai.com/api/docs/models/gpt-5.4. The design board used
different example prices; the app uses these.

## Proposed

Not yet agreed:

- The page layout details, the KPI tiles and the copy.
- Result names and their labels.
- Per project cost: summary spend divided by the projects that got a summary.
- Practice samples: counted from stored sample summaries made in the month,
  across up to 100 practice events. A replaced summary or a tidied practice
  event no longer counts.
- Days and months are UTC.
- The G then A shortcut and the header placement of the month picker and
  Download CSV.
- A month reads at most 8,000 calls; past that the page says the figures are
  partial.
- Only Standard tier prices; other tiers show "price unknown".
- No MCP tool for usage yet; the two queries are listed as browser-only in
  `scripts/mcp-admin-coverage.mjs`.

## Not in scope

- A monthly limit or editable prices.
- In the local harness, any client navigation away from `/events` crashes
  with React error 310. The same happens on `17a2c4e` without this branch.
