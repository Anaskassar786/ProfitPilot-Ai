# PatternAI — Complete Audit & Functional Test Report

Scope: **PatternAI only** (formerly Insights Hub), the discovery module of AI Growth Command.
This report documents a full sweep of the module — every surface, every button, every endpoint —
for errors, bugs, internal-server-error paths, and anything fake presented as real.

---

## 1. Verdict

**PatternAI is real and functional.** Every number it renders is computed server-side from the
store's synchronized Shopify data; locked plan features return honest `402 UPGRADE_REQUIRED`
responses with a generic **Upgrade Plan** CTA; and thin-data stores get educational empty states
with real `have / need` counts — never invented figures.

One genuine **non-functional (fake) control** was found and fixed: the **"Insight language"**
setting's **हिन्दी** option. It was persisted and shown as a selectable button but had **zero effect**
on output — the AI narrator always used the fixed English prompt. It is now wired end-to-end.

---

## 2. What was tested

### 2.1 Automated suites — all green

| Suite | Result |
| --- | --- |
| `apps/web/src/patternai-functional.test.tsx` (29) — real app mount, header actions, funnel click-to-filter, both toolbar filters, clear filters, discovery sweep, save / act / dismiss, detail view, all eleven sub-pages, nav badges, trial gating, export lock, light-theme re-mount | ✅ pass |
| `apps/web/src/patternai-model.test.ts` (37) — routing (incl. legacy), tab labels/purposes, hero stats, plan summary, readiness checklist, degraded notice | ✅ pass |
| `apps/web/src/patternai-ui.test.tsx` (29) — logo geometry, error panel, welcome state, plan panel, workspace smoke, no lab/eye iconography | ✅ pass |
| `apps/web/src/patternai-value.test.tsx` (31) — model + every new visual, "empty must look empty" rule, glyph | ✅ pass |
| `apps/web/src/patternai-mount.test.tsx` (6) — deep-link mount, discovery feed, grouped nav, **total backend failure**, legacy path normalisation | ✅ pass |
| `apps/api/src/insights-hub-routes.test.ts` (49) — ~57 endpoints, plan gating, rate limiting, kill switch, public API auth/quotas | ✅ pass |
| `apps/api/src/patternai-resilience.test.ts` (12) — degraded overview, feed survival, diagnostics, schema-error classification, engine-id writes, both HTTP prefixes, trend-view regression | ✅ pass |
| `packages/ai/src/insights-hub.test.ts` (58) — deterministic engine: detectors, personas, Why?, trends, comparisons, forecasts, lessons | ✅ pass |
| `apps/worker/src/insights-discovery-job.test.ts` (13) — auto-discovery sweep courier | ✅ pass |
| **`apps/api/src/insights-narration-language.test.ts` (6) — NEW** | ✅ pass |

**Total: 270 PatternAI tests passing.**

### 2.2 Build & typecheck

- `pnpm build` (whole workspace) — **clean, exit 0**.
- `apps/api` typecheck — **clean**.

### 2.3 Manual / static review of every surface

- **Discovery feed** — status/category filters, `NEW → REVIEWED → SAVED → ACTED_ON` /
  `DISMISSED`, momentum bars, evidence chips, confidence, plan panel, keep-exploring links.
- **Lessons** — recommended, generate, read, rate, bookmark.
- **Pattern lab** — detect, view, alert toggle, invalidate (delete).
- **Personas** — generate, detail, customer segment aggregates (anonymized, no PII).
- **Why? explorer** — ask, investigate, rate; deterministic root-cause decomposition.
- **Trend watcher** — business/market/emerging/declining, alert toggles; market honestly
  reports "no feed connected" until a verified source exists.
- **Comparisons** — product/period/segment/category/channel builder, delete; honest
  `INSUFFICIENT_DATA` verdict.
- **Knowledge base** — search, create/update/delete notes, tag cloud, link network.
- **Timeline** — type filter, days window.
- **Predictions** — generate, horizon filter, `Grade it` accuracy validation.
- **Settings** — auto-discovery toggle, frequency, categories, notifications, trend
  monitoring, persona refresh, **insight language (now functional)**.
- **API access (Commander)** — generate/regenerate key, masked key, usage, docs, OpenAPI.
- **Charts** — bubble, radar, heatmap, area-gradient, scatter, timeline, word cloud, network,
  treemap, diverging comparison bars, funnel; one-click SVG export is wired to
  `downloadChartSvg`.

