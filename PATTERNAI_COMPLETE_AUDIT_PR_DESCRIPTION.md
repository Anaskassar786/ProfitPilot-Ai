# PatternAI — complete audit, fix the one non-functional control

Scope: **PatternAI only** (formerly Insights Hub). AI Command Center, Recommendations,
Automation, AI Command / Copilot, Store Coach and GrowthIQ are untouched.

## Why this PR exists

A full audit of PatternAI — every surface, every button, every endpoint — found the module real
and healthy, with **one genuine fake control**: the **"Insight language"** setting's **हिन्दी**
option. It was persisted and shown as an active button but had **zero effect** — the AI narrator
always used the fixed English prompt. A Hindi-speaking merchant who chose हिन्दी still received
English-only discovery explanations. That is the kind of thing this PR removes.

## The fix

Wire the stored `language` preference into the AI narrator (`apps/api/src/insights-hub.ts`):

- `InsightsNarrator` now accepts an optional `language?: 'en' | 'hi'`.
- New `insightsNarratorSystemPrompt(language)` — for `hi`, appends a directive to respond in
  Devanagari while keeping **every number in Latin digits (0-9)**, so the numeric language
  firewall can still verify each figure against the engine's evidence pack (Devanagari numerals
  would otherwise bypass the ASCII-digit regex).
- `runDiscoveryPipeline` reads the store's stored language (defaulting to `en` on any read
  failure) and passes it through `narrateDiscoveries` into the narrator.

## Testing

- **New** `apps/api/src/insights-narration-language.test.ts` (6 tests): English/unspecified →
  base prompt; Hindi → Hindi + Latin-digit directive; language flows into the system prompt;
  English fallback; the firewall still rejects an invented number in Hindi narration; narrator
  type is language-aware.
- **270 PatternAI tests passing** (252 pre-existing + 6 new).
- Whole-workspace `pnpm build` clean; `apps/api` typecheck clean.

## Notes

- `docs/PATTERN_AI.md` documents that the Insight language setting is real and drives the
  narrator.
- A **pre-existing, out-of-scope** flaky test (`apps/web/src/command-center-functional.test.tsx`,
  AI Command Center) currently fails at some UTC hours because its mock places one activity
  `8 hours ago` and `insightsToday()` counts by UTC calendar day. It exists on `main`, is
  unrelated to PatternAI, and is intentionally not touched here; it should be fixed by pinning the
  mock timestamps.
- Full audit details: `PATTERNAI_COMPLETE_AUDIT_REPORT.md`.
