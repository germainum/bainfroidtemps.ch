// Température du Léman — réseau, cache et rendu.
//
// Deux sources complémentaires :
//   1. existenz.ch      → mesures in situ des stations hydrologiques de l'OFEV.
//   2. Alplakes / Eawag → simulation 3D du lac (Delft3D-FLOW) : une valeur pour
//                         n'importe quel point d'eau, plus l'historique et la
//                         prévision qui alimentent la courbe.
// Toute réponse utile est mise en cache (localStorage) : l'app affiche donc
// toujours quelque chose, hors ligne compris, en signalant l'âge de la donnée.

import { initBath, setBathPlace, setWaterTemperature } from './bath.js';
import { renderLakeMap } from './lakemap.js';
import { initOnboarding } from './onboarding.js';
import {
  CFG, SPOTS, asArray, bestReading, greeting, isStale, mood, nextIndex, parseMeasuredStations,
  nearestSpot, parseSeries, parseSnapshot, parseStationMeta, snapshotAge,
  snapshotCurrentTemps, swipeDecision, toDate, trend, urlLatestTemperature, urlModelPoint,
  urlModelSnapshot, urlStationMeta,
} from './sources.js';

const $ = (id) => document.getElementById(id);
const diagnostics = [];
let currentSpot = SPOTS[0];
let refreshing = false;
let spotTemps = {};       // température par lieu, pour la carte
let lastSeries = [];      // dernier rendu, pour repeindre sans refaire le réseau
let lastHint = 'modèle Eawag';

/* ------------------------------------------------------------------ affichage */

const formatTemp = (v) =>
  typeof v === 'number' && isFinite(v) ? v.toFixed(1).replace('.', ',') : '--';

// Sous dix kilomètres la décimale a du sens ; au-delà, elle n'apporte rien.
const formatKm = (km) =>
  km < 10 ? km.toFixed(1).replace('.', ',') : String(Math.round(km));

