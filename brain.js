// Brain: local answers (no internet needed) and the online AI router with fallback.

import { PROVIDERS, callWithRetry, ProviderError } from './providers.js';
import { keys, settings } from './storage.js';

// Local answers for simple requests. Returns null when the online AI should answer.
export function localAnswer(text) {
  const q = text.toLowerCase().trim();
  if (/\b(hello|hi|hey|namaste|namaskar)\b/.test(q)) return 'Namaste boss! Main Jarvis hoon. Kya karna hai?';
  if (/\b(time|samay|kitne baje|waqt)\b/.test(q)) return 'Abhi ka time: ' + new Date().toLocaleTimeString();
  if (/\b(date|tareekh|aaj kya hai)\b/.test(q)) return 'Aaj ki date: ' + new Date().toLocaleDateString();
  if (/^[\d\s.+\-*\/()]+$/.test(q)) {
    try {
      const v = Function('"use strict";return (' + q + ')')();
      if (typeof v === 'number' && isFinite(v)) return 'Jawab: ' + v;
    } catch { /* fall through */ }
    return 'Ye calculation samajh nahi aayi.';
  }
  return null;
}

// Tries the preferred provider first, then fallbacks. Only providers with an active key are used.
export async function askAI(prompt, { onStatus } = {}) {
  const s = settings.get();
  if (s.offlineOnly) return { ok: false, reason: 'offline mode on hai' };

  const order = [s.provider, ...s.fallbackOrder.filter(p => p !== s.provider)];
  const problems = [];

  for (const id of order) {
    const provider = PROVIDERS[id];
    const k = keys.active(id);
    if (!provider || !k) continue;

    onStatus?.(`${provider.name} se pooch raha hoon...`);
    try {
      const text = await callWithRetry(provider, prompt, k.value, s.models[id], {
        retries: s.retries,
        timeoutSec: s.timeoutSec
      });
      keys.patch(id, k.id, { status: 'ok' });
      return { ok: true, text, provider: provider.name };
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : 'UNKNOWN';
      problems.push(`${provider.name}: ${kind}`);
      if (kind === 'INVALID_KEY') keys.patch(id, k.id, { status: 'invalid' });
      if (kind === 'QUOTA') keys.patch(id, k.id, { status: 'quota' });
    }
  }

  return { ok: false, reason: problems.join(', ') || 'koi active API key nahi hai' };
}

// Photo analysis: sends a photo and a question to a vision-capable Groq model set in Settings.
export async function askVision(question, imageDataUrl) {
  const s = settings.get();
  if (!s.visionModel) return { ok: false, reason: 'Settings mein Vision model ka naam daalein' };
  const k = keys.active('groq');
  if (!k) return { ok: false, reason: 'Groq key active nahi hai' };
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.value}` },
      body: JSON.stringify({
        model: s.visionModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: question || 'Is photo mein kya hai? Hinglish mein, friendly tone mein batao, aur "boss" se bulao.' },
            { type: 'image_url', image_url: { url: imageDataUrl } }
          ]
        }]
      })
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}: ${String(j?.error?.message || '').slice(0, 140)}` };
    const text = j.choices?.[0]?.message?.content?.trim();
    return text ? { ok: true, text } : { ok: false, reason: 'Khaali jawab aaya' };
  } catch {
    return { ok: false, reason: 'Network error' };
  }
}
