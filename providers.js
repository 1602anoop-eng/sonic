// AI provider adapters. Each provider exposes call(prompt, key, model, timeoutSec).
// Keys are passed in per call; they are never logged or shown in error messages.

export class ProviderError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // INVALID_KEY | QUOTA | RATE_LIMITED | SERVICE_DOWN | NETWORK | TIMEOUT | UNKNOWN
  }
}

function classify(status, body) {
  if (status === 401 || status === 403) return 'INVALID_KEY';
  if (status === 429) return /quota|billing|exhaust|insufficient/i.test(body) ? 'QUOTA' : 'RATE_LIMITED';
  if (status >= 500) return 'SERVICE_DOWN';
  return 'UNKNOWN';
}

async function post(url, headers, body, timeoutSec) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const raw = await res.text();
    if (!res.ok) {
      let detail = '';
      try {
        detail = JSON.parse(raw).error?.message || '';
      } catch {
        detail = raw.slice(0, 120);
      }
      // Hide long tokens so an API key can never appear in the message
      detail = String(detail).replace(/\S{20,}/g, '[hidden]').slice(0, 160);
      throw new ProviderError(classify(res.status, raw), `HTTP ${res.status}: ${detail}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new ProviderError('UNKNOWN', 'Response JSON nahi tha');
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e.name === 'AbortError') throw new ProviderError('TIMEOUT', 'Request timeout');
    throw new ProviderError('NETWORK', 'Network error');
  } finally {
    clearTimeout(timer);
  }
}

function ensureText(s) {
  if (!s || !s.trim()) throw new ProviderError('UNKNOWN', 'Khaali response aaya');
  return s.trim();
}

export const PROVIDERS = {
  gemini: {
    name: 'Gemini',
    async call(prompt, key, model, timeoutSec) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const j = await post(url, { 'x-goog-api-key': key },
        { contents: [{ parts: [{ text: prompt }] }] }, timeoutSec);
      return ensureText(j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(''));
    }
  },
  openai: {
    name: 'OpenAI',
    async call(prompt, key, model, timeoutSec) {
      const j = await post('https://api.openai.com/v1/chat/completions',
        { Authorization: `Bearer ${key}` },
        { model, messages: [{ role: 'user', content: prompt }] }, timeoutSec);
      return ensureText(j.choices?.[0]?.message?.content);
    }
  },
  anthropic: {
    name: 'Anthropic',
    async call(prompt, key, model, timeoutSec) {
      const j = await post('https://api.anthropic.com/v1/messages',
        {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        { model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }, timeoutSec);
      return ensureText(j.content?.filter(b => b.type === 'text').map(b => b.text).join(''));
    }
  },
  groq: {
    name: 'Groq',
    // Groq uses the OpenAI-compatible chat format.
    async call(prompt, key, model, timeoutSec) {
      const j = await post('https://api.groq.com/openai/v1/chat/completions',
        { Authorization: `Bearer ${key}` },
        { model, messages: [{ role: 'user', content: prompt }] }, timeoutSec);
      return ensureText(j.choices?.[0]?.message?.content);
    }
  }
};

// Only transient failures are retried, with bounded attempts and backoff.
// Invalid key and quota errors are NOT retried, and keys are never rotated to get around quotas.
const RETRYABLE = new Set(['RATE_LIMITED', 'SERVICE_DOWN', 'NETWORK', 'TIMEOUT']);

export async function callWithRetry(provider, prompt, key, model, { retries = 2, timeoutSec = 20 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await provider.call(prompt, key, model, timeoutSec);
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof ProviderError && RETRYABLE.has(e.kind);
      if (!retryable || attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
    }
  }
  throw lastErr;
}
