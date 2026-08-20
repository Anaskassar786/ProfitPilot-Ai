# Jarvis → voice-only assistant (no chat panel), page aware, plan aware

## What changed

Jarvis was a second chat window competing with AI Command, its orb was small, and
it never actually spoke. It is now a **voice assistant only**.

### 1. The chat panel is gone
- Removed the Jarvis chat panel entirely: message timeline, composer, suggestion
  chips, preference footer, streaming transcript, and their CSS
  (`.jarvis-panel*`, `.jarvis-messages`, `.jarvis-composer`, `.jarvis-voice-inline`,
  the old floating widget).
- Tapping the orb now opens a small draggable **voice bar** (`JarvisVoiceBar.tsx`)
  with exactly three controls, as requested:
  - **microphone on/off**
  - **pause / resume**
  - **close**
- Nothing Jarvis says is printed on screen — the bar shows one state word
  (Listening / Thinking / Speaking / Paused / Mic off) and nothing else. Typing
  stays in AI Command.
- The launcher orb is bigger: `48px → 64px` inside a `100px` hit area.
- The particle-orb animation is untouched (`JarvisOrb.tsx` and `jarvis-orb.css`
  are byte-for-byte identical — the existing hash contract still passes).

### 2. Why it did not speak — and the fix
`apps/web/src/jarvis-speech.ts` (new) replaces the naive `speechSynthesis.speak()`
call. Root causes found and fixed:

| Root cause | Fix |
|---|---|
| Replies were only spoken when the turn came from voice; typed/briefing text never was | Every reply now goes through one speech path |
| `getVoices()` is empty on first call in Chrome/Edge, so the utterance had no voice and was dropped | `loadVoices()` waits for `voiceschanged` with a timeout |
| Autoplay policy silently discards speech started outside a user gesture | `unlockSpeech()` primes the engine inside the click that opens Jarvis |
| Chrome stops speaking after ~15s | `resume()` keep-alive pump while speaking |
| A stale queue blocks new utterances | every call cancels first |
| Long replies get truncated | text is chunked on sentence boundaries |
| Markdown/URLs/ids were read aloud | `normalizeForSpeech()` strips them (including the `@jarvis:action` protocol line) |
| Failures left the orb stuck in "speaking" | watchdog + `onerror` always release the mic and report a plain-language reason |

The voice is chosen to sound human: neural/cloud voices win, then `en-IN` / `hi-IN`
locales, and compact/robotic voices are penalised.

### 3. Listening loop
`jarvis-voice.ts` is now a real hands-free state machine: it stops listening while
Jarvis speaks (no more transcribing itself), restarts quietly after silence with a
back-off, distinguishes recoverable errors (`no-speech`, `aborted`) from blocking
ones (`not-allowed`), and exposes `micEnabled` / `paused` for the bar.

### 4. Page aware, without nagging
When voice is on, moving to a page produces **one short spoken briefing about that
page** — an observation plus a suggestion:
- at most once per page per session,
- at most once a minute (`BRIEFING_COOLDOWN_MS`),
- never while paused, muted, or mid-answer,
- never when the merchant chose Quiet / Answer-only / "only when asked" / 5-minute silence.

Briefings now work on **every plan** (guidance is the assistant's job); the model
writes them, with a grounded deterministic fallback when the AI provider is down.

### 5. Plan aware: suggest vs. act
- **Trial / Start / Growth** — insight, suggestions, read actions (revenue, orders,
  low stock, list automations) and navigation.
- **Commander** — Jarvis can also *do* it, after a spoken confirmation:
  - `create_automation` — builds a real workflow from the template library as a
    **draft** on the Automation page (drafts never fire on their own),
  - `set_automation_status` — pause / activate / archive,
  - `generate_report` — real closed-period report via the existing report service,
  - `approve_recommendation` / `reject_recommendation`, `trigger_sync`.
- Missing details are now a **question, not a failure**: "Which automation should I
  set up?", "Which period should the report cover — daily, weekly, monthly, or
  quarterly?" (`DETAILS_REQUIRED` outcome, audited like every other attempt).
- Navigation (`navigate_page`) runs in the browser on every plan — opening a page
  the merchant already pays for carries zero risk.
- Billing behaviour and the trial/plan gating are unchanged.

### 6. Store-only, professional persona
The system prompt is voice-first (1–2 spoken sentences, no markdown, no ids) and
strictly store-scoped. General-knowledge, news, politics, sport, entertainment and
coding questions are refused **before** the model is called, with a friendly
redirect back to the store, in English or Hinglish to match the merchant.

### 7. Unrelated red tests fixed
- `ai-command.css`: theme-agnostic `.aic-ring` rules had been appended inside the
  light-theme section — moved above it, so the "light overrides stay scoped" contract
  passes again.
- `analytics-ui`: the sort-label contract now accepts both shipped spellings
  (`Sort` and `Sort by`) instead of failing on Inventory/Customers.

## Tests
- New: `jarvis-speech.test.ts` (13 tests — voice selection, chunking, sanitising,
  actual synthesis, blocked-audio handling).
- Rewritten: `f8-ui.test.ts` (voice-only surface, no chat, briefing throttle,
  action parsing, navigation mapping, confirm/cancel, language detection),
  `jarvis-voice.test.ts` (mic toggle, pause/resume, speak-then-listen),
  `JarvisVoiceBar.test.ts` (renamed from `FloatingVoiceWidget.test.ts`).
- Updated backend contracts in `jarvis-actions.test.ts` and `f8-jarvis-copilot.test.ts`.
- Full suite: **2781 passed, 0 failed**. `pnpm -r typecheck` and `pnpm -r build` clean.
