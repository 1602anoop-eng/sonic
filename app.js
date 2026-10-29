import { PROVIDERS, callWithRetry } from './providers.js';
import { settings, keys, data } from './storage.js';
import { tasks } from './tasks.js';
import { askAI, localAnswer } from './brain.js';
import { createListener, speak, stopSpeaking } from './voice.js';
import { Avatar } from './avatar.js';

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

const avatar = new Avatar($('#avatar'), settings.get());

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

function say(text) {
  const s = settings.get();
  avatar.setState('speaking');
  speak(text, {
    lang: s.language,
    rate: s.voiceRate,
    enabled: s.voiceOn,
    onEnd: () => avatar.setState('idle')
  });
}

function addNote(text) {
  const d = data.get();
  d.notes.unshift({ id: crypto.randomUUID(), text, at: Date.now() });
  data.set(d);
}

// Returns true if saved, false if it was already there.
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
    return r.duplicate ? 'Ye task pehle se pending hai.' : `Task add ho gaya: ${body}`;
  }
  if (kind === 'note') {
    if (priv) return 'Private mode on hai, note save nahi hoga.';
    addNote(body);
    return 'Note save ho gaya.';
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
    'You are Jarvis, a helpful assistant. Reply in the same language the user uses (Hindi, Hinglish or English). ' + style,
    mem ? `Known facts the user approved:\n${mem}` : '',
    hist ? `Recent conversation:\n${hist}` : '',
    `User: ${userText}`
  ].filter(Boolean).join('\n\n');
}

async function handleInput(raw) {
  const text = raw.trim();
  if (!text) return;
  const s = settings.get();

  addMsg(text, 'user');
  if (!s.privateMode) pushHistory('user', text);

  if (/\b(stop|chup|band karo)\b/i.test(text)) {
    stopSpeaking();
    avatar.setState('idle');
    return;
  }

  avatar.setState('thinking');
  let reply = runCommand(text);
  if (reply === null) reply = localAnswer(text);
  if (reply === null) {
    const r = await askAI(buildPrompt(text), { onStatus: setStatus });
    setStatus('Ready');
    reply = r.ok
      ? r.text
      : `Online AI abhi nahi chal raha (${r.reason}). API Keys tab check karein. Basic commands kaam karte hain: time, date, calculation, "task: ...", "note: ...", "yaad rakho: ...".`;
  }

  addMsg(reply, 'jarvis');
  if (!s.privateMode) pushHistory('jarvis', reply);
  say(reply);
}

$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chatInput').value;
  $('#chatInput').value = '';
  handleInput(v);
};
$('#stopBtn').onclick = () => { stopSpeaking(); avatar.setState('idle'); };

// ---------- Voice input ----------
const listener = createListener({
  onStart: () => {
    avatar.setState('listening');
    $('#micBtn').classList.add('listening');
    setStatus('Sun raha hoon...');
  },
  onEnd: () => {
    $('#micBtn').classList.remove('listening');
    if (avatar.state === 'listening') avatar.setState('idle');
    setStatus('Ready');
  },
  onResult: (t) => handleInput(t),
  onError: (err) => {
    setStatus('Mic error: ' + err);
    avatar.setState('error');
    setTimeout(() => avatar.setState('idle'), 2000);
  }
});
$('#micBtn').onclick = () => {
  if (!listener) {
    setStatus('Is browser mein voice input nahi hai (Chrome use karein)');
    return;
  }
  stopSpeaking();
  listener.start(settings.get().language);
};

// ---------- Tasks ----------
function renderTasks() {
  const box = $('#taskList');
  box.replaceChildren();
  const list = tasks.all();
  if (!list.length) box.append(h('p', { class: 'hint' }, 'Koi task nahi hai.'));
  for (const t of list) {
    box.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', {}, t.title), h('span', { class: `badge ${t.status}` }, t.status)),
      t.due ? h('small', {}, 'Reminder: ' + new Date(t.due).toLocaleString()) : null,
      t.log.length ? h('small', {}, t.log.slice(-2).join(' | ')) : null,
      h('div', { class: 'row' },
        h('button', { class: 'small', disabled: t.status === 'running', onclick: () => runTask(t.id) }, 'Run'),
        h('button', { class: 'small ghost', onclick: () => { tasks.cancel(t.id); renderTasks(); } }, 'Cancel'),
        h('button', { class: 'small ghost', onclick: () => { tasks.remove(t.id); renderTasks(); } }, 'Delete')
      )
    ));
  }
}

