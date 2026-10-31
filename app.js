import { PROVIDERS, callWithRetry } from './providers.js';
import { settings, keys, data } from './storage.js';
import { tasks } from './tasks.js';
import { askAI, askVision, localAnswer } from './brain.js';
import { createListener, speak, stopSpeaking } from './voice.js';
import { Avatar } from './avatar.js';
import { parseEmotion, detectEmotion } from './emotion.js';
import { VrmAvatar } from './vrm-avatar.js';
import { saveModel, loadModel, deleteModel } from './vrm-store.js';

const $ = (sel) => document.querySelector(sel);
const setStatus = (t) => { $('#status').textContent = t; };

// Small DOM helper. Text is always set with textContent, so no HTML injection.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (typeof v === 'boolean') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const confirmDelete = (msg) => !settings.get().confirmDelete || confirm(msg);

// Set by Emergency stop. Blocks continuous listening until the user does something again.
let halt = false;

const avatar = new Avatar($('#avatar'), settings.get());
let vrm = null; // created only when the VRM style is used

// Every face call goes to the 2D avatar, and to the VRM model when it is loaded
const face = {
  get state() { return avatar.state; },
  setState(s) { avatar.setState(s); vrm?.setState(s); },
  setEmotion(e) { avatar.setEmotion(e); vrm?.setEmotion(e); },
  pulse() { avatar.pulse(); vrm?.pulse(); },
  update(s) { avatar.update(s); vrm?.update(s); },
  resize() { avatar.resize(); vrm?.resize(); }
};

// Loads the saved VRM model. force = true reloads it after a new upload.
async function ensureVrm(force = false) {
  if (!force && vrm?.loaded) return;
  try {
    const blob = await loadModel();
    if (!blob) {
      setStatus('Pehle VRM file upload karein (Settings)');
      return;
    }
    if (!vrm) vrm = new VrmAvatar($('#vrm'));
    await vrm.load(blob);
    vrm.setState(avatar.state);
    setStatus('VRM model load ho gaya');
  } catch (e) {
    setStatus('VRM load fail: ' + e.message);
  }
}

// Apply theme, accent colour and avatar look from settings
function applySettings() {
  const s = settings.get();
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.style.setProperty('--accent', s.accent);
  const isVrm = s.avatarStyle === 'vrm';
  $('#avatar').hidden = isVrm;
  $('#vrm').hidden = !isVrm;
  const height = Math.round(190 * s.avatarSize / 100) + 'px';
  $('#avatar').style.height = height;
  $('#vrm').style.height = height;
  face.update(s);
  face.resize();
  if (isVrm) ensureVrm();
}
function setSetting(patch) {
  settings.set(patch);
  applySettings();
}
applySettings();

// ---------- Tabs ----------
const renderers = {
  tasks: renderTasks, notes: renderNotes, memory: renderMemory,
  keys: renderKeys, settings: renderSettings
};
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + btn.dataset.tab));
    renderers[btn.dataset.tab]?.();
  };
});

// ---------- Chat ----------
function addMsg(text, who) {
  const log = $('#log');
  log.append(h('div', { class: `msg ${who}` }, text));
  log.scrollTop = log.scrollHeight;
}

function pushHistory(who, text) {
  const d = data.get();
  d.history.push({ who, text, at: Date.now() });
  d.history = d.history.slice(-40);
  data.set(d);
}

function addNote(text) {
  const d = data.get();
  d.notes.unshift({ id: crypto.randomUUID(), text, at: Date.now() });
  data.set(d);
}

// Returns true if saved, false if it already exists.
function remember(text) {
  const d = data.get();
  if (d.memories.some((m) => m.text.toLowerCase() === text.toLowerCase())) return false;
  d.memories.unshift({ id: crypto.randomUUID(), text, at: Date.now() });
  data.set(d);
  return true;
}

