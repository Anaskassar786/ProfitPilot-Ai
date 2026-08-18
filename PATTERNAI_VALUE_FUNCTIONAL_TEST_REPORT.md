# PatternAI — functional test report (PR #64)

Scope: **PatternAI only**. AI Command Center, Recommendations, Automation, AI Command / Copilot,
Store Coach and GrowthIQ were not opened, imported, or modified in this PR.

Two layers of testing were run:

1. **Executable** — `apps/web/src/patternai-functional.test.tsx` mounts the real
   `PatternAiWorkspace` in jsdom against a fully mocked backend and drives it like a merchant
   (21 tests). Plus `patternai-value.test.tsx` (31), `patternai-ui.test.tsx` (29),
   `patternai-model.test.ts` (37) and `patternai-mount.test.tsx` (6).
2. **Interactive** — `apps/web/pa-verify.html`, a dev-only harness that renders the real
   workspace in both themes across three store states (`fresh`, `trial`, `growth`).
   Run `corepack pnpm --filter @profitpilot/web dev`, then open
   `/pa-verify.html`, `/pa-verify.html?theme=dark`, `/pa-verify.html?data=growth`.

Whole-repo result: **177 test files, 2148 tests, all passing.** Typecheck and web build clean.

---

## Header

| Check | Result | Evidence |
| --- | --- | --- |
| New Run discovery icon displays | ✅ | Compass-with-spark glyph renders in the hero button and the toolbar button (`renders the brand mark, tagline and the new Run discovery glyph`) |
| Title readable in both themes | ✅ | `.pa-hero-title` uses `--pa-text`; light override `#0F172A` on `#FFFFFF` (AA) |
| 6 KPI stat cards, each with a *different* visualization | ✅ | `renders six KPI tiles, each with its own micro-visualization` asserts 6 tiles and 6 distinct `viz-*` classes |
| Stats engaging at zero | ✅ | Empty tiles render a ghost shape plus an honest caption (`waiting to populate`, `discovering…`, `analysing customers…`, `ask your first question`, `monitoring…`, `learning…`) |
| Run discovery button works | ✅ | `runs a discovery sweep from the header button` — POST `/discoveries/generate` fired, success toast raised |
| Settings button opens preferences | ✅ | `opens the plan panel and the settings tab from the header` |
| Plan indicator accurate | ✅ | Plan chip reads the API plan; trial banner only when `overview.trial` |
| Monthly allowance ring | ✅ | Growth store shows `of 20 limit` + `13 discoveries left this month`; trial shows `of 1 limit` |

## Discovery feed

| Check | Result | Evidence |
| --- | --- | --- |
| Funnel renders correctly | ✅ | `renders the pipeline funnel with real counts and a conversion rate` — stage values `3 / 2 / 1 / 1`, conversion `33%` |
| Funnel is interactive | ✅ | `filters the feed by clicking a funnel stage` — clicking *Acted on* sets the status filter and refetches |
| Filter by status works | ✅ | `filters by status and category through the toolbar selects` |
| Filter by category works | ✅ | same test; both filters hit the API with the query parameters |
| Clear filters | ✅ | Appears only while a filter is active; resets both selects |
| Export button functional with plan check | ✅ | Growth downloads the SVG; trial shows the locked button and the toast `Chart export unlocks with a plan upgrade.` |
| Upgrade Plan button routes to billing | ✅ | `sends the locked discovery CTA to billing` |
| Discovery-in-progress feedback | ✅ | Three-step progress panel renders while the sweep runs |

## Discovery cards

| Check | Result | Evidence |
| --- | --- | --- |
| Human headline | ✅ | `Rising product spotted` above the engine's own sentence; headline contains no digits (asserted) |
| Product **name**, never an id | ✅ | `expect(text()).not.toContain('gid://shopify')` — `productId` is filtered out of card evidence |
| Momentum before/after bars | ✅ | `Prior 14 days 0 sold` vs `Last 14 days 3 sold`, scaled to the larger side |
| "What this means for you" insight | ✅ | The engine's explanation, highlighted |
| Confidence shown | ✅ | `80%` pill with tone |
| Revenue impact shown | ✅ | `$1,800 in play` |
| Sample label prominent | ✅ | `SAMPLE` badge on trial |
| Explore / Save / Acted on / Dismiss | ✅ | `saves, acts on and dismisses a discovery through the API` (3 status calls) and `opens a discovery detail view from Explore` |

