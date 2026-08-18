# PR #50 — Insights Hub: "Where data becomes wisdom"

Third module of **AI Growth Command**. Insights Hub is the learning layer of ProfitPilot: it **discovers** hidden patterns, **teaches** lessons grounded in the store's own data, and **explains** why metrics move — with a "curious scientist" voice and zero invented numbers.

## What ships

### Backend (~55 endpoints, `apps/api/src/insights-hub-routes.ts`)
- **Discoveries** — feed/list/generate/detail/status lifecycle (`NEW → REVIEWED → SAVED / DISMISSED / ACTED_ON`).
- **Lessons** — library, recommended picks, generate, read/rate/bookmark.
- **Pattern lab** — list/detect/alert/invalidate across time, product, customer, behavioral, seasonal, anomaly, and correlation patterns.
- **Personas** — RFM-clustered, named + emoji, radar traits, motivations, reach plans; `/customers` returns anonymized aggregates only (never PII).
- **Why? explorer** — root-cause investigations ranked by measured impact share, with steps, evidence, what-to-do, and prevention tips; rateable.
- **Trends** — business/emerging/declining/internal vs market, plan-shaped freshness, alert toggles; market section is honestly unavailable until a verified external feed exists.
- **Comparisons** — PRODUCT/PERIOD/SEGMENT/CATEGORY/CHANNEL with per-metric deltas and a measured winner, or an honest `INSUFFICIENT_DATA` verdict.
- **Knowledge base** — notes + AI entries, search, tags, linked-insight network, editor.
- **Timeline** — one memory of every insight event, plan-windowed (7d/30d/90d/full).
- **Predictions** — revenue/orders forecasts + stockout warnings with 80% intervals, per-plan horizons (7/30/90d), and post-window accuracy grading.
- **Preferences, usage, cost summary** — nightly sweep settings, notification toggles, vocabulary; monthly meters (80% warn / 100% block); honest $0 free-tier cost card.
- **Commander public API** — `ihk_` Bearer keys (generate/regenerate — old keys die instantly), masked-key status, hourly/daily usage, recent calls, docs, and `GET /public-api/insights/*` (100 req/h, 1,000/day) with a served OpenAPI 3.1 spec.

### Deterministic engine (`packages/ai/src/insights-hub.ts`)
Weekday rhythm, z-score anomalies, co-purchase affinity, repeat-customer segments, momentum, rising products, concentration, peak hours; RFM personas; revenue→orders×AOV decomposition for Why?; weekday-seasonal + linear-trend forecasts; grounded lesson writer. All gated by data thresholds (7 days/10 orders, 50 customers, 60/14 days) and a 0.7 default confidence floor.

### AI narration — language first, numbers never
Dedicated OpenRouter key (`INSIGHTS_HUB_API_KEY`, named in `.env.example`; real value delivered via the secure Arena chat thread and set on Railway for api + worker — never committed to this public repo), models `nvidia/nemotron-3.5-lightning:free` → `nvidia/nemotron-3-super:free`, $0/day budget. The narrator may only restyle engine output; every sentence passes the existing language firewall (any non-evidence number ⇒ deterministic fallback).

### Frontend (`apps/web/src/insights-hub-*`)
- Full workspace at `/ai-growth-command/insights/*` with deep links, preserved store params, and browser back/forward; sidebar gains the **AI Growth Command** group with a **NEW** badge.
- Custom SVG chart kit — bubble, radar, heatmap, area-with-gradient fans, scatter, timeline strip, word cloud, network, treemap, sankey-style flow, diverging bars. **No line charts, no donuts.** All colors flow through `--ih-*` tokens: identical legibility in dark and light themes, subtle grids, tooltips, click-through, SVG export on plans with export rights.
- Educational empty states with exact thresholds and live progress ("Personas require at least 50 customers — you have 12"), skeletons, retryable error panels.
- Trial explores through clearly labeled **SAMPLE** content; every locked surface shows the generic **Upgrade Plan** CTA (never a plan name) routing to billing.

### Worker (`apps/worker/src/insights-discovery-job.ts`)
Queue-driven auto-discovery: daily 02:00 UTC / weekly Sunday / real-time (Commander) sweeps courier each store to `POST /insights/auto-discovery/run` over the standard CSRF handshake; plan walls/quota responses are steady-state; per-store failures never sink the sweep. In-band fallback on feed open keeps the UI fresh if the worker hasn't fired.

### Data (`migrations/0021_insights_hub.sql`)
12 tables (`insights_discoveries`, `insights_lessons`, `insights_patterns`, `insights_personas`, `insights_investigations`, `insights_trends`, `insights_comparisons`, `insights_knowledge_base`, `insights_timeline_events`, `insights_predictions`, `insights_preferences`, `insights_api_usage`) — indexed, tenant-scoped, RLS with `WITH CHECK`, registered in the migration runner.

## Plan matrix (402 `UPGRADE_REQUIRED` + "Upgrade Plan" everywhere)
Trial: 1 labeled sample discovery, 3 sample lessons, view-only patterns, 7-day timeline. Start $49: 5 discoveries/mo, 10 lessons, 5 patterns, 2 personas, 3 Why?/mo, PRODUCT+PERIOD compares, notes, 30d, 7-day forecasts, daily auto-discovery. Growth $149: 20/30/20/5/15, all comparison types, full knowledge, 90d, 7+30-day forecasts, export/share, daily trends + anomaly digest. Commander $349: unlimited, real-time, 90-day forecasts, collaboration, public API.

## Tests & docs
- `packages/ai/src/insights-hub.test.ts` — 58 engine tests.
- `apps/api/src/insights-hub-routes.test.ts` — 48 endpoint tests (plan walls, caps, validation, dedupe, key lifecycle, public API auth, rate limit, kill switch).
- `packages/db/src/db.test.ts` — migration registry + RLS coverage for all 12 tables.
- `apps/web/src/insights-hub-model.test.ts` + `insights-hub-ui.test.tsx` — 47 tests (routing, locks, humanization/no enum leakage, chart contracts: no line/donut, Upgrade-Plan-only CTAs, SAMPLE labeling).
- `apps/worker/src/insights-discovery-job.test.ts` — 13 sweep tests.
- Docs: `docs/INSIGHTS_HUB.md`, README + API.md sections, full `.env.example` block (key value intentionally kept out of the public repo — delivered via Arena chat + Railway, per "no credentials in git" convention).

## Out of scope (future PRs)
Verified external benchmark feed for Market trends (the section stays honestly unavailable until then); channel attribution comparison once Shopify channel fields sync; multi-language narration beyond en/hi.