// Explicit commands: "task: ...", "note: ...", "yaad rakho: ..." / "remember: ..."
function runCommand(text) {
  const m = text.match(/^(task|note|yaad rakho|remember)\s*[:\-]\s*(.+)$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const body = m[2].trim();
  const priv = settings.get().privateMode;

  if (kind === 'task') {
    if (priv) return 'Private mode on hai, task save nahi hoga.';
    const r = tasks.add({ title: body });
    return r.duplicate ? 'Ye task pehle se active hai.' : `Ji boss, task add ho gaya: ${body}`;
  }
  if (kind === 'note') {
    if (priv) return 'Private mode on hai, note save nahi hoga.';
    addNote(body);
    return 'Ji boss, note save ho gaya.';
  }
  if (priv) return 'Private mode on hai, ye yaad nahi rakhunga.';
  return remember(body) ? `Yaad rakh liya: ${body}` : 'Ye pehle se yaad hai.';
}

function buildPrompt(userText) {
  const s = settings.get();
  const d = data.get();
  const mem = d.memories.slice(0, 20).map((m) => '- ' + m.text).join('\n');
  const hist = d.history.slice(-6)
    .map((m) => `${m.who === 'user' ? 'User' : 'Jarvis'}: ${m.text}`).join('\n');
  const style = s.style === 'short'
    ? 'Jawab chhota aur seedha rakho (2-3 lines).'
    : 'Jawab detail mein do.';
  return [
    `You are Jarvis, a helpful and emotional assistant. Always address the user as "${s.addressAs || 'boss'}". Reply in the same language the user uses (Hindi, Hinglish or English). ${style} Start your reply with exactly one emotion tag: [EMOTION: neutral], [EMOTION: happy], [EMOTION: excited], [EMOTION: sad], [EMOTION: angry], [EMOTION: surprised], [EMOTION: confused] or [EMOTION: thinking]. Pick the tag that matches the feeling of your reply.`,
    mem ? `Known facts the user approved:\n${mem}` : '',
    hist ? `Recent conversation:\n${hist}` : '',
    `User: ${userText}`
  ].filter(Boolean).join('\n\n');
}

async function handleInput(raw) {
  const text = raw.trim();
  if (!text) return;
  halt = false;
  const s = settings.get();

  addMsg(text, 'user');
  if (!s.privateMode) pushHistory('user', text);

  if (/\b(stop|chup|band karo)\b/i.test(text)) {
    emergencyStop();
    return;
  }

  face.setState('thinking');
  let reply = runCommand(text);
  if (reply === null) reply = localAnswer(text);
  if (reply === null) {
    if (!navigator.onLine) {
      reply = 'Abhi internet nahi hai, online AI kaam nahi karega. Aap task banakar baad mein chala sakte hain.';
    } else {
      const r = await askAI(buildPrompt(text), { onStatus: setStatus });
      setStatus('Ready');
      reply = r.ok ? r.text : `Online AI abhi nahi chal raha (${r.reason}). API Keys tab check karein.`;
    }
  }

  const parsed = parseEmotion(reply);
  reply = parsed.text;
  const emotion = parsed.emotion || detectEmotion(reply);
  addMsg(reply, 'jarvis');
  if (!s.privateMode) pushHistory('jarvis', reply);
  say(reply, emotion);
}

// ---------- Voice output ----------
function say(text, emotion = null) {
  const s = settings.get();
  face.setState('speaking');
  face.setEmotion(emotion);
  // Barge-in needs the mic to run while Jarvis speaks
  if (settings.get().bargeIn && s.voiceOn && !halt) setTimeout(() => listen(true), 300);
  speak(text, {
    lang: s.language,
    rate: s.voiceRate,
    volume: s.volume,
    enabled: s.voiceOn,
    onWord: () => face.pulse(),
    onEnd: () => {
      face.setState('idle');
      face.setEmotion(null);
      // Continuous conversation: listen again after the reply, unless the user stopped Jarvis
      const s2 = settings.get();
      if ((s2.continuous || s2.wakeWord) && !halt) listen();
    }
  });
}

// ---------- Voice input ----------
const listener = createListener({
  onStart: () => {
    face.setState('listening');
    $('#micBtn').classList.add('listening');
    setStatus('Sun raha hoon...');
  },
  onEnd: () => {
    $('#micBtn').classList.remove('listening');
    const wasListening = face.state === 'listening';
    if (wasListening) face.setState('idle');
    const s = settings.get();
    // Restart only if we were still waiting for speech (not while thinking or speaking)
    if (wasListening && (s.continuous || s.wakeWord) && !halt) setTimeout(() => listen(speechSynthesis.speaking), 400);
    setStatus(navigator.onLine ? 'Ready' : 'Offline');
  },
  onSpeech: () => {
    // Barge-in: user started talking while Jarvis is speaking
    if (settings.get().bargeIn && speechSynthesis.speaking) {
      stopSpeaking();
      face.setState('listening');
    }
  },
  onResult: (t) => {
    let text = t;
    if (settings.get().wakeWord) {
      const m = t.match(/^\s*(hey|hi|he|ok)\s+(sonic|jarvis|sony)\b[,.!?]?\s*/i);
      if (!m) return; // not addressed to Jarvis: onEnd restarts listening
      text = t.slice(m[0].length);
      if (!text.trim()) { say('Ji boss, bolo.', 'happy'); return; }
    }
    handleInput(text);
  },
  onError: (err) => {
    // In continuous mode, silence is normal. Don't show it as an error.
    if (err === 'no-speech' && settings.get().continuous) return;
    setStatus('Mic error: ' + err);
    face.setState('error');
    setTimeout(() => face.setState('idle'), 2000);
  }
});

function listen(keepSpeaking = false) {
  if (!listener) {
    setStatus('Is browser mein voice input nahi hai (Chrome use karein)');
    return;
  }
  if (!keepSpeaking) stopSpeaking();
  listener.start(settings.get().language);
}

// Emergency stop: silence speech, stop listening, pause running tasks
function emergencyStop() {
  halt = true;
  stopSpeaking();
  listener?.stop();
  face.setState('idle');
  for (const t of tasks.all()) {
    if (t.status === 'running') tasks.pause(t.id);
  }
  setStatus('Ruk gaya (emergency stop)');
  renderTasks();
}

$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chatInput').value;
  $('#chatInput').value = '';
  handleInput(v);
};
$('#stopBtn').onclick = emergencyStop;
$('#micBtn').onclick = () => { halt = false; listen(); };

