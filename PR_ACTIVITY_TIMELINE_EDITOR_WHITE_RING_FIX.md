# PR — Recommendations Timeline, Automation Editor White-Flash & AI Command Ring Fixes

## Summary

Three merchant-reported polish issues, fixed on three pages:

1. **Recommendations → "Your Activity Timeline" + "Top Categories"** — the sidebar boxes were tiny and hard to read (`10px` stats, `8.5px` axis labels, `84px` chart). Everything is now bigger, clearly readable, and nothing can overflow or get clipped.
2. **Automation editor (edit view)** — the automation name and the top-bar buttons (**Save Draft / Test Run / Save & Activate**) painted **OS-white** in dark mode for every workflow. Root cause found and fixed at the CSS-variable level.
3. **AI Command → Daily commands ring** — "10 of 10 today" fits on Trial, but Growth / Commander plans raise the limit, so bigger numbers overflowed the circle. The ring type now scales by digit count and can never overflow.

## What changed

### 1. Recommendations — Activity Timeline & Top Categories (`recommendations.tsx`, `recommendations.css`)

**Your Activity Timeline**
- Chart canvas enlarged: `264×84` → `280×120` — a noticeably taller, readable area chart (still pure SVG, still real `generatedTrend` data, zero invented numbers).
- Stats row redesigned from a cramped one-liner into a **2×2 grid of stat tiles** (`found`, `approved`, `conversion`, `day window`) — each tile has a large mono value (16px) + clear label. Because the tiles live in a `minmax(0,1fr)` grid with ellipsis guards, they **can never overflow the card or clip** at any sidebar width.
- Axis labels `8.5px → 11px`, legend `9.5px → 12px` with bigger swatches, card gap increased, sidebar titles bumped to a consistent 14px.
- Empty-state sample chart made larger too (plot `74px → 96px`, labels `8.5px → 11px`).
- Light theme counterparts added for every new surface.

**Top Categories**
- Rows enlarged: `11px → 13px` text, roomier padding, taller share bars (`44px → 56px`, `3px → 4px`), labels keep ellipsis so long rule names never break the layout.

### 2. Automation editor — no more OS-white flash (`automation.css`)

**Root cause:** `WorkflowEditor` renders `.workflow-editor` *outside* `.automation-page`, but all `--auto-card / --auto-border / --auto-accent*` design tokens and `color-scheme` were defined **only** on `.automation-page`. Inside the editor the variables resolved to nothing, so:
- top-bar buttons and the automation-name button lost their background → the browser painted them with the **native light control face (white)** in dark mode;
- step groups, step cards, inputs, and selects lost their dark borders;
- native controls rendered with light `color-scheme` (white dropdowns/scrollbars).

**Fix (one place, both themes):**
- Defined the full `--auto-*` token set on `.workflow-editor` (dark) and `.light-mode .workflow-editor` (light), plus matching `color-scheme`.
- Explicit transparent/dark fills for the back button, the rename button, the automation name, and the top-bar actions (**Save Draft / Test Run / Save & Activate** now have a proper dark surface + border + readable text; hover states included).
- Property-panel actions (Remove step / Done) also get explicit backgrounds.
- Light-theme counterparts for every surface.

This restores every editor border (steps, groups, inputs, library search) and kills the white flash on **every** workflow, in both themes.

### 3. AI Command — daily-commands ring can never overflow (`ai-command.tsx`, `ai-command.css`)

- The ring computes the digit count of `used` / `limit` and applies a scale class: normal (≤3 digits), `size-sm` (4 digits), `size-xs` (≥6 digits).
- Ring + inner circle slightly enlarged (`84/68 → 88/71`) for breathing room; all ring text gets `max-width: 100%`, `overflow: hidden`, `white-space: nowrap`, `text-overflow: ellipsis` as a final safety net.
- Trial still shows "10 of 10 today"; Growth/Commander limits (e.g. 500, 2500, 25000) now stay neatly inside the circle. Commander keeps the `∞ / Unlimited` state.

## Files touched

| File | Change |
|------|--------|
| `apps/web/src/recommendations.tsx` | Timeline chart size + 2×2 stat-tile markup |
| `apps/web/src/recommendations.css` | Timeline & Top Categories readability/polish (dark + light) |
| `apps/web/src/recommendations-ui.test.tsx` | Assertions updated to the new tile markup (same data assertions) |
| `apps/web/src/automation.css` | Editor `--auto-*` tokens, `color-scheme`, explicit button fills (dark + light) |
| `apps/web/src/ai-command.tsx` | Ring digit-count scale class |
| `apps/web/src/ai-command.css` | Ring sizing + scale classes + overflow guards |

## Verification

- `vitest run` — **1185 passed / 1187**; the only 2 failures (`analytics-ui.test.ts` source-scan) are **pre-existing** on the base branch (verified via `git stash`) and unrelated to this PR.
- Targeted suites: `recommendations-ui` (50), `automation-editor` (11), `automation-functional` (46), `ai-command-ui` (6) — all green.
- `tsc -p tsconfig.json --noEmit` for `@profitpilot/web` — clean after workspace packages build.
- Vite dev server compiles all touched modules with no errors.

## Out of scope

- No backend/API changes.
- No data changes — every number still comes from the real summary/usage endpoints.
- Other pages untouched, per the request ("baaki page par koi problem nahi hai").
