// Persistent storage in localStorage. Settings can be exported; API keys never can.

const SETTINGS_KEY = 'jarvis.settings';
const KEYS_KEY = 'jarvis.keys';
const DATA_KEY = 'jarvis.data';

export const DEFAULT_SETTINGS = {
  language: 'hi-IN',
  voiceRate: 1,
  voiceOn: true,
  provider: 'groq',
  fallbackOrder: [],
  // Verify the current model ID in Groq's documentation before relying on it.
  models: {
    groq: 'llama-3.3-70b-versatile'
  },
  style: 'short',
  retries: 2,
  timeoutSec: 20,
  offlineOnly: false,
  privateMode: false,
  volume: 1,
  continuous: false,
  expression: 'auto',
  avatarSize: 100,
  avatarBg: '#0b0f1a',
  theme: 'dark',
  accent: '#00e5ff',
  reducedMotion: false,
  confirmDelete: true,
  addressAs: 'boss',
  avatarStyle: 'anime',
  queueOffline: true
};

const read = (k, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export const settings = {
  get() {
    const saved = read(SETTINGS_KEY, {});
    return { ...DEFAULT_SETTINGS, ...saved, models: { ...DEFAULT_SETTINGS.models, ...(saved.models || {}) } };
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    write(SETTINGS_KEY, next);
    return next;
  },
  reset() {
    localStorage.removeItem(SETTINGS_KEY);
  },
  exportJson() {
    return JSON.stringify(this.get(), null, 2);
  },
  importJson(text) {
    const obj = JSON.parse(text);
    const clean = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k in obj) clean[k] = obj[k];
    }
    write(SETTINGS_KEY, { ...DEFAULT_SETTINGS, ...clean });
  }
};

// Shape: { [providerId]: { activeId, items: [{ id, label, value, enabled, status }] } }
export const keys = {
  all() { return read(KEYS_KEY, {}); },
  _save(all) { write(KEYS_KEY, all); },
  _prov(all, p) { return all[p] ?? { activeId: null, items: [] }; },
  list(p) { return this._prov(this.all(), p).items; },
  active(p) {
    const pr = this._prov(this.all(), p);
    const k = pr.items.find(i => i.id === pr.activeId && i.enabled);
    return k ? { ...k } : null;
  },
  add(p, value, label) {
    const all = this.all();
    const pr = this._prov(all, p);
    const item = {
      id: crypto.randomUUID(),
      label: label || `Key ${pr.items.length + 1}`,
      value: value.trim(),
      enabled: true,
      status: 'untested'
    };
    pr.items.push(item);
    if (!pr.activeId) pr.activeId = item.id;
    all[p] = pr;
    this._save(all);
    return item.id;
  },
  patch(p, id, patch) {
    const all = this.all();
    const pr = this._prov(all, p);
    pr.items = pr.items.map(i => (i.id === id ? { ...i, ...patch } : i));
    all[p] = pr;
    this._save(all);
  },
  setActive(p, id) {
    const all = this.all();
    const pr = this._prov(all, p);
    pr.activeId = id;
    all[p] = pr;
    this._save(all);
  },
  remove(p, id) {
    const all = this.all();
    const pr = this._prov(all, p);
    pr.items = pr.items.filter(i => i.id !== id);
    if (pr.activeId === id) pr.activeId = pr.items[0]?.id ?? null;
    all[p] = pr;
    this._save(all);
  },
  mask(v) {
    return '••••' + v.slice(-4);
  }
};

const emptyData = () => ({ notes: [], tasks: [], memories: [], history: [] });

export const data = {
  get() { return { ...emptyData(), ...read(DATA_KEY, {}) }; },
  set(d) { write(DATA_KEY, d); },
  clearData() { write(DATA_KEY, emptyData()); }
};