// ---------- Photo and vision ----------
$('#camBtn').onclick = () => $('#camInput').click();
$('#camInput').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const question = $('#chatInput').value.trim();
  $('#chatInput').value = '';
  addMsg(`📷 Photo bheji${question ? ': ' + question : ''}`, 'user');
  face.setState('thinking');
  try {
    const dataUrl = await imageToDataUrl(f);
    const r = await askVision(question, dataUrl);
    const reply = r.ok ? r.text : `Photo analyze nahi ho payi (${r.reason}).`;
    addMsg(reply, 'jarvis');
    say(reply, detectEmotion(reply));
  } catch {
    addMsg('Photo load nahi hui.', 'jarvis');
    face.setState('error');
    setTimeout(() => face.setState('idle'), 2000);
  }
};

// Resizes the photo to max 1024px and returns a JPEG data URL (keeps the upload small)
function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Image load nahi hui'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Full-screen avatar ----------
$('#fsBtn').onclick = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    $('#avatar').requestFullscreen?.().catch(() => setStatus('Full screen support nahi hai'));
  }
};

// ---------- Tasks ----------
function renderTasks() {
  const box = $('#taskList');
  box.replaceChildren();
  const list = tasks.all();
  if (!list.length) box.append(h('p', { class: 'hint' }, 'Koi task nahi hai.'));
  for (const t of list) {
    const busy = t.status === 'running';
    box.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', {}, t.title), h('span', { class: `badge ${t.status}` }, t.status)),
      t.due ? h('small', {}, 'Reminder: ' + new Date(t.due).toLocaleString()) : null,
      t.steps.length ? h('small', {}, t.steps.map((s) => (s.status === 'completed' ? '✓ ' : '• ') + s.label).join(' | ')) : null,
      t.log.length ? h('small', {}, t.log.slice(-2).join(' | ')) : null,
      h('div', { class: 'row' },
        busy
          ? h('button', { class: 'small', onclick: () => { tasks.pause(t.id); renderTasks(); } }, 'Pause')
          : h('button', {
              class: 'small',
              disabled: t.status === 'completed' || t.status === 'cancelled',
              onclick: () => runTask(t.id)
            }, t.status === 'paused' ? 'Resume' : 'Run'),
        h('button', { class: 'small ghost', onclick: () => { tasks.cancel(t.id); renderTasks(); } }, 'Cancel'),
        h('button', {
          class: 'small ghost',
          onclick: () => { if (confirmDelete('Ye task delete karein?')) { tasks.remove(t.id); renderTasks(); } }
        }, 'Delete')
      )
    ));
  }
}

