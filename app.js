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

/* ── Achievements ─────────────────────────────────────────────────────
 * Everything here is a pure function of the history log, so a badge can be
 * granted retroactively on the first load after an update — past fasts count.
 * `test` is applied by earnedAt() below; this list is display order too.
 */
const ACHIEVEMENTS = [
  { id: 'first',  icon: '🌱', name: 'First fast',   hint: 'Finish one fast' },
  { id: 'h12',    icon: '🔑', name: 'Ketosis',      hint: 'Reach 12h' },
  { id: 'h16',    icon: '🔥', name: 'Sixteen',      hint: 'Reach 16h' },
  { id: 'h18',    icon: '🧬', name: 'Autophagy',    hint: 'Reach 18h' },
  { id: 'h24',    icon: '🌗', name: 'Full day',     hint: 'Reach 24h' },
  { id: 'n5',     icon: '🥉', name: 'Five fasts',   hint: '5 completed' },
  { id: 'n10',    icon: '🥈', name: 'Ten fasts',    hint: '10 completed' },
  { id: 'n25',    icon: '🥇', name: 'Twenty-five',  hint: '25 completed' },
  { id: 's3',     icon: '⚡', name: '3-day streak', hint: '3 days running' },
  { id: 's7',     icon: '🌊', name: '7-day streak', hint: '7 days running' },
  { id: 's14',    icon: '🚀', name: '14-day streak', hint: '14 days running' },
  { id: 'goal10', icon: '🎯', name: 'Ten on target', hint: 'Hit goal 10×' }
];

/* ── Mood ─────────────────────────────────────────────────────────── */
const MOODS = [
  { v: 1, icon: '😩', label: 'Drained' },
  { v: 2, icon: '😕', label: 'Low' },
  { v: 3, icon: '😐', label: 'Okay' },
  { v: 4, icon: '🙂', label: 'Good' },
  { v: 5, icon: '😄', label: 'Great' }
];
const MOOD_BY_VALUE = new Map(MOODS.map(m => [m.v, m]));
const MOOD_BUCKETS = [
  { label: 'under 14h', test: h => h < 14 },
  { label: '14–18h',    test: h => h >= 14 && h <= 18 },
  { label: 'over 18h',  test: h => h > 18 }
];
const MOOD_MIN_SAMPLES = 3;   // below this the average is noise, so we hide it

/* ── Storage ──────────────────────────────────────────────────────── */
const KEY = {
  current: 'fast.current', goal: 'fast.lastGoal', hist: 'fast.history',
  ach: 'fast.achievements'
};
/* A year of fasts. The stats strip reports lifetime figures — total fasts,
   longest fast, longest streak — so the log has to outlive the window they're
   read over. At ~120 bytes an entry this is ~45KB, nothing against the
   localStorage budget. (Was 30 before the stats existed.) */
const HISTORY_MAX = 365;
const MS_H = 3600000;
/* The widest epoch Date and Intl can format. A finite number outside this
   range is corrupt, not merely old, and formatting it throws a RangeError. */
const TS_MAX = 8.64e15;

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
let achievements = load(KEY.ach, {});
let lastSavedId = null;        // id of the history entry shown in the summary sheet

if (current && (typeof current.startedAt !== 'number' || !(current.goalHours > 0))) {
  current = null;
  save(KEY.current, null);
}
if (!(goalHours > 0)) goalHours = 16;

const num = v => typeof v === 'number' && Number.isFinite(v);
const validTs = v => num(v) && Math.abs(v) <= TS_MAX;

if (!achievements || typeof achievements !== 'object' || Array.isArray(achievements)) {
  achievements = {};
} else {
  /* A badge carrying an unformattable timestamp would throw inside Intl on the
     very first render and take the whole app down before it painted. Drop the
     bad value — syncAchievements() below regrants it from history. */
  for (const id of Object.keys(achievements)) {
    if (!validTs(achievements[id])) delete achievements[id];
  }
}

/** Entries written before r2 have no `mood`, and a crash mid-write can leave a
 *  half-formed one. Repair what's recoverable, drop what isn't — every consumer
 *  below can then assume the four core fields exist and are formattable. */