function formatAge(value) {
  const date = toDate(value);
  if (!date) return '';
  const min = Math.round((Date.now() - date.getTime()) / 60000);
  if (min < 0) return 'prévision';
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} jours`;
}

// Nom court de la source, pour le repère « source » : le nom de la station sans
// répéter celui du lieu — « mesure · Genève, sortie du lac » → « Sortie du lac ».
function sourceHead(label) {
  if (!/^mesure/.test(label)) return label === 'modèle Eawag' ? 'Eawag' : label;
  const station = label.replace(/^mesure\s*·\s*/, '');
  const spot = currentSpot.name.toLowerCase();
  const low = station.toLowerCase();
  const head = low === spot ? 'mesure'
    : low.startsWith(`${spot},`) ? station.slice(spot.length + 1).trim()
    : station;
  return head.charAt(0).toUpperCase() + head.slice(1);
}

function note(source, ok, detail) {
  const time = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  diagnostics.push(`${ok ? '✓' : '✗'} ${time} ${source} — ${detail}`);
  $('diagOut').textContent = diagnostics.slice(-14).join('\n');
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* -------------------------------------------------------------------- réseau */

// Résumé d'URL pour le diagnostic : hôte et chemin, sans schéma ni clé d'app.
function shortUrl(url) {
  try {
    const u = new URL(url);
    const tail = `${u.host}${u.pathname}`;
    return tail.length > 96 ? `${tail.slice(0, 93)}…` : tail;
  } catch {
    return url;
  }
}

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // L'URL fait partie du diagnostic : sans elle, « Load failed » n'apprend rien.
    const reason = err.name === 'AbortError' ? 'délai dépassé' : err.message;
    throw new Error(`${reason} — ${shortUrl(url)}`);
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------- cache */

// La version du préfixe invalide tout le cache local. À incrémenter dès qu'une
// donnée mise en cache change de forme ou s'est révélée fausse — sans quoi les
// appareils déjà utilisés conservent l'ancienne pendant des heures.
const PREFIX = 'leman.v2.';

function cacheSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch { /* quota ou navigation privée : le cache est un bonus, pas une dépendance */ }
}

function cacheGet(key, maxAgeMs = Infinity) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { savedAt, value } = JSON.parse(raw);
    return Date.now() - savedAt > maxAgeMs ? null : value;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- fetchers */

// Métadonnées des stations (nom, cours d'eau, coordonnées) : stables, cachées une semaine.
const geolocated = (meta) => Object.values(meta).filter((m) => m.lat != null).length;

async function fetchStationMeta() {
  const cached = cacheGet('stationMeta', CFG.metaCacheMs);
  if (cached) {
    // Journalisé même depuis le cache : l'absence de cette ligne masquait le fait
    // que des métadonnées sans coordonnées restaient en place des jours.
    note('métadonnées (cache)', geolocated(cached) > 0,
      `${Object.keys(cached).length} stations, ${geolocated(cached)} géolocalisées`);
    return cached;
  }

  for (const path of ['/locations', '/stations']) {
    try {
      const raw = await getJSON(urlStationMeta(path));
      const meta = parseStationMeta(raw);
      if (meta) {
        cacheSet('stationMeta', meta);
        const withCoords = geolocated(meta);
        note('existenz' + path, withCoords > 0,
          `${Object.keys(meta).length} stations, ${withCoords} géolocalisées`);
        return meta;
      }
      // Réponse reçue mais illisible : le nombre d'entrées lues situe le problème.
      note('existenz' + path, false,
        `aucune station exploitable sur ${asArray(raw).length} entrée(s) — clés : ${Object.keys(raw || {}).slice(0, 6).join(', ') || '∅'}`);
    } catch (err) {
      note('existenz' + path, false, err.message);
    }
  }
  return null;
}

async function fetchMeasuredStations() {
  const raw = await getJSON(urlLatestTemperature());
  const received = asArray(raw).length;
  const meta = await fetchStationMeta();
  const list = parseMeasuredStations(raw, meta);
  note('existenz/latest', list.length > 0,
    `${list.length} station(s) sur le Léman, ${received} enregistrement(s) reçu(s)`);
  return list;
}

// Le modèle passe d'abord par l'instantané précalculé : Alplakes ne renvoie pas
// d'en-tête CORS, donc l'appel direct n'aboutit que hors navigateur. Il reste
// tenté en second, au cas où (usage local, ou CORS ouvert un jour).
async function fetchModelSeries(spot) {
  try {
    const raw = await getJSON(urlModelSnapshot());
    const points = parseSnapshot(raw, spot.key);
    if (!points.length) throw new Error(`aucun point pour ${spot.key}`);
    const ageH = Math.round((snapshotAge(raw) ?? 0) / 3600000);
    note('instantané', true, `${spot.name} : ${points.length} points, calculé il y a ${ageH} h`);
    // Les températures de tous les lieux servent à la carte.
    return { points, origin: 'snapshot', age: snapshotAge(raw), temps: snapshotCurrentTemps(raw) };
  } catch (err) {
    note('instantané', false, err.message);
  }

  const now = Date.now();
  const url = urlModelPoint(
    spot,
    new Date(now - CFG.pastDays * 86400000),
    new Date(now + CFG.futureDays * 86400000),
  );
  const points = parseSeries(await getJSON(url));
  if (!points.length) throw new Error('série vide');
  note('alplakes direct', true, `${spot.name} : ${points.length} points`);
  // L'appel direct ne porte que le lieu demandé : la carte garde ce qu'elle a.
  return { points, origin: 'live', age: 0, temps: null };
}

/* ----------------------------------------------------------------- rendu UI */

// « +0,4° » se lit d'un coup d'œil ; sous un dixième, l'écart n'est pas un signal.
function formatTrend(delta) {
  if (delta == null || !isFinite(delta)) return '—';
  if (Math.abs(delta) < 0.1) return 'stable';
  const signe = delta > 0 ? '+' : '−';
  return `${signe}${Math.abs(delta).toFixed(1).replace('.', ',')}°`;
}

// Le sélecteur porte les dix lieux, dans l'ordre du lac. Construit une fois :
// SPOTS ne bouge pas en cours de route.
function renderPicker() {
  const select = $('spot');
  select.replaceChildren(...SPOTS.map((spot) => {
    const opt = document.createElement('option');
    opt.value = spot.key;
    opt.textContent = spot.name;
    return opt;
  }));
  select.addEventListener('change', () => {
    const spot = SPOTS.find((s) => s.key === select.value);
    if (spot) selectSpot(spot);
  });
}

// Le lieu peut aussi changer par la carte, le balayage ou la géolocalisation :
// le sélecteur suit, sinon il annoncerait un autre endroit que la température.
function syncPicker() {
  $('spot').value = currentSpot.key;
  $('spotDistance').textContent = located?.key === currentSpot.key
    ? `à ${formatKm(located.km)} km de vous`
    : '';
}

// Le chiffre monte jusqu'à sa valeur à la première ouverture. Uniquement là :
// répété à chaque rafraîchissement, le mouvement deviendrait une nuisance, et
// un balayage entre deux lieux doit changer la valeur, pas la rejouer.
let counted = false;

function showValue(value) {
  const el = $('value');
  if (value == null || !isFinite(value)) { el.textContent = formatTemp(value); return; }
  const skip = counted || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  counted = true;
  if (skip) { el.textContent = formatTemp(value); return; }

  const from = performance.now();
  const DUR = 900;
  const step = (now) => {
    const p = Math.min(1, (now - from) / DUR);
    // Décélération : la fin de la montée doit être lisible, pas brutale.
    el.textContent = formatTemp(value * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderHero({ value, at, kind, label }) {
  // La couleur du fond suit la température : elle informe avant le chiffre.
  document.body.dataset.band = mood(value).band;
  showValue(value);

  syncPicker();
  // Le détail de la source vit dans les trois repères ci-dessous ; cette ligne
  // ne parle que lorsqu'il n'y a rien à afficher.
  $('readoutSource').textContent = value == null ? label : '';

  $('greeting').textContent = greeting(value);

  $('factTrend').textContent = formatTrend(trend(lastSeries, Date.now()));
  $('factAge').textContent = formatAge(at).replace(/^il y a /, '') || '—';
  // « relevé » ne disait pas d'où venait le chiffre. « mesuré » ou « simulé »
  // répond, et l'âge juste au-dessus devient concret.
  $('factAgeLabel').textContent = kind === 'measured' ? 'mesuré' : 'simulé';
  $('factSource').textContent = sourceHead(label);

  document.querySelector('.readout').classList.toggle('stale', value != null && isStale(at));

  // Le minuteur se règle sur la valeur affichée : une minute par degré.
  setWaterTemperature(value);
  setBathPlace(currentSpot.name);
}

function renderChart(points) {
  const box = $('chart');
  const W = 320, H = 150, padL = 26, padR = 8, padT = 12, padB = 20;

  if (!points || points.length < 2) {
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe indisponible">`
      + `<text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">Courbe indisponible</text>`
      + '</svg>';
    return;
  }

  const values = points.map((p) => p.value);
  const t0 = points[0].at.getTime();
  const t1 = points[points.length - 1].at.getTime();
  const lo = Math.floor(Math.min(...values) - 0.6);
  const hi = Math.ceil(Math.max(...values) + 0.6);
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / Math.max(0.5, hi - lo)) * (H - padT - padB);
  const path = (pts) => pts
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.at.getTime()).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join('');

  const now = Date.now();
  const past = points.filter((p) => p.at.getTime() <= now);
  const future = points.filter((p) => p.at.getTime() >= now);

  // Pas de grille : une ligne de base, et les extrêmes annotés au plus près.
  const extremes = [
    { v: Math.max(...values), anchor: 'start' },
    { v: Math.min(...values), anchor: 'start' },
  ].map(({ v }) => `<text class="axis" x="0" y="${(y(v) + 3).toFixed(1)}">`
    + `${v.toFixed(1).replace('.', ',')}°</text>`).join('');

  const baseline = `<line class="base" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>`;

  const days = [];
  for (const d = new Date(t0); d.getTime() <= t1; d.setDate(d.getDate() + 1)) {
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (midnight <= t0 || midnight >= t1) continue;
    days.push(`<text class="axis" x="${x(midnight).toFixed(1)}" y="${H - 6}" text-anchor="middle">`
      + `${new Date(midnight).toLocaleDateString('fr-CH', { weekday: 'short' }).replace('.', '').toUpperCase()}</text>`);
  }

  const marker = past.length ? past[past.length - 1] : points[0];

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"`
    + ` aria-label="Température de l'eau sur ${CFG.pastDays + CFG.futureDays} jours">`
    + baseline + extremes + days.join('')
    + (past.length > 1 ? `<path class="line" d="${path(past)}"/>` : '')
    + (future.length > 1 ? `<path class="line line-future" d="${path(future)}"/>` : '')
    + `<circle class="now" cx="${x(marker.at.getTime()).toFixed(1)}" cy="${y(marker.value).toFixed(1)}" r="3.5"/>`
    + '</svg>';
}