async function runTask(id) {
  const t = tasks.all().find((x) => x.id === id);
  if (!t || t.status === 'running') return;

  // Offline queue: keep the task until the internet comes back
  if (!navigator.onLine && settings.get().queueOffline) {
    tasks.patch(id, { status: 'queued', log: [...t.log, 'Offline: queue mein rakha'] });
    renderTasks();
    return;
  }

  if (!t.steps.length) tasks.patch(id, { steps: [{ label: t.title, status: 'pending' }] });
  setStatus('Task chal raha hai...');
  await tasks.run(id, async (label) => {
    if (halt) return { ok: false, note: 'stopped' };
    const r = await askAI(label, { onStatus: setStatus });
    return r.ok ? { ok: true } : { ok: false, note: r.reason };
  }, { maxRetries: settings.get().retries, onChange: renderTasks });
  setStatus(navigator.onLine ? 'Ready' : 'Offline');
  renderTasks();
}

// Runs queued tasks when the connection returns
async function flushQueue() {
  for (const t of tasks.all().filter((x) => x.status === 'queued')) {
    await runTask(t.id);
  }
}
window.addEventListener('online', () => { setStatus('Online'); flushQueue(); });
window.addEventListener('offline', () => setStatus('Offline: online AI band hai'));

$('#taskForm').onsubmit = (e) => {
  e.preventDefault();
  const title = $('#taskTitle').value.trim();
  const due = $('#taskDue').value || null;
  if (!title) return;
  if (settings.get().privateMode) { setStatus('Private mode on hai, task save nahi hua'); return; }
  const r = tasks.add({ title, due });
  if (r.duplicate) setStatus('Ye task pehle se active hai');
  $('#taskTitle').value = '';
  $('#taskDue').value = '';
  renderTasks();
};

// Reminder checker: runs while the app is open
setInterval(() => {
  for (const t of tasks.dueNow()) {
    tasks.patch(t.id, { notified: true });
    const msg = `Reminder: ${t.title}`;
    addMsg(msg, 'jarvis');
    say(msg);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Jarvis', { body: msg });
    }
  }
}, 30000);

// ---------- Notes ----------
function renderNotes() {
  const q = $('#noteSearch').value.toLowerCase();
  const box = $('#noteList');
  box.replaceChildren();
  const list = data.get().notes.filter((n) => n.text.toLowerCase().includes(q));
  if (!list.length) box.append(h('p', { class: 'hint' }, 'Koi note nahi mila.'));
  for (const n of list) {
    box.append(h('div', { class: 'card' },
      h('div', {}, n.text),
      h('small', {}, new Date(n.at).toLocaleString()),
      h('button', {
        class: 'small ghost',
        onclick: () => {
          if (!confirmDelete('Ye note delete karein?')) return;
          const d = data.get();
          d.notes = d.notes.filter((x) => x.id !== n.id);
          data.set(d);
          renderNotes();
        }
      }, 'Delete')
    ));
  }
}

$('#noteForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#noteText').value.trim();
  if (!v) return;
  if (settings.get().privateMode) { setStatus('Private mode on hai, note save nahi hua'); return; }
  addNote(v);
  $('#noteText').value = '';
  renderNotes();
};
$('#noteSearch').oninput = renderNotes;

// ---------- Memory ----------
function updateMemory(id, text) {
  const d = data.get();
  d.memories = d.memories.map((m) => (m.id === id ? { ...m, text } : m));
  data.set(d);
  renderMemory();
}

