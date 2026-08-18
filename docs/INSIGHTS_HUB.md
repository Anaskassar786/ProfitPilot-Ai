# Insights Hub (PR #50)

**Where data becomes wisdom.** Insights Hub is the third module of **AI Growth Command**. Where the AI Command Center watches operations and Recommendations propose actions, Insights Hub is the *learning* layer:

- **DISCOVER** — hidden patterns, anomalies, and opportunities inside your own synced data.
- **LEARN** — short lessons compiled from your store's real history, never generic filler.
- **UNDERSTAND** — Why? investigations that decompose metric movements into ranked root causes.

> **Zero fake data.** Every number the Hub shows is computed deterministically from the store's real synchronized Shopify data (`analytics_revenue_daily`, `analytics_orders_daily`, `analytics_product_sales_daily`, customer aggregates, inventory velocity). When the data is too thin, the Hub says exactly what is missing and how close you are — it never fills the gap with invented figures. The AI narrator (OpenRouter) may only *rephrase* deterministic engine output, and every generated sentence passes the language firewall before it can reach the UI.

---

## 1. Feature tour

| Surface | Route | What it does |
| --- | --- | --- |
| Discovery feed | `/ai-growth-command/insights` | Masonry feed of AI discoveries with evidence, confidence, and one-click review actions (`NEW → REVIEWED → SAVED → ACTED_ON`, or `DISMISSED`). Weekday/hour heatmaps and a review-funnel visualize the engine's own outputs. |
| Lessons | `/ai-growth-command/insights/lessons[/:id]` | A learning library of short, data-grounded briefings with reading time, ratings, bookmarks, recommended picks, and action items. |
| Pattern lab | `/ai-growth-command/insights/patterns` | Recurring structures the engine has confirmed (time, product, customer, behavioral, seasonal, anomaly, correlation), plotted as a confidence × recurrence bubble chart, with break-alerts and invalidation. |
| Personas | `/ai-growth-command/insights/personas[/:id]` | RFM-clustered customer personas with names, emoji, radar trait charts, motivations, reach plans — and strictly anonymized segment aggregates (never PII). |
| Why? explorer | `/ai-growth-command/insights/why[/:id]` | Ask "Why did revenue drop last week?" — the explorer decomposes revenue into orders × AOV, checks product mix and segments, then ranks root causes by measured impact share with evidence and prevention tips. |
| Trend watcher | `/ai-growth-command/insights/trends` | Business / emerging / declining signals with magnitude × confidence scatter, alert toggles, and plan-shaped freshness. The Market section renders honest unavailability until a verified external feed is connected. |
| Comparisons | `/ai-growth-command/insights/comparisons[/new\|/:id]` | Head-to-head PRODUCT, PERIOD, SEGMENT, CATEGORY, and CHANNEL comparisons with diverging bars, per-metric deltas, and a winner — or an honest `INSUFFICIENT_DATA` verdict. |
| Knowledge base | `/ai-growth-command/insights/knowledge[/:id]` | Everything the Hub learned plus merchant notes — searchable, tag-clouded, and drawn as a link network. |
| Timeline | `/ai-growth-command/insights/timeline` | One chronological memory of every discovery, lesson, pattern, persona, investigation, trend, comparison, and prediction (plan-windowed). |
| Predictions | `/ai-growth-command/insights/predictions` | Revenue/orders forecasts and stockout warnings with confidence bands rendered as area-with-gradient fans, methods, and post-window accuracy grading. |
| Settings | `/ai-growth-command/insights/settings` | Auto-discovery, frequency, categories, notifications, trend monitoring, persona refresh, and insight language preferences. |
| API access | `/ai-growth-command/insights/api-access` | Commander-only programmatic access: key generation/regeneration, masked key, hourly/daily usage, recent calls, quick-start snippets, and the OpenAPI spec link. |

All pages deep-link, preserve `storeId`/`shop` search params, and support browser back/forward. Charts are hand-built SVG (bubble, radar, heatmap, area-with-gradient, scatter, timeline strip, word cloud, network graph, treemap, sankey-style flow, diverging comparison bars) — **no line charts, no donut charts** — theme-adaptive in dark and light (`--ih-*` tokens), with native tooltips, click interactions, and one-click SVG export on plans with export rights.

## 2. Plans at a glance

| Capability | Trial (14 days) | Start $49 | Growth $149 | Commander $349 |
| --- | --- | --- | --- | --- |
| Discoveries / month | 1 labeled **SAMPLE** | 5 | 20 | unlimited |
| Lessons | 3 labeled samples | 10 | 30 | unlimited |
| Patterns | view-only gallery | 5 custom | 20 custom | unlimited |
| Personas | — | 2 | 5 | unlimited |
| Why? / month | — | 3 | 15 | unlimited |
| Comparison types | — | PRODUCT, PERIOD | all | all + custom |
| Knowledge | — | notes | full | advanced |
| Timeline window | 7 days | 30 days | 90 days | full history |
| Prediction horizons | — | 7 days | 7 + 30 days | 7 + 30 + 90 days |
| Auto-discovery | — | daily | daily | real-time |
| Export / share | — | — | basic | advanced / collaboration |
| Public API | — | — | — | 100 req/h, 1,000/day |
| External trends | — | weekly | daily | real-time |
| Anomaly alerts | — | — | daily digest | real-time push |

Locked surfaces return **402** with `reason: 'UPGRADE_REQUIRED'` and the generic CTA **`Upgrade Plan`** (plan names never appear in CTAs; the button routes to billing). Trial expiry is absolute: a dead subscription stops all generation immediately (402 `SUBSCRIPTION_REQUIRED`).

