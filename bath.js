// Minuteur de bain froid.
//
// La durée conseillée découle de la température de l'eau : une minute par degré,
// et c'est un plafond. Le décompte se calcule à partir d'un horodatage de départ,
// jamais par accumulation de ticks : iOS suspend le JavaScript quand l'app passe
// en arrière-plan ou que l'écran s'éteint, et un compteur incrémental dériverait.
// Une session en cours est conservée, de sorte qu'un rechargement ne la perde pas.

import {
  BATH_MAX_MINUTES, bathCoach, bathPhase, bathPlan, bathStats, breathCue, formatClock,
  shareText, statsPhrase,
} from './sources.js';

const $ = (id) => document.getElementById(id);

const STORE = 'leman.v2.bath';
const LOG = 'leman.v2.baths';
const MIN_MINUTES = 1;
const HOLD_MS = 1100;      // durée de maintien pour confirmer le lancement

let temp = null;          // température de l'eau connue
let minutes = null;       // durée retenue, ajustable par l'utilisateur
let manual = false;       // vrai dès que l'utilisateur a réglé la durée
let session = null;       // { startedAt, totalSec }
let ticker = null;
let audio = null;
let beeped = { exit: false, done: false };
let buzzedMinute = 0;     // dernière minute entière déjà signalée
let place = null;         // nom du lieu, pour le texte de partage

/* ------------------------------------------------------------------- son */

// Le contexte doit naître d'un geste utilisateur, sinon iOS le laisse suspendu.
function armAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;   // pas de son : le minuteur reste utilisable
  }
}

function beep(freq = 880, dur = 0.18, delay = 0) {
  if (!audio) return;
  const at = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audio.destination);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.28, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/* --------------------------------------------------------- retour haptique */

// Une vibration au départ, une à chaque minute, une longue à l'échéance : dans
// l'eau, les mains mouillées, c'est ce qui permet de ne pas regarder l'écran.
//
// À savoir : iOS n'expose pas `navigator.vibrate`. Le code est donc sans effet
// sur iPhone, où le repère reste sonore. Il fonctionne sur Android. Mieux vaut
// une fonctionnalité qui se dégrade en silence qu'une promesse dans l'interface
// que l'appareil ne tiendrait pas.
const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function buzz(pattern) {
  if (!canVibrate()) return;
  try { navigator.vibrate(pattern); } catch { /* refusé par l'appareil : sans conséquence */ }
}

/* --------------------------------------------------------------- session */

function save() {
  try {
    if (session) localStorage.setItem(STORE, JSON.stringify(session));
    else localStorage.removeItem(STORE);
  } catch { /* navigation privée : la session vit alors en mémoire seulement */ }
}

function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!raw?.startedAt || !(raw.totalSec > 0)) return null;
    // Au-delà du double de la durée, la session est manifestement abandonnée.
    if (Date.now() - raw.startedAt > (raw.totalSec + 1800) * 1000) return null;
    return raw;
  } catch {
    return null;
  }
}

const elapsed = () => (Date.now() - session.startedAt) / 1000;

/* ------------------------------------------------------ journal des bains */

// Une entrée par immersion assumée — celles qu'on inscrit soi-même en sortant.
// Un bain annulé n'y figure pas : ce journal sert à se souvenir, pas à mesurer.
function readLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function appendLog(entry) {
  try {
    // Cent entrées suffisent largement, et bornent ce qu'on garde sur l'appareil.
    localStorage.setItem(LOG, JSON.stringify([...readLog(), entry].slice(-100)));
  } catch { /* quota ou navigation privée : le journal est un bonus */ }
}

/* ----------------------------------------------------------------- rendu */

// La régularité, en une ligne discrète sur l'écran d'accueil — pas un tableau
// de bord. Invisible tant qu'il n'y a rien à raconter : un visiteur qui n'a
// jamais consigné de bain ne doit voir ni zéro ni case vide, juste rien.
function renderHomeStreak() {
  const el = $('homeStreak');
  if (!el) return;
  const phrase = statsPhrase(bathStats(readLog()));
  el.textContent = phrase;
  el.hidden = !phrase;
}

function renderPlan() {
  const plan = bathPlan(temp);
  if (minutes == null) minutes = plan ? plan.minutes : 5;

  $('bathMinutes').textContent = minutes;
  $('briefMinutes').textContent = minutes;

  $('bathNote').textContent = plan
    ? 'Une minute par degré. Ni plus, ni moins que ce qui te fait du bien.'
    : 'Température inconnue : durée à régler à la main.';
}

