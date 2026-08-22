# Billing Limits + Full Product QA

Raises AI recommendation monthly limits per plan, runs a full product QA across billing, recommendations, agents, AI Command, automations, cart recovery and auto-execution, and fixes every broken/brittle test found along the way. **Full suite: 2802 tests pass, build green.**

---

**BILLING LIMITS + PRODUCT QA REPORT**

**Limits changed**

- Start ai_recommendations_month: 30 → 150
- Growth ai_recommendations_month: 150 → 300
- Commander: unlimited (confirmed, `null`)
- Trial: unchanged at 10 (preserved, not broken)

**Files updated**

- `packages/types/src/plans.ts` — `PLAN_ENTITLEMENT_LIMITS` (canonical source of truth): start 30→150, growth 150→300
- `packages/billing/src/plans.ts` — plan feature bullets: Start "150 AI recommendations / month", Growth "300 AI recommendations / month", Commander "Unlimited AI recommendations"
- `apps/web/src/App.tsx` — billing feature matrix (`recs` row 150/300/Unlimited) + fallback plan-card copy
- `apps/web/src/ai-command.css` — relocated theme-neutral `.aic-ring` layout rules out of the light-theme block so they no longer leak into the light-scoping contract
- Tests/fixtures: `f5-billing.test.ts`, `types.test.ts`, `f5-shopify-billing.test.ts`, `command-center-functional.test.tsx`, `command-center-ui.test.ts`, `recommendations-model.test.ts`, `recommendations-workflow.test.tsx`, `recommendations-ui.test.tsx`, `ai-command-page-metrics.test.ts`, `pr46-lifecycle.test.ts`, `f4-engine.test.ts`, `analytics-ui.test.ts`, `final-polish.test.ts`

**QA matrix**

| Area | Status | Notes | Fixed in this PR? |
|---|---|---|---|
| Billing page | PASS | $79/$199/$399, Start 150 / Growth 300 / Commander unlimited on cards + matrix, no "Campaign Agent"/"15 campaigns" copy, gift placeholder is a generic example (not a secret), redeem button hover is blue (not destructive), mock "Choose plan" refreshes usage caps from canonical limits, monthly/annual pricing correct | Yes (limits + stale price test fixtures) |
| Recommendations | PASS | List/tabs/filters load, approve/reject/details work, friendly limit-reached message (no 500), agent labels correct, cap message surfaces UPGRADE_REQUIRED | Yes (agent-count + gating fixtures) |
| Agents / Command Center | PASS | Roster is Trial 2 · Start 3 · Growth 4 · Commander 6, Pricing Agent on Growth, Campaign Agent fully purged, locked agents show upgrade CTA | Yes (stale "2 of 5" / "$349/mo" / "7 agents" fixtures) |
| AI Command | PASS | Page metrics correct, light-theme overrides properly scoped, no unbounded selectors in light block | Yes (CSS scoping + basicAgentCount fixture) |
| Automations | PASS | Workflow limits (5/20/∞) already derive from canonical limits; no campaigns dependency | n/a (verified) |
| Cart recovery / Customer | PASS | Recovery/welcome run under Customer Agent; no Campaign Agent references | n/a (verified) |
| Auto-execution | PASS | Commander-only; gated off for Start/Growth via `auto_execution` matrix row | n/a (verified) |

**Bugs found**

1. [high] Stale Shopify billing test fixtures assumed old prices ($49 Start / $149 Growth) → charge payload/verify tests failed against $79/$199/$399 → fixed fixtures.
2. [medium] Stale agent-count fixtures still assumed the pre-removal 7-agent roster (Campaign Agent) → recs-model, f4-engine, pr46-lifecycle, ai-command-page-metrics, command-center-functional expected "2 of 5", "7 agents", "basicAgentCount: 5" → updated to the 6-agent roster (2/3/4/6).
3. [medium] AI Command light-theme scoping guard flagged 10 unscoped `.aic-*` selectors (`.aic-ring` layout rules landed inside the light block) → relocated them to the base section.
4. [low] `analytics-ui` sort-dropdown contract expected `label="Sort"` but inventory/customers use the established `label="Sort by"` prefix → aligned the contract (still rejects the compact `triggerLabel` regression).
5. [low] `jarvis-orb.css` byte-for-byte hash drifted after a prior intentional change (`JarvisOrb.tsx` still pinned) → refreshed CSS hash.
6. [info] Real Shopify charge flow requires Phase 2 Shopify billing (live charges); mock "Choose plan" path updates the local plan + usage caps correctly.

**Remaining risks**

- Live Shopify recurring-charge creation/verification is Phase 2 Shopify billing; covered by unit tests but not exercised against a real store here.
- Gift/redeem success path depends on env-configured codes (`GIFT_CODE_SEQUENCE_1/2`, seeded at boot); the UI placeholder is a generic example, never a real secret.

**Build**

- `pnpm build` (tsc all packages + vite web bundle): PASS
- `pnpm test`: PASS — 221 files, 2802 passed / 1 skipped
