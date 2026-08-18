# 🔍 AI Command Center — Complete Investigation Report

**Repo:** `Anaskassar786/ProfitPilot-Ai` · **Branch:** `arena/01a00fb5-profitpilot-ai` (from `main@cccbd48`)
**Date:** 2026-08-17
**Scope:** Everything the "AI Command Center" module touches — frontend, API, AI package, rules engine, billing gates, database, config.

> **TL;DR** — The AI Command Center page is a ~10-line inline component inside `App.tsx` that renders a hard-coded list of 7 agent names against a status array from `GET /ai/agents`. There is **no interactivity** (no card clicks, no working 3-dot menu, no detail view, no routes). The real AI machinery (rules engine, OpenRouter provider, cost meter, evidence packs) lives in `packages/ai` and is genuinely well-architected, but it is **starved of data** (4 of 8 rules can never fire), **2 of 7 agents have no rules mapped to them at all**, and the cost/calibration ledgers are **in-memory stubs** while their Postgres tables sit unused. Details and receipts below.

---

## SECTION 1: File Structure Audit

### 1.1 / 1.2 — All files related to the AI Command Center

#### Frontend (`apps/web/src/`)

| File | LOC | Purpose |
|---|---|---|
| `App.tsx` | 843 | Monolithic SPA. Contains `CommandCenterPage` **inline** (lines 642–649), the hard-coded `agents` array (lines 165–173), nav entry (line 125), page meta (line 152), and the `PageRouter` switch (line 534). |
| `model.ts` | 149 | Frontend types. `SectionId` includes `'command-center'` (line 8); `AgentStatus` type (line 29). |
| `api.ts` | 395 | API client. `fetchAgentStatuses()` (lines 257–258) → `GET /ai/agents`. Also `fetchRecommendations`, `analyzeRecommendations`, `decideRecommendation`. |
| `styles.css` | 734 | All Command Center CSS: `.command-health`, `.agent-grid`, `.agent-card`, `.agent-big-icon`, `.agent-status` (all packed on **line 234**). Responsive overrides lines 259–260. |
| `f4.css` | 27 | Ready-state colors: `.agent-big-icon.green`, `.agent-status.ready`. |
| `final-polish.css` | ~2000 | Light-mode overrides for `.command-health` / `.agent-card` (lines 1907–1935). |
| `main.tsx` | ~30 | Entry point; imports the CSS cascade in a fixed order. |

#### Backend (`apps/api/src/`)

| File | LOC | Purpose |
|---|---|---|
| `ai-routes.ts` | 72 | Express router: `GET /ai/agents`, `GET /recommendations`, `POST /recommendations/analyze`, `POST /recommendations/:id/approve|reject`, `GET /ai/cost`. |
| `f4-bootstrap.ts` | 24 | Wires `OpenRouterClient` + `CostMeter` + `CalibrationLedger` + `PostgresRecommendationRepository` into a `DecisionEngine` from env vars. |
| `store-snapshot.ts` | 70 | `buildStoreSnapshot()` — assembles the `StoreSnapshot` the rules engine consumes from analytics tables + `sync_records`. |
| `app.ts` | ~160 | Mounts the AI router at line 81 (`app.use(createAiRouter(dependencies.ai))`), behind security/auth/CSRF middleware (lines 55–68). |
| `main.ts` | ~60 | Passes `bootstrap.ai` into `createApi` (line 47). |
| `ai-routes.test.ts` | 40 | Route contract tests (status codes, CAS versioning, cost summary). |

#### AI package (`packages/ai/src/`) — the actual brain

| File | LOC | Purpose |
|---|---|---|
| `domain.ts` | 134 | Canonical types: `AGENT_IDS` (7 agents), `RULE_IDS` (8 rules), `StoreSnapshot`, `RuleSignal`, `AgentStatus`, `Recommendation`, `actionRisk()`. |
| `agents.ts` | 25 | `AGENT_PROMPTS` (the 7 system prompts), `agentStatuses()`, `promptFor()` (the shared user-prompt template). |
| `rules.ts` | 67 | **The 8 deterministic rules** + `RuleConfig` thresholds + `runDeterministicRules()`. |
| `engine.ts` | 76 | `DecisionEngine` — orchestrates health → rules → calibration → evidence pack → AI explanation → repository. |
| `provider.ts` | 313 | `OpenRouterClient` — multi-key/multi-model failover, streaming + non-streaming, timeout/retry/telemetry. |
| `cost.ts` | 48 | `CostMeter` — **in-memory** daily per-store cost cap ($5 default), `CostCapExceededError`. |
| `repository.ts` | 71 | `RecommendationRepository` interface + InMemory & Postgres (`ai_recommendations`) implementations. |
| `calibration.ts` | 30 | `CalibrationLedger` — **in-memory** per-agent confidence caps from accept/reject history. |
| `evidence.ts` | 37 | Immutable evidence packs: PII assertion + canonical sha256 hash + verify. |
| `language.ts` | 18 | `validateLanguageResponse()` — rejects AI text containing PII or any number not present in evidence. |
| `context.ts` | 23 | `buildStoreContext()` / `serializeAiContext()` — strips PII, enforces opaque customer keys. |
| `health.ts` | 40 | `calculateStoreHealth()` — deterministic weighted store health score. |
| `executor.ts` | 56 | `ActionExecutor` + `assertPolicy` — idempotent action execution with risk policy (**not wired to any route**). |
| `approval.ts` | 29 | `CompareAndSetApprovals` — in-memory CAS approvals (**not wired**). |
| `attribution.ts` | 51 | `AttributionTracker` — HMAC checkout tokens / discount / time-window matching (partially used via `ai_attribution_events` in `f5-bootstrap.ts:62` for ROI). |
| `tools.ts` | 11 | Action tool adapter map (TAG_CUSTOMER / SEND_EMAIL / CREATE_DISCOUNT) (**not wired**). |
| `index.ts` | 19 | Package exports. |