function sanitizeHistory(list) {
  if (!Array.isArray(list)) return [];
  const ids = new Set();
  return list
    .map(f => {
      if (!f || typeof f !== 'object') return null;
      const e = Object.assign({}, f);
      /* Lose either the duration or the end time and the other two fields still
         pin it down. Reconstruct before discarding — this is someone's log. */
      if (!num(e.durationMs) && validTs(e.startedAt) && validTs(e.endedAt)) {
        e.durationMs = e.endedAt - e.startedAt;
      }
      if (!validTs(e.startedAt) || !num(e.durationMs) || e.durationMs < 0) return null;
      if (!validTs(e.endedAt)) e.endedAt = e.startedAt + e.durationMs;
      if (!validTs(e.endedAt)) return null;
      if (!(e.goalHours > 0)) e.goalHours = 16;
      const m = Math.round(Number(e.mood));
      if (m >= 1 && m <= 5) e.mood = m; else delete e.mood;
      /* Ids key the mood writes and the delete-this-fast escape hatch, so a
         collision would silently rewrite or remove the wrong fast. */
      if (typeof e.id !== 'string') e.id = String(e.startedAt);
      while (ids.has(e.id)) e.id += '-';
      ids.add(e.id);
      return e;
    })
    .filter(Boolean)
    .slice(0, HISTORY_MAX);
}

const rawHistory = JSON.stringify(history);
history = sanitizeHistory(history);
/* Only write back if we actually changed something — no pointless churn (and
   no write at all on the overwhelmingly common clean-load path). */
if (JSON.stringify(history) !== rawHistory) save(KEY.hist, history);
/* Mid-fast goal edits: the chips must reflect the running fast, not the
   remembered idle default. */
if (current) goalHours = current.goalHours;

/* ── Formatting ───────────────────────────────────────────────────── */
const pad = n => String(n).padStart(2, '0');

