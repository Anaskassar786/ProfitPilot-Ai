# PR #62 — Store Coach: Ultra-Professional Redesign & Value-Driven Experience

> **Scope:** Store Coach only. No other module (AI Command Center, Recommendations, Automation, Copilot, AI Executive, Insights Hub) was touched. All backend logic is preserved — this is a frontend transformation plus pure, tested helpers.

---

## What changed

### FIX 1 — Complete visual overhaul (both themes)
`apps/web/src/store-coach.css` was rewritten around a scoped token system (`.coach-workspace` + `.app-shell.light-mode` overrides). No global tokens or other modules are affected.

| Token | Dark | Light |
|---|---|---|
| Cards | `#1A1A20` on a deep-space wash | `#FFFFFF` on warm `#FAFAFA` canvas with layered soft shadows |
| Borders | subtle `rgba(255,255,255,.07)` | clearly visible `#E5E7EB` / `#D1D5DB` |
| Coach purple | `#8B5CF6` | `#7C3AED` |
| Warm orange (motivation) | `#FB923C` | `#C2410C` (darkened so 12px text passes WCAG AA) |
| Success green (wins) | `#10B981` | `#059669` |
| Text | `#F5F5F5` / `#A3A3A3` | `#111827` / `#4B5563` |

Design language: 12px minimum typography, 12px card radius, 20–24px card padding, gentle hover lift, coach-purple gradient primary buttons scoped to Store Coach, radial gauges + linear bars + sparklines (no new chart types), Inter via the existing app font stack. Charts adapt through `--coach-chart-*` tokens that flip with the theme.

### FIX 2 — Personal hero header
New `CoachHero`: coach avatar with presence dot, **time-based greeting** (`daypartForHour`), merchant name derived **from the real shop domain** (`merchantDisplayName("anas-apparel.myshopify.com") → "Anas Apparel"` — never invented), engagement-status pill (real health score), live streak counter, chat usage, and the two daily actions: **Start Morning Huddle** and **Ask Coach**, plus settings/tour icon buttons.

### FIX 3 — Rich daily briefing
Three honest states:
- **First run** — a warm welcome explaining exactly what the coach does, with *Generate My First Briefing* and *Learn how it works*.
- **Generating** — animated 4-step checklist (`CoachGenerationSteps`); steps advance on a timer while the real API promise is in flight, with a “10–30 seconds” expectation note.
- **Ready** — date-stamped header, greeting, *Yesterday's snapshot / Key insight / Today's focus* cells, read-time chip, refresh, **Play audio / Stop audio** (voice plans; locked hint otherwise), and *Mark as read — keep the streak alive*.

### FIX 4 — Rich priority cards
Category pill (High Impact / Quick Win / Opportunity) with colored accent bar, time estimate, dollar impact with label (or an honest "no dollar estimate — do it for the momentum" fallback), **Take Action** / **Skip** actions, and a celebratory *All caught up* empty state with *Set a weekly goal* + *Refresh analysis*.

### FIX 5 — Enhanced weekly goal
- **No goal:** the Coach's AI suggestions now load automatically into the main page (feasibility, target, rationale, *Choose this goal* → real accept endpoint), with an educational empty state when the trend is too thin and a custom-goal path.
- **Active goal:** radial gauge, current/target/days-left, pace badge, and a new **Coach's projection** line computed from the backend's real progress math (`actualDailyPace × daysTotal`, required pace when behind).

### FIX 6 — Activity heatmap with derived patterns
The real 12-week weekday×week grid now ships with a 4-step legend, honest window stats (orders, active days), and pattern chips **computed from the real cells** (`heatmapPatterns`): strongest weekday, weekend-vs-weekday delta (only once ≥10 active days), best single day — plus a coach insight sentence built from the merchant's actual best day. Empty state explains what will appear and what data is needed.

### FIX 7 — Gamified achievements (real events only)
Streak strip with a progress bar toward the **next real streak milestone** (3/7/14/30/60/100 ladder mirrored from the backend badge catalog), *Keep it alive* CTA when today isn't logged, recent wins using the badge catalog titles, and **Next achievements** rows with honest progress (current streak ÷ target — no invented XP). Plan-visible badge counter retained.

### FIX 8 — Professional chat
Coach persona header (avatar + current personality mode from real preferences), warm grounded-data greeting, “Try asking me” suggestion chips, labeled Send button, and a plan-status footer (`Your plan: X · N messages left today`). Upgrade CTA always reads **Upgrade Plan**.

### FIX 9 — Weekly review card
Now renders the full review payload: week highlights, metrics vs last week (with color-coded change), key learnings, next week's focus, suggested goal with *Set this goal*, email delivery, and Commander PDF (locked note otherwise).

### FIX 10 — Onboarding polish
The 5-step tour keeps its real preference persistence and adds huddle-time presets (Morning recommended / 10 AM / 2 PM / 6 PM) and a completion checklist on the final step.

### FIX 11 — Settings
Unchanged functionally (personality, huddle time, notifications, voice, widget, language — all plan-gated), now on the new design system.

### FIX 12 — Plan features card (new)
A *Your Plan* card lists exactly what the current tier includes (from the `COACH_LIMITS` matrix — factual tier facts, not store data) and, for non-Commander plans, what higher plans add, with **Upgrade Plan** buttons that route to billing.

## Non-negotiables honored
- **Zero fake data** — every metric rendered comes from the existing backend endpoints. New UI math (heatmap patterns, pace projections, streak milestones) derives from those payloads. Empty/thin data produces educational empty states. Also fixed pre-existing `\u2019` literals that rendered as raw escape text in labels.
- **Plan gating** — unchanged backend matrix; the frontend mirror (`COACH_LIMITS`) drives all locked-feature notes. Trial/Start/Growth/Commander behavior verified by tests.
- **Upgrade wording** — every upgrade CTA reads exactly **“Upgrade Plan”**; a mount test asserts the page never matches `/Upgrade to (Start|Growth|Commander)/i`.
- **12px+ typography** across every Store Coach style; `prefers-reduced-motion` respected.

## Testing
- `store-coach-ui.test.tsx` — new suites for hero greeting/dayparts, shop-domain name derivation, heatmap pattern derivation (incl. the ≥10-active-days guard), streak milestones, plan feature summaries, priority card actions, and generation steps; all prior suites retained (40 tests in the two coach files).
- `store-coach-mount.test.tsx` — asserts the new hero greeting + merchant name + streak, the educational empty states, the plan card with factual inclusions, and the upgrade-wording rule; still fails on any console error.
- Full workspace: **typecheck clean, 172 files / 1906 tests passing.**

## Visual QA / preview
A dev-only fixture server (`scripts/store-coach-preview-fixture-server.mjs`) serves deterministic, clearly-labeled layout fixtures (shop `fixture-demo`) so both themes and every state can be reviewed without a Shopify connection:

```bash
node scripts/store-coach-preview-fixture-server.mjs        # growth fixtures on :3000
PREVIEW_PLAN=trial  PREVIEW_EMPTY=1 node scripts/...       # honest empty states / plan gating
corepack pnpm --dir apps/web dev                           # open /ai-growth-command/coach?storeId=preview-store
```

> Note: the production app never uses this server — all numbers in production come from the real grounded backend, and the fixture shop name makes its origin obvious in screenshots.

## Risk & rollout
Frontend-only within Store Coach (plus the preview script and PR notes). No API, gating, or persistence changes. Rollback is a revert of the four Store Coach source files.
