# Store Coach — AI Growth Command (PR #48)

Store Coach is the first section of **AI Growth Command**, ProfitPilot's new
merchant-facing AI advisor module. It replaces the Campaigns page in
prominence and turns real, synced Shopify data into a daily coaching routine:

- **Daily huddles** — a short briefing generated from yesterday's real revenue,
  orders, AOV, and customer rows (never invented numbers).
- **Priorities** — up to 5 actions per day (plan-capped), each carrying a real
  impact value taken from the store's own data.
- **Goals** — weekly/monthly/quarterly goals with live progress measured from
  synced analytics rows, feasibility ratings, and pace analysis.
- **Achievements** — a 50-badge catalog (streaks, revenue milestones, growth,
  engagement, special) awarded only for events that actually happened.
- **Progress dashboard** — 30-day area chart with previous-period comparison,
  big number cards with sparklines, and a GitHub-style activity heatmap.
- **Chat** — SSE-streamed conversations grounded in store evidence with a
  language firewall that rejects hallucinated statistics.
- **Weekly reviews** — Sunday digest (Brevo SMTP) with a Commander-only PDF.

The two future sections, **Executive Briefing** (PR #49) and **Insights Hub**
(PR #50), plug into the same `/ai-growth-command` tab bar as "Coming Soon"
placeholders. The page architecture — tabs, sub-routes, plan-aware layout —
was designed for them from day one.

## Routes

| Path | Purpose |
| --- | --- |
| `/ai-growth-command` | AI Growth Command (defaults to Store Coach) |
| `/ai-growth-command/coach` | Store Coach main view |
| `/ai-growth-command/coach/goals` | Goals sub-view |
| `/ai-growth-command/coach/progress` | Progress sub-view |
| `/ai-growth-command/coach/chat` | Chat sub-view |
| `/ai-growth-command/coach/achievements` | Achievements sub-view |
| `/ai-growth-command/coach/settings` | Preferences sub-view |
| `/ai-growth-command/briefing` | Executive Briefing (Coming Soon) |
| `/ai-growth-command/insights` | Insights Hub (Coming Soon) |

All routes preserve the Shopify `storeId`/`shop` query string and support
browser back/forward.

## API

All endpoints live under `/store-coach/*` and follow the standard envelope
`{ ok, data, requestId }`. They enforce plan limits, and return
`402 UPGRADE_REQUIRED` with `{ currentPlan, requiredPlan, feature }` context
when a feature is not included in the merchant's plan.

- Huddle: `GET /huddle/today`, `GET /huddle/history?days=`, `POST /huddle/:id/viewed`, `POST /huddle/generate`
- Priorities: `GET /priorities/today`, `POST /priorities/:id/complete`, `POST /priorities/:id/dismiss`, `POST /priorities/generate`
- Goals: `GET/POST /goals`, `PATCH/DELETE /goals/:id`, `GET /goals/suggestions`, `POST /goals/:id/accept-suggestion`, `GET /goals/:id/progress`
- Achievements: `GET /achievements`, `GET /achievements/available`, `GET /streak`
- Progress: `GET /progress/summary`, `GET /progress/trends`, `GET /progress/heatmap`, `GET /progress/comparisons`
- Chat: `POST /chat` (SSE), `GET /chat/history`, `POST /chat/clear`, `GET /chat/suggestions`
- Review: `GET /review/current`, `GET /review/history`, `POST /review/generate`, `GET /review/:id/pdf` (Commander), `POST /review/:id/email`
- Preferences: `GET/PATCH /preferences` · `GET /health-score`
- Onboarding: `GET /onboarding/status`, `POST /onboarding/complete-step`, `POST /onboarding/skip`
- Usage: `GET /usage`, `GET /cost-summary`

## Plan matrix

| Feature | Trial | Start | Growth | Commander |
| --- | --- | --- | --- | --- |
| Daily huddle | 7:00 AM fixed | ✅ custom time | ✅ | ✅ |
| Priorities/day | 2 | 3 | 5 | Unlimited |
| Active goals | 1 | 2 | 5 | Unlimited |
| Badges visible | 5 | 15 | 30 | 50 |
| Progress history | 7 days | 30 days | 90 days | Unlimited |
| Chat messages/day | 5 | 20 | 100 | Unlimited |
| Voice | ❌ | ❌ | ✅ | ✅ |
| Weekly PDF | ❌ | ❌ | ❌ | ✅ |
| Personalities | Professional | + Motivational | All 4 | All 4 |
| Languages | English | English | + Hindi | + Hindi |
| Widget | ❌ | ✅ | ✅ | ✅ |

Trial expiry is absolute: once the 14-day trial ends, every Store Coach
endpoint returns 402 until the merchant upgrades. All upgrade CTAs say
**"Upgrade Plan"** and route to the billing page — never plan names.

## AI provider

- Provider: OpenRouter
- Primary model: `nvidia/nemotron-3-ultra:free`
- Fallback: `nvidia/nemotron-3-super:free`
- Key: `STORE_COACH_API_KEY` (shared with PR #49 AI Executive)
- Rate limit: 30 requests/minute per store
- Daily budget: $0 (free tier)

Generation results pass the **grounded-number firewall** before they are
persisted or streamed: every numeric token must appear in the store's own
evidence set (zero is always allowed for honest "nothing yet" statements),
standard round percentages are allowed for relative framing, and PII /
prompt-injection patterns are rejected. Responses that fail validation throw
`VALIDATION_ERROR` (502) and are never shown to the merchant.

## Background jobs

`StoreCoachScheduler` (API process, hourly interval):

1. Generates the daily huddle at each store's preferred huddle time in the
   merchant's own timezone.
2. On Sunday at 20:00 merchant-local time, generates the weekly review and
   emails the digest when a verified merchant email exists and
   `weekly_email_enabled` is set.
3. Hourly badge/health-score sweep (best effort; badges also award on direct
   activity like viewing a huddle or completing a priority).

## Database

Migration `0021_store_coach.sql` creates eleven tenant-isolated tables
(RLS via `app.store_id`): `store_coach_huddles`, `store_coach_priorities`,
`store_coach_goals`, `store_coach_achievements`, `store_coach_conversations`,
`store_coach_preferences`, `store_coach_health_scores`, `store_coach_reports`,
`store_coach_streaks`, plus `store_coach_onboarding` and
`store_coach_usage_daily` which back the onboarding and usage endpoints.

## Badge catalog

50 badges across five categories — Streaks (10), Revenue (8), Growth (10),
Engagement (12), Special (10) — with rarities COMMON → UNCOMMON → RARE →
EPIC → LEGENDARY. Each badge's condition is a deterministic expression
evaluated against `BadgeSignals` computed from real rows (see
`packages/ai/src/store-coach.ts`).

## Voice

Voice output uses the browser **Web Speech API** (`speechSynthesis`) for
huddle and chat replies; voice input uses `webkitSpeechRecognition` where
available. Both are gated to Growth+. The `STORE_COACH_VOICE_ENABLED` flag
controls the server-side capability.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Store Coach AI is not configured` (503) | `STORE_COACH_API_KEY` missing | Set the key (see `.env.example`) |
| `402 PAYMENT_REQUIRED` everywhere | Trial expired or feature above plan | Upgrade in Billing; error carries required plan |
| `429 RATE_LIMITED` on chat | 30 req/min per-store ceiling | Wait 60s; the ceiling protects the free tier |
| `VALIDATION_ERROR … unsupported number` (502) | Model hallucinated a statistic | Logged server-side; regenerate (the firewall is working) |
| Empty heatmap / zero metrics | Orders have not synced | Sync orders — Store Coach never fabricates rows |

## Reserved keys (future PRs)

- PR #49 AI Executive reuses the same key as `STORE_COACH_API_KEY`.
- PR #50 Insights Hub and PR #51 AI Command use their own dedicated OpenRouter
  keys; those are configured in their PRs, not here.
