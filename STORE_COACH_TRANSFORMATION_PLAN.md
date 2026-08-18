# Store Coach Transformation Plan — Human-Friendly Coach

> Scope: Store Coach only. No other module is touched.
> Goal: Replace every robotic element, remove duplicated features, add five unique visualizations, fix loading, and deliver warm, honest coaching.

## 1. Remove All Robotic Elements

**Findings:** Current header uses a Compass icon with a presence dot; briefing uses a Compass orb. No literal robot SVG remains, but the feel is still technical (compass + purple gradient without warm illustration). The language in places is still formal.

**Actions:**
- Replace header Compass avatar with a warm Growth Pathway icon: a gentle upward path leading to a star. SVG, not an icon font, with soft gradient and rounded corners. Warm purple to orange gradient, friendly stroke.
- Replace briefing welcome orb with a warm coach illustration: friendly coach silhouette / growth tree / mountain-with-flag motif. Must feel encouraging, not technical. Provide SVG at multiple sizes and check both themes.
- Audit all copy for cold phrasing. Change formal labels to warm personal language: "Building your priorities" becomes encouraging, add "Your Coach is analyzing" style microcopy.
- Update hero eyebrow and subtitles to personal tone.

## 2. Fix Empty and Loading Boxes

**Findings:** Priorities section checks `priorities === null` to show building state, otherwise shows empty or cards. If the backend returns empty array or slow response, the UI can show a bare spinner. No progress pathway or sync context is shown.

**Actions:**
- Debug the data hook `useCoachData` which uses `Promise.allSettled` for 12 fetches. Ensure priorities endpoint is not silently failing and that partial load still renders. Add explicit loading state with progress pathway visualization instead of generic skeleton.
- Enhanced empty state when no priorities: show a four-node pathway (Sync → Setup → Ready → Priorities) with checkmarks, sync progress percentage, and a note like "Need 30+ orders for personalized priorities — currently 12 orders". This must derive from real order count via heatmap or summary payload, not fake numbers.
- Add polished loading animation with educational content and progress indicators, not just a spinner. Fix any backend call that leaves "Loading your priorities" forever by ensuring error is surfaced and retry is offered.

## 3. Remove Voice and Speaking Function Completely

**Findings:** Voice remains in `store-coach-panels.tsx` via `speak()` with speechSynthesis, `Volume2` buttons on coach messages, `Mic` voice input, and `listening` state. Footer shows "voice on higher plans" vs "voice enabled". Preferences and routes still accept `voiceEnabled`.

**Actions:**
- Delete `speak`, `startListening`, `listening` state, `Mic` and `Volume2` imports and buttons from the chat panel, then delete the entire chat panel if chat is removed.
- Remove every string mentioning voice: composer placeholder, footer hint, upgrade prompts, and `voiceAvailable` branching.
- Remove `voiceEnabled` from coach preferences patch and from display logic. Update plan summary to not mention voice.
- Ensure no orphan voice icons remain in briefing or footer.

## 4. Remove Chat Interface Completely

**Findings:** The full chat panel lives in `store-coach-panels.tsx` as `CoachChatPanel`. The main page routes `/coach/chat` to a redirect, but the panel code and related API helpers still exist. The composer, message list, suggestions, rate warning, and clear history still render if the panel is mounted elsewhere.

**Actions:**
- Delete `CoachChatPanel` and its helpers from `store-coach-panels.tsx`. Keep only the onboarding modal.
- Keep the `/coach/chat` route but have it render a small redirect callout, not a chat UI. The main Coach workspace must not embed any chat section.
- Replace with a compact card at the bottom of the main page: "Need to ask your coach a question? Head over to AI Command..." with an "Open AI Command" button that routes to AI Command. Style it warm and minimal so it does not dominate the page.
- Remove chat-related upgrade prompts and counters. Update `COACH_LIMITS` display to omit chat messages if desired, or keep for billing but do not surface on the Store Coach home.
- Verify layout collapses cleanly without the chat column.

## 5. Add Five Unique Visualizations

**Constraint:** Do not use donut charts. Do not reuse sparklines, radial rings, bar charts, semi-circular gauges, stacked bars, area charts, bubble charts, network graphs, radar, word clouds, treemaps, funnel, or heatmap duplicates. Keep the existing heatmap but enhance it.

**Current charts to retire:** `RadialGauge` (radial ring), `Sparkline` (sparkline), `AreaChart` with gradient (area chart), `BarChart` stacked weekly bars (bar chart). These must be replaced.

**New unique components to build:**

- **Coach Progression Path:** Horizontal dotted pathway with milestone nodes. Shows Start through Day 100 with checkmarks for completed days, pulsing current node, locked future nodes. Used in the journey and streak strip area. Built with flex divs and CSS, not Recharts.

- **Momentum Wave:** Weekly momentum wave. Smooth SVG wave path with gradient fill showing daily engagement. X axis is weekdays Monday through Sunday. Unique wave style, not a sparkline or area chart. Built with custom SVG path and gradient, no Recharts.

- **Achievement Constellation:** Star constellation visualization. Stars connected by faint lines, earned stars bright and filled, locked stars dimmed. Beautiful pattern, not a progress bar. Used in achievements section.

- **Weekly Rhythm Beat Bars:** Music beat style horizontal bars. Each weekday gets a horizontal bar showing intensity with labels like Strong beat, Quiet, Building. Different from heatmap and from bar charts by using beat metaphor and custom styling. Rendered with div widths, not Recharts BarChart.

