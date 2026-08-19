# Fix: Store Coach — हमेशा खाली रहने वाले तीन डिब्बे ("Want to track multiple goals?" के नीचे)

## Reported problem

Store Coach home page पर **"Want to track multiple goals?"** वाले goal card के नीचे **तीन खाली डिब्बे** दिखते थे — blank, shimmer वाले boxes जो कभी भरते नहीं थे। कोई message नहीं, कोई retry नहीं, और तीनों हूबहू same (repeated)।

## Root cause (real bug, confirmed)

`useCoachData` बारह endpoints को `Promise.allSettled` से load करता है। अगर `/store-coach/progress/summary` या `/store-coach/progress/heatmap` reject हो जाए (network blip, 5xx, timeout), तो `data.summary` / `data.heatmap` **हमेशा के लिए `null`** रह जाते हैं और page `loadState: 'partial'` में render होता है।

Page-level खेल: जब तक data load हो रहा है, `CoachMain` पूरा `CoachSkeletonMain` दिखाता है — यानी sections तब ही render होते हैं जब सारे fetches settle हो चुके हों। इसलिए section के अंदर `null` का एक ही मतलब बचता है: **fetch fail हो गया**।

लेकिन तीन sections null पर ये करती थीं:

```tsx
// ProgressDashboard / HeatmapSection / BestDaysSection (पुराना behavior)
if (!summary) return <CoachSkeletonRow />   // = 3 identical blank shimmer boxes, FOREVER
```

`.coach-skeleton-row` = `grid-template-columns: repeat(3, 1fr)` — तीन identical खाली boxes, बिना heading, बिना explanation, बिना recovery। यही screenshot वाली problem है। Same pattern Achievements subview के badge catalog पर भी था।

Bonus bug (sweep में मिला): `fetchCoachReview` का 404 ("अभी weekly review नहीं बना") भी failure count होता था — यानी **हर नया store** silently `partial` state में रहता, जबकि UI review card को पहले से conditionally render करता है।

## Fix

**Failure अब कभी blank box नहीं बनता — हर जगह honest, helpful, non-repeated recovery UI:**

1. **`CoachPartialBanner`** (नया) — `loadState === 'partial'` पर page top पर slim honest strip: *"A few cards couldn't load this time — everything else on this page is live from your real store."* + real **Retry** (पूरा data re-fetch)।

2. **`ProgressDashboard`** — तीन blank boxes की जगह एक असली card: रखा हुआ असली heading *"How your store is moving"*, BarChart3 icon, honest copy, **"Retry loading progress"** (real reload) + **"Open progress view"** (subview खुद भी fresh fetch करता है)।

3. **`BestDaysSection`** (goal card के नीचे) — **बिल्कुल अलग design**: compact green strip, CalendarDays icon, अलग copy (*day-by-day rhythm / strongest weekday / peak week — real orders only*), अलग CTA *"Check again"*। Progress fallback से कुछ भी repeated नहीं।

4. **`HeatmapSection`** (progress subview) — अलग copy + *"Reload patterns"* retry।

5. **`CoachAchievementsView`** — अब "loading" और "failed" अलग states हैं: skeleton सिर्फ असली loading में, failure पर *"The badge catalog didn't load"* + working retry (earned badges safe रहने का reassurance)।

6. **`useCoachData`** — review का 404 अब failure count नहीं होता (`catch` → `null` बाकी errors अभी भी reject)। नए stores पर false banner नहीं दिखेगा।

**User की दोनों शर्तें पूरी:**
- ✅ **Fake कुछ नहीं** — कोई invented metric/placeholder data नहीं; सिर्फ honest copy + असली retry action (पूरा `useCoachData` reload fire करता है)।
- ✅ **Repeated नहीं** — हर fallback का icon, layout दोगुना (block card vs compact strip), copy और CTA अलग; headings तो section के अपने असली हैं।

## Files changed

- `apps/web/src/store-coach.tsx` — 4 sections का permanent-skeleton bug fix, नया `CoachPartialBanner`, review-404 classification fix
- `apps/web/src/store-coach.css` — `.coach-partial-banner`, `.coach-section-unavailable` (+`.slim`, icon tones), `.coach-tempo-unavailable` styles (dark + light themes, mobile stacked, existing tokens only)
- `apps/web/src/store-coach-partial-failure.test.tsx` — **7 new regression tests** (jsdom full-app mount with failing endpoints)

## Verification

| Check | Result |
|---|---|
| Regression tests (failing summary/heatmap/catalog) | **7/7 pass** — no `.coach-skeleton-row` on home, banner present, fallbacks distinct, retry really re-fetches, recovery to real content works, zero console errors |
| Existing Store Coach suites (ui / mount / integrity) | 59/59 pass |
| Full monorepo suite | **211 files · 2662/2662 tests pass** |
| Typecheck (web + api) | Clean |

## Before / After

| State | Before | After |
|---|---|---|
| Progress API fails | 3 blank shimmer boxes forever | Headed card + honest reason + Retry + progress-view link |
| Heatmap API fails (home) | 3 identical blank boxes below goal card | Distinct rhythm strip + "Check again" retry |
| Heatmap API fails (progress view) | 3 blank boxes | Heatmap strip + "Reload patterns" |
| Badge catalog fails | Skeleton row forever | Honest note + "Retry loading badges" |
| Store without weekly review | Silently flagged `partial` | Expected absence — treated as fine |
