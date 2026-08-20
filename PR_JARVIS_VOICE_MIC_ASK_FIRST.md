# Jarvis: natural human voice, reliable mic permission, and "ask before explaining"

Branch: `arena/01a01dcd-profitpilot-ai`

This PR fixes the three issues merchants hit with Jarvis:

1. **Robotic voice** → Jarvis now speaks with a natural human voice (male **and** female), like ChatGPT, and falls back gracefully to a much-improved browser voice.
2. **Microphone permission prompt never appears** → Jarvis now requests the mic in the page first (so the browser prompt reliably shows) and only falls back to the popup bridge when the iframe truly blocks it.
3. **Jarvis irritates by talking over every page** → Jarvis now **asks first** ("Shall I tell you what's important here?") and only explains when the merchant says yes — and **never re-offers the same page**. Commander actions still require explicit confirmation.

---

## 1. Natural human voice (like ChatGPT)

The browser `speechSynthesis` engine is OS-level and inherently robotic — it can never match a neural TTS voice. Two changes fix this:

### Cloud text-to-speech (new)
- **`packages/ai/src/tts.ts`** — a new OpenAI-compatible TTS provider (`OpenAiTtsProvider`). It calls `POST {base}/audio/speech` and works with OpenAI, Groq, or any compatible gateway. Feminine maps to `shimmer`, masculine to `echo` (both natural). Includes a small LRU memoization cache so repeated greetings/lines are never re-synthesized.
- **`POST /jarvis/tts`** route in `apps/api/src/f8-routes.ts` — returns `audio/mpeg`. Returns **503** when no key is configured so the client falls back to the browser voice instead of hanging. Synthesis failures also degrade to 503.
- **`apps/web/src/jarvis-voice.ts`** — `speak()` now tries the cloud voice **first**, plays it through an `<audio>` element, and falls straight back to the browser voice on any miss. Once the endpoint reports unavailable it is disabled for the session (and re-enabled on the next user gesture) so we never waste a round-trip per reply.
- **`apps/web/src/api.ts`** — `synthesizeJarvisSpeech()` fetches the audio blob and returns a playback-ready object URL (or `null`).

### Browser voice quality fix (always-on)
- **`apps/web/src/voice.ts`** — new `loadSpeechVoices()`. Browser TTS voices load **asynchronously** (`getVoices()` returns `[]` until the `voiceschanged` event fires), so Jarvis was speaking with the OS default robotic voice. The native fallback now warms up the voice list first, so the best available natural/neural voice is actually selected.

**Configuration (optional — works with zero config):**
```env
JARVIS_TTS_API_KEY=            # set to enable neural voice
JARVIS_TTS_BASE_URL=https://api.openai.com/v1
JARVIS_TTS_MODEL=gpt-4o-mini-tts
JARVIS_TTS_VOICE_FEMININE=shimmer
JARVIS_TTS_VOICE_MASCULINE=echo
```
When `JARVIS_TTS_API_KEY` is unset, Jarvis uses the improved browser voice and nothing else changes.

---

## 2. Microphone permission now appears

Previously, inside a framed preview the controller jumped straight to a same-origin popup to capture the mic — which popup blockers routinely swallowed, so **no permission prompt ever appeared and the mic heard nothing**.

**`apps/web/src/jarvis-voice.ts`** `start()` now:
1. Calls `getUserMedia` in **the page first**. This reliably surfaces the browser permission prompt in the main tab (and in modern preview iframes that allow the mic).
2. Only when the page genuinely cannot own the mic (framed + policy-denied) does it open the popup bridge as a fallback.

The in-page path was already there for top-level pages; it is now the first attempt everywhere.

---

## 3. Jarvis asks before explaining (no more irritation)

The Jarvis settings page already promised *"On a new page Jarvis asks first, then explains only if you say yes"* — but `f8.tsx` actually stayed completely silent on page changes. That promise is now delivered.

**`apps/web/src/f8.tsx`**:
- On **first open**: time-based greeting, then (if page guidance is on) Jarvis asks once *"Shall I tell you what's important on Dashboard?"* and waits.
- On **page change**: never dumps a briefing unprompted. It asks the same one-line offer, and only delivers the briefing when the merchant says **yes**.
- **Never re-offers the same page** during a session (`offeredPages`), so it can't nag.
- A direct ask ("what's important here?" / "kya important hai") still explains immediately.
- Respects both settings: **Ask before explaining a new page** (`navigationSuggestions`) and **Only answer when I ask** (`onlyAnswerWhenAsked`).
- **Commander** actions still require explicit confirmation (unchanged, already correct).

The offer copy now matches the request: *"Shall I tell you what's important on [page]?"* / *"Main aapko bataun ki is [page] par kya sabse important hai?"*

---

## Files changed

**Backend**
- `packages/ai/src/tts.ts` *(new)* — OpenAI-compatible TTS provider + factory.
- `packages/ai/src/index.ts` — export tts.
- `apps/api/src/f8-routes.ts` — `POST /jarvis/tts` route; `tts?` on dependencies.
- `apps/api/src/f8-bootstrap.ts` — wire provider from env.
- `.env.example` — document TTS env vars.

**Frontend**
- `apps/web/src/voice.ts` — `loadSpeechVoices()` (fixes robotic default voice).
- `apps/web/src/jarvis-voice.ts` — cloud-first `speak()`, mic `start()` in-page first, cloud audio lifecycle.
- `apps/web/src/api.ts` — `synthesizeJarvisSpeech()`.
- `apps/web/src/f8.tsx` — ask-before-explain behavior; storeId into speak for cloud voice.

**Tests**
- `packages/ai/src/tts.test.ts` *(new, 9 tests)*
- `apps/api/src/f8-routes.test.ts` *(+2 TTS route tests)*
- `apps/web/src/voice.test.ts` *(+1 voices-load test)*
- `apps/web/src/jarvis-voice.test.ts` *(+3: cloud plays, 503 → native fallback, in-page mic when framed)*

---

## Testing
- All new + existing Jarvis tests pass (**62/62**).
- Full build passes (`pnpm -r build`) for `ai`, `api`, and `web`.
- 3 pre-existing failures in `analytics-ui.test.ts` / `final-polish.test.ts` are **unrelated** source-hash snapshot tests that fail on the clean base commit too (confirmed via `git stash`).

## Manual checklist
- [ ] With `JARVIS_TTS_API_KEY` set: Jarvis speaks with a natural neural voice (male & female).
- [ ] Without the key: Jarvis still speaks, using the best browser voice.
- [ ] Tap mic → browser permission prompt appears; mic hears speech.
- [ ] In a framed preview where the page allows the mic → prompt appears in-page (no popup).
- [ ] Open Jarvis → greeting, then one offer. Navigate pages → one offer each (never repeats). Say "yes" → briefing.
- [ ] Commander: actions still ask for confirmation.