function renderTimer() {
  if (!session) return;
  const el = elapsed();
  const left = session.totalSec - el;
  const phase = bathPhase(el, session.totalSec);

  $('timerClock').textContent = formatClock(Math.abs(left));
  $('timerPhase').textContent = phase.label;
  // Le repère de sécurité (respire, reste au bord…) reste au-dessus ; le
  // message du coach, ancré dans le temps plutôt que dans la mécanique, porte
  // le ton de l'immersion.
  $('timerHint').textContent = bathCoach(el, session.totalSec);
  $('timer').dataset.phase = phase.key;

  const pct = Math.min(100, (el / session.totalSec) * 100);
  $('timerFill').style.width = `${pct.toFixed(1)}%`;

  $('timerMeta').textContent = left >= 0
    ? `${formatClock(el)} écoulées sur ${formatClock(session.totalSec)}`
    : `dépassement de ${formatClock(-left)} — sors maintenant`;

  // La respiration guidée n'a de sens qu'à l'entrée dans l'eau, quand il s'agit
  // de reprendre le contrôle du souffle.
  const breath = $('breath');
  if (phase.key === 'shock') {
    const cue = breathCue(el);
    breath.hidden = false;
    $('breathWord').textContent = `${cue.word} ${cue.seconds}`;
    // Le cercle s'ouvre puis se referme, en suivant la consigne.
    const scale = cue.phase === 'in' ? 0.62 + cue.progress * 0.38 : 1 - cue.progress * 0.38;
    const ring = $('breathRing');
    ring.style.transform = `scale(${scale.toFixed(3)})`;
    ring.style.opacity = String(0.3 + (cue.phase === 'in' ? cue.progress : 1 - cue.progress) * 0.4);
  } else if (!breath.hidden) {
    breath.hidden = true;
  }

  // Un son à l'approche de la sortie, trois à l'échéance. Sans effet si l'app
  // est en arrière-plan : iOS y suspend l'audio comme le reste.
  if (phase.key === 'exit' && !beeped.exit) { beeped.exit = true; beep(660, .14); }
  if (phase.key === 'done' && !beeped.done) {
    beeped.done = true;
    beep(880, .18); beep(880, .18, .28); beep(1180, .3, .56);
    buzz([220, 120, 220, 120, 520]);        // longue, à l'échéance
  }

  // Une vibration par minute entière écoulée : le repère se prend sans regarder.
  const whole = Math.floor(el / 60);
  if (whole > buzzedMinute && el < session.totalSec) {
    buzzedMinute = whole;
    buzz(90);
  }
}

/* ------------------------------------------------- confirmation à maintenir */

// Un simple appui suffirait techniquement. Le maintien impose une seconde
// d'attention sur les consignes, juste avant d'entrer dans l'eau — et rend
// impossible un lancement par mégarde dans la poche.
const RING = 2 * Math.PI * 43;
let holding = null;

function setHoldProgress(p) {
  const fill = $('holdFill');
  fill.style.strokeDasharray = String(RING);
  fill.style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(1, p))));
}

function holdStep(now) {
  if (!holding) return;
  const p = (now - holding.from) / HOLD_MS;
  setHoldProgress(p);
  if (p >= 1) {
    holding = null;
    $('holdLabel').textContent = 'C’est parti';
    confirmStart();
    return;
  }
  holding.raf = requestAnimationFrame(holdStep);
}

function holdBegin(e) {
  if (holding) return;
  e.preventDefault();
  armAudio();                       // le contexte audio naît de ce geste
  holding = { from: performance.now() };
  $('holdBtn').classList.add('held');
  $('holdNote').textContent = 'Ne relâchez pas…';
  holding.raf = requestAnimationFrame(holdStep);
}

function holdEnd() {
  if (!holding) return;
  cancelAnimationFrame(holding.raf);
  holding = null;
  $('holdBtn').classList.remove('held');
  $('holdNote').textContent = 'Relâché trop tôt — maintenez une seconde';
  setHoldProgress(0);
}

/* -------------------------------------------------------------- contrôle */

// Étape de consignes : rien ne démarre encore.
function openBriefing() {
  $('briefMinutes').textContent = minutes;
  $('holdLabel').textContent = 'Maintenir';
  $('holdNote').textContent = 'Maintenez une seconde pour lancer';
  setHoldProgress(0);
  $('timer').dataset.state = 'briefing';
  $('timer').hidden = false;
  document.body.classList.add('timing');
  $('holdBtn').focus();
}

function confirmStart() {
  session = { startedAt: Date.now(), totalSec: minutes * 60, temp };
  beeped = { exit: false, done: false };
  buzzedMinute = 0;
  save();
  beep(520, .12);                   // repère sonore de départ
  buzz([60, 60, 60]);
  open();
}

function open() {
  $('timer').dataset.state = 'running';
  $('timer').hidden = false;
  document.body.classList.add('timing');
  renderTimer();
  clearInterval(ticker);
  ticker = setInterval(renderTimer, 250);
}

/* -------------------------------------------------------- après le bain */