## 3. Architecture

```
apps/web/src/insights-hub*.tsx|ts|css     curious-scientist UI (tabs, charts, states)
apps/api/src/insights-hub.ts              repository (Postgres + in-memory), service, rate limiter, narrator
apps/api/src/insights-hub-routes.ts       ~55 endpoints incl. /public-api/insights/* + OpenAPI
packages/ai/src/insights-hub.ts           deterministic engine: detectors, personas, Why?, trends, comparisons, forecasts, lessons
apps/worker/src/insights-discovery-job.ts auto-discovery sweep courier (queue → API)
migrations/0021_insights_hub.sql          12 RLS-protected tables
```

- **Engine first, AI second.** Detectors, forecasts, personas, and investigations are deterministic functions over the synced dataset. The narrator (`INSIGHTS_HUB_SYSTEM_PROMPT`, curious-scientist tone — *"Interesting…", "Did you know…"*) restyles the output; the language firewall rejects any generated sentence containing a number that is not in the evidence pack.
- **Caching:** datasets cache 12h per store; generation endpoints always refresh.
- **Rate limits:** 25 req/min/store on merchant endpoints (429 + `retryAfterSeconds`); the public API enforces its own hourly/daily caps.
- **Isolation:** every Postgres read/write runs inside the tenant context (`app.store_id`) and all 12 tables carry `WITH CHECK` RLS policies.

## 4. Auto-discovery (Part 4)

1. A scheduler enqueues `insights_discovery_sweep` `{ storeIds, reason }` (daily 02:00 UTC; weekly sweeps ride the Sunday tick; Commander stores can run real-time `insights_discovery` jobs).
2. The worker (`createInsightsDiscoveryRunner`) posts each store to `POST /insights/auto-discovery/run` using the standard CSRF double-submit handshake. Plan walls (402) and quota/rate-limit (429) responses are steady-state — recorded, not retried as failures.
3. The API pipeline re-runs the deterministic detectors and pattern/trend detection, narrates the fresh discoveries, persists everything under RLS, writes timeline events, and stamps the store's last-run marker. Merchants with high-confidence notifications enabled hear about it the next time they open the app.
4. Opening the feed when a sweep is due (but the worker has not fired) runs the pipeline in-band exactly once, so the UI is never stale.

Data thresholds the engine honors: discoveries need **7** revenue days or **10** orders, personas **50** customers, business trends **60** days, predictions **14** days, minimum confidence **0.7** by default.

## 5. Public API (Commander)

Authenticate with a key from **Settings → API access** (shown once at generation; regenerating invalidates the old key instantly):

```bash
curl -H "Authorization: Bearer ihk_your_key" \
  "https://your-profitpilot-host/public-api/insights/discoveries?status=NEW"
```

```js
// JavaScript
const res = await fetch('https://your-profitpilot-host/public-api/insights/predictions', {
  headers: { Authorization: 'Bearer ihk_your_key' },
})
const { data } = await res.json()
console.log(data.predictions.map((p) => [p.title, p.predictedValue, p.confidenceScore]))
```

```python
# Python
import requests

r = requests.get(
    "https://your-profitpilot-host/public-api/insights/trends",
    headers={"Authorization": "Bearer ihk_your_key"},
    timeout=15,
)
for trend in r.json()["data"]["trends"]:
    print(trend["trendType"], trend["title"], trend["magnitude"])
```

Endpoints: `GET /public-api/insights/discoveries|patterns|personas|predictions|trends`. Quotas: **100 requests/hour, 1,000/day** per store (429 with `retryAfterSeconds` beyond that). The OpenAPI 3.1 spec is served at `GET /public-api/insights/openapi.json` and linked from the API access page. Usage (`requestsThisHour`, `requestsToday`, recent calls) is visible in the app and via `GET /insights/api-access/usage`.

## 6. Configuration

See the `Insights Hub` block in `.env.example` — the module runs on a dedicated OpenRouter key (`INSIGHTS_HUB_API_KEY`) with free-tier Nemotron models (`INSIGHTS_HUB_MODEL_PRIMARY/FALLBACK`) and a $0/day default budget (`INSIGHTS_HUB_DAILY_BUDGET_USD=0`); pay only after consciously switching models. `INSIGHTS_HUB_ENABLED=false` cleanly 503s every endpoint and makes the worker sweeps no-op.

## 7. Troubleshooting

- **"Not enough history to discover yet"** — the empty state tells you exactly what is missing (`Discoveries need 7 days of revenue history or 10 orders`). Run a Shopify sync and check back; discoveries light up automatically.
- **Personas grayed out with a progress bar** — personas require ≥50 synced customers; the bar shows `have / need`.
- **Market trends section says no feed is connected** — intended. Connect a verified benchmark source (or enable `INSIGHTS_HUB_EXTERNAL_TRENDS`) — the Hub never fabricates market data.
- **402 with `reason: UPGRADE_REQUIRED`** — the store is on the edge of its plan matrix; the generic **Upgrade Plan** CTA routes to billing.
- **429 on merchant endpoints** — 25 requests/minute/store by default; back off for `retryAfterSeconds`.
- **Public API returns 401** — the key was regenerated (old keys die instantly) or API access is disabled for the store.
- **Charts look empty in one theme** — all chart colors flow through `--ih-*` tokens defined for both themes; hard refreshes clear stale CSS.
