// Phone control from chat. Works only inside the SONIC Android app (window.JarvisNative exists there).
// In a normal browser it returns null, and the message goes to the AI as usual.

const APPS = {
  whatsapp: 'com.whatsapp',
  youtube: 'com.google.android.youtube',
  chrome: 'com.android.chrome',
  maps: 'com.google.android.apps.maps',
  gmail: 'com.google.android.gm',
  instagram: 'com.instagram.android'
};

function native(action) {
  try {
    return JSON.parse(window.JarvisNative.run(JSON.stringify(action)));
  } catch {
    return { ok: false, message: 'Phone control kaam nahi kar raha' };
  }
}

// Returns the reply text if the message was a phone command, otherwise null.
export function phoneCommand(text) {
  if (!window.JarvisNative) return null;
  const q = text.toLowerCase();
  let m;

  if (/\b(flashlight|torch)\b/.test(q)) {
    return native({ action: 'flashlight', on: !/\b(off|band)\b/.test(q) }).message;
  }
  if ((m = q.match(/volume\s*(\d{1,3})|(\d{1,3})\s*%?\s*volume/))) {
    return native({ action: 'volume', level: Number(m[1] || m[2]) }).message;
  }
  if ((m = q.match(/alarm\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?/))) {
    let hour = Number(m[1]);
    const minute = Number(m[2] || 0);
    if (m[3] === 'pm' && hour < 12) hour += 12;
    if (m[3] === 'am' && hour === 12) hour = 0;
    return native({ action: 'alarm', hour, minute, label: 'SONIC' }).message;
  }
  if ((m = q.match(/timer\s*(\d+)\s*(second|sec|minute|min|hour|ghanta)/))) {
    const unit = /hour|ghanta/.test(m[2]) ? 3600 : /min/.test(m[2]) ? 60 : 1;
    return native({ action: 'timer', seconds: Number(m[1]) * unit, label: 'SONIC' }).message;
  }
  if ((m = q.match(/(?:open|kholo)\s+(\w+)/)) && APPS[m[1]]) {
    return native({ action: 'openApp', pkg: APPS[m[1]] }).message;
  }
  if ((m = q.match(/settings\s+(wifi|bluetooth|display|sound|battery|apps)/))) {
    return native({ action: 'openSettings', page: m[1] }).message;
  }
  if (/\bcamera\s*(kholo|open)\b/.test(q)) {
    return native({ action: 'camera' }).message;
  }
  if ((m = q.match(/(?:map|maps|navigate|rasta)\s+(.+)/))) {
    return native({ action: 'map', query: m[1] }).message;
  }
  if ((m = q.match(/(?:call|dial)\s+(\+?\d{6,15})/))) {
    return native({ action: 'dial', number: m[1] }).message;
  }
  if (/\b(battery)\b/.test(q)) {
    return native({ action: 'battery' }).message;
  }
  return null;
}
