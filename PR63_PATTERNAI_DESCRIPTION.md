# PatternAI (formerly Insights Hub) — crash fix, complete rebrand, and professional redesign

This PR is scoped **exclusively** to the discovery module. AI Command Center, Recommendations, Automation, AI Command / Copilot, Store Coach, and GrowthIQ / AI Executive are untouched.

---

## 1. The crash is fixed (root cause, not a band-aid)

The page answered **"The laboratory hit a snag — Internal server error"**. Two independent causes:

### Cause A — uuid columns vs. deterministic engine ids

`migrations/0024_insights_hub.sql` declared every primary key as `uuid`. The deterministic engine in `packages/ai/src/insights-hub.ts` mints **content-addressed** ids so the same finding keeps the same identity across sweeps:

```
deterministicId('disc', storeId, type, category, title)  →  disc_1f4c9a2b7d
```

Every `INSERT` therefore failed with `invalid input syntax for type uuid: "disc_…"`. That killed `/insights/discoveries/generate`, the auto-discovery sweep, and — because auto-discovery runs in-band on first paint — `/insights/overview` itself. The module could never finish loading on a real store.

**Fix — `migrations/0025_patternai_id_types.sql`:** widens `id` to `text` on all ten entity tables plus `insights_timeline_events.entity_id` and `insights_knowledge_base.linked_insights` (`uuid[] → text[]`). Existing rows are preserved (`USING id::text`), defaults become `gen_random_uuid()::text`, and the blocks are idempotent (they inspect `information_schema` first). The migration also adds the unique indexes the pattern/trend upserts already assumed, plus a partial index for the `NEW` discovery feed.

### Cause B — all-or-nothing rendering

`InsightsHubService.overview()` loaded fourteen panels through one `Promise.all`. A single failing query removed the whole page.

**Fix:** each panel now resolves independently with an honest fallback, and the response carries `degraded: string[]` naming anything that could not load. The UI shows one calm banner ("PatternAI rendered this page without personas, trends…") instead of a crash screen. In addition:

- `PostgresInsightsHubRepository` classifies Postgres *schema-not-ready* codes (`42P01`, `42703`, `42883`, `3F000`), degrades those **reads** to empty results and logs a warning — a deployment that has not run migrations yet renders empty states, not 500s. Genuine faults (e.g. `08006`) still surface.
- `discoveryFeed()` survives a dead data plane and falls back to an educational empty state.
- Auto-discovery on first paint is best-effort and can no longer take the page down.
- New diagnostics endpoint: **`GET /patternai/health?storeId=…`** probes the dataset + all twelve storage sections and returns `{ ok, plan, narration, autoDiscovery, sections[] }`.

### Cause C (found while testing) — Trend Watcher always empty

`/insights/trends/business` passed the *view* name `'business'` into the repository, which filtered `trend_type = 'business'` — a value that never exists (the enum is upper-case). The overview counted 5 trends while the Trend Watcher rendered "0 signals under watch". Views (`business`, `market`) are now applied after loading, and only real `TrendType` values reach storage.

**Executable proof:** `apps/web/src/patternai-mount.test.tsx` mounts the real app on the PatternAI deep link against a backend that **500s on every module endpoint** and asserts the shell, the navigation, and a retryable message still render, with zero React console errors.

---

## 2. Complete rebrand to PatternAI

| | Before | After |
| --- | --- | --- |
| Name | Insights Hub | **PatternAI** |
| Tagline | "Where data becomes wisdom" | **"Discover the patterns that drive your business"** |
| Icon | 🧪 `FlaskConical` | **Neural-network constellation** (custom SVG) |
| Web route | `/ai-growth-command/insights` | `/ai-growth-command/patternai` (old path still parses and is rewritten on first paint) |
| API prefix | `/insights/*` | `/patternai/*` **and** `/insights/*` (both served) |
| Docs | `docs/INSIGHTS_HUB.md` | `docs/PATTERN_AI.md` |
| Web sources | `insights-hub*.tsx/ts/css` | `patternai*.tsx/ts/css` (+ `patternai-logo.tsx`) |

**Deliberately unchanged for compatibility:** the twelve `insights_*` tables, the `INSIGHTS_HUB_*` environment block, the API service/route filenames, and the `/public-api/insights/*` contract. Renaming any of those would break running installations and issued API keys; the rebrand is complete on every surface a merchant can see.

Voice moved from "curious scientist / laboratory" to discovery-oriented and educational — no lab, flask, microscope, telescope, or eye metaphors remain anywhere in the module (asserted by tests).

---

## 3. New logo — neural network constellation

`apps/web/src/patternai-logo.tsx`

- Five nodes wired by seven edges: the literal shape of a pattern being found.
- Purple → cyan gradient (`#A78BFA → #8B5CF6 → #06B6D4`), cyan accent nodes, soft halos.
- Pure SVG, per-instance gradient ids (safe to render many times), `plain` and `badge` variants, theme-aware CSS variables so it reads on `#0B0D14` and `#FAFBFC` alike.
- Legible at 16/24/32/48px — the same component works as a favicon and as the sidebar glyph (`PatternAiIcon` matches the Lucide call signature).
- Explicitly avoided: eye, lab equipment, magnifier, lightbulb, chart.

---

## 4. Ultra-professional redesign, both themes

`apps/web/src/patternai.css` is a full rewrite (≈900 lines, `pa-` prefix) built on the specified palettes:

| Token | Dark | Light |
| --- | --- | --- |
| Canvas | `#0B0D14` | `#FAFBFC` |
| Card | `#14171F` | `#FFFFFF` + `0 1px 3px rgba(15,23,42,.05)` |
| Elevated | `#1D202C` | `#F1F5F9` |
| Border | `#2A2E3D` | `#E2E8F0` |
| Text / secondary | `#F8FAFC` / `#94A3B8` | `#0F172A` / `#475569` |
| Accent purple / cyan | `#8B5CF6` / `#06B6D4` | `#7C3AED` / `#0891B2` |

