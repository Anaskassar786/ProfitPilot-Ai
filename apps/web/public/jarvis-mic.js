(() => {
  const CHANNEL = 'profitpilot:jarvis-voice';
  const search = new URLSearchParams(location.search);
  const rawLang = search.get('lang');
  const LANG = rawLang === 'hi-IN' ? 'hi-IN' : 'en-IN';
  let ORIGIN = '*';
  try {
    if (window.opener && window.opener.location && window.opener.location.origin) {
      ORIGIN = window.opener.location.origin;
    } else if (document.referrer) {
      ORIGIN = new URL(document.referrer).origin;
    }
  } catch {
    ORIGIN = '*';
  }

  let stopped = false;
  let paused = false;
  let rec = null;
  let stream = null;
  const status = document.getElementById('status');
  const heard = document.getElementById('heard');

  function post(kind, extra) {
    extra = extra || {};
    extra.channel = CHANNEL;
    extra.kind = kind;
    try {
      if (window.opener) window.opener.postMessage(extra, ORIGIN);
    } catch {}
  }

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function stopTracks() {
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {}
    });
    stream = null;
  }

  function teardownRec() {
    if (!rec) return;
    rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
    try {
      rec.abort();
    } catch {}
    rec = null;
  }

  function startRec() {
    if (stopped || paused) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      post('error', { message: 'Voice input is not available in this browser.' });
      return;
    }
    teardownRec();
    rec = new Ctor();
    rec.lang = LANG;
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => {
      post('listening');
      setStatus('Listening… speak now.');
    };
    rec.onresult = (event) => {
      const text = Array.prototype.map
        .call(event.results, (result) => (result[0] && result[0].transcript ? result[0].transcript : ''))
        .join(' ')
        .trim();
      if (text) {
        if (heard) heard.textContent = text;
        post('transcript', { text });
      }
    };
    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setStatus('Microphone was blocked. Allow it for this window, then tap Done and try again.');
        post('denied', { message: 'Microphone permission was blocked. Allow the mic in the Jarvis window, then tap the microphone again.' });
        return;
      }
      post('error', { message: 'Could not hear that. Please try again.' });
    };
    rec.onend = () => {
      rec = null;
      if (!stopped && !paused) window.setTimeout(startRec, 180);
    };
    try {
      rec.start();
    } catch {
      window.setTimeout(startRec, 240);
    }
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
    } catch {
      setStatus('Allow the microphone for this window to talk to Jarvis.');
      post('denied', { message: 'Allow the microphone in the Jarvis window, then tap the microphone again.' });
    }
  }

  window.addEventListener('message', (event) => {
    if (ORIGIN !== '*' && event.origin !== ORIGIN) return;
    if (!event.data || event.data.channel !== CHANNEL) return;
    if (event.data.kind === 'pause') {
      paused = true;
      teardownRec();
      setStatus('Paused while Jarvis speaks.');
    }
    if (event.data.kind === 'resume') {
      paused = false;
      setStatus('Listening… speak now.');
      startRec();
    }
    if (event.data.kind === 'stop') {
      stopped = true;
      teardownRec();
      stopTracks();
      window.close();
    }
  });

  const done = document.getElementById('done');
  if (done) {
    done.addEventListener('click', () => {
      stopped = true;
      teardownRec();
      stopTracks();
      post('closed');
      window.close();
    });
  }

  window.addEventListener('beforeunload', () => {
    post('closed');
  });

  boot();
})();