#### Database & config

| File | LOC | Purpose |
|---|---|---|
| `migrations/0006_ai_loop.sql` | 80 | Tables: `ai_recommendations`, `ai_evidence_packs`, `ai_executions`, `ai_calibration_samples`, `ai_cost_ledger`, `ai_attribution_events` — all with RLS tenant isolation. **Only `ai_recommendations` and `ai_attribution_events` are actually written/read by code.** |
| `.env.example` (lines 17–31) | — | `OPENROUTER_API_KEY_1..3`, `AI_MODEL_PRIMARY/FALLBACK1/FALLBACK2`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_TEMPERATURE`, `AI_MAX_TOKENS`, `AI_DAILY_COST_CAP_USD=5.00`, `AI_INPUT_MICRO_DOLLARS=0`, `AI_OUTPUT_MICRO_DOLLARS=0`. |
| `packages/billing/src/plans.ts` | 19 | `active_agents` entitlement per plan (START 3 / GROWTH 6 / COMMANDER 7). |
| `packages/billing/src/entitlements.ts` | 35 | `TRIAL_LIMITS.active_agents = 2`, `accessGate()`, `UpgradeRequiredError`. |

### 1.3 — Component hierarchy tree

```
main.tsx
└── App (App.tsx, useState-driven; NO router library)
    ├── Sidebar nav ("AI employee" group → id 'command-center')
    └── PageRouter (App.tsx:481)  ← switch on `active` string, not URL
        └── CommandCenterPage (App.tsx:642)          ← INLINE, not exported
            └── PageLayout (shared shell: eyebrow/title/description/actions)
                ├── "Refresh statuses" button        ← actions slot
                ├── <div class="command-health">     ← hero banner (inline JSX)
                │   └── stats: ready/7 · "8 rules" · "$5 budget"  ← hard-coded copy
                └── <div class="agent-grid">
                    └── 7 × <div class="card agent-card">  ← INLINE map, no component
                        ├── agent-big-icon (lucide icon)
                        ├── agent-status pill (READY/UNCONFIGURED/…)
                        ├── <MoreHorizontal/>        ← decorative, NO handler
                        └── agent-card-footer (Read-only + status badge)
```

There is **no shared `AgentCard` component**, no hook, no context — everything is inline JSX inside one function.

---

## SECTION 2: Current Frontend Implementation

### 2.1 — Main page component

- **File:** `apps/web/src/App.tsx`, function `CommandCenterPage`, lines 642–649 (yes, the whole page is ~8 lines of dense JSX).
- **Full component code:**

```tsx
function CommandCenterPage({ agents: statuses, onRefresh, onPhaseGate }: { agents: readonly AgentStatus[]; onRefresh: () => void; onPhaseGate: (phase: string, capability: string) => void }) {
  const ready = statuses.filter((agent) => agent.execution === 'READY').length
  const gated = statuses.length === 0
  return <PageLayout eyebrow="AI employee" title="AI Command Center" description="Seven agents explain deterministic store evidence. They never invent numbers." actions={<button className="button secondary" onClick={onRefresh} disabled={gated}><RefreshCw size={15} /> {gated ? 'Awaiting AI backend' : 'Refresh statuses'}</button>}>
    <div className="command-health">…hero banner: ready/7 agents · "8 deterministic rules" · "$5 daily AI API budget"…</div>
    <div className="agent-grid">{agents.map(([name, Icon]) => { const status = statuses.find((item) => item.label === name); const execution = status?.execution ?? 'UNCONFIGURED'; … return <div className="card agent-card" key={name}>…<MoreHorizontal size={17} className="muted-icon" />…</div> })}</div>
  </PageLayout>
}
```

- **State management:** none locally. All data lives in a single `WorkspaceData` `useState` at the App level (`App.tsx:219`). `loadData()` (App.tsx:250–262) does one `Promise.allSettled` of 5 fetches (`analytics`, `catalog`, **`fetchAgentStatuses()`**, `recommendations`, `inventory`) on mount and on `storeId` change. Agent statuses are passed down as a prop.
- **Props:** `agents: readonly AgentStatus[]`, `onRefresh: () => void`, `onPhaseGate` — **`onPhaseGate` is a dead prop**: it's passed in (App.tsx:534) but never used inside the component.
- **Static data:** the card list comes from a hard-coded const (App.tsx:165):

```ts
const agents = [
  ['Revenue Agent', TrendingUp, 'Read-only'],
  ['Inventory Agent', Box, 'Read-only'],
  ['Customer Agent', Users, 'Read-only'],
  ['Pricing Agent', Tag, 'Read-only'],
  ['Campaign Agent', Send, 'Read-only'],
  ['Product Agent', Package, 'Read-only'],
  ['Executive Agent', Briefcase, 'Read-only'],
] as const
```

Server statuses are joined to this list **by display-label string match** (`statuses.find(item => item.label === name)`) — fragile; a copy change on either side silently breaks the join. The stable `AgentStatus.id` (`REVENUE_AGENT` etc.) is available but unused.

### 2.2 — Agent Card component

- **Inline**, not shared. One `<div className="card agent-card">` per agent inside the `.map()`.
- **onClick handlers:** none. The card is a plain div — not a button, no `role`, no keyboard access.
- **Hover states:** only the generic `.card` CSS hover (background shift). No card-specific interaction affordance.

### 2.3 — Interactive elements audit

| Element | Current behavior |
|---|---|
| **"Refresh statuses" button** | Calls `onRefresh` → App's `loadData()` → re-fetches **all five** workspace datasets (not just agents). Disabled when the statuses array is empty ("Awaiting AI backend"). |
| **3-dot menu (`⋯`)** | `<MoreHorizontal size={17} className="muted-icon" />` — a bare lucide icon. **No onClick, no menu, purely decorative.** |
| **Agent cards** | Not clickable. Nothing happens. |
| **Modals / drawers / detail views** | None for the Command Center. (The Recommendations page has an "Evidence drawer" button, and there's a global command palette + Jarvis orb, but nothing agent-specific.) |
| **Hero stats ("8 rules", "$5 budget")** | Hard-coded strings in JSX, not fetched from `/ai/cost` or config. If the env cap changes, the UI lies. |

### 2.4 — Routing

- **There is no router library at all.** No `react-router`, no URL sync, no hash routing. Navigation is `useState<SectionId>('dashboard')` (App.tsx:185) + `navigate()` (App.tsx:341). `PageRouter` (App.tsx:481) is just a switch on that string.
- Consequently: **no `/ai-command-center/:agentId`**, no nested routes, no deep-linking, and a browser refresh always lands back on Dashboard (only `storeId`/`shop` survive via query params).

---

## SECTION 3: Backend API Endpoints

### 3.1 — Existing endpoints (all in `apps/api/src/ai-routes.ts`, mounted at `app.ts:81`)

| # | Method | Path | Purpose | Request | Response (`{ ok, data, meta }` envelope) | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/ai/agents` | Agent status contracts | — (no params!) | `AgentStatus[]`: `{ id, label, promptVersion, enabled, execution: READY\|UNCONFIGURED\|RUNNING\|PAUSED, languageOnly: true }` | ✅ Working, but **tenant-agnostic & plan-blind** — `engine.statuses()` only reflects whether OpenRouter keys exist. `RUNNING`/`PAUSED` are never actually produced (statuses are computed, never stateful). |
| 2 | GET | `/recommendations?storeId=` | List a store's recommendations | query `storeId` (required) | `Recommendation[]` from `ai_recommendations` | ✅ Working |
| 3 | POST | `/recommendations/analyze?storeId=` | Build snapshot → run rules → AI explanations → persist | query/body `storeId` | `DecisionRun`: `{ storeId, health, recommendations[], generatedAt }` | ⚠️ Working-but-flawed (see 10.x: duplicates on re-run, sequential AI calls, starved rules) |
| 4 | POST | `/recommendations/:id/approve` | CAS approve | body `{ expectedVersion: number }` | updated `Recommendation` | ✅ Working (409 on stale version) |
| 5 | POST | `/recommendations/:id/reject` | CAS reject | body `{ expectedVersion: number }` | updated `Recommendation` | ✅ Working |
| 6 | GET | `/ai/cost?storeId=` | Daily AI spend summary | query `storeId` | `{ storeId, day, microDollars, capMicroDollars, remainingMicroDollars, calls }` | ⚠️ Working but **in-memory** (resets on deploy; not multi-instance safe) and **the frontend never calls it** |