- **Type scale:** 12px labels → 32px page title. Nothing in the module is below 12px (the shared shell uses 8–10px in older sections; PatternAI overrides its own buttons, inputs and kickers).
- **Layout:** hero (mark + wordmark + tagline + actions + six stat tiles) → optional plan panel → grouped **navigation rail** (Discover / Understand / Remember & look ahead / Workspace) → section header with purpose line → content.
- **Cards:** 12px radius, 20–24px padding, 1px borders, soft shadow, gentle lift + border highlight on hover, per-type accent rail.
- Charts stay bubble / radar / heatmap / area-band / scatter / timeline / word cloud / network / treemap / sankey-lite — **no line or donut charts** — and every fill now flows through `--pa-*` tokens so both themes are correct.
- Responsive down to 620px; `prefers-reduced-motion` respected; focus rings on every control.

---

## 5. Discovery-first content model

- **Discovery cards** lead with a plain-English headline per type ("New pattern detected", "Anomaly detected", "Opportunity spotted"…), then description, narrator note, three evidence chips pulled from the engine's own evidence bundle, confidence, category, monetary impact, and the actions Explore / Save / Acted on it / Dismiss. Seven type tones (pattern indigo, anomaly amber, opportunity green, correlation purple, trend cyan, segment pink, behaviour indigo).
- **Educational welcome state** replaces the blank box: six capability cards plus a readiness checklist driven entirely by the API's thresholds (`15 / 50 customers for persona modelling`, `12 / 30 days of history`…).
- **"Keep exploring"** strip cross-links the other discovery surfaces from the feed.
- **Plan panel** lists what is available now vs. what a paid plan unlocks, with the generic **`Upgrade Plan`** CTA.

Scope stays unique: discovery, learning, understanding. No daily coaching (Store Coach), no strategy reports (GrowthIQ), no action queue (Recommendations), no agent management (AI Command Center), no chat, no automation.

---

## 6. Rules honoured

- **Zero fake data** — the UI still renders only server-computed values; the preview harness used during development lives outside the repo. Thin data produces educational empty states with real `have / need` counts.
- **Plan gating** — unchanged matrix; trial explores clearly-labelled samples; locked capabilities 402 with `reason: UPGRADE_REQUIRED`.
- **Upgrade wording** — every CTA is `Upgrade Plan` / `Upgrade Subscription`; tests assert no `Upgrade to <tier>` string exists.
- **Both themes perfect**, 12px+ type, premium enterprise aesthetic.

---

## 7. Tests

`1902 passed / 174 files`, full workspace build and typecheck clean.

New coverage:

- `apps/api/src/patternai-resilience.test.ts` (12) — degraded overview, feed survival, diagnostics endpoint, schema-error classification, engine-id writes, both HTTP prefixes, trend-view regression.
- `apps/web/src/patternai-mount.test.tsx` (6) — real app mount on the PatternAI route, discovery feed rendering, grouped nav, **total backend failure**, legacy path normalisation, no Insights Hub branding.
- `apps/web/src/patternai-ui.test.tsx` (29) — logo geometry (5 nodes / 7 edges), error panel, welcome state, plan panel, workspace smoke, no lab/eye iconography.
- `apps/web/src/patternai-model.test.ts` (36) — rebranded routing incl. legacy links, tab labels and purposes, hero stats, plan summary, readiness checklist, degraded notice.
- `packages/db/src/db.test.ts` — migration `0025` registered and asserted column-by-column.

---

## 8. Deploy notes

1. `RUN_MIGRATIONS=true` (or run out-of-band) so **0025** applies — this is the crash fix.
2. Verify with `GET /patternai/health?storeId=<store>`; every section should report `ready`.
3. No environment changes required. `INSIGHTS_HUB_*` variables keep their names.
4. Old links (`/ai-growth-command/insights…`, `/insights/*`, existing `ihk_` API keys) continue to work.

---

## 9. Rebased onto main (conflicts resolved)

This branch was opened before six module PRs landed (AI Command Center, Recommendations, Automation, AI Command, Store Coach, GrowthIQ). `main` has been merged in; both conflicts are resolved and the PR is **mergeable**.

| Conflict | Resolution |
| --- | --- |
| `PR59_DESCRIPTION.md` (add/add) | `main` claimed that filename for the **Automation redesign** description. Main's file is kept byte-for-byte; this description moved to `PR63_PATTERNAI_DESCRIPTION.md`, matching the repo's `PR<number>_<topic>.md` convention. |
| `apps/web/src/App.tsx` (content) | Both sides edited adjacent lines in `pageMeta` and `renderPage`. **Kept main's** new Automation copy ("Automate the busywork — recover carts…") and Recommendations copy ("Your AI team has been watching your store 🎯…"); **kept PatternAI's** section id, constellation icon, route and workspace. Nothing was dropped from either side. |

**One follow-through the rename made necessary:** the AI Command Center's *AI Growth Command* module registry pointed its "Open" action at the section id `insights-hub`, which no longer exists — after the merge that card would have navigated nowhere. Renamed the registry entry only (`id: PATTERN_AI`, `path: 'patternai'`, `label: 'PatternAI'`) and swapped its `Microscope` glyph for `Network` so no lab iconography remains. No layout, behaviour, or other copy in that module was touched; its tests were updated to match.

Also removed the now-unused `FlaskConical` import from the shell.

**Verification on the merged tree:** `pnpm -r build` clean, web typecheck clean, **1943 tests passing across 174 files** — the 1902 from this branch plus the 41 that arrived with the six merged PRs. No functionality lost from any module.
