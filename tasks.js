// Task engine.
// States: pending -> running -> completed | failed | cancelled.
// Tasks are saved after every change, so they survive app restarts.

import { data } from './storage.js';

const ACTIVE = ['pending', 'running'];

export const tasks = {
  all() { return data.get().tasks; },

  _save(list) {
    const d = data.get();
    d.tasks = list;
    data.set(d);
  },

  add({ title, due = null, steps = [] }) {
    const list = this.all();
    // Duplicate prevention: same title while still pending or running.
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

  // After an app restart, a task that was mid-run goes back to pending so the user can resume it.
  recoverInterrupted() {
    this._save(this.all().map(t =>
      t.status === 'running'
        ? { ...t, status: 'pending', log: [...t.log, 'App band hui thi, resume ke liye pending hai'] }
        : t
    ));
  },

  dueNow() {
    const now = Date.now();
    return this.all().filter(t =>
      t.due && !t.notified && t.status === 'pending' && Date.parse(t.due) <= now
    );
  },

  // Runs steps in order. A failed step is retried a bounded number of times, then the task fails.
  // Cancelling mid-run stops the task at the next checkpoint.
  async run(id, executor, { maxRetries = 2, onChange } = {}) {
    const get = () => this.all().find(t => t.id === id);
    if (!get() || get().status === 'running') return;
    this.patch(id, { status: 'running' });
    onChange?.();

    const count = get().steps.length;
    for (let i = 0; i < count; i++) {
      let ok = false;
      let note = '';
      for (let attempt = 0; attempt <= maxRetries && !ok; attempt++) {
        if (get()?.status !== 'running') return;
        const label = get().steps[i].label;
        const r = await executor(label);
        if (get()?.status !== 'running') return; // cancelled while the step was running
        ok = !!r.ok;
        note = r.note || '';
        if (!ok && attempt < maxRetries) {
          await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
        }
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