/* ----------------------------------------------------------- orchestration */

const reviveSeries = (raw) => (raw || [])
  .map((p) => ({ at: new Date(p.at), value: p.value }))
  .filter((p) => !isNaN(p.at.getTime()) && isFinite(p.value));

// La liste rédigée en bas de page est préremplie par la CI, pour qu'un robot
// d'indexation y trouve des valeurs. Elle se remet à jour ici, sinon un visiteur
// verrait le texte annoncer une chose et l'app une autre.
function renderTempsList() {
  const rows = document.querySelectorAll('#tempsList li');
  if (!rows.length) return;
  rows.forEach((li, i) => {
    const spot = SPOTS[i];
    if (!spot) return;
    const v = spotTemps[spot.key];
    li.querySelector('b').textContent = isFinite(v) ? `${formatTemp(v)} °C` : '—';
  });
}

function paint(stations, series, hint = 'modèle Eawag') {
  lastSeries = series || [];
  lastHint = hint;
  renderChart(series);
  renderHero(bestReading(currentSpot, stations, series));
  renderTempsList();
  $('chartHint').textContent = hint;
  drawMap();
}

function drawMap() {
  renderLakeMap($('map'), {
    temps: spotTemps,
    selectedKey: currentSpot.key,
    user: located,
    onSelect: (key) => {
      const spot = SPOTS.find((s) => s.key === key);
      if (spot) selectSpot(spot);
    },
  });
}