- **Coach Confidence Meter:** Vertical liquid fill meter. Shows coaching accuracy percentage with animated fill effect. Placed near briefing or plan context. Unique vertical container with liquid wave top.

- **Additional required small radar:** Coach personality radar, small, showing current personality traits. Must be distinct from PatternAI radar by being tiny and stylized for Store Coach only.

All five must pull from real data or honest derived state. Empty states must not invent numbers. Each needs both dark and light theme styling with warm coach palette.

## 6. Enhance Today's Briefing

**Actions:**
- Replace cold "Welcome to Store Coach" with warm personal greeting: "Good evening, Pilot" style with coach illustration.
- List clear value bullets: morning briefings, personal priorities, weekly goals, wins celebration.
- Provide two actions: primary "Show Me Today's Insights" and secondary "Learn how it works".
- Ensure the orb is warm illustration, not robot. Keep the three-cell ready state but ensure empty generation uses friendly 4-step language.

## 7. Simplify Weekly Goal Section

**Actions:**
- Change formal heading "AI-SUGGESTED GOALS FROM YOUR REAL DATA" to warm "Coach's Suggestions".
- Show growth pathway visualization for suggested goal progression instead of plain list.
- Improve empty state copy to be encouraging and simple. Keep "Create Your Own Goal" but make it secondary.
- Add note "Track 1 goal on Trial · Unlock more with plans" with Upgrade Plan link.

## 8. Simplify Activity Pattern

**Actions:**
- Keep heatmap. Add rhythm bars enhancement below it: horizontal beat bars for Sun through Mon with intensity and labels, plus a coach insight sentence grounded in the real best weekday.
- Ensure warmer language for insights. Keep "Explore Detailed Patterns" link.

## 9. Enhance Achievements

**Actions:**
- Replace plain streak counter with constellation visualization plus journey path.
- Show earned vs locked badges in constellation style, not just list.
- Add motivational milestone path with dots and progress indicator.
- Keep honest progress: only real earned badges.

## 10. Add Coach Personality Selector Prominence

**Actions:**
- Add dedicated section "Customize Your Coach" with current selection highlighted.
- Show three alternatives: Professional, Motivational, Analytical with brief descriptors.
- Include small personality radar visualization showing trait balance for current coach.
- Mark locked options with Upgrade Plan callout. Ensure persistence via `updateCoachPreferences`.

## 11. Simplify Plan Section

**Actions:**
- Make plan card compact by default: show current inclusions collapsed with "Show more features" toggle.
- Expanded state shows categorized features by plan: Start, Growth, Commander with clear bullet lists.
- Replace long feature list with concise card. Ensure Upgrade Plan button always says Upgrade Plan, never plan names.

## 12. Complete Light Theme

**Actions:**
- Audit `store-coach.css` light overrides. Ensure warm off-white background, white cards with visible borders and soft shadows, warm coach colors (purple primary, orange achievements, green success, blue learning), clear hierarchy, professional but warm feel.
- Test every new visualization in both themes. Ensure text contrast passes, borders are visible, and hover states are smooth.

## 13. Functional Testing

**Header:** Warm logo, greeting with time, streak accuracy, setting gear, no Ask Coach button.
**Briefing:** Warm illustration, welcome message, generate button, learn how it works, real briefing load, no infinite loading.
**Priorities:** Real priorities load, plan limit indicator, regenerate works, empty pathway viz, loading animation.
**Weekly Goal:** AI suggestions load, custom creation works, progress tracking, upgrade prompt.
**Activity Pattern:** Heatmap correct, rhythm bars added, real insights, link works.
**Achievements:** Constellation renders, journey path correct, progress accurate, recent and next lists.
**Personality Selector:** Section displays, current shown, options selectable, locked marked.
**Redirect:** Chat removed, voice removed, Open AI Command callout displays and routes.
**Plan Section:** Compact by default, expands, accurate list, button works.
**Real Data:** All numbers from backend, no fake messages, empty states honest, goals from trends.
**Interactive:** Buttons functional, hover smooth, loading appropriate, error graceful.
**Both Themes:** Dark polished, light premium, toggle smooth, readable, warm.
**Removed Features:** Voice gone, chat gone, no orphans, layout adjusts.
**Plan Restrictions:** Trial limited, upgrade prompts correct, Upgrade Plan text everywhere.

## 14. Implementation Order

1. Remove voice and chat code and strings first to avoid orphans.
2. Replace logo and avatar SVGs and update header and briefing components.
3. Retire banned charts and build five unique visualizations as isolated components.
4. Fix loading and empty states with pathway viz and sync progress.
5. Restructure goal, achievements, activity, personality, and plan sections per warm copy.
6. Polish light theme overrides for all new elements.
7. Update tests to cover new components and assert removals, then run full typecheck and suite.

## 15. Risks and Guards

- Scope guard: touch only `store-coach*` files, `store-coach.css`, and `store-coach-model` helpers. No changes to AI Command Center, Recommendations, Automation, GrowthIQ, or PatternAI.
- Zero fake data guard: every visualization derives from existing payloads or plan matrix. Empty stores show honest placeholders.
- Chart uniqueness guard: manually verify no banned chart type remains via grep for Recharts imports and class names.
- Upgrade wording guard: grep for Upgrade to and replace with Upgrade Plan.

## 16. Deliverables

- New warm coach logo and avatar in both themes.
- Five unique visualizations rendered and tested.
- Fixed loading with honest empty states.
- Voice and chat fully removed with redirect callout.
- Personality selector and compact plan card.
- Light theme premium, dark theme enhanced.
- Complete functional testing report with all checklist items passing and no regressions.