async function runTask(id) {
  const t = tasks.all().find((x) => x.id === id);
  if (!t) return;
  if (!t.steps.length) tasks.patch(id, { steps: [{ label: t.title, status: 'pending' }] });
  setStatus('Task chal raha hai...');
  await tasks.run(id, async (label) => {
    const r = await askAI(label, { onStatus: setStatus });
    return r.ok ? { ok: true } : { ok: false, note: r.reason };
  }, { maxRetries: settings.get().retries, onChange: renderTasks });
  setStatus('Ready');
  renderTasks();
}

$('#taskForm').onsubmit = (e) => {
  e.preventDefault();
  const title = $('#taskTitle').value.trim();
  const due = $('#taskDue').value || null;
  if (!title) return;
  if (settings.get().privateMode) { setStatus('Private mode on hai, task save nahi hua'); return; }
  const r = tasks.add({ title, due });
  if (r.duplicate) setStatus('Ye task pehle se pending hai');
  $('#taskTitle').value = '';
  $('#taskDue').value = '';
  renderTasks();
};

// Reminder checker: runs while the app is open. Background reminders need the OS (see README limits).
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
function renderMemory() {
  $('#privateToggle').checked = settings.get().privateMode;
  const box = $('#memList');
  box.replaceChildren();
  const list = data.get().memories;
  if (!list.length) box.append(h('p', { class: 'hint' }, 'Koi memory nahi hai.'));
  for (const m of list) {
    box.append(h('div', { class: 'card row' },
      h('span', {}, m.text),
      h('button', {
        class: 'small ghost',
        onclick: () => {
          const d = data.get();
          d.memories = d.memories.filter((x) => x.id !== m.id);
          data.set(d);
          renderMemory();
        }
      }, 'Delete')
    ));
  }
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
  settings.set({ privateMode: e.target.checked });
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
          h('button', { class: 'small ghost', onclick: () => { keys.remove(id, it.id); renderKeys(); } }, 'Remove')
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
  const set = (patch) => { settings.set(patch); avatar.update(settings.get()); };
  const field = (label, el) => h('label', { class: 'field' }, label, el);
  const bool = (label, key) => field(label,
    h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => set({ [key]: e.target.checked }) }));
  const num = (label, key, min, max) => field(label,
    h('input', { type: 'number', min, max, value: String(s[key]), onchange: (e) => set({ [key]: Number(e.target.value) }) }));
  const choose = (label, key, opts) => field(label,
    h('select', { onchange: (e) => set({ [key]: e.target.value }) },
      ...opts.map(([v, t]) => h('option', { value: v, selected: s[key] === v }, t))));

  box.append(
    choose('Language', 'language', [['hi-IN', 'Hindi'], ['en-IN', 'English (India)'], ['en-US', 'English (US)']]),
    field('Voice speed', h('input', {
      type: 'range', min: 0.5, max: 1.5, step: 0.1, value: String(s.voiceRate),
      onchange: (e) => { set({ voiceRate: Number(e.target.value) }); renderSettings(); }
    })),
    bool('Bolkar jawab dein (voice on)', 'voiceOn'),
    choose('Default AI provider', 'provider', Object.keys(PROVIDERS).map((id) => [id, PROVIDERS[id].name])),
    field('Fallback order (comma se, jaise openai,anthropic)', h('input', {
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
    choose('Avatar theme', 'avatarTheme', [['cyan', 'Cyan'], ['violet', 'Violet'], ['green', 'Green'], ['amber', 'Amber']]),
    bool('Reduced animation', 'reducedMotion'),
    bool('Offline mode (online AI band)', 'offlineOnly'),
    bool('Private mode', 'privateMode'),
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
          avatar.update(settings.get());
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
          avatar.update(settings.get());
          renderSettings();
          setStatus('Settings reset ho gaye');
        }
      }, 'Settings reset'),
      h('button', {
        class: 'small ghost',
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
setStatus('Ready');
addMsg('Namaste! Main Jarvis hoon. Mic dabao ya type karo. Example: "task: kal doodh lana", "yaad rakho: mera naam Rahul hai".', 'jarvis');