async function refresh({ silent = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  $('refresh').classList.add('busy');

  const [stationsRes, seriesRes] = await Promise.allSettled([
    fetchMeasuredStations(),
    fetchModelSeries(currentSpot),
  ]);

  let stations;
  if (stationsRes.status === 'fulfilled') {
    stations = stationsRes.value;
    cacheSet('stations', stations);
  } else {
    note('existenz/latest', false, stationsRes.reason?.message || 'échec');
    stations = cacheGet('stations');
  }

  let series;
  let hint = 'modèle Eawag';
  if (seriesRes.status === 'fulfilled') {
    const { points, origin, age, temps } = seriesRes.value;
    series = points;
    if (temps && Object.keys(temps).length) {
      spotTemps = temps;
      cacheSet('spotTemps', temps);
    }
    // Un instantané qui ne se rafraîchit plus doit se voir : la CI est en panne.
    const ageH = Math.round((age || 0) / 3600000);
    hint = origin === 'live' ? 'modèle Eawag, direct'
      : ageH >= 6 ? `modèle Eawag, il y a ${ageH} h`
      : 'modèle Eawag';
    cacheSet(`series.${currentSpot.key}`,
      series.map((p) => ({ at: p.at.toISOString(), value: p.value })));
  } else {
    note('modèle', false, seriesRes.reason?.message || 'échec');
    series = reviveSeries(cacheGet(`series.${currentSpot.key}`));
    hint = series.length ? 'dernière valeur en cache' : 'indisponible';
  }

  paint(stations, series, hint);

  if (!silent && stationsRes.status === 'rejected' && seriesRes.status === 'rejected') {
    toast(navigator.onLine ? 'Sources injoignables' : 'Hors ligne — données en cache');
  }

  $('refresh').classList.remove('busy');
  refreshing = false;
}

// Peint immédiatement la dernière donnée connue ; indique si elle existait.
function paintFromCache() {
  const stations = cacheGet('stations');
  const series = reviveSeries(cacheGet(`series.${currentSpot.key}`));
  if (!stations && !series.length) return false;
  paint(stations, series, 'dernière valeur en cache');
  return true;
}

function selectSpot(spot, direction = null) {
  if (spot.key === currentSpot.key) return;
  currentSpot = spot;
  cacheSet('spot', spot.key);
  // Avant le rendu : sans cache à peindre, `renderHero` n'est pas encore appelé
  // et le sélecteur afficherait le lieu précédent.
  syncPicker();
  paintFromCache();
  refresh({ silent: true });
  if (direction) animateSwap(direction);
}

// Le contenu entre depuis le côté d'où vient le geste : sans ce repère visuel,
// un balayage ne se distingue pas d'un rafraîchissement.
function animateSwap(direction) {
  const cls = direction === 'next' ? 'enter-next' : 'enter-prev';
  for (const el of document.querySelectorAll('.whereat, .readout')) {
    el.classList.remove('enter-next', 'enter-prev');
    // Forcer un recalcul relance l'animation même sur deux balayages successifs.
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }
}

function moveSpot(direction) {
  const from = SPOTS.findIndex((s) => s.key === currentSpot.key);
  const to = nextIndex(from, direction, SPOTS.length);
  if (to !== from) selectSpot(SPOTS[to], direction);
}

/* ------------------------------------------------------------ balayage */

// Balayage horizontal sur le premier écran. Événements pointeur : ils couvrent
// le doigt comme la souris, et le navigateur émet pointercancel dès qu'il prend
// le geste pour un défilement — ce qui suffit à ne jamais lui disputer la page.
function enableSwipe() {
  const screen = document.querySelector('.screen');
  let start = null;

  screen.addEventListener('pointerdown', (e) => {
    // Les commandes gardent la priorité sur le geste.
    if (e.target.closest('button, a')) return;
    if (!e.isPrimary) return;
    start = { x: e.clientX, y: e.clientY, at: Date.now() };
  });

  const finish = (e) => {
    if (!start) return;
    const decision = swipeDecision(e.clientX - start.x, e.clientY - start.y, Date.now() - start.at);
    start = null;
    if (decision) moveSpot(decision);
  };

  screen.addEventListener('pointerup', finish);
  screen.addEventListener('pointercancel', () => { start = null; });
  screen.addEventListener('pointerleave', () => { start = null; });

  // Au clavier, les flèches font le même travail.
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') moveSpot('next');
    else if (e.key === 'ArrowLeft') moveSpot('prev');
  });
}