function hms(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

/** "16h" / "16h 30m" — for goals and durations in prose. Round to whole minutes
 *  first, then split: rounding the remainder on its own turns 16.999h into
 *  "16h 60m", which the 7-day average would hit most weeks. */
function humanHours(hours) {
  const mins = Math.round(hours * 60);
  const m = mins % 60;
  return m ? `${Math.floor(mins / 60)}h ${m}m` : `${Math.floor(mins / 60)}h`;
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

/* ── Derived stats ────────────────────────────────────────────────────
 * Nothing here is stored. Streaks, totals and averages are recomputed from
 * `history` on every render, so an edited start time or a deleted fast is
 * reflected immediately and there's no second store to drift out of sync.
 */

/** The local calendar day as an integer. Doing the arithmetic in UTC on the
 *  already-localised Y/M/D keeps it right across DST, where a naive
 *  midnight-to-midnight millisecond division is off by an hour twice a year. */
function dayIndex(ts) {
  const d = new Date(ts);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/** Unique calendar days a fast ENDED on, ascending. Two fasts on one day count
 *  once; a backdated fast lands on whatever day its end time says. */
function endDays(list) {
  return [...new Set(list.map(f => dayIndex(f.endedAt)))].sort((a, b) => a - b);
}

function meanBy(list, fn) {
  return list.length ? list.reduce((a, x) => a + fn(x), 0) / list.length : null;
}

function computeStats(list, now = Date.now()) {
  const st = {
    total: list.length, current: 0, longest: 0, longestFast: null,
    avg7: null, goalRate: null, moodCount: 0, moodAvg: null, buckets: []
  };
  if (!list.length) return st;

  /* reduce, not Math.max(...spread) — a long log would blow the argument limit */
  st.longestFast = list.reduce((a, f) => Math.max(a, f.durationMs), 0);
  st.goalRate = Math.round(
    list.filter(f => f.durationMs / MS_H >= f.goalHours).length / list.length * 100);

  const today = dayIndex(now);
  const recent = list.filter(f => dayIndex(f.endedAt) > today - 7);
  st.avg7 = meanBy(recent, f => f.durationMs);

  const days = endDays(list);
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = (i > 0 && days[i] === days[i - 1] + 1) ? run + 1 : 1;
    if (run > st.longest) st.longest = run;
  }
  /* The current streak survives today: you may simply not have ended a fast
     yet, so a run that reached yesterday is still live. It breaks once a whole
     calendar day passes with nothing ending on it. */
  if (days[days.length - 1] >= today - 1) {
    st.current = 1;
    for (let i = days.length - 1; i > 0 && days[i - 1] === days[i] - 1; i--) st.current++;
  }

  const moods = list.filter(f => f.mood >= 1 && f.mood <= 5);
  st.moodCount = moods.length;
  st.moodAvg = meanBy(moods, f => f.mood);
  st.buckets = MOOD_BUCKETS.map(b => {
    const inBucket = moods.filter(f => b.test(f.durationMs / MS_H));
    return { label: b.label, n: inBucket.length, avg: meanBy(inBucket, f => f.mood) };
  });
  return st;
}

/** { achievementId: epochMs } for everything the log currently satisfies. The
 *  timestamp is the end of the fast that earned it, not "now" — so a badge
 *  granted retroactively still shows the day it was actually reached. */
function earnedAt(list) {
  const out = {};
  const mark = (id, ts) => { if (out[id] === undefined) out[id] = ts; };
  const done = list.slice().sort((a, b) => a.endedAt - b.endedAt);

  let n = 0, hits = 0;
  for (const f of done) {
    n++;
    const hrs = f.durationMs / MS_H;
    if (n === 1) mark('first', f.endedAt);
    if (n === 5) mark('n5', f.endedAt);
    if (n === 10) mark('n10', f.endedAt);
    if (n === 25) mark('n25', f.endedAt);
    if (hrs >= 12) mark('h12', f.endedAt);
    if (hrs >= 16) mark('h16', f.endedAt);
    if (hrs >= 18) mark('h18', f.endedAt);
    if (hrs >= 24) mark('h24', f.endedAt);
    if (hrs >= f.goalHours && ++hits === 10) mark('goal10', f.endedAt);
  }

  const lastEndOnDay = new Map();
  for (const f of done) {
    const d = dayIndex(f.endedAt);
    lastEndOnDay.set(d, Math.max(lastEndOnDay.get(d) || 0, f.endedAt));
  }
  const days = endDays(done);
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = (i > 0 && days[i] === days[i - 1] + 1) ? run + 1 : 1;
    if (run === 3) mark('s3', lastEndOnDay.get(days[i]));
    if (run === 7) mark('s7', lastEndOnDay.get(days[i]));
    if (run === 14) mark('s14', lastEndOnDay.get(days[i]));
  }
  return out;
}

/** Grant anything newly satisfied and persist it. Returns the fresh unlocks in
 *  display order so the summary sheet can name them. Unlocks are sticky: an
 *  earned badge survives clearing the history or the log rolling past
 *  HISTORY_MAX — that's the whole reason they're stored rather than derived. */
function syncAchievements() {
  const earned = earnedAt(history);
  const fresh = ACHIEVEMENTS.filter(
    a => earned[a.id] !== undefined && achievements[a.id] === undefined);
  for (const a of fresh) achievements[a.id] = earned[a.id];
  if (fresh.length) save(KEY.ach, achievements);
  return fresh;
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
  nextBlock: $('nextBlock'), nextTitle: $('nextTitle'), nextRange: $('nextRange'),
  nextUnlock: $('nextUnlock'), nextBody: $('nextBody'), nextBenefits: $('nextBenefits'),
  timeline: $('timeline'),
  historyList: $('historyList'), historyEmpty: $('historyEmpty'),
  clearHistoryBtn: $('clearHistoryBtn'), historyHead: $('historyHead'),
  statsBlock: $('statsBlock'), statStreakTile: $('statStreakTile'),
  statStreak: $('statStreak'), statBestStreak: $('statBestStreak'),
  statTotal: $('statTotal'), statLongest: $('statLongest'),
  statAvg7: $('statAvg7'), statGoalRate: $('statGoalRate'),
  statMood: $('statMood'),
  achBlock: $('achBlock'), achCount: $('achCount'), achGrid: $('achGrid'),
  editSheet: $('editSheet'), editForm: $('editForm'), startInput: $('startInput'),
  editError: $('editError'),
  summarySheet: $('summarySheet'), summaryTitle: $('summaryTitle'),
  summaryLine: $('summaryLine'), summaryGoal: $('summaryGoal'),
  summaryUnlocks: $('summaryUnlocks'), moodRow: $('moodRow'),
  summaryStages: $('summaryStages'), summaryDone: $('summaryDone'),
  discardBtn: $('discardBtn')
};

const RING_C = 2 * Math.PI * 88;   // matches r=88 in index.html

/* ── Render ───────────────────────────────────────────────────────── */
let lastStageIdx = -1;
let lastNextIdx = -2;
let lastTimelineGoal = null;
let lastDay = -1;

function benefitItems(list) {
  return list.map(b => {
    const li = document.createElement('li');
    li.textContent = b;
    return li;
  });
}

/** "in 3h 12m" / "in 42m" — countdown to the next stage boundary. */
function untilLabel(hoursLeft) {
  const mins = Math.max(1, Math.ceil(hoursLeft * 60));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function render() {
  const running = !!current;
  const now = Date.now();

  /* Streaks and the 7-day window are measured against "today", so they go
     stale the instant the date rolls over — or when the phone wakes up days
     after it went to sleep with the history screen open. Both land here,
     because visibilitychange and pageshow repaint through render(). */
  const today = dayIndex(now);
  if (today !== lastDay) {
    const first = lastDay === -1;
    lastDay = today;
    if (!first) renderHistory();
  }

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

  /* Idle vs running chrome — the goal picker stays visible while running so
     the goal can be changed mid-fast. */
  el.goalPicker.hidden = false;
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
    el.stageBenefits.replaceChildren(...benefitItems(s.benefits));
    lastStageIdx = idx;
    lastTimelineGoal = null;      // force a timeline repaint
  }

  /* Next-up card — full details of the stage about to unlock */
  const nextIdx = idx + 1 < STAGES.length ? idx + 1 : -1;
  el.nextBlock.hidden = nextIdx === -1;
  if (nextIdx !== -1) {
    const n = STAGES[nextIdx];
    if (nextIdx !== lastNextIdx) {
      el.nextTitle.textContent = n.name;
      el.nextRange.textContent = stageRange(n);
      el.nextBody.textContent = n.body;
      el.nextBenefits.replaceChildren(...benefitItems(n.benefits));
      lastNextIdx = nextIdx;
    }
    el.nextUnlock.textContent = running
      ? `Unlocks in ${untilLabel(n.from - hours)}`
      : `Unlocks ${n.from}h into a fast`;
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

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'tl-h';
    head.setAttribute('aria-expanded', 'false');
    const when = document.createElement('span');
    when.className = 'tl-when';
    when.textContent = stageRange(s);
    const name = document.createElement('span');
    name.className = 'tl-name';
    name.textContent = s.name;
    const chev = document.createElement('span');
    chev.className = 'tl-chev';
    chev.textContent = '+';
    head.append(when, name, chev);

    const detail = document.createElement('div');
    detail.className = 'tl-detail';
    detail.hidden = true;
    const body = document.createElement('p');
    body.textContent = s.body;
    const ul = document.createElement('ul');
    ul.className = 'benefits';
    ul.append(...benefitItems(s.benefits));
    detail.append(body, ul);

    head.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      chev.textContent = detail.hidden ? '+' : '–';
      head.setAttribute('aria-expanded', String(!detail.hidden));
    });

    li.append(head, detail);

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
  if (current) {
    current.goalHours = h;
    save(KEY.current, current);
  }
  el.customForm.hidden = true;
  renderGoalChips();
  lastTimelineGoal = null;
  render();
}

