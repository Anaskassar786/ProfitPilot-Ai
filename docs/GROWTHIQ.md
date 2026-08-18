# GrowthIQ — "Intelligent growth for ambitious merchants"

GrowthIQ (formerly **AI Executive**, PR #49) is the strategic intelligence
module of the **AI Growth Command**. Where Store Coach handles daily tactical
coaching, GrowthIQ handles the decisions merchants make a handful of times
per year: board reports, industry position, what-if scenarios, health
diagnosis, opportunities, decision tracking, risk radar, and strategic
roadmaps.

Every number in the module is computed from **real synced store rows** or
from **curated public industry benchmarks**. The AI layer writes narrative
language only, and the language firewall rejects any AI output that
introduces a number outside the evidence set computed from the store.

> **Rebuild notes (GrowthIQ rebrand):** The module was renamed AI Executive →
> GrowthIQ with a new growth-arrow + neural logo and a purple
> intelligence-purple design system (dark + light). The rebuild also fixed
> four production defects: a `pg` `date` → `Date` crash that 500'd the
> dashboard, a CORS same-origin 403 that blanked the SPA in Origin-sending
> browsers, an off-by-one hash parser that made sub-pages unreachable, and a
> `?? 3` fallback that capped Commander's benchmark metrics at 3. See the PR
> description for details. The backend API namespace (`/ai-executive/*`) and
> table names are intentionally unchanged for compatibility.

---

## Feature overview

| Surface | What it does | Data it uses |
|---|---|---|
| Executive dashboard | CEO rollup: summary, health gauge, industry position, opportunities, risk counts, scenarios, roadmap snapshot, recent decisions, usage | Dashboard endpoint rollup |
| Board reports | Monthly / quarterly / custom reports with executive summary, strategic position, key insights, recommended decisions, financial forecast, appendix | Real metrics + optional grounded AI narrative |
| Industry benchmarks | Merchant value vs percentile ladder (10/25/50/75/90) with gap-to-top-10% | Curated public Shopify benchmarks (Phase 1) |
| Scenario planning | Pricing, product, marketing, inventory, custom what-ifs with explicit assumptions and confidence | Real baselines + stated planning assumptions |
| Business health | 8 vital signs, weighted score, conditions, prescriptions, score history | Synced orders, products, customers |
| Strategic opportunities | Market gap, expansion, seasonal, cross-sell, pricing, product opportunities with annual impact estimates | Velocity, margins, co-purchase pairs, retention |
| Decision log | Predicted vs actual outcomes, accuracy scores, quality ratings, lessons | Merchant-entered outcomes |
| Risk radar | Concentration, seasonal, competition, cash-flow, operational, market risks with probability × impact | Deterministic detectors over real rows |
| Strategic roadmaps | 30/60/90-day, quarterly, yearly plans with weekly milestones | Business state + optional AI planning |
| Investor PDF | Print-ready board report PDFs, white-label (Commander) | The report payload — nothing else |
| Monthly email | Scheduled board report email via Brevo, PDF attached (Commander) | Preferences + report payload |

### Routes

- SPA path: `/ai-growth-command/growthiq`
- Hash sub-routes: `#/ai-growth-command/growthiq[/reports|/reports/:id|/benchmarks|/scenarios|/health|/opportunities|/decisions|/risks|/roadmaps|/settings]`
- The legacy `#/ai-growth-command/executive…` prefix still deep-links (shared
  links, bookmarks, older email links) and normalizes to the new route.

## Plan gating (feature matrix)

Enforced **server-side** via `billing_usage` meters and tier gates. Locked
features return `402 UPGRADE_REQUIRED` with `{ feature, plan, requiredPlan,
reason }`; the UI renders aspirational overlays whose CTA is always
**"Upgrade Plan"** — it never names a plan.

| Feature | Trial | Start | Growth | Commander |
|---|---|---|---|---|
| Dashboard | Preview | Full | Full | Full |
| On-demand reports | — | 1/mo | 5/mo | Unlimited |
| Auto monthly report | — | — | ✅ | ✅ |
| Benchmark metrics visible | 3 | 5 | 10 | All (unlimited) |
| Scenarios | — | 1/mo | 5/mo | Unlimited |
| Health diagnoses | — | 1/mo | 4/mo | Unlimited |
| Opportunities tracked | 1 | 3 | 10 | Unlimited |
| Decision log | — | 5 | Unlimited | Unlimited |
| Risk scans | — | 1/mo | 4/mo | Unlimited |
| Roadmaps | — | 30-day | 30/60/90 | + Quarterly/Yearly |
| Investor PDF | — | — | — | ✅ |
| White-label PDF | — | — | — | ✅ |
| Monthly email report | — | — | ✅ | ✅ + PDF attached |
| Exports | — | — | 5/mo | Unlimited |

Meters warn at 80% usage and hard-block at 100% with the upgrade CTA.
Trial expiry is handled by the existing billing layer (14 days, then upgrade).

## Technical architecture

```
apps/api/src/executive-analytics.ts   Deterministic engine (vitals, risks,
                                      opportunities, scenarios, accuracy,
                                      roadmap progress, percentile math)
apps/api/src/executive-benchmarks.ts  Benchmark ladders + merchant position
apps/api/src/executive-ai.ts          OpenRouter orchestration + language
                                      firewall + deterministic fallbacks
apps/api/src/executive-repository.ts  Postgres + in-memory repositories
apps/api/src/executive-service.ts     Plan gates, feature flows, dashboard,
                                      monthly report tick
apps/api/src/executive-routes.ts      /ai-executive/* router (35+ endpoints)
apps/api/src/executive-pdf.ts         Dependency-free PDF 1.4 writer with
                                      vector charts + white-label + stores
apps/api/src/executive-email.ts       Brevo SMTP monthly report email
apps/api/src/executive-bootstrap.ts   Env-driven wiring (F9 bootstrap)
apps/web/src/executive.tsx            GrowthIQ workspace + CEO dashboard
apps/web/src/executive-*.tsx          8 sub-pages (reports, benchmarks, …)
apps/web/src/growthiq-logo.tsx        Growth-arrow + neural SVG mark
apps/web/src/executive-charts.tsx     Theme-adaptive SVG charts
apps/web/src/executive.css            Intelligence-purple design system
migrations/0022_ai_executive.sql      Tables + RLS + seeded public benchmarks
```

### Report generation flow

1. `POST /ai-executive/reports/generate` (or the monthly tick) passes plan
   gating and the per-store rate limit (default 20 req/min).
2. The snapshot pipeline reads real rows (`buildStoreSnapshot` +
   `AnalyticsRepository`), the deterministic engine computes vitals, risks,
   opportunities, and benchmark percentiles into an `ExecutiveFacts` sheet.
3. `ExecutiveAiService.generateBoardReport` sends the fact sheet to
   OpenRouter (`nvidia/nemotron-3-ultra:free` → `nvidia/nemotron-3-super:free`,
   shared `STORE_COACH_API_KEY`). The response must pass
   `validateLanguageResponse` against the facts' numbers — any invented number
   rejects the section, which falls back to the deterministic template.
4. The report is stored with the unique `(store, type, period_start)`
   constraint, usage is metered, and the monthly tick emails it via Brevo.

### PDF generation (Commander)

`renderExecutiveReportPdf` writes a PDF 1.4 document without external
dependencies: cover page with vector logo, table of contents, headings, data
tables, area/horizontal-bar/radial-gauge vector charts, page numbers, and a
white-label pass (brand name, logo, primary color, footer). Generation is
asynchronous (`POST …/pdf` → job id → poll `pdf/status` → download) and files
are retained for 30 days. Set `AI_EXECUTIVE_PDF_DIR` to persist PDFs to disk;
otherwise an in-memory store serves the process lifetime (dev/test).

### Industry benchmarks (Phase 1 — hybrid)

Percentile ladders are curated from public e-commerce benchmark literature
(Littledata Shopify benchmarks, Shopify/Statista published commerce figures,
industry return-rate studies) and seeded in `ai_executive_benchmarks` with
`data_source=SHOPIFY_PUBLIC` and a source label. Phase 2 adds anonymized
GDPR-compliant aggregates once the merchant base exceeds 100 (opt-in only).
Category is auto-detected from Shopify `product_type` values and overridable
in preferences. A `null` plan limit (Commander) means **all** metrics are
visible — the UI and API must never fall back to a number for it.

### No-fake-data guarantees

- Health vitals, risks, and opportunities are pure functions of real rows.
- Missing metrics (CAC, conversion, marketing ROI without ad data) are
  reported as "not measurable" — never estimated.
- Scenario projections list every planning assumption (elasticity, ROAS,
  ramp curves) next to the numbers and lower confidence when history is thin.
- The AI layer may only restate numbers from the fact sheet (language
  firewall); otherwise the deterministic template serves the report.
- Thin-history stores get an honest "Building your intelligence baseline"
  state with real sync counts (orders synced, days synced) — no demo data.

## Endpoints

`GET/POST /ai-executive/dashboard|usage|cost-summary`,
`reports[/:id][/generate|/pdf|/pdf/status|/pdf/download|/email|/mark-viewed]`,
`benchmarks|benchmarks/position|benchmarks/comparison|benchmarks/refresh`,
`scenarios[/:id]|scenarios/templates`,
`health/current|health/diagnose|health/history|health/trends`,
`opportunities[/:id][/generate|/status]`,
`decisions[/:id][/analytics|/review]`,
`risks[/:id][/scan|/mitigate|/resolve]|risks/trends`,
`roadmaps[/:id][/generate|/mark-milestone]`,
`preferences`.

All write endpoints enforce tenant isolation (existing session middleware +
RLS), the `{ ok, data, requestId }` envelope, plan gates (402), and the
per-store rate limit (429 with `retryAfterMs`).

## Environment variables

```
STORE_COACH_API_KEY=sk-or-v1-…          shared OpenRouter key (PR #48/#49)
AI_EXECUTIVE_ENABLED=true
AI_EXECUTIVE_MODEL_PRIMARY=nvidia/nemotron-3-ultra:free
AI_EXECUTIVE_MODEL_FALLBACK=nvidia/nemotron-3-super:free
AI_EXECUTIVE_RATE_LIMIT_PER_STORE=20
AI_EXECUTIVE_DAILY_BUDGET_USD=0
AI_EXECUTIVE_PDF_ENABLED=true
AI_EXECUTIVE_PDF_DIR=                   optional disk persistence
AI_EXECUTIVE_BENCHMARK_MODE=hybrid
```

## Troubleshooting

- **"Something went wrong / Internal server error" on the dashboard** — check
  API logs for the `internalMessage`. Fixed in the GrowthIQ rebuild: the `pg`
  driver returns `date` columns as `Date` objects; `PostgresAnalyticsRepository`
  now normalizes them to `YYYY-MM-DD` strings at the boundary. If it recurs
  after a bad deploy, confirm migration `0022_ai_executive` is applied (the
  dashboard maps missing-relation errors to a 503 with
  `reason: SCHEMA_MISSING`).
- **"AI narrative unavailable" on reports** — normal without a provider key
  or when the model returns an ungrounded number; the deterministic report is
  complete either way.
- **402 UPGRADE_REQUIRED** — the feature is gated for the store's plan. The
  payload carries `requiredPlan`; the UI routes to billing ("Upgrade Plan").
- **429 RATE_LIMITED** — 20 AI-generation requests per minute per store.
- **"Not measurable" benchmarks/vitals** — the sync hasn't produced enough
  history yet; run a sync and re-check.
- **PDF endpoint 503** — set `AI_EXECUTIVE_PDF_ENABLED=true` (Commander only).
- **Monthly email skipped** — the store needs a `report_email` in GrowthIQ
  settings, Growth+ plan, and SMTP configuration.
