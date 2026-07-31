/* Fast — a minimal offline fasting timer.
 *
 * Everything is derived from one stored number: the fast's start timestamp.
 * Nothing counts up in memory, so closing the app, reloading, going offline
 * or letting the phone sleep can't drift the clock.
 */
'use strict';

/* ── Fasting stages ───────────────────────────────────────────────────
 * Hour boundaries are typical ranges, not hard switches — they shift with
 * your last meal, carb intake, training and how fat-adapted you are.
 */
const STAGES = [
  {
    name: 'Fed & anabolic',
    from: 0, to: 4,
    body: 'Your last meal is still being digested and absorbed. Insulin is ' +
          'elevated, blood sugar is up, and the body is storing rather than ' +
          'releasing energy. Nothing to do here but let the clock run.',
    benefits: [
      'Nutrients from your last meal are being absorbed and stored',
      'Muscle repair and glycogen top-up happen in this window',
      'Fat burning is paused while insulin is high — that is normal'
    ]
  },
  {
    name: 'Post-absorptive',
    from: 4, to: 8,
    body: 'Digestion winds down. Blood sugar drifts back to baseline and ' +
          'insulin falls, which is the signal that flips the body from ' +
          'storing to spending. The liver starts releasing stored glycogen ' +
          'to hold glucose steady.',
    benefits: [
      'Insulin drops — the switch that unlocks stored fuel',
      'Liver glycogen becomes the main energy source',
      'Digestive system gets its first real rest of the day'
    ]
  },
  {
    name: 'Glycogen depletion',
    from: 8, to: 12,
    body: 'Liver glycogen is running low, so the body starts leaning on fat. ' +
          'Fatty acids are pulled from storage and the first ketones appear. ' +
          'Hunger often comes in waves here rather than climbing steadily.',
    benefits: [
      'Fat breakdown (lipolysis) ramps up as glycogen thins out',
      'Early ketone production begins',
      'Insulin sensitivity starts improving'
    ]
  },
  {
    name: 'Ketosis onset',
    from: 12, to: 16,
    body: 'Glycogen is mostly spent and the liver converts fat into ketones ' +
          'in earnest. Many people notice steadier energy and sharper focus ' +
          'once the brain has ketones to run on. This is the payoff zone of ' +
          'a standard 16:8.',
    benefits: [
      'Ketones become a meaningful fuel for brain and muscle',
      'Steadier energy without the post-meal crash',
      'Fat is now the primary fuel source'
    ]
  },
  {
    name: 'Fat-burning ramp',
    from: 16, to: 18,
    body: 'Ketone levels keep climbing and fat oxidation is in full swing. ' +
          'Growth hormone rises to protect lean tissue while fat is being ' +
          'used, and the earliest autophagy signals switch on.',
    benefits: [
      'Peak fat-burning for a typical daily fast',
      'Growth hormone rises, helping preserve muscle',
      'Early cellular clean-up signalling begins'
    ]
  },
  {
    name: 'Autophagy',
    from: 18, to: 24,
    body: 'Autophagy — the cell\'s recycling program — picks up. Damaged ' +
          'proteins and worn-out cell parts get broken down and reused. ' +
          'Insulin sits near its floor and growth hormone continues to climb.',
    benefits: [
      'Cellular clean-up and recycling accelerate',
      'Growth hormone continues rising',
      'Inflammation markers tend to fall'
    ]
  },
  {
    name: 'Deep autophagy',
    from: 24, to: Infinity,
    body: 'Past a full day, autophagy deepens and the body starts recycling ' +
          'older immune cells. Fat is essentially the only fuel. Long fasts ' +
          'ask more of you — hydrate, add electrolytes, and ease off hard ' +
          'training.',
    benefits: [
      'Autophagy approaches its strongest sustained levels',
      'Immune-cell renewal begins',
      'IGF-1 falls; metabolic flexibility improves'
    ]
  }
];

const PRESETS = [
  { h: 13, label: '13h', note: 'circadian' },
  { h: 16, label: '16h', note: '16:8' },
  { h: 18, label: '18h', note: '18:6' },
  { h: 20, label: '20h', note: '20:4' },
  { h: 24, label: '24h', note: 'one day' },
  { h: 36, label: '36h', note: 'extended' }
];

/* ── Storage ──────────────────────────────────────────────────────── */
const KEY = { current: 'fast.current', goal: 'fast.lastGoal', hist: 'fast.history' };
const HISTORY_MAX = 30;
const MS_H = 3600000;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.warn('storage read failed', key, e);
    return fallback;
  }
}
function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('storage write failed', key, e);
  }
}

