# AI Command Center — Critical Fixes & Professional Polish

One PR, one module. This changes **only the AI Command Center** (`command-center.*`).
No other module (Recommendations, Automation, AI Command / Copilot, Store Coach,
AI Executive, Insights Hub) is touched in product code.

---

## What was wrong & what changed

### 1. Store Health Score showed "0/100 Critical" 🚨

**Root cause.** `calculateStoreHealth()` scored a store from any non-null signal,
so a store with a handful of orders — or a single day of history — could resolve
to `0` (or an inflated `100`) and the hero rendered it as a red "Critical".

**Fix (two layers, zero fake data):**

- **Backend** (`packages/ai/src/health.ts`): the score now returns `null` whenever
  there is not enough closed-period evidence — fewer than **10 orders** or fewer
  than **7 days** of order history. `null` is the honest answer until data accrues.
- **Frontend** (`command-center-model.ts`): the hero now renders an educational
  empty state instead of a number:
  - `"Not enough data yet — need 10+ orders to calculate health score"`
  - `"Store health calculating… check back in 24 hours"`
  - A low-but-real score is labeled calmly (**"Needs attention"**) — the word
    **"Critical" never reaches merchants**.
- The existing tooltip (what the score means) and the improving/declining trend
  indicator remain on the card.

### 2. Replaced the meaningless "0 calls today / $0.00 of $5.00" card

That card told merchants nothing useful. It is now **AI Actions Completed**:

- Big number = recommendations approved or executed **this week**.
- Trend vs. the previous week (`+23% vs last week` / `flat` / `new this week`).
- A 7-day sparkline.
- Tooltip: *"Total AI actions that helped grow your business…"*.

The number comes from the real `/recommendations/summary` endpoint
(`generatedTrend.approved`), never from a hard-coded string.

### 3. "Insights Today" got a real visualization

- Big number for today, a **7-day sparkline**, a
  `Last 7 days: 0 | 2 | 1 | …` row, and a `Total this week` total.
- All from the real `generatedTrend.generated` series.
- Sparklines are theme-adaptive (dark + light), subtle, and hoverable (per-day
  tooltips). No line or donut charts were added.

### 4. AI Growth Command cards no longer say "Coming Soon"

All four modules (Store Coach, AI Executive, Insights Hub, AI Command) are live
and have their own sidebar entries. The cards now:

- Show **Available** (green) or **Requires Growth** (amber) by plan tier.
- Are **clickable** and link to the real pages via `onNavigate`:
  - Store Coach → `store-coach` (`/ai-growth-command/coach`)
  - AI Executive → `ai-executive` (`/ai-growth-command/executive`)
  - Insights Hub → `insights-hub` (`/ai-growth-command/insights`)
  - AI Command → `ai-command`
- Replace the disabled "Coming soon" button with **"Open {Module}"**.
- The info drawer dropped its "coming soon" banner for a live banner + Open CTA,
  while keeping the real per-plan feature matrix.

### 5. Removed Pricing Agent & Campaign Agent from the display

- Both cards are hidden from "Your AI team", "Unlock more agents", and the hero
  agent dots (`visibleAgents()` in `command-center-model.ts`).
- Agent counts are recomputed from the visible roster, so headers and the KPI
  card stay truthful.
- **Backend code is untouched** — the agents still run and their activity still
  appears in the feed; they are only hidden from the card grid.

### 6. Professional polish

- New KPI layout with sparklines, trend badges, and per-metric tooltips.
- Subtle fade-in on freshly loaded cards; smoother hover/lift already present.
- Growth-module cards get clickable affordance + hover highlight.
- 12px typography floor maintained; fixed the one remaining 11px label.
- Dark and light themes both covered for every new surface.

---

## Design & data rules honoured

- ✅ **Zero fake data** — every number is computed from real backend queries
  (`/ai/health`, `/recommendations/summary`, `/ai/agents`). No hardcoded stats.
- ✅ **Plan gating** — agent locks and module availability still respect
  Trial / Start / Growth / Commander.
- ✅ **Upgrade CTAs** always read **"Upgrade Plan"** — never "Upgrade to Growth".
- ✅ No line/donut charts — sparklines only.
- ✅ Backend Pricing/Campaign infrastructure kept intact.

## Testing

- `apps/web/src/command-center-ui.test.ts` — hero KPIs, module cards/drawer,
  store-health empty states, hidden agents, sparkline, series helpers.
- `packages/ai/src/f4-context-rules.test.ts` — new store-health data-sufficiency
  gating tests.
- `apps/api/src/pr46-recommendations-api.test.ts` — snapshot updated to carry
  sufficient order history for the health assertion (the analyze endpoint now
  honestly reports `null` health for thin data).

**Full suite: 172 files / 1871 tests passing. Typecheck green across all
workspaces.**