function removeMemory(id) {
  const d = data.get();
  d.memories = d.memories.filter((x) => x.id !== id);
  data.set(d);
  renderMemory();
}

function exportMemory() {
  const blob = new Blob([JSON.stringify(data.get().memories, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'jarvis-memory.json' });
  document.body.append(a);
  a.click();
  a.remove();
}

async function importMemory(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const list = JSON.parse(await f.text());
    const d = data.get();
    for (const m of list) {
      if (typeof m.text !== 'string' || !m.text.trim()) continue;
      if (d.memories.some((x) => x.text.toLowerCase() === m.text.trim().toLowerCase())) continue;
      d.memories.push({ id: crypto.randomUUID(), text: m.text.trim(), at: Date.now() });
    }
    data.set(d);
    renderMemory();
    setStatus('Memory import ho gayi');
  } catch {
    setStatus('Invalid memory file');
  }
}

function renderMemory() {
  $('#privateToggle').checked = settings.get().privateMode;
  const box = $('#memList');
  box.replaceChildren();
  const list = data.get().memories;
  if (!list.length) box.append(h('p', { class: 'hint' }, 'Koi memory nahi hai.'));
  for (const m of list) {
    box.append(h('div', { class: 'card row' },
      h('span', {}, m.text),
      h('div', { class: 'row' },
        h('button', {
          class: 'small ghost',
          onclick: () => {
            const v = prompt('Memory update karein:', m.text);
            if (v && v.trim()) updateMemory(m.id, v.trim());
          }
        }, 'Edit'),
        h('button', {
          class: 'small ghost',
          onclick: () => { if (confirmDelete('Ye memory delete karein?')) removeMemory(m.id); }
        }, 'Delete')
      )
    ));
  }
  box.append(h('div', { class: 'row' },
    h('button', { class: 'small ghost', onclick: exportMemory }, 'Memory export'),
    h('input', { type: 'file', accept: 'application/json', onchange: importMemory })
  ));
}

$('#memForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#memText').value.trim();
  if (!v) return;
  if (settings.get().privateMode) { setStatus('Private mode on hai, save nahi hua'); return; }
  remember(v);
  $('#memText').value = '';
  renderMemory();
};
$('#privateToggle').onchange = (e) => {
  setSetting({ privateMode: e.target.checked });
  renderMemory();
};

// ---------- API key manager ----------
function renderKeys() {
  const box = $('#keyProviders');
  box.replaceChildren();
  for (const id of Object.keys(PROVIDERS)) {
    const p = PROVIDERS[id];
    const items = keys.list(id);
    const active = keys.active(id);
    const valueInput = h('input', { type: 'password', placeholder: `${p.name} API key paste karein`, autocomplete: 'off' });
    const labelInput = h('input', { type: 'text', placeholder: 'Label (optional)' });

    box.append(h('div', { class: 'card' },
      h('h3', {}, p.name),
      h('small', {}, active
        ? `Active: ${keys.mask(active.value)} (status: ${active.status})`
        : 'Koi active key nahi'),
      ...items.map((it) => h('div', { class: 'key' },
        h('div', { class: 'row' },
          h('span', {}, `${it.label}  ${keys.mask(it.value)}  [${it.status}]${it.enabled ? '' : ' (disabled)'}`)),
        h('div', { class: 'row' },
          h('button', { class: 'small', onclick: () => { keys.setActive(id, it.id); renderKeys(); } }, 'Use'),
          h('button', { class: 'small ghost', onclick: () => { keys.patch(id, it.id, { enabled: !it.enabled }); renderKeys(); } },
            it.enabled ? 'Disable' : 'Enable'),
          h('button', {
            class: 'small ghost',
            onclick: async () => {
              setStatus(`${p.name} test ho raha hai...`);
              try {
                await callWithRetry(p, 'Reply with the single word OK.', it.value,
                  settings.get().models[id], { retries: 0, timeoutSec: 15 });
                keys.patch(id, it.id, { status: 'ok' });
                setStatus(`${p.name} test OK`);
              } catch (e) {
                const kind = e.kind || 'UNKNOWN';
                keys.patch(id, it.id, { status: kind === 'INVALID_KEY' ? 'invalid' : kind === 'QUOTA' ? 'quota' : 'untested' });
                setStatus(`${p.name} test fail: ${e.message}`);
              }
              renderKeys();
            }
          }, 'Test'),
          h('button', {
            class: 'small ghost',
            onclick: () => { if (confirmDelete('Ye key remove karein?')) { keys.remove(id, it.id); renderKeys(); } }
          }, 'Remove')
        )
      )),
      labelInput,
      valueInput,
      h('button', {
        class: 'small',
        onclick: () => {
          const v = valueInput.value.trim();
          if (v.length < 8) { setStatus('Key bahut chhoti lag rahi hai'); return; }
          keys.add(id, v, labelInput.value.trim());
          valueInput.value = '';
          renderKeys();
        }
      }, 'Add key')
    ));
  }
}