/* --------------------------------------------------------- géolocalisation */

// Position de l'utilisateur et lieu retenu, pour n'annoter la distance que
// lorsqu'elle porte bien sur le lieu affiché.
let located = null;    // { lat, lon, km, key }

function askPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      // La précision fine ne servirait à rien : on cherche le lieu le plus
      // proche parmi dix, distants de plusieurs kilomètres.
      enableHighAccuracy: false,
      timeout: 9000,
      maximumAge: 5 * 60 * 1000,
    });
  });
}

const GEO_ERRORS = {
  1: 'Localisation refusée',
  2: 'Position indisponible',
  3: 'Localisation trop lente',
};

// `silent` : lancement automatique au démarrage, sans message en cas d'échec.
async function locate({ silent = false } = {}) {
  if (!('geolocation' in navigator)) {
    if (!silent) toast('Localisation non disponible');
    return;
  }
  $('locate').classList.add('busy');
  try {
    const pos = await askPosition();
    const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    const near = nearestSpot(coords, SPOTS);
    if (!near) return;

    located = { ...coords, km: near.km, key: near.spot.key };
    cacheSet('geolocate', true);
    note('position', true, `${near.spot.name} à ${near.km.toFixed(1)} km`);

    if (near.spot.key === currentSpot.key) paint(cacheGet('stations'), lastSeries, lastHint);
    else selectSpot(near.spot);

    // Au-delà, l'utilisateur n'est manifestement pas au bord du lac : le dire
    // vaut mieux que de laisser croire que la valeur le concerne.
    if (!silent) {
      toast(near.km > 40
        ? `${near.spot.name}, le plus proche — à ${formatKm(near.km)} km de vous`
        : `${near.spot.name}, à ${formatKm(near.km)} km de vous`);
    }
  } catch (err) {
    if (err?.code === 1) cacheSet('geolocate', false);
    note('position', false, GEO_ERRORS[err?.code] ?? err?.message ?? 'échec');
    if (!silent) toast(GEO_ERRORS[err?.code] ?? 'Localisation impossible');
  } finally {
    $('locate').classList.remove('busy');
  }
}