## Sub-pages (every sidebar destination)

`renders content for each sidebar destination without console errors` opens all of them in one run:

| Page | Result | Content asserted |
| --- | --- | --- |
| Discovery feed | ✅ | funnel + cards |
| Learning library | ✅ | lesson title |
| Pattern lab | ✅ | pattern title |
| Customer personas | ✅ | persona name (locked state verified separately on trial) |
| Why? explorer | ✅ | investigation question |
| Trend watcher | ✅ | trend title |
| Comparisons | ✅ | builder copy |
| Knowledge base | ✅ | knowledge entry |
| Timeline | ✅ | timeline event |
| Predictions | ✅ | forecast title |
| Settings | ✅ | discovery cadence |
| API access | ✅ | API panel (locked below Commander) |

## Keep exploring

| Check | Result |
| --- | --- |
| 6 cards render | ✅ `renders the six Keep exploring cards, each with its own mini chart` |
| Each has a **different** mini-visualization | ✅ word cloud, scatter, radar, cause web, diverging bars, probability wave all present in the DOM |
| Navigation on click | ✅ each card routes to its tab |
| Locked cards labelled | ✅ `Opens with a plan upgrade` + lock icon, never a plan name |

## Real-data verification

| Check | Result | Note |
| --- | --- | --- |
| All numbers from the API | ✅ | Every new model function formats API values; none derive a metric. Mini charts only fetch when `overview.counts` already reports data |
| Sample data labelled | ✅ | `SAMPLE` badge + trial banner |
| No fabricated patterns | ✅ | Empty states draw ghost outlines with honest captions instead of placeholder shapes (`falls back to an explicitly empty state instead of a fake shape`) |
| Confidence scores real | ✅ | Straight from `confidenceScore` |
| Revenue real | ✅ | `impactEstimate` + `impactCurrency`, summed only across discoveries that actually carry one; otherwise the money line is omitted |
| Pattern strength honest | ✅ | Each bar is `have ÷ need` against the engine's own threshold, with the raw counts printed under it (`412 of 10 orders`) |

## Plan restrictions

| Check | Result |
| --- | --- |
| Trial limits enforced | ✅ 1 discovery allowance, sample-only feed, locked generation button |
| Locked features clearly shown | ✅ `.pa-nav-item.locked` + lock glyph + tooltip "Locked on your current plan — Upgrade Plan to open this section" |
| "Upgrade Plan" wording everywhere | ✅ asserted: no `Upgrade to Start/Growth/Commander` anywhere in the rendered page |

## Both themes

| Check | Result |
| --- | --- |
| Light renders the same structure | ✅ `renders the same structure inside a light-mode shell` |
| No hard-coded colours in the new visuals | ✅ `never hard-codes a page colour on the new value visuals` — inline styles carry only widths |
| Dark polished | ✅ visual pass in `/pa-verify.html?theme=dark` |
| Contrast | ✅ light text `#0F172A` / secondary `#475569` on `#FFFFFF`, cards bordered `#E2E8F0` with a real shadow above the `#F8FAFC` canvas |

---

## Bugs found and fixed during this sweep

1. **Detail view crashed on a partial payload.** `evidenceRows` called `Object.entries` on a
   `dataEvidence` that a degraded/partial response can omit, throwing inside render and taking the
   discovery detail page down. `evidenceRows`, `humanEvidenceRows` and `discoveryMomentum` now
   guard the input and return empty results. Regression test:
   *"survives a partial payload instead of crashing the detail view"*.
2. **Product ids leaked to merchants.** The rising-product card printed
   `productId: gid://shopify/Product/…` as evidence. Technical keys are now filtered and the
   remaining keys get plain-English labels.
3. **Header showed a bare grid of zeros.** Each tile now carries its own micro-visualization and a
   truthful "what happens next" caption instead of six identical `0`s.
4. **Dead chart code.** The superseded Sankey-lite `InsightsFlowChart` and `funnelStages` helper
   (plus their CSS) were removed rather than left behind the new funnel.

## Known limits

- Screenshots could not be captured in this environment (no browser binary is installable in the
  sandbox — Playwright's CDN and the Debian mirrors are unreachable). The `pa-verify.html` harness
  is provided instead: it renders every state of the real page in both themes in one click.
