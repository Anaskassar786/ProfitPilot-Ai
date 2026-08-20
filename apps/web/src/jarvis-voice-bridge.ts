import { isFramed } from './voice.js'

export const VOICE_BRIDGE_CHANNEL = 'profitpilot:jarvis-voice'
export const VOICE_BRIDGE_WINDOW_NAME = 'profitpilot-jarvis-mic'

export type VoiceBridgeKind = 'ready' | 'listening' | 'transcript' | 'error' | 'denied' | 'closed' | 'pause' | 'resume' | 'stop'
export type VoiceBridgeMessage = Readonly<{ channel: typeof VOICE_BRIDGE_CHANNEL; kind: VoiceBridgeKind; text?: string; message?: string }>

export type VoiceBridgeSession = Readonly<{
  popup: Window
  close: () => void
  pause: () => void
  resume: () => void
}>

type StartVoiceBridgeOptions = Readonly<{
  scope: Window
  popup: Window
  language: 'en' | 'hi'
  onTranscript: (text: string) => void
  onError: (message: string) => void
  onListening: () => void
  onClosed: () => void
}>

export function isVoiceBridgeMessage(data: unknown): data is VoiceBridgeMessage {
  if (!data || typeof data !== 'object') return false
  const record = data as Partial<VoiceBridgeMessage>
  return record.channel === VOICE_BRIDGE_CHANNEL && typeof record.kind === 'string'
}

export function voiceBridgeEnvelope(kind: VoiceBridgeKind, extra: Readonly<{ text?: string; message?: string }> = {}): VoiceBridgeMessage {
  return { channel: VOICE_BRIDGE_CHANNEL, kind, ...extra }
}

/**
 * Cross-origin iframes (Arena preview, Shopify Admin) usually strip
 * microphone from the child document. A same-origin popup is a top-level
 * browsing context, so getUserMedia and SpeechRecognition work there.
 * Must be called synchronously inside a click handler.
 */
export function reserveVoiceBridge(scope: Window | undefined): Window | null {
  if (!scope || typeof scope.open !== 'function') return null
  try {
    const popup = scope.open('', VOICE_BRIDGE_WINDOW_NAME, 'popup=yes,width=380,height=280,left=72,top=72')
    return popup && !popup.closed ? popup : null
  } catch {
    return null
  }
}

export function startVoiceBridge(options: StartVoiceBridgeOptions): VoiceBridgeSession | null {
  const { scope, popup, language, onTranscript, onError, onListening, onClosed } = options
  if (popup.closed) return null
  const origin = scope.location?.origin || '*'
  try {
    popup.document.open()
    popup.document.write(voiceBridgeDocumentHtml(language, origin))
    popup.document.close()
    popup.focus()
  } catch {
    try { popup.close() } catch { /* ignore */ }
    return null
  }

  let closed = false
  const post = (kind: VoiceBridgeKind): void => {
    try { popup.postMessage(voiceBridgeEnvelope(kind), origin) } catch { /* ignore */ }
  }
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== origin && origin !== '*') return
    if (event.source !== popup) return
    if (!isVoiceBridgeMessage(event.data)) return
    if (event.data.kind === 'transcript' && event.data.text) onTranscript(event.data.text)
    else if (event.data.kind === 'listening' || event.data.kind === 'ready') onListening()
    else if (event.data.kind === 'denied' || event.data.kind === 'error') onError(event.data.message || 'Could not open the microphone. Allow access and try again.')
    else if (event.data.kind === 'closed') finish()
  }
  const poll = scope.setInterval(() => {
    if (popup.closed) finish()
  }, 400)
  const finish = (): void => {
    if (closed) return
    closed = true
    scope.clearInterval(poll)
    scope.removeEventListener('message', onMessage)
    try { if (!popup.closed) popup.close() } catch { /* ignore */ }
    onClosed()
  }

  scope.addEventListener('message', onMessage)
  return {
    popup,
    close: finish,
    pause: () => post('pause'),
    resume: () => post('resume'),
  }
}

export function framedMicrophoneNeedsBridge(scope: Window | undefined, documentScope: Document | undefined): boolean {
  if (!isFramed(scope)) return false
  const policy = (documentScope as (Document & { permissionsPolicy?: { allowsFeature(feature: string): boolean } }) | undefined)?.permissionsPolicy
  if (!policy) return true
  try { return !policy.allowsFeature('microphone') } catch { return true }
}

