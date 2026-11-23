// Opening hours for shops and chemists, in Kenya time (EAT, UTC+3, no daylight saving).
//   hours: { always: false, days: [ { closed, open: '08:00', close: '21:00' } × 7 (Sunday first) ],
//            override: { state: 'open' | 'closed', until: Date|null, note } }
// The seller controls all of it: their weekly hours, or "closed right now" / "open right now" (for today or
// until they change it back).
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EAT_MS = 3 * 3600 * 1000;

const mins = (value) => {
  const match = TIME.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
// "21:00" → "9:00 PM", "00:00" → "midnight"
const pretty = (value) => {
  const minsResult = mins(value);
  if (minsResult === 0) return 'midnight';
  const amount = Math.floor(minsResult / 60);
  return `${amount % 12 || 12}:${String(minsResult % 60).padStart(2, '0')} ${amount < 12 ? 'AM' : 'PM'}`;
};
const kenyaNow = (date = new Date()) => {
  const day = new Date(date.getTime() + EAT_MS);
  return { day: day.getUTCDay(), min: day.getUTCHours() * 60 + day.getUTCMinutes() };
};
// the end of today, Kenya time
const endOfKenyaDay = (date = new Date()) => {
  const day = new Date(date.getTime() + EAT_MS);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1) - EAT_MS);
};

// one day's opening: { from, to } in minutes; "to" past 1440 means it closes after midnight
const span = (date) => {
  if (!date || date.closed) return null;
  const from = mins(date.open);
  let to = mins(date.close);
  if (from === null || to === null) return null;
  if (to <= from) to += 1440; // e.g. 18:00 – 02:00
  return { from, to };
};

// { open, label, today } or null when the seller hasn't set hours
function openState(hours, at = new Date()) {
  if (!hours || (!hours.always && !hours.days?.length)) return null;
  const override = hours.override;
  if (override?.state && (!override.until || new Date(override.until) > at)) {
    const tonight = override.until && new Date(override.until).getTime() === endOfKenyaDay(at).getTime();
    const until = !override.until ? '' : tonight ? ' for the rest of today' : ` until ${new Date(override.until).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
    const note = override.note ? ` (${override.note})` : '';
    return { open: override.state === 'open', label: override.state === 'open' ? `Open now${note}` : `Closed${until || ' for now'}${note}`, today: todayText(hours, at), override: true };
  }
  if (hours.always) return { open: true, label: 'Open 24 hours', today: 'Open 24 hours' };
  const { day, min } = kenyaNow(at);
  const today = span(hours.days[day]);
  const yesterday = span(hours.days[(day + 6) % 7]);
  if (today && min >= today.from && min < today.to) return { open: true, label: `Open · closes ${today.to >= 1440 ? `${pretty(hours.days[day].close)} (after midnight)` : pretty(hours.days[day].close)}`, today: todayText(hours, at) };
  if (yesterday && yesterday.to > 1440 && min < yesterday.to - 1440) return { open: true, label: `Open · closes ${pretty(hours.days[(day + 6) % 7].close)}`, today: todayText(hours, at) };
  // closed: when does it open next?
  for (let index = 0; index < 8; index++) {
    const distance = (day + index) % 7;
    const spanResult = span(hours.days[distance]);
    if (!spanResult || (index === 0 && spanResult.from <= min)) continue;
    const when = index === 0 ? '' : index === 1 ? ' tomorrow' : ` ${DAYS[distance]}`;
    return { open: false, label: `Closed · opens ${pretty(hours.days[distance].open)}${when}`, today: todayText(hours, at) };
  }
  return { open: false, label: 'Closed', today: 'Closed today' };
}
function todayText(hours, at = new Date()) {
  if (hours.always) return 'Open 24 hours';
  const day = hours.days?.[kenyaNow(at).day];
  return !day || day.closed ? 'Closed today' : `${pretty(day.open)} – ${pretty(day.close)}`;
}

// checks what the seller entered (throws a friendly message)
function cleanHours(hours, httpError) {
  if (!hours) return undefined;
  if (hours.always === true || hours.always === 'true') return { always: true, days: [], override: cleanOverride(hours.override) };
  const days = Array.isArray(hours.days) ? hours.days.slice(0, 7) : [];
  if (days.length !== 7) throw httpError('Set your opening hours for each day of the week');
  const out = days.map((day, index) => {
    if (day?.closed === true || day?.closed === 'true') return { closed: true, open: '', close: '' };
    if (mins(day?.open) === null || mins(day?.close) === null) throw httpError(`${DAYS[index]}: enter opening and closing times like 08:00 and 21:00`);
    if (day.open === day.close) throw httpError(`${DAYS[index]}: opening and closing times are the same. Tick “Open 24 hours” if you never close.`);
    return { closed: false, open: day.open, close: day.close };
  });
  if (out.every((item) => item.closed)) throw httpError('You’re closed every day. Open at least one day.');
  return { always: false, days: out, override: cleanOverride(hours.override) };
}
function cleanOverride(override) {
  if (!override || !['open', 'closed'].includes(override.state)) return undefined;
  const until = override.until ? new Date(override.until) : null;
  if (until && (isNaN(until) || until < new Date())) return undefined;
  return { state: override.state, until, note: String(override.note || '').replace(/[<>]/g, '').trim().slice(0, 60) };
}

// what buyers see: the week, plus whether it's open right now
const publicHours = (hours) => (hours && (hours.always || hours.days?.length) ? { always: !!hours.always, days: hours.always ? [] : hours.days.map((day) => ({ closed: !!day.closed, open: day.open || '', close: day.close || '' })), status: openState(hours) } : null);

module.exports = { DAYS, openState, cleanHours, cleanOverride, publicHours, pretty, endOfKenyaDay, kenyaNow };