Middleware in front of all of these (app.ts:55–68): security headers → CORS → rate limiting (120 req/min default) → JSON body limit 100kb → launch controls → tenant input guard → authentication → tenant context → CSRF.

### 3.2 — Missing endpoints a real Command Center needs

1. `GET /ai/agents?storeId=` — tenant + **plan-aware** statuses (which agents this store's plan unlocks; per-agent enabled toggle state).
2. `POST /ai/agents/:agentId/run?storeId=` — run a single agent on demand (currently only all-rules-at-once via `/recommendations/analyze`).
3. `PATCH /ai/agents/:agentId` — pause/resume an agent (the `PAUSED` status exists in the type system but nothing can set it).
4. `GET /ai/agents/:agentId/activity?storeId=` — recent recommendations/runs/outcomes per agent (data exists in `ai_recommendations.agent`, just needs a filtered query).
5. `GET /ai/cost/breakdown?storeId=` — per-agent/per-model cost (needs `ai_cost_ledger` to actually be written, see 6.2).
6. `GET /ai/health?storeId=` — `calculateStoreHealth()` is computed inside `run()` but never exposed standalone; the hero banner should show it.
7. `GET /ai/rules` — rule catalog + thresholds (so "8 deterministic rules" copy is data, not string literals) and ideally `PATCH` for per-store `RuleConfig` overrides (the engine already accepts `Partial<RuleConfig>` — it's just never passed).
8. Streaming (SSE) run progress — `OpenRouterClient.generateStream` already exists and is used by Jarvis (F8), but not by the decision engine.

---

## SECTION 4: The 7 AI Agents — Deep Dive

**Architecture fact first:** the "agents" are **not** separate processes/classes. Each agent is (a) a system-prompt string in `AGENT_PROMPTS`, plus (b) a routing tag on rule signals (`RuleSignal.agent`). One shared template `promptFor()` (`packages/ai/src/agents.ts:19–24`) builds every user prompt:

```
System: <agent.system> Prompt version: <agent.version>

User:
Decision title: <signal.title>
Reason: <signal.reason>
Impact from deterministic rules: <impactValue> <currency>
Evidence:
<label>: <value> [source: <source>]   (one line per evidence field)
Store currency: <snapshot.currency>
Request: explain this decision in plain language without adding numbers.
```

All agents share: **input** = `RuleSignal` + `StoreSnapshot` currency; **output** = plain text, post-validated by `validateLanguageResponse()` (must contain no PII patterns and no number that isn't in the evidence/impact set), stored as `Recommendation.explanation` with `explanationStatus ∈ {AI_GENERATED, AI_UNAVAILABLE, AI_REJECTED}`. All logic lives in `packages/ai/src/agents.ts` + `engine.ts`.

| Agent | System prompt (verbatim, v1.0.0) | Rules feeding it | Data sources | Status |
|---|---|---|---|---|
| **Revenue Agent** (`REVENUE_AGENT`) | "Explain revenue and sales signals using only the supplied evidence. Never calculate or invent numbers." | **NONE — no rule maps to it.** | (would be `analytics revenue/orders` momentum) | 🔴 **Stub in practice.** Status card shows READY but it can never produce a recommendation. |
| **Inventory Agent** (`INVENTORY_AGENT`) | "Explain inventory signals using only the supplied evidence. Never invent stock, velocity, or dates." | `STOCKOUT_RISK`, `DEAD_STOCK` | `products` catalog payload: `inventory_quantity` (real from Shopify), `averageDailyUnits`/`unitsSold120d`/`daysSinceLastSale` (⚠️ never populated by sync — see Sec. 10) | 🟡 Partial — DEAD_STOCK can fire (and over-fires); STOCKOUT_RISK effectively never fires. |
| **Customer Agent** (`CUSTOMER_AGENT`) | "Explain customer segments without names, emails, phones, or direct identifiers. Use only supplied evidence." | `CHURN_RISK`, `REPEAT_PURCHASE` | `sync_records(module='customers')` → `total_spent`, `orders_count`, `last_order_at` | 🟢 Closest to fully working (real Shopify fields). |
| **Pricing Agent** (`PRICING_AGENT`) | "Explain margin-aware pricing opportunities without introducing a number not present in evidence." | `PRICING_UPLIFT` | needs `unitCost` + `averageDailyUnits` (⚠️ both always null/0 from snapshot builder) | 🔴 Rule can never fire → agent is decorative. |
| **Campaign Agent** (`CAMPAIGN_AGENT`) | "Write concise, compliant campaign language. Do not send messages or invent performance claims." | `CART_ABANDONMENT`, `NEW_CUSTOMER_WELCOME` | `sync_records(module='checkouts')` → `total_price`, `created_at`, `completed_at`; customers | 🟢 Workable if checkouts sync. |
| **Product Agent** (`PRODUCT_AGENT`) | "Explain catalog and cross-sell signals from evidence only. Do not alter product data." | `CROSS_SELL` | `snapshot.productPairs` — ⚠️ **hard-coded `[]`** in `store-snapshot.ts:37` | 🔴 Rule can never fire. |
| **Executive Agent** (`EXECUTIVE_AGENT`) | "Summarize the supplied store evidence for a merchant. Keep every number grounded." | **NONE — no rule maps to it.** | (would be `calculateStoreHealth()` output — computed but never routed to this agent) | 🔴 Stub in practice. |

**File paths:** prompts `packages/ai/src/agents.ts`; rule→agent mapping `packages/ai/src/rules.ts`; orchestration `packages/ai/src/engine.ts` (`DecisionEngine.run` → `fromSignal`); snapshot assembly `apps/api/src/store-snapshot.ts`.

**Current honest scorecard: 2 agents workable, 1 partial, 4 effectively decorative.**

---

## SECTION 5: The 8 Deterministic Rules

**Location:** `packages/ai/src/rules.ts` (67 LOC). Rule IDs declared in `domain.ts` (`RULE_IDS`). Version constant `RULE_VERSION = '1.0.0'`.

### 5.1 — Rule catalog

Defaults: `{ stockoutDays: 7, deadStockDays: 120, highLtvThreshold: 250, churnDays: 75, repeatPurchaseDays: 45, cartRecoveryRate: .11, crossSellRate: .08, welcomeDays: 7, minimumMargin: .55 }`

| Rule | Purpose | Trigger condition (inputs) | Impact formula | Confidence | Action | Agent | Can it fire today? |
|---|---|---|---|---|---|---|---|
| `STOCKOUT_RISK` | Reorder before sell-out | `averageDailyUnits > 0 && inventory/velocity ≤ 7d` | `(7 − daysOfCover) × dailyUnits × price` ("revenue at risk") | .90 | CREATE_RECOMMENDATION | Inventory | ❌ `averageDailyUnits` always 0 |
| `DEAD_STOCK` | Unlock trapped cash | `unitsSold120d === 0 && daysSinceLastSale ≥ 120` | `inventoryUnits × unitPrice` | .86 | CREATE_RECOMMENDATION | Inventory | ⚠️ Over-fires: both fields default to 0/null→120 for every synced product |
| `CHURN_RISK` | Win back high-LTV customer | `LTV ≥ 250 && daysSinceLastOrder ≥ 75` | `lifetimeValue` (LTV at risk) | .88 | SEND_EMAIL | Customer | ✅ |
| `PRICING_UPLIFT` | Margin-safe price test | `unitCost ≠ null && margin ≥ 55% && velocity > 0` | `dailyUnits × 30 × price × 5%` | .64 | CREATE_RECOMMENDATION | Pricing | ❌ `unitCost` always null |
| `REPEAT_PURCHASE` | Reorder nudge | `orderCount > 1 && daysSinceLastOrder ≥ 45` | `LTV / orderCount` (modeled next order) | .70 | SEND_EMAIL | Customer | ✅ |
| `CART_ABANDONMENT` | Recover checkout | `!recovered && 1h ≤ age ≤ 48h` | `total × 11%` (expected recovery) | .72 | SEND_EMAIL | Campaign | ✅ (needs checkouts sync) |
| `CROSS_SELL` | Bundle co-purchased products | `coPurchaseRate ≥ 8%` | `relatedPrice × coPurchaseRate` | .67 | CREATE_RECOMMENDATION | Product | ❌ `productPairs` hard-coded `[]` |
| `NEW_CUSTOMER_WELCOME` | Welcome first order | `orderCount === 1 && daysSinceLastOrder ≤ 7` | `lifetimeValue` (first-order value) | .80 | SEND_EMAIL | Campaign | ✅ |

**Output format** — every rule emits a `RuleSignal` (domain.ts): `{ ruleId, ruleVersion, agent, title, reason, impactValue, impactLabel, currency, confidence, actionType, actionRisk, evidence[{key,label,value,source}], entityKey }`. Signals are sorted by `impactValue` desc.

### 5.2 — Rule engine invocation flow

```
POST /recommendations/analyze
 → ai-routes.ts: dependencies.snapshot(storeId)        // buildStoreSnapshot (store-snapshot.ts)
 → DecisionEngine.run(snapshot)                        // engine.ts:42
    ├─ calculateStoreHealth(snapshot)                  // health.ts (never surfaced in UI)
    ├─ runDeterministicRules(snapshot)                 // rules.ts:10 — pure function, DEFAULTS only
    └─ for each signal (sequentially):
        ├─ CalibrationLedger.calibrate(agent, conf)    // caps confidence at .75 until 10 outcomes
        ├─ buildEvidencePack(...)                      // evidence.ts — PII assert + sha256
        ├─ promptFor(signal, snapshot)                 // agents.ts
        ├─ OpenRouterClient.generate(system, user)     // provider.ts (skipped if no keys)
        ├─ validateLanguageResponse(text, evidence)    // language.ts — number/PII firewall
        ├─ CostMeter.record(...)                       // cost.ts — throws at $5/day cap
        └─ repository.put(recommendation)              // ai_recommendations (ON CONFLICT DO NOTHING)
```

Notes: `runDeterministicRules` accepts a `Partial<RuleConfig>` override — **no caller ever passes one** (no per-store tuning). AI failure at any signal degrades gracefully to `explanationStatus: 'AI_UNAVAILABLE'` — the deterministic recommendation still persists. This "AI never supplies the numbers" invariant is real and enforced.

---

## SECTION 6: AI Infrastructure

### 6.1 — Provider

- **Provider:** OpenRouter (`https://openrouter.ai/api/v1/chat/completions`), `packages/ai/src/provider.ts`.
- **Models** (env, with hard-coded defaults in `provider.ts:3`):
  - `AI_MODEL_PRIMARY=nvidia/nemotron-nano-9b-v2:free`
  - `AI_MODEL_FALLBACK1=google/gemma-4-26b-a4b-it:free` ⚠️ *this model ID looks fabricated — no "Gemma 4 26B a4b" exists on OpenRouter; verify all three IDs against `GET /models` or fallback rotation will silently churn.*
  - `AI_MODEL_FALLBACK2=nvidia/nemotron-3.5-lightning:free` ⚠️ *same concern.*
- **Failover:** iterates model × key matrix (up to 3 keys × 3 models), retries retryable failures with backoff, structured failure telemetry (`onFailure`), 25s timeout, temp 0.3, max 2000 tokens. This part is production-grade.
- **API keys:** env vars `OPENROUTER_API_KEY_1/2/3` (`OPENROUTER_API_KEY` accepted as fallback), read only in `apps/api/src/f4-bootstrap.ts`. Never persisted, never sent to the client. `provider.configured` (= any key present) is what flips agent cards from UNCONFIGURED → READY.

### 6.2 — Cost & budget — ⚠️ the $5 budget is largely theater right now

- **Tracking:** `CostMeter` (`packages/ai/src/cost.ts`), cap from `AI_DAILY_COST_CAP_USD` (default 5) in micro-dollars, keyed per store per UTC day. When a `record()` would exceed the cap it throws `CostCapExceededError` (HTTP 429 semantics) → engine degrades to `AI_UNAVAILABLE`.
- **Three problems:**
  1. **In-memory only.** Entries live in a process array. Every deploy/restart resets the day's spend to $0; multiple API instances each get their own $5. The `ai_cost_ledger` Postgres table (migration 0006) exists **and nothing writes to it** (verified: zero references outside the migration).
  2. **Rates default to zero.** `AI_INPUT_MICRO_DOLLARS=0` / `AI_OUTPUT_MICRO_DOLLARS=0` → every call records $0 → **the cap can mathematically never trip** with default config (consistent with `:free` models, but it means the meter is untested against reality).
  3. **No per-agent breakdown.** `CostEntry` has `model` but not `agent`; `GET /ai/cost` returns only a daily total, and the frontend never calls even that. The "$5 daily AI API budget" stat on the page is a hard-coded string.

### 6.3 — Rate limiting

- **Global HTTP layer only:** `EndpointRateLimiter` (`apps/api/src/security.ts:42`) — default **120 req/min per identity per endpoint** (env `RATE_LIMIT_DEFAULT`, `RATE_LIMIT_WINDOW_MS`), with `X-RateLimit-*` headers. Applied to all routes incl. AI (app.ts:58).
- **Per-store AI throttle:** only the cost cap (see above). **No per-agent, no per-user AI-specific limits.** The action executor has a per-store daily action cap (`assertPolicy`, executor.ts) but it's unwired.

### 6.4 — Caching

- **AI responses are not cached at all.** `packages/cache` ships a solid `TenantVersionedCache` (InMemory + Upstash Redis backends, TTL validation, tenant-versioned invalidation) — and the AI path never imports it. Identical signals re-analyzed = identical prompts re-billed. No cache key strategy, no TTL, no invalidation triggers exist for AI. (This is a gap, not a bug — but an expensive one once models aren't `:free`.)

---

## SECTION 7: Design System Currently Used

| # | Question | Answer |
|---|---|---|
| 7.1 | UI library | **None / fully custom.** No shadcn, Radix, MUI, or Chakra. Plain JSX + a tiny internal `@profitpilot/ui` package (just `tokens.ts` + `buttonClass()` helper). |
| 7.2 | Styling | **Hand-written plain CSS** files imported globally in a fixed cascade order (`main.tsx`): `styles.css` → `f4.css` → … → `upgrade-overrides.css` → `final-polish.css`. No Tailwind, no CSS Modules, no CSS-in-JS. Later files override earlier ones by specificity — fragile. |
| 7.3 | Theme | Dark-first via CSS custom properties in `:root` (`apps/web/src/styles.css:1`); light mode via `.app-shell.light-mode` override blocks (styles.css:563+, final-polish.css:1907+). Shared tokens duplicated in `packages/ui/src/tokens.ts`. |
| 7.4 | Command Center palette | Background `#0F1117`, card `#1A1D27`, border `#2A2E38`; text `#F9FAFB` / `#9CA3AF` / `#6B7280`. Accent semantics: **purple `#9B7CF6`** = AI/gated, **green `#10B981`** = READY, blue `#3B82F6`, amber `#F59E0B`, red `#EF4444`. Hero banner uses purple radial gradients `rgba(107,80,213,.16)` over `rgba(36,29,72,.62)`. |
| 7.5 | Typography | Inter (sans) + system mono stack. A token scale exists (`--text-2xs:11px` … in styles.css) **but the Command Center ignores it**: agent card body text is **8px**, headings **10px**, hero stats labels **8px** — far below accessible minimums. |
| 7.6 | Icons | `lucide-react` ^0.468 exclusively (Bot, TrendingUp, Box, Users, Tag, Send, Package, Briefcase, MoreHorizontal, LockKeyhole, RefreshCw…). Charts: `recharts` ^3.10 (unused on this page). |

---

## SECTION 8: Plans & Permissions

### 8.1 — Entitlements (`packages/billing/src/plans.ts` + `entitlements.ts`)

The entitlement key is `active_agents` (a **count**, not a named-agent list — there is no mapping of *which* agents belong to which tier):

| Plan | `active_agents` | `ai_recommendations_month` | Notes |
|---|---|---|---|
| **Trial** | **2** | 10 | `TRIAL_LIMITS` in entitlements.ts:11 |
| **START** ($49/mo) | **3** | 30 | plans.ts:12 |
| **GROWTH** ($149/mo) | **6** | 150 | plans.ts:13, "AI agents and recommendations" is a listed feature |
| **COMMANDER** ($349/mo) | **7** | unlimited | plans.ts:14 / `UNLIMITED` map |

### 8.2 — Locked states: **not implemented in the Command Center at all**

- `GET /ai/agents` → `engine.statuses()` is called **with no plan context** (ai-routes.ts:14). The `agentStatuses(aiConfigured, enabledAgents)` helper *supports* an enabled subset (→ `PAUSED` status) but the router never passes one.
- The UI renders all 7 cards identically regardless of plan. A Trial store (2 agents) sees 7 "READY" cards. The `LockKeyhole` icon on every card means "read-only AI", not "plan-locked".
- Enforcement machinery exists elsewhere (`accessGate` / `assertAccess` / `UpgradeRequiredError`, wired for other features via `f5-bootstrap.ts` usage meters) — the AI routes simply don't call it.

### 8.3 — Upgrade CTA

- Global only: `UpgradePlanButton.tsx` ("Upgrade Plan" pill in the topbar; hidden for Commander). Billing page has full plan cards. **The Command Center page has zero upgrade affordances** — no locked-card CTA, no "unlock 5 more agents" messaging. This is the single cheapest revenue-relevant improvement available.

---

## SECTION 9: Data Flow Diagram

### 9a — What actually happens today when a user clicks an agent card

```
User clicks agent card
    ↓
NOTHING. (plain <div>, no handler, no route, no drawer)
```

### 9b — The real end-to-end AI flow (triggered from the *Recommendations* page, not the Command Center)

```
User clicks "Generate recommendations"  (RecommendationsPage.analyze, App.tsx:652)
    ↓
analyzeRecommendations(storeId)                          apps/web/src/api.ts
    ↓  POST /recommendations/analyze?storeId=…  (CSRF token + credentials)
Express middleware chain                                  apps/api/src/app.ts:55–68
  security headers → CORS → rate limit (120/min) → JSON(100kb)
  → launch controls → tenantInputGuard → authenticationMiddleware
  → tenantContextMiddleware → csrfMiddleware
    ↓
createAiRouter POST handler                               apps/api/src/ai-routes.ts:25
    ↓
buildStoreSnapshot(storeId, analytics, database)          apps/api/src/store-snapshot.ts:7
  ← analytics.read()/readCatalog()  (revenue/orders/product metrics, catalog payloads)
  ← SELECT payload FROM sync_records WHERE module IN ('customers','checkouts')
  ⚠ productPairs: [], averageDailyUnits/unitCost: not derivable → 0/null
    ↓
DecisionEngine.run(snapshot)                              packages/ai/src/engine.ts:42
  ├─ calculateStoreHealth(snapshot)                       packages/ai/src/health.ts
  ├─ runDeterministicRules(snapshot)                      packages/ai/src/rules.ts:10
  └─ per signal (SEQUENTIAL loop):
      ├─ CalibrationLedger.calibrate(agent, confidence)   calibration.ts
      ├─ buildEvidencePack(fields) → sha256               evidence.ts (assertPiiMinimized)
      ├─ promptFor(signal, snapshot)                      agents.ts:19
      │    system: "<agent system prompt> Prompt version: 1.0.0"
      │    user:   title/reason/impact/evidence lines/currency + "explain… without adding numbers"
      ├─ OpenRouterClient.generate(system, user)          provider.ts:96
      │    → POST openrouter.ai/…/chat/completions (model×key failover, 25s timeout)
      │    ← { text, model, usage{promptTokens, completionTokens} }
      ├─ validateLanguageResponse(text, evidence, impact) language.ts
      │    rejects PII patterns & any number ∉ {impact, evidence values} → AI_REJECTED
      ├─ CostMeter.record(tokens × micro$ rates)          cost.ts (throws at cap → AI_UNAVAILABLE)
      └─ PostgresRecommendationRepository.put()           repository.ts:46
           INSERT INTO ai_recommendations … ON CONFLICT (id) DO NOTHING   (RLS: app.store_id)
    ↓
200 { ok: true, data: DecisionRun{ storeId, health, recommendations[], generatedAt } }
    ↓
Frontend: toast "Generated N recommendations…" → onRefresh() → loadData()
    ↓  GET /recommendations?storeId → list → RecommendationsPage cards
Displayed in: Recommendations page (agent pill, confidence pill, rule id, impact,
              explanation snippet, Approve/Reject with expectedVersion CAS)
Command Center page: only re-renders the same 7 status cards. Health score: computed, DISCARDED by UI.
```

### 9c — Status flow feeding the Command Center

```
App mount / storeId change / "Refresh statuses"
  → loadData() (App.tsx:250) → fetchAgentStatuses() (api.ts:257)
  → GET /ai/agents → engine.statuses() → agentStatuses(provider.configured)
  → 7 × { id, label, promptVersion:'1.0.0', enabled:true, execution: READY|UNCONFIGURED }
  → joined to hard-coded card list BY LABEL STRING → cards colored green/purple
```

---

## SECTION 10: Known Issues & Gaps

### 10.1 — Broken right now

1. **Revenue Agent & Executive Agent generate nothing, ever** — no rule in `rules.ts` maps to `REVENUE_AGENT` or `EXECUTIVE_AGENT` (grep the `signal(...)` calls: 8 rules → 5 agents). Their READY cards are false advertising.
2. **Rule starvation from the snapshot builder** (`store-snapshot.ts`): `averageDailyUnits`, `unitCost`, `unitsSold120d`, `daysSinceLastSale` are read from Shopify product payload keys **that Shopify never sends**, and `productPairs` is hard-coded `[]`. Net effect: `STOCKOUT_RISK`, `PRICING_UPLIFT`, `CROSS_SELL` can never fire, and `DEAD_STOCK` fires for essentially *every* product (0 units-sold default + null→120-day default) — noisy and wrong in both directions. The repo has real velocity code (`apps/api/src/inventory-velocity.ts`, `analytics product_sales` metrics) that simply isn't plugged in here.
3. **Duplicate recommendations on every re-run**: `DecisionEngine.run` creates fresh `randomUUID()` ids; `put()` is `ON CONFLICT (id) DO NOTHING` — so a second "Generate" for the same store duplicates every still-true signal. No dedupe on `(storeId, ruleId, entityKey, status='PENDING')`.
4. **Label-string join in the UI** (`statuses.find(item => item.label === name)`) — rename either side and cards silently fall back to UNCONFIGURED.

### 10.2 — Stubbed / placeholder

- 3-dot menu icon (no menu), non-clickable cards, dead `onPhaseGate` prop, hard-coded "8 deterministic rules" and "$5 daily AI API budget" hero stats.
- `execution: 'RUNNING' | 'PAUSED'` states exist in types but no code path ever produces them.
- Unwired backend machinery: `ActionExecutor`/`assertPolicy`, `CompareAndSetApprovals`, `createActionTools` (TAG_CUSTOMER/SEND_EMAIL/CREATE_DISCOUNT) — fully tested classes with no routes.
- Unused DB tables from migration 0006: `ai_evidence_packs` (packs are only embedded in the recommendation payload JSON), `ai_executions`, `ai_calibration_samples`, `ai_cost_ledger`.
- `CalibrationLedger` is in-memory: approve/reject decisions **never feed back** into it (nothing calls `record()` from the decide route), so the .75 confidence cap never learns.

### 10.3 — Missing for production readiness

- Durable cost ledger (write/read `ai_cost_ledger`) + real per-token rates, per-agent attribution of spend.
- Plan gating on `/ai/agents` + locked-card UI + upgrade CTA (Sec. 8).
- Per-store rule threshold config (engine supports it; no storage/route/UI).
- URL routing/deep links; agent detail view; run history.
- Observability: no metrics on AI success/reject/unavailable rates per agent (telemetry hook exists in provider only).
- Verification of the three OpenRouter model IDs (two look nonexistent — 6.1).

### 10.4 — Performance concerns

- `engine.run` is a **sequential** loop: one AI round-trip per signal at up to 25s timeout each. A store with 200 churn-risk customers = up to 200 serial LLM calls in a single HTTP request → guaranteed proxy/client timeout. Needs: batching (many signals per prompt), concurrency limit, and/or queue + polling (a `packages/queue` BullMQ setup already exists in the repo, plus `apps/worker`).
- No AI response caching (Sec. 6.4); every analyze repays for identical prompts.
- `loadData()` refetches all 5 datasets when you only want agent statuses.
- `CostMeter.entries` array grows unbounded for the process lifetime.

### 10.5 — Security concerns

**Genuinely good:** RLS tenant isolation on all AI tables; PII stripped at three layers (context builder key-regex, evidence pack assert, output validator); numbers firewall on AI output; CAS versioning on decisions; CSRF + rate limiting + 100kb body cap; keys server-side only.

**Watch items:**
1. **Prompt injection surface = product titles.** `signal.title`/`reason` embed merchant-controlled `product.title` straight into the user prompt ("Reorder {title} before stockout"). A malicious title ("Ignore previous instructions…") can steer the explanation text. The number/PII validator limits blast radius (language-only, no tools), but explanation text is rendered to merchants — sanitize/delimit evidence values in prompts and consider output length caps.
2. **`GET /ai/agents` has no tenant/storeId requirement** — low sensitivity today (global config booleans), but it also means the endpoint can't enforce plan entitlements. Restructure when adding gating.
3. **Cost cap is fail-open across restarts/instances** (in-memory) — a crash-loop or horizontal scale multiplies the real budget.
4. `validateLanguageResponse` extracts numbers with a regex that treats things like "7-day" or "24/7" as numbers → legitimate responses get `AI_REJECTED`; conversely number-words ("about two hundred dollars") pass through unchecked. Tighten both directions.
5. Route trusts `?storeId=` query param; tenant guard middleware must remain the backstop — any future refactor that drops `tenantContextMiddleware` silently opens IDOR on recommendations. Add an explicit assertion in the AI router.

---

## SECTION 11: Recommendations

### 11.1 — Top 3 things to fix first (before any visual redesign)

1. **Feed the rules real data** (`store-snapshot.ts`): derive `averageDailyUnits`/`unitsSold120d`/`daysSinceLastSale` from the existing `product_sales` analytics rows and `inventory-velocity.ts`, take `unitCost` from Shopify InventoryItem cost, and build `productPairs` from order line co-occurrence. This single change takes the engine from "4 of 8 rules dead" to fully live — nothing in the UI matters until the agents actually produce output.
2. **Give Revenue & Executive agents rules**: e.g. `REVENUE_DROP` / `REVENUE_SPIKE` from the momentum data already in the snapshot (`last30dRevenue` vs `previous30dRevenue`), and route a weekly `calculateStoreHealth()` digest through `EXECUTIVE_AGENT`. Also dedupe engine runs on `(storeId, ruleId, entityKey)` while you're in there.
3. **Make the budget real**: persist `CostMeter` to `ai_cost_ledger` (table already migrated), set non-zero per-token rates, add `agent` to the ledger row, and surface `GET /ai/cost` in the hero banner instead of the hard-coded "$5".

### 11.2 — Top 5 features for a professional Command Center

1. **Agent detail drawer/route** (`/command-center/:agentId`): description, rules it owns with live thresholds, last-run stats, recent recommendations filtered by `ai_recommendations.agent`, per-agent spend, prompt version history.
2. **"Run analysis" as a first-class action on the page** with per-agent run buttons and streamed progress (queue job + SSE; `generateStream` already exists) — replacing the passive "Refresh statuses".
3. **Live KPI hero**: real store health score (`calculateStoreHealth` output — currently computed and thrown away), today's AI spend vs cap gauge, recommendations pending/approved counts, explanation quality (AI_GENERATED vs AI_REJECTED rate).
4. **Plan-aware locked cards**: Trial shows 2 unlocked + 5 locked cards with `LockKeyhole` + inline "Upgrade to Growth" CTA (reuses `accessGate` + `UpgradePlanButton`). Directly monetizes the page.
5. **Functional 3-dot menu + activity feed**: pause/resume agent (persist `PAUSED`), view rules, view last error; a right-rail timeline of recent agent events (generated/approved/rejected/executed).

### 11.3 — Architecture changes

- Extract `CommandCenterPage`, `AgentCard`, `AgentDrawer` into their own files with a `command-center-model.ts` (the codebase already follows this pattern for orders/inventory/analytics — App.tsx at 843 dense lines is the outlier).
- Join cards on `AgentStatus.id`, never label; drive the card list from `AGENT_IDS` shared types instead of a duplicated const.
- Move analyze to the existing BullMQ queue/worker (`packages/queue`, `apps/worker`) with per-signal batched prompts and a concurrency cap; return a job id and stream progress.
- Add a real router (even a tiny hash router) so agents/sections are deep-linkable.
- Wire `CalibrationLedger` to the approve/reject route and persist to `ai_calibration_samples` so confidence actually calibrates.
- Cache AI explanations in `TenantVersionedCache` keyed on `sha256(evidencePack)` + prompt version — identical evidence ⇒ free repeat.

### 11.4 — Remove / deprecate

- Dead `onPhaseGate` prop on `CommandCenterPage`; hard-coded hero stats; the decorative `MoreHorizontal` (until functional).
- Decide the fate of `executor.ts`/`approval.ts`/`tools.ts`: wire them (F-phase roadmap suggests yes) or move them out of the shipped bundle — tested-but-unreachable code misleads audits.
- Drop or verify the two suspicious fallback model IDs.
- Housekeeping: `PR38/39/43/44_*.md` files in the repo root belong in `docs/` or the PRs themselves.
- The 8px/9px font sizes on this page should be deprecated in favor of the existing `--text-*` token scale (accessibility: WCAG comfortably fails at 8px).

### 11.5 — Products worth referencing

- **Shopify Sidekick / Shopify Magic** — https://www.shopify.com/magic — the native benchmark for "AI employee inside Shopify admin"; note how actions are always previewed before execution.
- **Triple Whale (Moby & agents)** — https://www.triplewhale.com/ — closest direct competitor; their agent gallery cards → detail drawer → run history is the exact interaction model this page needs.
- **Klaviyo AI** — https://www.klaviyo.com/ai — best-in-class "AI writes, human approves" flows for the Campaign Agent surface.
- **Intercom Fin AI console** — https://www.intercom.com/fin — excellent pattern for AI spend/quality dashboards (resolution rate ≈ your AI_GENERATED rate).
- **Linear Insights / Vercel dashboards** — https://linear.app , https://vercel.com — the dark-UI density/typography standard the current design language is clearly aiming at; steal their type scale (12px floor).

---

## DELIVERABLES CHECKLIST

- [x] Complete audit report covering all 11 sections (this document)
- [x] File structure tree (Sec. 1.3)
- [x] API endpoints table (Sec. 3.1)
- [x] Code snippets (Secs. 2, 4, 5, 9)
- [ ] Screenshots — not captured: the dev server renders the "connect Shopify" gate without a live store/API; happy to spin up the preview with seeded statuses on request
- [x] Priority-ordered recommendations (Sec. 11.1 → 11.2)
