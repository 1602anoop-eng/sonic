// Task engine.
// States: pending, running, paused, queued (waiting for internet), completed, failed, cancelled.
// Tasks are saved after every change, so they survive app restarts.

import { data } from './storage.js';

const ACTIVE = ['pending', 'running', 'paused', 'queued'];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export const tasks = {
  all() { return data.get().tasks; },

  _save(list) {
    const d = data.get();
    d.tasks = list;
    data.set(d);
  },

  add({ title, due = null, steps = [] }) {
    const list = this.all();
    // Duplicate prevention: same title while still active
    const dup = list.find(t => t.title === title && ACTIVE.includes(t.status));
    if (dup) return { duplicate: true, task: dup };

    const task = {
      id: crypto.randomUUID(),
      title,
      due,
      status: 'pending',
      notified: false,
      createdAt: Date.now(),
      steps: steps.map(label => ({ label, status: 'pending' })),
      log: []
    };
    list.unshift(task);
    this._save(list);
    return { task };
  },

  patch(id, patch) {
    this._save(this.all().map(t => (t.id === id ? { ...t, ...patch } : t)));
  },

  remove(id) {
    this._save(this.all().filter(t => t.id !== id));
  },

  cancel(id) {
    this.patch(id, { status: 'cancelled' });
  },

  // Pausing only changes the status. The run loop stops at its next checkpoint.
  pause(id) {
    const t = this.all().find(x => x.id === id);
    if (t && t.status === 'running') this.patch(id, { status: 'paused' });
  },

  // After an app restart, a task that was running becomes paused, so the user can resume it.
  recoverInterrupted() {
    this._save(this.all().map(t =>
      t.status === 'running' || t.status === 'queued'
        ? { ...t, status: 'paused', log: [...t.log, 'App band hui thi; resume kar sakte hain'] }
        : t
    ));
  },

  dueNow() {
    const now = Date.now();
    return this.all().filter(t =>
      t.due && !t.notified && t.status === 'pending' && Date.parse(t.due) <= now
    );
  },

  // Runs unfinished steps in order, starting from the first step that is not completed (so resume works).
  // A failed step is retried a bounded number of times. Pause or cancel stops the loop at the next checkpoint.
  async run(id, executor, { maxRetries = 2, onChange } = {}) {
    const get = () => this.all().find(t => t.id === id);
    const first = get();
    if (!first || first.status === 'running') return;

    this.patch(id, { status: 'running' });
    onChange?.();

    const start = first.steps.findIndex(s => s.status !== 'completed');
    if (start === -1) {
      this.patch(id, { status: 'completed' });
      onChange?.();
      return;
    }

    for (let i = start; i < first.steps.length; i++) {
      let ok = false;
      let note = '';
      for (let attempt = 0; attempt <= maxRetries && !ok; attempt++) {
        if (get()?.status !== 'running') return; // paused, cancelled or removed
        const r = await executor(first.steps[i].label);
        if (get()?.status !== 'running') return; // paused or cancelled during the step
        ok = !!r.ok;
        note = r.note || '';
        if (!ok && attempt < maxRetries) await sleep(800 * (attempt + 1));
      }

      const task = get();
      if (!task) return;
      const steps = task.steps.map((s, j) => (j === i ? { ...s, status: ok ? 'completed' : 'failed' } : s));
      const log = [...task.log, `Step ${i + 1}: ${ok ? 'ho gaya' : 'fail'}${note ? ' (' + note + ')' : ''}`];
      if (!ok) {
        this.patch(id, { steps, log, status: 'failed' });
        onChange?.();
        return;
      }
      this.patch(id, { steps, log });
      onChange?.();
    }

    if (get()?.status === 'running') this.patch(id, { status: 'completed' });
    onChange?.();
  }
};
