# PR #49 — AI Executive: Complete Build (Part 2 of AI Growth Command)

**"Your Boardroom in a Box"** — CEO-level strategic intelligence for Shopify
merchants, delivered as the second section of the AI Growth Command page next
to Store Coach (with Insights Hub reserved as a coming-soon tab for PR #50).

AI Executive covers the decisions merchants make a handful of times per year —
never the daily coaching Store Coach owns. Zero feature overlap with the AI
Command Center, Automation, Recommendations, Store Coach, or Analytics.

## What ships

**Database** — migration `0021_ai_executive.sql`: 9 tenant-isolated tables with
RLS (reports, benchmarks, scenarios, health diagnoses, opportunities,
decisions, risks, roadmaps, preferences) plus seeded public-source industry
benchmark percentile ladders (10 categories × 7 metrics).

**Backend** — 35+ endpoints under `/ai-executive/*`:
- Board reports: list/get/generate/view/email + async investor PDF jobs
  (job → poll → download, Commander-gated)
- Benchmarks: position, detailed comparison, refresh
- Scenarios: templates + run/save/delete for pricing, product, marketing,
  inventory, and custom what-ifs
- Health: diagnose, history, trends
- Opportunities: generate + status lifecycle
- Decisions: log, edit, review (predicted vs actual), analytics
- Risks: scan, mitigate, resolve, trends
- Roadmaps: create/generate/mark-milestone across 30/60/90/quarterly/yearly
- Preferences + usage + cost summary
- Monthly report tick (API process schedule) → Brevo email, PDF attached for
  Commander

**Deterministic engine** (`executive-analytics.ts`) — every number is computed
from real synced rows: eight vital signs, weighted health score, six risk
detectors, six opportunity detectors, scenario projections with explicit
planning assumptions, decision accuracy scoring, roadmap progress, and
piecewise-linear benchmark percentile interpolation.

**Grounded AI** (`executive-ai.ts`) — OpenRouter via the shared
`STORE_COACH_API_KEY` (`nvidia/nemotron-3-ultra:free` → `nvidia/nemotron-3-super:free`).
The language firewall rejects any AI-introduced number; deterministic fallback
templates keep every report complete without the provider. Cost $0 (free tier).

**Investor PDF** (`executive-pdf.ts`) — dependency-free PDF 1.4 writer:
cover page with logo, table of contents, serif headings, data tables, vector
area/bar/gauge charts, page numbers, white-label pass (Commander), 30-day
retention (in-memory or `AI_EXECUTIVE_PDF_DIR`).

**Frontend** — new AI Growth Command tab structure (Store Coach coming soon ·
AI Executive with NEW badge · Insights Hub coming soon) with the CEO dashboard
(9 sections) and 8 deep-linkable sub-pages, extracted into dedicated files
(`executive.tsx`, `executive-*.tsx`, `executive-charts.tsx`,
`executive.css`, `executive-model.ts`, `executive-api.ts`). Hash routing
(`#/ai-growth-command/executive/…`) supports refresh and back/forward.

## Rules honored

- **Zero fake data** — no demo numbers, no hard-coded dynamic values; missing
  metrics render as honest "not measurable" states; trial users see clearly
  labeled SAMPLE previews.
- **Plan gating** — server-side 402 `UPGRADE_REQUIRED` with upgrade context;
  usage meters warn at 80%, block at 100%; every upgrade CTA reads
  "Upgrade Plan" and never names a plan.
- **Chart vocabulary** — area/gradient, radial gauge, sparkline, stacked bar,
  waterfall, horizontal bar, bubble map, bullet, percentile bar, heatmap.
  No line charts, no donut charts. All theme-adaptive (dark + light) with
  hover tooltips.
- **No other module touched** — changes are limited to the executive module,
  its wiring points (`app.ts`, `main.ts`, `web-app.ts` API prefix, `plans.ts`
  entitlement keys, `entitlements.ts` error union), and the AI Growth Command
  nav entry.

## Tests

9 new test files, 67 new tests (156 files / 1,517 tests total, all passing):
engine math, benchmark positions, grounded-AI firewall behavior, PDF validity
and white-label, repository lifecycles (decision review, risk reconciliation,
milestone clock, due-store selection), endpoint contracts (402 gating, 429
rate limits, async PDF jobs, full generation flows), email builder/delivery,
client formatters, chart rendering, and upgrade-CTA wording.

## Environment variables (see `.env.example`)

```
STORE_COACH_API_KEY=sk-or-v1-…            (shared with Store Coach, PR #48)
AI_EXECUTIVE_ENABLED=true
AI_EXECUTIVE_MODEL_PRIMARY=nvidia/nemotron-3-ultra:free
AI_EXECUTIVE_MODEL_FALLBACK=nvidia/nemotron-3-super:free
AI_EXECUTIVE_RATE_LIMIT_PER_STORE=20
AI_EXECUTIVE_DAILY_BUDGET_USD=0
AI_EXECUTIVE_PDF_ENABLED=true
AI_EXECUTIVE_PDF_DIR=
AI_EXECUTIVE_BENCHMARK_MODE=hybrid
```

## Docs

`docs/AI_EXECUTIVE.md` — feature overview, plan matrix, architecture, report
generation flow, benchmark methodology, PDF setup, and troubleshooting.
README gains an AI Executive section.

## Verification

- `pnpm typecheck` — clean across all 20 workspace projects
- `pnpm test` — 156 files / 1,517 tests passing (no regressions)
- Manual: open `#/ai-growth-command/executive` in the web app; dashboard,
  reports, benchmarks, scenarios, health, opportunities, decisions, risks,
  roadmaps, and settings render in both dark and light themes with skeletons,
  educational empty states, and distinct error states.
