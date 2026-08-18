# Store Coach Human-Friendly Redesign — Functional Test Report

Date: 2026-08-18  
Scope: Store Coach page only

## Automated

| Suite | Result |
|---|---|
| `apps/web/src/store-coach-ui.test.tsx` | 36 passed |
| `apps/web/src/store-coach-mount.test.tsx` | 10 passed |
| `apps/web` typecheck | passed |

Covered: routing, plan matrix, greeting/dayparts, merchant name from shop domain, heatmap pattern math, streak milestones, plan feature copy, priority cards, generation steps, radial gauge, empty/error/skeleton, human-friendly tip/celebration/feasibility helpers, mount smoke (no console errors), no “Upgrade to &lt;tier&gt;” wording, chat/voice removed from home.

## Manual / code-path checklist

### Header
- [x] Compass avatar (not robot)
- [x] Time-based greeting (morning / afternoon / evening / night)
- [x] Merchant name from shop domain
- [x] Streak counter from real streak payload
- [x] “Just getting started” when streak is 0
- [x] Start Morning Huddle present
- [x] Settings gear present
- [x] Ask Coach / voice buttons absent

### Briefing
- [x] Empty: “getting to know your store” + Show Me Today’s Insights
- [x] Generating: human-language steps
- [x] Ready: yesterday / worth noticing / focus — no play-audio
- [x] Mark-as-read keeps the streak

### Priorities
- [x] Loading copy: Building your priorities…
- [x] Empty after analysis: All caught up (honest)
- [x] Plan chip: “You get N personalized priorities each day”
- [x] Upgrade Plan for more priorities
- [x] Cards: why it matters, time, impact, Take Action / Skip

### Goals
- [x] Suggestions from `/store-coach/goals/suggestions`
- [x] Custom goal path retained
- [x] “Want to track multiple goals?” + Upgrade Plan
- [x] No plan-name lock copy

### Best days / progress
- [x] Home uses 3 insight cards, not a heatmap dump
- [x] Detailed heatmap retained on Progress view
- [x] Empty state honest when no cells

### Journey
- [x] Motivational streak headline
- [x] Earned badges from catalog
- [x] Next badges use real streak targets

### Coach style
- [x] Four styles shown
- [x] Locked styles gated by plan
- [x] Persist via `updateCoachPreferences`

### Plan
- [x] Current inclusions from `COACH_LIMITS`
- [x] Upgrade Plan routes to billing
- [x] No “Upgrade to X”

### Removed
- [x] Voice completely gone from Store Coach home
- [x] Chat section gone
- [x] `/coach/chat` redirects to an AI Command CTA
- [x] Layout still stacks cleanly

### Themes
- [x] Dark: warm purple/orange coach tokens
- [x] Light: `#FAFBFC` canvas, white cards, visible borders/shadows

### Data honesty
- [x] No invented motivational stats
- [x] Celebration block omitted when there is nothing real to cheer
- [x] Tips derived from pending priorities, best weekday, goals, or huddle insight

## Bugs found and fixed during this PR

1. Trailing garbage accidentally appended to `store-coach.tsx` during a mid-edit — trimmed.
2. `WeeklyReviewCard` className typo (`<ol review-learnings">`) — restored.
3. Locked-feature notes named plan tiers — now only “Upgrade Plan”.
4. 0-day streak headline felt punitive — replaced with “Build your streak”.