export function voiceBridgeDocumentHtml(language: 'en' | 'hi', parentOrigin: string): string {
  const lang = language === 'hi' ? 'hi-IN' : 'en-IN'
  const origin = JSON.stringify(parentOrigin)
  const recognitionLang = JSON.stringify(lang)
  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis microphone</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      display: grid; place-items: center;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      background: radial-gradient(circle at 30% 0%, #16324a 0%, #09101f 58%);
      color: #e6f6ff;
    }
    main {
      width: min(100%, 340px); padding: 22px 20px 18px; text-align: center;
    }
    .orb {
      width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%;
      background: radial-gradient(circle at 33% 28%, #c8dcff 0 3%, #72a7ff 12%, #3b82f6 36%, #213c9a 68%, #151d4a 100%);
      box-shadow: 0 0 22px rgba(59,130,246,.7), inset 0 0 16px rgba(255,255,255,.28);
      animation: pulse 1.6s ease-in-out infinite;
    }
    h1 { margin: 0 0 6px; font-size: 18px; letter-spacing: -.03em; }
    p { margin: 0; color: #9fb4c8; font-size: 13px; line-height: 1.45; }
    #heard { min-height: 18px; margin-top: 10px; color: #dff8ff; font-size: 12px; }
    button {
      margin-top: 16px; min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px;
      background: rgba(48,189,240,.18); color: #e6f6ff; font-weight: 650; cursor: pointer;
    }
    @keyframes pulse { 50% { transform: scale(1.06); } }
    @media (prefers-reduced-motion: reduce) { .orb { animation: none; } }
  </style>
</head>
<body>
  <main>
    <div class="orb" aria-hidden="true"></div>
    <h1>Jarvis is listening</h1>
    <p id="status">Allow the microphone if the browser asks, then speak.</p>
    <p id="heard"></p>
    <button type="button" id="done">Done</button>
  </main>
  <script>
    (function () {
      var CHANNEL = ${JSON.stringify(VOICE_BRIDGE_CHANNEL)};
      var ORIGIN = ${origin};
      var LANG = ${recognitionLang};
      var stopped = false;
      var paused = false;
      var rec = null;
      var stream = null;
      var status = document.getElementById('status');
      var heard = document.getElementById('heard');
      function post(kind, extra) {
        extra = extra || {};
        extra.channel = CHANNEL;
        extra.kind = kind;
        try { if (window.opener) window.opener.postMessage(extra, ORIGIN); } catch (e) {}
      }
      function setStatus(text) { if (status) status.textContent = text; }
      function stopTracks() {
        if (!stream) return;
        stream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) {} });
        stream = null;
      }
      function teardownRec() {
        if (!rec) return;
        rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
        try { rec.abort(); } catch (e) {}
        rec = null;
      }
      function startRec() {
        if (stopped || paused) return;
        var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Ctor) { post('error', { message: 'Voice input is not available in this browser.' }); return; }
        teardownRec();
        rec = new Ctor();
        rec.lang = LANG;
        rec.continuous = false;
        rec.interimResults = false;
        rec.onstart = function () { post('listening'); setStatus('Listening… speak now.'); };
        rec.onresult = function (event) {
          var text = Array.prototype.map.call(event.results, function (result) {
            return result[0] && result[0].transcript ? result[0].transcript : '';
          }).join(' ').trim();
          if (text) {
            if (heard) heard.textContent = text;
            post('transcript', { text: text });
          }
        };
        rec.onerror = function (event) {
          if (event.error === 'no-speech' || event.error === 'aborted') return;
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setStatus('Microphone was blocked. Allow it for this window, then tap Done and try again.');
            post('denied', { message: 'Microphone permission was blocked. Allow the mic in the Jarvis window, then tap the microphone again.' });
            return;
          }
          post('error', { message: 'Could not hear that. Please try again.' });
        };
        rec.onend = function () {
          rec = null;
          if (!stopped && !paused) window.setTimeout(startRec, 180);
        };
        try { rec.start(); } catch (e) { window.setTimeout(startRec, 240); }
      }
      async function boot() {
        post('ready');
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            startRec();
            return;
          }
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setStatus('Listening… speak now.');
          startRec();
        } catch (error) {
          setStatus('Allow the microphone for this window to talk to Jarvis.');
          post('denied', { message: 'Allow the microphone in the Jarvis window, then tap the microphone again.' });
        }
      }
      window.addEventListener('message', function (event) {
        if (ORIGIN !== '*' && event.origin !== ORIGIN) return;
        if (!event.data || event.data.channel !== CHANNEL) return;
        if (event.data.kind === 'pause') { paused = true; teardownRec(); setStatus('Paused while Jarvis speaks.'); }
        if (event.data.kind === 'resume') { paused = false; setStatus('Listening… speak now.'); startRec(); }
        if (event.data.kind === 'stop') { stopped = true; teardownRec(); stopTracks(); window.close(); }
      });
      document.getElementById('done').addEventListener('click', function () {
        stopped = true;
        teardownRec();
        stopTracks();
        post('closed');
        window.close();
      });
      window.addEventListener('beforeunload', function () { post('closed'); });
      boot();
    })();
  </script>
</body>
</html>`
}