/* current = { startedAt: epochMs, goalHours: number } | null */
let current = load(KEY.current, null);
let goalHours = load(KEY.goal, 16);
let history = load(KEY.hist, []);
let lastSaved = null;          // the history entry shown in the summary sheet

if (current && (typeof current.startedAt !== 'number' || !(current.goalHours > 0))) {
  current = null;
  save(KEY.current, null);
}
if (!Array.isArray(history)) history = [];
if (!(goalHours > 0)) goalHours = 16;

/* ── Formatting ───────────────────────────────────────────────────── */
const pad = n => String(n).padStart(2, '0');

function hms(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

/** "16h" / "16h 30m" — for goals and durations in prose. */
function humanHours(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt  = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** Days between two dates, ignoring time of day. */
function dayDelta(from, to) {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to);   b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

/** "14:30", "14:30 tomorrow", "14:30 Sat", "14:30 3 Aug" */
function whenLabel(date, now = new Date()) {
  const t = timeFmt.format(date);
  const d = dayDelta(now, date);
  if (d === 0) return t;
  if (d === 1) return `${t} tomorrow`;
  if (d === -1) return `${t} yesterday`;
  if (d > 1 && d < 7) return `${t} ${dayFmt.format(date)}`;
  return `${t} ${dateFmt.format(date)}`;
}

/** Value for <input type="datetime-local"> — local time, no timezone suffix. */
function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
         `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ── Stage helpers ────────────────────────────────────────────────── */
function stageIndexAt(hours) {
  for (let i = STAGES.length - 1; i >= 0; i--) if (hours >= STAGES[i].from) return i;
  return 0;
}
function stageRange(s) {
  return s.to === Infinity ? `${s.from}h+` : `${s.from}–${s.to}h`;
}

/* ── DOM ──────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const el = {
  timerView: $('timerView'), historyView: $('historyView'), navBtn: $('navBtn'),
  ringFill: $('ringFill'), ringLabel: $('ringLabel'), ringSub: $('ringSub'),
  elapsed: $('elapsed'),
  goalPicker: $('goalPicker'), presets: $('presets'),
  customForm: $('customForm'), customHours: $('customHours'),
  runFacts: $('runFacts'), factStart: $('factStart'), factEnd: $('factEnd'),
  editStartBtn: $('editStartBtn'), primaryBtn: $('primaryBtn'),
  stageTitle: $('stageTitle'), stageRange: $('stageRange'),
  stageBody: $('stageBody'), stageBenefits: $('stageBenefits'),
  timeline: $('timeline'),
  historyList: $('historyList'), historyEmpty: $('historyEmpty'),
  clearHistoryBtn: $('clearHistoryBtn'),
  editSheet: $('editSheet'), editForm: $('editForm'), startInput: $('startInput'),
  editError: $('editError'),
  summarySheet: $('summarySheet'), summaryTitle: $('summaryTitle'),
  summaryLine: $('summaryLine'), summaryGoal: $('summaryGoal'),
  summaryStages: $('summaryStages'), summaryDone: $('summaryDone'),
  discardBtn: $('discardBtn')
};

const RING_C = 2 * Math.PI * 88;   // matches r=88 in index.html

/* ── Render ───────────────────────────────────────────────────────── */
let lastStageIdx = -1;
let lastTimelineGoal = null;

function render() {
  const running = !!current;
  const now = Date.now();
  const elapsedMs = running ? now - current.startedAt : 0;
  const hours = elapsedMs / MS_H;
  const goal = running ? current.goalHours : goalHours;
  const pct = Math.min(1, hours / goal);

  /* Ring + clock */
  el.ringFill.style.strokeDashoffset = String(RING_C * (1 - pct));
  el.ringFill.classList.toggle('over', running && hours >= goal);
  el.elapsed.textContent = running ? hms(elapsedMs) : '0:00:00';
  el.ringLabel.textContent = running ? 'Elapsed' : 'Ready';
  el.ringSub.textContent = running
    ? (hours >= goal
        ? `Goal ${humanHours(goal)} reached · ${Math.round(hours / goal * 100)}%`
        : `${Math.round(pct * 100)}% of ${humanHours(goal)}`)
    : `Goal ${humanHours(goal)}`;

  /* Idle vs running chrome */
  el.goalPicker.hidden = running;
  el.runFacts.hidden = !running;
  el.primaryBtn.textContent = running ? 'End fast' : 'Start fast';
  el.primaryBtn.classList.toggle('stop', running);

  if (running) {
    const startDate = new Date(current.startedAt);
    const endDate = new Date(current.startedAt + goal * MS_H);
    el.factStart.textContent = whenLabel(startDate, new Date(now));
    el.factEnd.textContent = whenLabel(endDate, new Date(now));
  }

  /* Stage card — only touch the DOM when the stage actually changes */
  const idx = stageIndexAt(running ? hours : 0);
  if (idx !== lastStageIdx) {
    const s = STAGES[idx];
    el.stageTitle.textContent = s.name;
    el.stageRange.textContent = stageRange(s);
    el.stageBody.textContent = s.body;
    el.stageBenefits.replaceChildren(...s.benefits.map(b => {
      const li = document.createElement('li');
      li.textContent = b;
      return li;
    }));
    lastStageIdx = idx;
    lastTimelineGoal = null;      // force a timeline repaint
  }
  if (lastTimelineGoal !== goal || el.timeline.childElementCount === 0) {
    renderTimeline(idx, goal, running);
    lastTimelineGoal = goal;
  } else {
    markTimeline(idx);
  }
}

function renderTimeline(activeIdx, goal, running) {
  el.timeline.replaceChildren(...STAGES.map((s, i) => {
    const li = document.createElement('li');
    li.className = 'tl-item';
    li.dataset.i = String(i);

    const head = document.createElement('div');
    head.className = 'tl-h';
    const when = document.createElement('span');
    when.className = 'tl-when';
    when.textContent = stageRange(s);
    const name = document.createElement('span');
    name.className = 'tl-name';
    name.textContent = s.name;
    head.append(when, name);
    li.append(head);

    if (!running && s.from >= goal) li.style.opacity = '.55';
    return li;
  }));
  markTimeline(activeIdx);
}

function markTimeline(activeIdx) {
  for (const li of el.timeline.children) {
    const i = Number(li.dataset.i);
    li.classList.toggle('done', i < activeIdx);
    li.classList.toggle('current', i === activeIdx && !!current);
    li.classList.toggle('upcoming', i > activeIdx);
  }
}

function renderGoalChips() {
  const known = PRESETS.some(p => p.h === goalHours);
  const chips = PRESETS.map(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(p.h === goalHours));
    b.append(document.createTextNode(p.label));
    const small = document.createElement('small');
    small.textContent = p.note;
    b.append(small);
    b.addEventListener('click', () => setGoal(p.h));
    return b;
  });

  const custom = document.createElement('button');
  custom.type = 'button';
  custom.className = 'chip';
  custom.setAttribute('aria-pressed', String(!known));
  custom.append(document.createTextNode(known ? 'Custom' : humanHours(goalHours)));
  const small = document.createElement('small');
  small.textContent = 'set hours';
  custom.append(small);
  custom.addEventListener('click', () => {
    el.customForm.hidden = !el.customForm.hidden;
    if (!el.customForm.hidden) {
      el.customHours.value = String(goalHours);
      el.customHours.focus();
    }
  });
  chips.push(custom);

  el.presets.replaceChildren(...chips);
}

function setGoal(h) {
  goalHours = h;
  save(KEY.goal, h);
  el.customForm.hidden = true;
  renderGoalChips();
  lastTimelineGoal = null;
  render();
}

/* ── History ──────────────────────────────────────────────────────── */
function renderHistory() {
  el.historyEmpty.hidden = history.length > 0;
  el.clearHistoryBtn.hidden = history.length === 0;
  el.historyList.replaceChildren(...history.map(f => {
    const li = document.createElement('li');
    const hrs = f.durationMs / MS_H;
    const hit = hrs >= f.goalHours;

    const date = document.createElement('span');
    date.className = 'h-date';
    date.textContent = dateFmt.format(new Date(f.startedAt));

    const dur = document.createElement('span');
    dur.className = 'h-dur';
    dur.textContent = humanHours(hrs);

    const goal = document.createElement('span');
    goal.className = 'h-goal';
    goal.textContent = `goal ${humanHours(f.goalHours)}`;

    const badge = document.createElement('span');
    badge.className = 'badge' + (hit ? ' hit' : '');
    badge.textContent = hit ? 'hit' : 'short';

    li.append(date, dur, goal, badge);
    return li;
  }));
}

/* ── Actions ──────────────────────────────────────────────────────── */
function startFast() {
  current = { startedAt: Date.now(), goalHours };
  save(KEY.current, current);
  lastStageIdx = -1;
  lastTimelineGoal = null;
  render();
}

function endFast() {
  if (!current) return;
  const entry = {
    id: String(current.startedAt),
    startedAt: current.startedAt,
    endedAt: Date.now(),
    goalHours: current.goalHours,
    durationMs: Math.max(0, Date.now() - current.startedAt)
  };
  history.unshift(entry);
  history = history.slice(0, HISTORY_MAX);
  save(KEY.hist, history);

  current = null;
  save(KEY.current, null);
  lastSaved = entry;
  lastStageIdx = -1;
  lastTimelineGoal = null;
  render();
  renderHistory();
  showSummary(entry);
}

function showSummary(f) {
  const hrs = f.durationMs / MS_H;
  const hit = hrs >= f.goalHours;
  const reached = STAGES.filter(s => hrs >= s.from);

  el.summaryTitle.textContent = hit ? 'Goal reached' : 'Fast ended';
  el.summaryLine.textContent = hms(f.durationMs);
  el.summaryGoal.textContent = hit
    ? `${humanHours(hrs)} against a ${humanHours(f.goalHours)} goal — nice.`
    : `${humanHours(hrs)} of a ${humanHours(f.goalHours)} goal. Still counts.`;
  el.summaryStages.replaceChildren(...reached.map(s => {
    const li = document.createElement('li');
    li.textContent = `${s.name} (${stageRange(s)})`;
    return li;
  }));
  el.summarySheet.hidden = false;
}

function discardLast() {
  if (lastSaved) {
    history = history.filter(f => f.id !== lastSaved.id);
    save(KEY.hist, history);
    renderHistory();
  }
  lastSaved = null;
  el.summarySheet.hidden = true;
}

/* ── Edit start time ──────────────────────────────────────────────── */
function openEditSheet() {
  if (!current) return;
  el.startInput.value = toLocalInput(new Date(current.startedAt));
  el.editError.hidden = true;
  el.editSheet.hidden = false;
}

function submitEdit(e) {
  e.preventDefault();
  const value = el.startInput.value;
  if (!value) return;
  const ts = new Date(value).getTime();
  const now = Date.now();
  if (Number.isNaN(ts)) return fail('That does not look like a valid time.');
  if (ts > now + 60000) return fail('Start time can\'t be in the future.');
  if (now - ts > 14 * 24 * MS_H) return fail('That\'s more than 14 days ago.');

  current.startedAt = Math.min(ts, now);
  save(KEY.current, current);
  el.editSheet.hidden = true;
  lastStageIdx = -1;
  render();

  function fail(msg) {
    el.editError.textContent = msg;
    el.editError.hidden = false;
  }
}

/* ── View switching ───────────────────────────────────────────────── */
function toggleView() {
  const showHistory = el.historyView.hidden;
  el.historyView.hidden = !showHistory;
  el.timerView.hidden = showHistory;
  el.navBtn.setAttribute('aria-label', showHistory ? 'Timer' : 'History');
  if (showHistory) renderHistory();
}

/* ── Wire up ──────────────────────────────────────────────────────── */
el.primaryBtn.addEventListener('click', () => (current ? endFast() : startFast()));
el.editStartBtn.addEventListener('click', openEditSheet);
el.editForm.addEventListener('submit', submitEdit);
el.navBtn.addEventListener('click', toggleView);
el.summaryDone.addEventListener('click', () => {
  lastSaved = null;
  el.summarySheet.hidden = true;
});
el.discardBtn.addEventListener('click', discardLast);
el.clearHistoryBtn.addEventListener('click', () => {
  history = [];
  save(KEY.hist, history);
  renderHistory();
});
el.customForm.addEventListener('submit', e => {
  e.preventDefault();
  const h = Number(el.customHours.value);
  if (h >= 1 && h <= 72) setGoal(h);
});
for (const b of document.querySelectorAll('[data-close]')) {
  b.addEventListener('click', () => { el.editSheet.hidden = true; });
}
for (const sheet of [el.editSheet, el.summarySheet]) {
  sheet.addEventListener('click', e => {
    if (e.target === sheet && sheet === el.editSheet) sheet.hidden = true;
  });
}

/* The phone sleeps, the interval stalls — repaint the moment we're back. */
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
window.addEventListener('pageshow', render);

renderGoalChips();
renderHistory();
render();
setInterval(render, 1000);

/* ── Service worker ───────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  // On the very first visit there is no controller yet; claiming one then is
  // the normal install path, not an update — don't bounce the page for it.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW failed', e));
  });
}
