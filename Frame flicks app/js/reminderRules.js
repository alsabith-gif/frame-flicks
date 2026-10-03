// reminderRules.js — pure logic: turns calendar data + notification
// preferences into a list of reminders with exact fire times. No DOM, no
// storage, no network (reminders.js does the syncing), so it's easy to test.

export const EVENT_TYPES = {
  shoot: { label: 'Shoot days', main: true, hasTime: true },
  deadline: { label: 'Project deadlines', hasTime: false },
  payment: { label: 'Payment due', hasTime: false },
  meeting: { label: 'Client meetings', hasTime: true },
};

const base = { on: true, dayBefore: false, dayBeforeTime: '18:00', sameDay: true, sameDayTime: '09:00', minutesBefore: 0 };
export const DEFAULT_NOTIF_PREFS = {
  enabled: false, // master switch — turned on when you enable notifications
  shoot: { ...base, dayBefore: true, dayBeforeTime: '18:00', sameDay: true, sameDayTime: '07:00', minutesBefore: 120 },
  deadline: { ...base, dayBefore: true, sameDayTime: '09:00' },
  payment: { ...base, sameDayTime: '10:00' },
  meeting: { ...base, sameDayTime: '08:00', minutesBefore: 30 },
};

export function mergePrefs(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const out = { enabled: !!s.enabled };
  Object.keys(EVENT_TYPES).forEach((k) => {
    out[k] = { ...DEFAULT_NOTIF_PREFS[k], ...(s[k] || {}) };
  });
  return out;
}

// One flat list of everything that can have a reminder.
export function buildEvents(income, meetings) {
  const events = [];
  (income || []).forEach((p) => {
    const name = p.project || 'Project';
    if (p.shootDate) events.push({ id: `shoot-${p.id}`, type: 'shoot', date: p.shootDate, time: '', title: name, client: p.client || '' });
    if (p.dueDate) {
      events.push({ id: `due-${p.id}`, type: 'deadline', date: p.dueDate, time: '', title: name, client: p.client || '' });
      if (p.status !== 'Paid') events.push({ id: `pay-${p.id}`, type: 'payment', date: p.dueDate, time: '', title: name, client: p.client || '', amount: p.amount });
    }
  });
  (meetings || []).forEach((m) => {
    if (!m.date) return;
    events.push({
      id: `mtg-${m.id}`,
      type: m.type === 'shoot' ? 'shoot' : 'meeting',
      date: m.date, time: m.time || '', title: m.title || 'Event', client: m.client || '',
    });
  });
  return events;
}

function at(dateStr, hm, dayOffset = 0) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (hm || '09:00').split(':').map(Number);
  return new Date(y, mo - 1, d + dayOffset, h || 0, mi || 0, 0, 0);
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function minsLabel(m) {
  if (m % 60 === 0) { const h = m / 60; return `${h} hour${h > 1 ? 's' : ''}`; }
  return `${m} min`;
}

const EMOJI = { shoot: '🎬', deadline: '📦', payment: '💰', meeting: '📅' };

function words(ev, when) {
  const name = ev.title;
  const join = (...parts) => parts.filter(Boolean).join(' · ');
  const day = when === 'tomorrow' ? 'tomorrow' : 'today';
  switch (ev.type) {
    case 'shoot':
      return {
        title: `${EMOJI.shoot} Shoot ${when === 'tomorrow' ? 'tomorrow' : when === 'today' ? 'day today' : 'starts in ' + when} — ${name}`,
        body: join(ev.client, ev.time && `Call time ${ev.time}`, when === 'tomorrow' && 'Charge batteries and pack the gear tonight') || 'Get ready!',
      };
    case 'deadline':
      return { title: `${EMOJI.deadline} Delivery due ${day} — ${name}`, body: join(ev.client, "Make sure it's ready to deliver") };
    case 'payment':
      return { title: `${EMOJI.payment} Payment due ${day} — ${name}`, body: join(ev.client, `₹${Number(ev.amount || 0).toLocaleString('en-IN')} pending`) };
    default:
      return { title: `${EMOJI.meeting} Meeting ${when === 'tomorrow' ? 'tomorrow' : when === 'today' ? 'today' : 'in ' + when} — ${name}`, body: join(ev.client, ev.time && `At ${ev.time}`) || name };
  }
}

// Returns reminders that fire in the future (up to horizonDays ahead).
// Each id is stable for the same event + time + wording, so re-syncing never
// creates duplicates and a reminder already sent is never sent twice.
export function buildReminders(events, prefs, now = new Date(), horizonDays = 60) {
  const out = [];
  const limit = now.getTime() + horizonDays * 86400000;
  const url = './index.html?page=calendar';

  function push(ev, slot, fire, when) {
    const t = fire.getTime();
    if (t <= now.getTime() || t > limit) return;
    const { title, body } = words(ev, when);
    out.push({
      id: `${ev.id}:${slot}:${t}:${hash(title + body)}`,
      type: ev.type,
      fire_at: fire.toISOString(),
      title, body, url,
      tag: `${ev.id}:${slot}`,
    });
  }

  events.forEach((ev) => {
    const p = prefs[ev.type];
    if (!p || !p.on) return;
    if (p.dayBefore) push(ev, 'before', at(ev.date, p.dayBeforeTime, -1), 'tomorrow');
    if (p.sameDay) push(ev, 'day', at(ev.date, p.sameDayTime), 'today');
    if (EVENT_TYPES[ev.type].hasTime && ev.time && Number(p.minutesBefore) > 0) {
      const mins = Number(p.minutesBefore);
      push(ev, 'soon', new Date(at(ev.date, ev.time).getTime() - mins * 60000), minsLabel(mins));
    }
  });
  return out.sort((a, b) => a.fire_at.localeCompare(b.fire_at));
}