// Au démarrage, on ne relocalise que si l'autorisation est déjà acquise :
// surgir sur une demande de permission à l'ouverture serait intrusif.
async function locateIfAllowed() {
  if (!('geolocation' in navigator)) return;
  let allowed = cacheGet('geolocate') === true;
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    if (status?.state === 'granted') allowed = true;
    if (status?.state === 'denied') allowed = false;
  } catch { /* Permissions API absente : on s'en tient à la préférence stockée */ }
  if (allowed) locate({ silent: true });
}

/* ------------------------------------------------------ iOS & cycle de vie */

// Le bandeau d'action est fixe : la page doit réserver sa hauteur en bas, sinon
// il recouvre le pied de page. Cette hauteur n'est pas une constante — l'invite
// d'installation s'y ajoute puis disparaît, l'encoche varie d'un appareil à
// l'autre, et un libellé peut passer à la ligne. La mesurer évite d'entretenir
// une valeur en dur qui finit toujours par mentir.
function trackDockHeight() {
  const dock = document.querySelector('.cta-dock');
  const apply = () => {
    const h = Math.ceil(dock.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--dock-h', `${h}px`);
  };
  apply();
  if ('ResizeObserver' in window) new ResizeObserver(apply).observe(dock);
  else window.addEventListener('resize', apply);
}

function maybeShowInstallHint() {
  const standalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standalone || !iOS || cacheGet('installHintDismissed')) return;

  $('install').hidden = false;
  $('installClose').addEventListener('click', () => {
    $('install').hidden = true;
    cacheSet('installHintDismissed', true);
  });
}

function init() {
  currentSpot = SPOTS.find((s) => s.key === cacheGet('spot')) || SPOTS[0];
  spotTemps = cacheGet('spotTemps') || {};

  renderPicker();
  syncPicker();

  const hadCache = paintFromCache();
  // Au premier lancement sans cache, un échec total mérite d'être signalé.
  refresh({ silent: hadCache });

  $('refresh').addEventListener('click', () => refresh());
  $('locate').addEventListener('click', () => locate());

  // Sur iOS l'app reste ouverte des jours : on rafraîchit au retour au premier plan.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh({ silent: true });
  });
  window.addEventListener('online', () => refresh({ silent: true }));
  setInterval(() => { if (!document.hidden) refresh({ silent: true }); }, CFG.autoRefreshMs);

  enableSwipe();
  initBath();
  initOnboarding();
  locateIfAllowed();
  maybeShowInstallHint();
  // Après l'invite : sa présence change la hauteur à réserver.
  trackDockHeight();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .catch((err) => note('service worker', false, err.message));
  }
}

init();