/* ── History ──────────────────────────────────────────────────────── */
function renderHistory() {
  const any = history.length > 0;
  el.historyEmpty.hidden = any;
  el.clearHistoryBtn.hidden = !any;
  el.historyHead.hidden = !any;
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

    const mood = document.createElement('span');
    mood.className = 'h-mood';
    const m = MOOD_BY_VALUE.get(f.mood);
    if (m) {
      mood.textContent = m.icon;
      mood.title = m.label;
    }

    const goal = document.createElement('span');
    goal.className = 'h-goal';
    goal.textContent = `goal ${humanHours(f.goalHours)}`;

    const badge = document.createElement('span');
    badge.className = 'badge' + (hit ? ' hit' : '');
    badge.textContent = hit ? 'hit' : 'short';

    li.append(date, dur, mood, goal, badge);
    return li;
  }));
  renderStats();
  renderAchievements();
}

/* ── Stats strip ──────────────────────────────────────────────────── */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function renderStats() {
  el.statsBlock.hidden = history.length === 0;
  if (!history.length) return;

  const s = computeStats(history);
  el.statStreakTile.classList.toggle('on', s.current > 0);
  el.statStreak.textContent = plural(s.current, 'day');
  el.statBestStreak.textContent = plural(s.longest, 'day');
  el.statTotal.textContent = String(s.total);
  el.statLongest.textContent = humanHours(s.longestFast / MS_H);
  el.statAvg7.textContent = s.avg7 === null ? '—' : humanHours(s.avg7 / MS_H);
  el.statGoalRate.textContent = `${s.goalRate}%`;

  renderMoodSummary(s);
}

