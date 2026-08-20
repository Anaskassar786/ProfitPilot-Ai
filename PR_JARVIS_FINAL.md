# Jarvis: human voice (Fish Audio S2.1 Pro EN+HI male/female) + mic fix + ask-first

Branch: `arena/01a01dcd-profitpilot-ai` → `main`

Fixes the three merchant-facing Jarvis issues plus two production hardening fixes:

1. **Robotic voice** → Jarvis now speaks with a natural, human, neural voice (English + Hindi, male and female) using **Fish Audio S2.1 Pro via OpenRouter**, and gracefully falls back to an improved browser voice when no key is set.
2. **Microphone permission never appears** → Jarvis requests the mic in the page first (so the browser prompt reliably shows) and only falls back to the popup bridge when an iframe truly blocks it.
3. **Jarvis irritates by talking over every page** → it now **asks first** (“Shall I tell you what's important here?”) and only explains when the merchant says **yes**, never re-offering the same page. Commander actions still require explicit confirmation.
4. **CSP-safe mic popup** → popup now loads a real served page (`/jarvis-mic.html` + `/jarvis-mic.js` + `/jarvis-mic.css`) so the app CSP (`script-src 'self'`) allows the external script. The previous `about:blank` + `document.write` inline `<script>` was blocked by CSP and left the Done button dead.
5. **Repeated speech** → `speak()` now de-duplicates identical text within 2 seconds (React StrictMode double-effect guard).

---

## 1. Natural human voice — Fish Audio S2.1 Pro (English + Hindi, male + female)

Browser `speechSynthesis` is OS-level and inherently robotic. Two layers fix this:

### Cloud TTS (new) — `packages/ai/src/tts.ts`
A new OpenAI-compatible TTS provider (`OpenAiTtsProvider`) calls `POST {base}/audio/speech`. It works with any compatible gateway (OpenRouter + Fish Audio/Grok, OpenAI, Groq). Includes an LRU memoization cache, timeouts, and graceful `JarvisTtsUnavailableError` handling.

- **`POST /jarvis/tts`** route (`apps/api/src/f8-routes.ts`) returns `audio/mpeg`; **503** when no key is configured so the client falls back to the browser voice. `tts?` is wired into the Jarvis route dependencies.
- **Provider-safe payload**: the optional `speed` field is **omitted by default** (Fish Audio/Grok strictly validate and reject unknown fields) and exposed via `JARVIS_TTS_SPEED`.
- **Per-language voice selection**: 4 distinct voices — `JARVIS_TTS_VOICE_EN_FEMININE/MASCULINE` and `JARVIS_TTS_VOICE_HI_FEMININE/MASCULINE` — so a Hindi reply uses a Hindi-trained voice and an English reply an English voice. `FEMININE`/`MASCULINE` remain the language-agnostic fallback. `synthesize()` resolves the voice by (language, gender); the cache key includes language.
- Frontend `jarvis-voice.ts` tries the cloud voice **first**, plays it via `<audio>`, and falls back to the browser voice on any miss. Once unavailable it is disabled for the session and re-enabled on the next user gesture.

### Browser voice quality fix (always-on) — `apps/web/src/voice.ts`
New `loadSpeechVoices()` waits for the asynchronous `voiceschanged` event, so Jarvis no longer speaks with the OS default robotic voice (it picked an empty voice list).

### Recommended setup (Railway dashboard — never commit the key)
```env
JARVIS_TTS_API_KEY=sk-or-v1-...                      # OpenRouter key (regenerate the user-provided key — do not commit)
JARVIS_TTS_BASE_URL=https://openrouter.ai/api/v1
JARVIS_TTS_MODEL=fish-audio/s2.1-pro
JARVIS_TTS_RESPONSE_FORMAT=mp3
JARVIS_TTS_VOICE_EN_FEMININE=933563129e564b19a115bedd57b7406a   # fish.audio Sarah
JARVIS_TTS_VOICE_EN_MASCULINE=802e3bc2b27e49c2995d23ef70e6ac89
JARVIS_TTS_VOICE_HI_FEMININE=aab4d9c3cc3f4a7e9dd4a890c682a114
JARVIS_TTS_VOICE_HI_MASCULINE=b79b6174191548d08af0fb6bf0396127
JARVIS_TTS_SPEED=
JARVIS_TTS_TIMEOUT_MS=15000
```
Voice ids are the hex id in a fish.audio voice page URL (`/m/<id>/`). Zero-config alternatives (Grok Voice TTS, OpenAI) are documented in `.env.example`. Without a key, Jarvis uses the improved browser voice.

## 2. Microphone permission now appears — `apps/web/src/jarvis-voice.ts`
`start()` calls `getUserMedia` **in the page first**, which reliably surfaces the browser permission prompt in the main tab and modern preview iframes. The same-origin popup bridge is now only the fallback when the iframe genuinely blocks the mic.

## 3. CSP-safe mic popup — `apps/web/src/jarvis-voice-bridge.ts` + `apps/web/public/jarvis-mic.*`
Previously the popup used `about:blank` + `document.write` with an inline `<script>`, which the app CSP `script-src 'self'` blocks — the Done button was dead and the mic never heard.

Now:
- `apps/web/public/jarvis-mic.html` — minimal page with `<script src="/jarvis-mic.js" defer>` + `<link href="/jarvis-mic.css">`
- `apps/web/public/jarvis-mic.js` — popup logic: `getUserMedia` + `SpeechRecognition` + `postMessage` to opener via channel `profitpilot:jarvis-voice`; reads `?lang=en-IN|hi-IN` from URL; Done button → post `closed` + `close`
- `apps/web/public/jarvis-mic.css` — dark orb styling
- `jarvis-voice-bridge.ts`: `voiceBridgePopupUrl(language)` → `'/jarvis-mic.html?lang=...'`; `reserveVoiceBridge(scope, language)` now does `scope.open(URL)`; `startVoiceBridge` no longer does `document.write` (only `postMessage` listener + poll). `voiceBridgeDocumentHtml` removed.
- `jarvis-voice.ts`: `reserveVoiceBridge(window, language)` call updated.

## 4. Ask before explaining (no irritation) — `apps/web/src/f8.tsx`
Delivers the settings-page promise *"On a new page Jarvis asks first, then explains only if you say yes"*:
- First open → greeting, then one offer.
- Page change → one offer (*"Shall I tell you what's important on Dashboard?"*), never re-offering the same page (`offeredPages`).
- Briefing only on "yes" or a direct ask.
- Respects **Ask before explaining** and **Only answer when I ask**.
- Commander actions still require confirmation.

## 5. Repeated speech fix — `apps/web/src/jarvis-voice.ts`
React StrictMode double-effects / rapid re-renders caused 2–3× same line. `speak()` now has a 2s de-dup guard:
```ts
let lastDedupText = ''; let lastDedupAt = 0;
if (clean === lastDedupText && Date.now() - lastDedupAt < 2000) { onEnd?.(); return }
lastDedupText = clean; lastDedupAt = Date.now();
```

---

## Files changed (vs PR #135 base)
**Backend:** `packages/ai/src/tts.ts` *(new)*, `packages/ai/src/index.ts`, `apps/api/src/f8-routes.ts`, `apps/api/src/f8-bootstrap.ts`, `.env.example`
**Frontend:** `apps/web/src/voice.ts`, `apps/web/src/jarvis-voice.ts`, `apps/web/src/jarvis-voice-bridge.ts`, `apps/web/src/api.ts`, `apps/web/src/f8.tsx`, `apps/web/public/jarvis-mic.html` *(new)*, `apps/web/public/jarvis-mic.js` *(new)*, `apps/web/public/jarvis-mic.css` *(new)*
**Tests:** `packages/ai/src/tts.test.ts` *(new, 12)*, `apps/api/src/f8-routes.test.ts` *(+2)*, `apps/api/src/web-app.test.ts` *(+1 CSP-safe popup test)*, `apps/web/src/voice.test.ts` *(+1)*, `apps/web/src/jarvis-voice.test.ts` *(+4 cloud + in-page mic + dedup)*, `apps/web/src/jarvis-voice-bridge.test.ts` *(CSP-safe URL tests)*

## Testing
- **47/47 Jarvis core tests pass** (6 files: `tts.test.ts`, `f8-routes.test.ts`, `web-app.test.ts`, `voice.test.ts`, `jarvis-voice.test.ts`, `jarvis-voice-bridge.test.ts`); total Jarvis suite ~74 tests pass.
- Full build clean (`corepack pnpm -r run build`).
- 3 pre-existing failures in `analytics-ui.test.ts` / `final-polish.test.ts` are unrelated source-hash snapshot tests that fail on the clean base too (verified via `git stash`).

## Manual checklist
- [ ] With the OpenRouter key + 4 voice ids: Jarvis speaks naturally, Hindi reply → Hindi voice, English reply → English voice, Settings Female/Male both work.
- [ ] Without a key: Jarvis still speaks (best browser voice).
- [ ] Tap mic → browser permission prompt appears; mic hears speech.
- [ ] In a framed preview where the page allows the mic → prompt appears in-page (no popup); where blocked → CSP-safe popup opens at `/jarvis-mic.html?lang=...`, Done works, CSP `script-src 'self'` allows it.
- [ ] Open Jarvis → greeting then one offer; navigate → one offer each (never repeats); "yes" → briefing.
- [ ] Rapid re-renders do not cause repeated speech.
- [ ] Commander: actions still ask for confirmation.