---

## 3. Bug found & fixed — the "fake" insight-language control

**Symptom:** Settings → **Insight language** offered **English / हिन्दी**. Selecting हिन्दी
persisted `language: 'hi'` to `insights_preferences` and showed the button as active, **but
nothing in the narration pipeline read it**. The AI narrator always called the model with the
fixed `INSIGHTS_HUB_SYSTEM_PROMPT` (English), so a Hindi-speaking merchant who chose हिन्दी
still received English-only discovery explanations. The setting was a no-op — fake.

**Root cause:** `language` was stored (`insights-hub.ts` preferences read/write), exposed via
`GET/PATCH /patternai/preferences`, and rendered as a button (`patternai.tsx`), but was never
passed to `createInsightsNarrator` / `narrateDiscoveries`.

**Fix (`apps/api/src/insights-hub.ts`):**
1. `InsightsNarrator` input now carries an optional `language?: 'en' | 'hi'`.
2. New `insightsNarratorSystemPrompt(language)` returns the base prompt, or — for `hi` — the base
   prompt plus an explicit directive to respond in Devanagari while keeping **every number in
   Latin digits (0-9)**, so the numeric language firewall (`validateLanguageResponse`) can still
   verify each figure against the engine's evidence pack (Devanagari numerals would otherwise
   slip past the ASCII-digit regex).
3. `runDiscoveryPipeline` reads the store's stored language (`preferenceLanguage`, defaulting to
   `en` on any read failure) and forwards it into `narrateDiscoveries`, which passes it to the
   narrator.

**New regression tests (`apps/api/src/insights-narration-language.test.ts`, 6 tests):** base
prompt for `en`/`undefined`; Hindi directive present for `hi` (Devanagari + Latin-digits rule);
language flows into the narrator's system prompt; `en` fallback; the firewall still rejects an
invented number (`999`) in Hindi narration; the narrator type is language-aware.

**Docs (`docs/PATTERN_AI.md`):** the Settings row now documents that the Insight language choice
is real and drives the narrator.

---

## 4. "Everything real" — verified, nothing fake found in production

- **No mock/fake data in production code.** The `pa-verify.*` harness (which mocks `/insights/*`)
  is a dev-only visual checker served only from its own `pa-verify.html` entry; it is **not**
  part of the production `index.html` bundle (confirmed: no reference in `dist`).
- **No `console.log` / debug leftovers**, no `TODO`/`FIXME`/`XXX`/`not implemented` in the module.
- Every `<button>` in `patternai.tsx` has a real `onClick` (the single submit button without one
  is `type="submit"` inside a form).
- Every UI API call maps to a real endpoint on `/patternai/*` **and** `/insights/*`; all routes
  answer through the shared `handle` wrapper (rate limit → 429, module disabled → 503, plan wall →
  402, malformed input → 400), so no unhandled throw reaches the browser as a raw 500.
- The module router is mounted in `apps/api/src/app.ts` and the auto-discovery runner is
  registered in `apps/worker/src/main.ts` — nothing is dead wiring.

---

## 5. Out-of-scope note (pre-existing, not introduced by this PR)

One test outside PatternAI currently fails in this repository: `apps/web/src/command-center-functional.test.tsx`
(AI Command Center) asserts the Inventory Agent shows `7 insights today`, but at the current UTC
hour it shows `6`. It is a **time-sensitive mock**: `insightsToday()` counts items whose
`createdAt` is on today's UTC date, and the mock places one activity at `8 hours ago`, which
crosses midnight for part of the day. This is pre-existing on `main`, unrelated to PatternAI, and
is deliberately left untouched to keep this PR scoped exclusively to the discovery module (per the
module's own convention). It should be addressed separately by pinning the mock timestamps.

---

## 6. Files changed

| File | Change |
| --- | --- |
| `apps/api/src/insights-hub.ts` | Wire the stored `language` preference into the AI narrator; add `insightsNarratorSystemPrompt`. |
| `apps/api/src/insights-narration-language.test.ts` | New: 6 tests covering the language wiring + firewall safety. |
| `docs/PATTERN_AI.md` | Document that the Insight language setting drives the narrator. |

**Validation:** whole-workspace `pnpm build` clean; `apps/api` typecheck clean;
**270 PatternAI tests passing** (252 pre-existing + 6 new narration-language tests).