// La sortie n'est pas une fin d'écran, c'est le moment du bilan : la durée
// tenue, l'eau du jour, et un geste pour l'inscrire au journal. Rien n'y est
// enregistré tant que « J'y étais » n'est pas touché — un bain interrompu au
// bout de dix secondes n'a pas à figurer dans une série.
let lastBath = null;      // { minutes, temp, at } de l'immersion qui vient de finir

function openAfter() {
  const held = session ? Math.max(0, elapsed() / 60) : 0;
  lastBath = { at: new Date().toISOString(), minutes: Math.round(held * 10) / 10, temp: session?.temp ?? temp };

  $('afterMinutes').textContent = held < 1
    ? held.toFixed(1).replace('.', ',')
    : String(Math.round(held));
  $('afterTemp').textContent = isFinite(lastBath.temp)
    ? lastBath.temp.toFixed(1).replace('.', ',')
    : '--';
  $('afterStats').textContent = statsPhrase(bathStats(readLog()));
  $('afterKeep').disabled = false;
  $('afterKeep').hidden = false;

  // Le partage natif n'existe pas partout : sans lui, pas de bouton mort.
  $('afterShare').hidden = typeof navigator.share !== 'function';

  clearInterval(ticker);
  ticker = null;
  $('timer').dataset.state = 'after';
  $('timer').hidden = false;
  document.body.classList.add('timing');
}

function keepBath() {
  if (!lastBath) return;
  appendLog(lastBath);
  lastBath = null;
  $('afterKeep').disabled = true;
  $('afterStats').textContent = statsPhrase(bathStats(readLog()));
  renderHomeStreak();   // l'écran d'accueil, retrouvé en sortant, doit déjà le savoir
  buzz(40);
}

async function shareBath() {
  const text = shareText({
    minutes: Number($('afterMinutes').textContent.replace(',', '.')),
    temp: Number($('afterTemp').textContent.replace(',', '.')),
    place,
  });
  try {
    await navigator.share({ text, url: location.href });
  } catch { /* partage refusé ou annulé : rien à signaler */ }
}

function close() {
  clearInterval(ticker);
  ticker = null;
  holdEnd();
  $('timer').hidden = true;
  document.body.classList.remove('timing');
}

// Sortie de l'eau : la session s'efface, mais l'écran de clôture s'ouvre.
function finish() {
  openAfter();
  session = null;
  save();
}

function stop() {
  session = null;
  save();
  close();
}

function step(delta) {
  minutes = Math.min(BATH_MAX_MINUTES + 10, Math.max(MIN_MINUTES, minutes + delta));
  renderPlan();
}

/* ------------------------------------------------------------------ mise en place */

// Appelée à chaque rafraîchissement des données : la durée conseillée suit la
// température, tant que l'utilisateur ne l'a pas réglée lui-même.
export function setWaterTemperature(value) {
  temp = typeof value === 'number' && isFinite(value) ? value : null;
  // Un réglage manuel n'est pas écrasé par un rafraîchissement des données.
  if (!manual) minutes = bathPlan(temp)?.minutes ?? minutes ?? 5;
  renderPlan();
}

export function initBath() {
  renderPlan();
  renderHomeStreak();

  // Le bouton mène aux consignes, jamais directement à l'eau : la règle « jamais
  // seul » se lit là, en tête de liste, juste avant le maintien de confirmation.
  $('bathStart').addEventListener('click', openBriefing);
  $('briefCancel').addEventListener('click', close);

  const btn = $('holdBtn');
  btn.addEventListener('pointerdown', holdBegin);
  btn.addEventListener('pointerup', holdEnd);
  btn.addEventListener('pointercancel', holdEnd);
  btn.addEventListener('pointerleave', holdEnd);
  // Au clavier, maintenir la touche produit le même engagement.
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') holdBegin(e);
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') holdEnd();
  });
  $('bathMinus').addEventListener('click', () => { manual = true; step(-1); });
  $('bathPlus').addEventListener('click', () => { manual = true; step(1); });
  // « Je sors » mène au bilan ; « Annuler » referme sans rien inscrire.
  $('timerDone').addEventListener('click', finish);
  $('timerCancel').addEventListener('click', stop);
  $('afterKeep').addEventListener('click', keepBath);
  $('afterShare').addEventListener('click', shareBath);
  $('afterClose').addEventListener('click', close);

  // Retour au premier plan : on repart de l'horodatage, jamais du dernier tick.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session) renderTimer();
  });

  const resumed = restore();
  if (resumed) {
    session = resumed;
    // Les sons déjà dus ne sont pas rejoués à la reprise.
    const el = elapsed();
    beeped = {
      exit: bathPhase(el, session.totalSec).key !== 'shock',
      done: el >= session.totalSec,
    };
    buzzedMinute = Math.floor(el / 60);   // pas de rattrapage de vibrations
    open();   // une session en cours reprend directement à l'immersion
  }
}

// Le lieu courant, pour le texte de partage. Appelé par `app.js` à chaque rendu.
export function setBathPlace(name) {
  place = name || null;
}