/** Bold-label prose rather than a chart — three numbers don't earn axes. */
function renderMoodSummary(s) {
  el.statMood.hidden = s.moodCount < MOOD_MIN_SAMPLES;
  if (el.statMood.hidden) return;

  const parts = [strong('Mood'), document.createTextNode(' averages ')];
  parts.push(strong(s.moodAvg.toFixed(1)), document.createTextNode(` of 5 across ${
    plural(s.moodCount, 'check-in')}`));

  /* A bucket holding one check-in isn't an average, it's an anecdote. */
  const shown = s.buckets.filter(b => b.n >= 2);
  if (shown.length > 1) {
    parts.push(document.createTextNode(' — '));
    shown.forEach((b, i) => {
      if (i) parts.push(document.createTextNode(', '));
      parts.push(document.createTextNode(`${b.label} `), strong(b.avg.toFixed(1)));
    });
  }
  parts.push(document.createTextNode('.'));
  el.statMood.replaceChildren(...parts);

  function strong(text) {
    const s2 = document.createElement('strong');
    s2.textContent = text;
    return s2;
  }
}

/* ── Achievements grid ────────────────────────────────────────────── */
function renderAchievements() {
  const unlocked = ACHIEVEMENTS.filter(a => achievements[a.id] !== undefined).length;
  el.achBlock.hidden = history.length === 0 && unlocked === 0;
  el.achCount.textContent = `${unlocked} of ${ACHIEVEMENTS.length}`;
  el.achGrid.replaceChildren(...ACHIEVEMENTS.map(a => {
    const at = achievements[a.id];
    const li = document.createElement('li');
    li.className = 'ach' + (at === undefined ? '' : ' on');
    li.dataset.id = a.id;

    const icon = document.createElement('span');
    icon.className = 'ach-icon';
    icon.textContent = a.icon;

    const name = document.createElement('span');
    name.className = 'ach-name';
    name.textContent = a.name;

    const meta = document.createElement('span');
    meta.className = 'ach-meta';
    meta.textContent = at === undefined ? a.hint : dateFmt.format(new Date(at));

    li.append(icon, name, meta);
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
  lastSavedId = entry.id;
  lastStageIdx = -1;
  lastTimelineGoal = null;
  const fresh = syncAchievements();
  render();
  renderHistory();
  showSummary(entry, fresh);
}

function showSummary(f, fresh = []) {
  const hrs = f.durationMs / MS_H;
  const hit = hrs >= f.goalHours;
  const reached = STAGES.filter(s => hrs >= s.from);

  el.summaryTitle.textContent = hit ? 'Goal reached' : 'Fast ended';
  el.summaryLine.textContent = hms(f.durationMs);
  el.summaryGoal.textContent = hit
    ? `${humanHours(hrs)} against a ${humanHours(f.goalHours)} goal — nice.`
    : `${humanHours(hrs)} of a ${humanHours(f.goalHours)} goal. Still counts.`;

  el.summaryUnlocks.hidden = fresh.length === 0;
  el.summaryUnlocks.replaceChildren(...fresh.map(a => {
    const p = document.createElement('p');
    p.className = 'unlocked';
    p.textContent = `Unlocked: ${a.icon} ${a.name}`;
    return p;
  }));

  renderMoodPicker(f);

  el.summaryStages.replaceChildren(...reached.map(s => {
    const li = document.createElement('li');
    li.textContent = `${s.name} (${stageRange(s)})`;
    return li;
  }));
  el.summarySheet.hidden = false;
}

/* ── Mood check-in ────────────────────────────────────────────────── */
/** Optional by design: no default selection, no nag. Tapping the selected
 *  level again clears it, so a mis-tap isn't permanent. */
function renderMoodPicker(f) {
  el.moodRow.replaceChildren(...MOODS.map(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mood';
    b.setAttribute('aria-pressed', String(f.mood === m.v));
    b.setAttribute('aria-label', m.label);

    const icon = document.createElement('span');
    icon.className = 'mood-g';
    icon.textContent = m.icon;
    const label = document.createElement('span');
    label.className = 'mood-t';
    label.textContent = m.label;

    b.append(icon, label);
    b.addEventListener('click', () => setMood(f.id, f.mood === m.v ? null : m.v));
    return b;
  }));
}

function setMood(id, value) {
  const entry = history.find(f => f.id === id);
  if (!entry) return;
  if (value === null) delete entry.mood; else entry.mood = value;
  save(KEY.hist, history);
  renderMoodPicker(entry);
  renderHistory();
}

function discardLast() {
  if (lastSavedId !== null) {
    history = history.filter(f => f.id !== lastSavedId);
    save(KEY.hist, history);
    renderHistory();
  }
  lastSavedId = null;
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
  lastSavedId = null;
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

/* Retroactive grant: the first load after this update lights up every badge
   the existing log already earned, so upgrading doesn't reset you to zero. */
syncAchievements();
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
