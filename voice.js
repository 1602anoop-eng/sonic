// Voice input (speech recognition) and output (speech synthesis) using browser Web Speech APIs.

export function speak(text, { lang = 'hi-IN', rate = 1, volume = 1, enabled = true, onEnd, onWord } = {}) {
  if (!enabled || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = /[\u0900-\u097F]/.test(text) ? 'hi-IN' : lang; // Devanagari text uses Hindi voice
  u.rate = rate;
  u.volume = Math.min(1, Math.max(0, volume));
  u.onboundary = (e) => { if (e.name === 'word') onWord?.(); };
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// Returns null if the browser has no speech recognition (e.g. Firefox).
export function createListener({ onStart, onEnd, onSpeech, onResult, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onstart = () => onStart?.();
  rec.onend = () => onEnd?.();
  rec.onerror = (e) => onError?.(e.error);
  rec.onresult = (e) => onResult?.(e.results[0][0].transcript);
  rec.onspeechstart = () => onSpeech?.();

  return {
    start(lang) {
      rec.lang = lang;
      try { rec.start(); } catch { /* already running */ }
    },
    stop() {
      try { rec.abort(); } catch { /* not running */ }
    }
  };
}