// ---------- Settings dashboard ----------
function renderSettings() {
  const s = settings.get();
  const box = $('#settingsForm');
  box.replaceChildren();
  const set = (patch) => setSetting(patch);
  const field = (label, el) => h('label', { class: 'field' }, label, el);
  const bool = (label, key) => field(label,
    h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => set({ [key]: e.target.checked }) }));
  const num = (label, key, min, max) => field(label,
    h('input', { type: 'number', min, max, value: String(s[key]), onchange: (e) => set({ [key]: Number(e.target.value) }) }));
  const choose = (label, key, opts) => field(label,
    h('select', { onchange: (e) => set({ [key]: e.target.value }) },
      ...opts.map(([v, t]) => h('option', { value: v, selected: s[key] === v }, t))));
  const slider = (label, key, min, max, step, transform = (x) => x) => field(`${label}: ${transform(s[key])}`,
    h('input', { type: 'range', min, max, step, value: String(s[key]),
      onchange: (e) => { set({ [key]: Number(e.target.value) }); renderSettings(); } }));

  box.append(
    choose('Language', 'language', [['hi-IN', 'Hindi'], ['en-IN', 'English (India)'], ['en-US', 'English (US)']]),
    bool('Bolkar jawab dein (voice on)', 'voiceOn'),
    slider('Voice speed', 'voiceRate', 0.5, 1.5, 0.1),
    slider('Volume', 'volume', 0, 1, 0.1, (x) => Math.round(x * 100) + '%'),
    bool('Continuous conversation (jawab ke baad apne aap sunna)', 'continuous'),
    bool('Barge-in: Jarvis bolte waqt aap bolein to wo ruk jaye (headphones best)', 'bargeIn'),
    field('Vision model (photo analysis ke liye, Groq vision model ID)', h('input', {
      type: 'text', value: s.visionModel,
      onchange: (e) => set({ visionModel: e.target.value.trim() })
    })),
    h('button', {
      class: 'small ghost',
      onclick: async () => {
        try {
          const p = await navigator.permissions.query({ name: 'microphone' });
          setStatus('Mic permission: ' + p.state);
        } catch {
          setStatus('Mic permission check support nahi hai');
        }
      }
    }, 'Mic permission check'),
    bool('Wake word: "Hey SONIC" ya "Hey Jarvis" bolne par hi jawab dein', 'wakeWord'),
    choose('Default AI provider', 'provider', Object.keys(PROVIDERS).map((id) => [id, PROVIDERS[id].name])),
    field('Fallback order (comma se, khali chhod sakte hain)', h('input', {
      type: 'text', value: s.fallbackOrder.join(','),
      onchange: (e) => set({ fallbackOrder: e.target.value.split(',').map((x) => x.trim()).filter((x) => PROVIDERS[x]) })
    })),
    ...Object.keys(PROVIDERS).map((id) => field(`${PROVIDERS[id].name} model`, h('input', {
      type: 'text', value: s.models[id],
      onchange: (e) => set({ models: { ...settings.get().models, [id]: e.target.value.trim() } })
    }))),
    choose('Response style', 'style', [['short', 'Chhota'], ['detailed', 'Detail mein']]),
    num('Retries (0-5)', 'retries', 0, 5),
    num('Timeout seconds (5-60)', 'timeoutSec', 5, 60),
    choose('Theme', 'theme', [['dark', 'Dark'], ['light', 'Light']]),
    field('Accent colour', h('input', { type: 'color', value: s.accent, onchange: (e) => set({ accent: e.target.value }) })),
    slider('Avatar size', 'avatarSize', 60, 140, 10, (x) => x + '%'),
    field('Avatar background', h('input', { type: 'color', value: s.avatarBg, onchange: (e) => set({ avatarBg: e.target.value }) })),
    choose('Avatar style', 'avatarStyle', [['anime', 'Anime'], ['realistic', 'Realistic'], ['vrm', 'VRM 3D model']]),
    field('VRM model upload (.vrm file, sirf is phone mein save hogi)', h('input', {
      type: 'file', accept: '.vrm,.glb',
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          await saveModel(f);
          setSetting({ avatarStyle: 'vrm' });
          await ensureVrm(true);
          renderSettings();
        } catch {
          setStatus('VRM file save nahi hui');
        }
      }
    })),
    h('button', {
      class: 'small ghost',
      onclick: async () => {
        await deleteModel();
        setSetting({ avatarStyle: 'anime' });
        renderSettings();
        setStatus('VRM model hata diya');
      }
    }, 'VRM model hatayein'),
    choose('Avatar expression', 'expression', [
      ['auto', 'Auto (state ke hisaab se)'], ['neutral', 'Neutral'], ['happy', 'Happy'],
      ['excited', 'Excited'], ['sad', 'Sad'], ['angry', 'Angry'], ['surprised', 'Surprised'],
      ['confused', 'Confused'], ['focused', 'Focused'], ['thinking', 'Thinking']
    ]),
    field('Jarvis aapko kya bulaye', h('input', {
      type: 'text', value: s.addressAs,
      onchange: (e) => set({ addressAs: e.target.value.trim() || 'boss' })
    })),
    bool('Reduced animation', 'reducedMotion'),
    bool('Offline mode (online AI band)', 'offlineOnly'),
    bool('Private mode', 'privateMode'),
    bool('Delete se pehle confirm karein', 'confirmDelete'),
    bool('Offline hone par tasks queue mein rakhein', 'queueOffline'),
    h('div', { class: 'row' },
      h('button', {
        class: 'small',
        onclick: async () => {
          if (!('Notification' in window)) { setStatus('Notification support nahi hai'); return; }
          setStatus('Notification: ' + await Notification.requestPermission());
        }
      }, 'Notifications allow karein'),
      h('button', {
        class: 'small ghost',
        onclick: () => {
          const blob = new Blob([settings.exportJson()], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: 'jarvis-settings.json' });
          document.body.append(a);
          a.click();
          a.remove();
        }
      }, 'Settings export')
    ),
    field('Settings import (JSON file)', h('input', {
      type: 'file', accept: 'application/json',
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          settings.importJson(await f.text());
          applySettings();
          renderSettings();
          setStatus('Settings import ho gaye');
        } catch {
          setStatus('Invalid settings file');
        }
      }
    })),
    h('div', { class: 'row' },
      h('button', {
        class: 'small ghost',
        onclick: () => {
          settings.reset();
          applySettings();
          renderSettings();
          setStatus('Settings reset ho gaye');
        }
      }, 'Settings reset'),
      h('button', {
        class: 'small danger',
        onclick: () => {
          if (confirm('Notes, tasks, memory aur chat history delete ho jayenge. Continue?')) {
            data.clearData();
            setStatus('Data delete ho gaya');
            renderSettings();
          }
        }
      }, 'Sara data delete')
    )
  );
}

// ---------- Startup ----------
tasks.recoverInterrupted();
setStatus(navigator.onLine ? 'Ready' : 'Offline');
addMsg('Namaste boss! Main Jarvis hoon. Mic dabao ya type karo. Example: "task: kal doodh lana", "yaad rakho: mera naam Rahul hai".', 'jarvis');
