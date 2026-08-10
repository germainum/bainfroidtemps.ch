// Tests de la couche données, sans réseau : node tools/test-parsers.mjs
// Chaque cas décrit une forme de réponse plausible des API amont, y compris
// dégradée (champs manquants, valeurs aberrantes, kelvin, station hors lac).

import assert from 'node:assert/strict';

import {
  BATH_MAX_MINUTES, CFG, LAKE_OUTLINE, SPOTS, asArray, bathCoach, bathPhase, bathPlan, bestReading,
  breathCue, distanceKm, nearestSpot, pointInPolygon, projectPoints, snapshotCurrentTemps,
  bathStats, dayNumber, greeting, shareText, statsPhrase, trend,
  formatClock, isStale, mood, nextIndex, parseMeasuredStations, swipeDecision,
  parseSeries, parseSnapshot, parseStationMeta, snapshotAge, stampUTC, toDate, urlModelPoint,
} from '../sources.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

const NOW = Date.parse('2026-08-04T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

console.log('horodatages et géométrie');

test('stampUTC produit le format attendu par Alplakes', () => {
  assert.equal(stampUTC(new Date('2026-08-04T09:30:00Z')), '202608040900');
  assert.equal(stampUTC(new Date('2026-01-02T00:00:00Z')), '202601020000');
});

test("l'URL du modèle contient lac, modèle, profondeur et coordonnées", () => {
  const spot = SPOTS[0];
  const url = urlModelPoint(spot, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-06T00:00:00Z'));
  // Les coordonnées sont lues dans SPOTS : déplacer un lieu ne doit pas casser
  // ce test, seulement le test de position dans le lac, plus bas.
  const tail = `/simulations/point/delft3d-flow/geneva/202608010000/202608060000/1/${spot.lat}/${spot.lon}`;
  assert.ok(url.endsWith(tail), `attendu ...${tail}, obtenu ${url}`);
});

test('toDate accepte secondes, millisecondes, ISO et Date', () => {
  assert.equal(toDate(1785844800).toISOString(), '2026-08-04T12:00:00.000Z');
  assert.equal(toDate(1785844800000).toISOString(), '2026-08-04T12:00:00.000Z');
  assert.equal(toDate('2026-08-04T12:00:00Z').toISOString(), '2026-08-04T12:00:00.000Z');
  assert.equal(toDate(new Date(NOW)).getTime(), NOW);
  assert.equal(toDate('pas une date'), null);
  assert.equal(toDate(null), null);
});

test('distanceKm : Genève–Lausanne ≈ 50 km', () => {
  const km = distanceKm({ lat: 46.2044, lon: 6.1432 }, { lat: 46.5197, lon: 6.6323 });
  assert.ok(km > 45 && km < 55, `obtenu ${km.toFixed(1)} km`);
});

test('isStale : au-delà de six heures la donnée est périmée', () => {
  assert.equal(isStale(hoursAgo(1), NOW), false);
  assert.equal(isStale(hoursAgo(9), NOW), true);
  assert.equal(isStale(null, NOW), true);
});

console.log('\nmétadonnées de stations (existenz.ch)');

test('parseStationMeta lit une réponse enveloppée dans payload', () => {
  const meta = parseStationMeta({
    ok: true,
    payload: [
      { loc: '2027', name: 'Genève, Sécheron', water: 'Lac Léman', lat: 46.2205, lon: 6.1478 },
      { loc: '2606', name: 'Genève, Halle de l’Île', water: 'Rhône', lat: 46.2058, lon: 6.1435 },
    ],
  });
  assert.equal(Object.keys(meta).length, 2);
  assert.equal(meta['2027'].name, 'Genève, Sécheron');
  assert.equal(meta['2027'].water, 'Lac Léman');
  assert.ok(Math.abs(meta['2027'].lat - 46.2205) < 1e-9);
});

test('parseStationMeta accepte les noms de champs alternatifs', () => {
  const meta = parseStationMeta([
    { id: 2027, label: 'Sécheron', waterbody: 'Léman', latitude: '46.22', longitude: '6.15' },
  ]);
  assert.equal(meta['2027'].name, 'Sécheron');
  assert.equal(meta['2027'].lat, 46.22);
});

test('parseStationMeta renvoie null si rien d’exploitable', () => {
  assert.equal(parseStationMeta({ ok: false, payload: [] }), null);
  assert.equal(parseStationMeta(null), null);
});

// Forme observée en production : payload est un objet indexé par numéro de
// station, et non une liste. La clé porte alors l'identifiant.
test('parseStationMeta lit un payload indexé par numéro de station', () => {
  const meta = parseStationMeta({
    ok: true,
    payload: {
      2027: { name: 'Genève, Sécheron', water: 'Lac Léman', lat: 46.2205, lon: 6.1478 },
      2135: { name: 'Basel, Rheinhalle', water: 'Rhein', lat: 47.559, lon: 7.59 },
    },
  });
  assert.deepEqual(Object.keys(meta).sort(), ['2027', '2135']);
  assert.equal(meta['2027'].name, 'Genève, Sécheron');
  assert.equal(meta['2027'].lat, 46.2205);
});

test('asArray réinjecte la clé sans écraser un identifiant déjà présent', () => {
  assert.deepEqual(asArray({ payload: { abc: { loc: '2027', v: 1 } } }), [{ loc: '2027', v: 1 }]);
  assert.deepEqual(asArray({ payload: { 2027: { v: 1 } } }), [{ loc: '2027', v: 1 }]);
  assert.deepEqual(asArray({ ok: true, status: 200 }), []);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray([{ loc: '1' }]), [{ loc: '1' }]);
});

test('les mesures indexées par station sont exploitées de la même façon', () => {
  const list = parseMeasuredStations({
    payload: {
      2027: { parameter: 'temperature', value: 21.4, timestamp: 1785844800 },
      2135: { parameter: 'temperature', value: 24.1, timestamp: 1785844800 },
    },
  }, {
    2027: { name: 'Genève, Sécheron', water: 'Lac Léman', lat: 46.2205, lon: 6.1478 },
    2135: { name: 'Basel, Rheinhalle', water: 'Rhein', lat: 47.559, lon: 7.59 },
  });
  assert.deepEqual(list.map((s) => s.id), ['2027']);
  assert.equal(list[0].name, 'Genève, Sécheron');
});

// ---------------------------------------------------------------------------
// Formes réelles, relevées sur api.existenz.ch. Ce sont les fixtures qui
// comptent : les précédentes étaient des hypothèses, celles-ci sont observées.
// ---------------------------------------------------------------------------

const REAL_LOCATIONS = {
  source: 'Swiss Federal Office for the Environment FOEN / BAFU, Hydrology',
  payload: {
    2004: { id: 1, name: '2004', details: { id: '2004', name: 'Murten', 'water-body-name': 'Murtensee', 'water-body-type': 'lake', chx: 575500, chy: 199790, lat: 46.9308, lon: 7.1169 } },
    2026: { id: 15, name: '2026', details: { id: '2026', name: 'Chillon', 'water-body-name': 'Lac Léman', 'water-body-type': 'lake', chx: 560720, chy: 140490, lat: 46.4146, lon: 6.9277 } },
    2027: { id: 16, name: '2027', details: { id: '2027', name: 'St-Prex', 'water-body-name': 'Lac Léman', 'water-body-type': 'lake', chx: 524940, chy: 148410, lat: 46.4828, lon: 6.4611 } },
    2028: { id: 17, name: '2028', details: { id: '2028', name: 'Genève', 'water-body-name': 'Lac Léman', 'water-body-type': 'lake', chx: 500750, chy: 119390, lat: 46.2186, lon: 6.1524 } },
    2135: { id: 70, name: '2135', details: { id: '2135', name: 'Bern, Schönau', 'water-body-name': 'Aare', 'water-body-type': 'river', lat: 46.9331, lon: 7.448 } },
  },
};

const REAL_LATEST = {
  source: 'Swiss Federal Office for the Environment FOEN / BAFU, Hydrology',
  payload: [
    { timestamp: 1785873600, loc: '2009', par: 'temperature', val: 10.9 },
    { timestamp: 1785873600, loc: '2026', par: 'temperature', val: 22.44 },
    { timestamp: 1785873600, loc: '2027', par: 'temperature', val: 24.51 },
    { timestamp: 1785873600, loc: '2028', par: 'temperature', val: 25.06 },
    { timestamp: 1785873600, loc: '2135', par: 'temperature', val: 22.69 },
  ],
};

test('forme réelle : le numéro de station vient de details.id, pas du rang', () => {
  const meta = parseStationMeta(REAL_LOCATIONS);
  assert.deepEqual(Object.keys(meta).sort(), ['2004', '2026', '2027', '2028', '2135']);
  assert.equal(meta['2027'].name, 'St-Prex');
  assert.equal(meta['2027'].water, 'Lac Léman');
  assert.equal(meta['2027'].kind, 'lake');
  assert.equal(meta['2027'].lat, 46.4828);
  assert.equal(meta['2027'].lon, 6.4611);
});

test('forme réelle : les trois stations du Léman sont retenues, les autres non', () => {
  const list = parseMeasuredStations(REAL_LATEST, parseStationMeta(REAL_LOCATIONS));
  assert.deepEqual(list.map((s) => s.name), ['Chillon', 'Genève', 'St-Prex']);
  assert.deepEqual(list.map((s) => s.value), [22.44, 25.06, 24.51]);
  assert.ok(!list.some((s) => s.name.startsWith('Bern')), 'Berne est hors du Léman');
  assert.ok(!list.some((s) => s.id === '2009'), 'station sans métadonnées ni nom lémanique');
});

test('forme réelle : les abréviations par et val sont comprises', () => {
  const list = parseMeasuredStations(REAL_LATEST, parseStationMeta(REAL_LOCATIONS));
  const geneve = list.find((s) => s.name === 'Genève');
  assert.equal(geneve.value, 25.06);
  assert.equal(geneve.at.toISOString(), new Date(1785873600 * 1000).toISOString());
  assert.deepEqual(geneve.coords, { lat: 46.2186, lon: 6.1524 });
});

test('forme réelle : la station de Genève alimente le grand affichage', () => {
  const stations = parseMeasuredStations(REAL_LATEST, parseStationMeta(REAL_LOCATIONS))
    .map((s) => ({ ...s, at: new Date(NOW - 20 * 60 * 1000) }));
  const r = bestReading(SPOTS.find((s) => s.key === 'geneve'), stations, [], NOW);
  assert.equal(r.kind, 'measured');
  assert.equal(r.value, 25.06);
  assert.match(r.label, /Genève/);
});

// ---------------------------------------------------------------------------
// Situation réelle observée en production : les trois stations du Léman ne
// publient PAS de température (elles mesurent le niveau). Les seules valeurs
// disponibles dans l'emprise du lac viennent de deux stations du Rhône — l'une
// à la sortie du lac, l'autre en amont, alimentée par les glaciers à 10,9 °C.
// C'est cette seconde qui affichait 10,8 °C à Vevey.
// ---------------------------------------------------------------------------

const RHONE_META = {
  ...parseStationMeta(REAL_LOCATIONS),
  2009: { name: 'Porte du Scex', water: 'Rhône', kind: 'river', lat: 46.3496, lon: 6.8886 },
  2606: { name: "Genève, Halle de l'Île", water: 'Rhône', kind: 'river', lat: 46.2058, lon: 6.1435 },
};

const RHONE_LATEST = {
  payload: [
    { timestamp: 1785873600, loc: '2009', par: 'temperature', val: 10.9 },
    { timestamp: 1785873600, loc: '2606', par: 'temperature', val: 25.71 },
  ],
};

test('le Rhône glaciaire en amont est écarté, malgré sa position dans l’emprise', () => {
  const list = parseMeasuredStations(RHONE_LATEST, RHONE_META);
  assert.ok(!list.some((s) => s.id === '2009'),
    'Porte du Scex mesure de l’eau de glacier, pas le lac');
});

test('la sortie du lac est retenue, et nommée comme telle', () => {
  const list = parseMeasuredStations(RHONE_LATEST, RHONE_META);
  const out = list.find((s) => s.id === '2606');
  assert.ok(out, 'l’eau qui sort du lac est de l’eau du lac');
  assert.equal(out.name, 'Genève, sortie du lac');
  // Le cours d'eau reste nommé pour ce qu'il est ; c'est le nom de la station
  // qui porte la nuance, sans la répéter.
  assert.equal(out.water, 'Rhône');
  assert.equal(out.value, 25.71);
});

test('Vevey ne se rattache plus à une rivière : le modèle reprend la main', () => {
  const stations = parseMeasuredStations(RHONE_LATEST, RHONE_META)
    .map((s) => ({ ...s, at: new Date(NOW - 10 * 60 * 1000) }));
  const series = [{ at: new Date(NOW), value: 22.8 }];
  const r = bestReading(SPOTS.find((s) => s.key === 'vevey'), stations, series, NOW);
  assert.equal(r.kind, 'model', 'aucune station lacustre proche de Vevey');
  assert.equal(r.value, 22.8);
});

test('Le Bouveret non plus, alors qu’il est à 4 km de Porte du Scex', () => {
  const stations = parseMeasuredStations(RHONE_LATEST, RHONE_META)
    .map((s) => ({ ...s, at: new Date(NOW - 10 * 60 * 1000) }));
  const r = bestReading(SPOTS.find((s) => s.key === 'bouveret'), stations, [{ at: new Date(NOW), value: 23.1 }], NOW);
  assert.equal(r.kind, 'model');
  assert.equal(r.value, 23.1);
});

test('Genève garde sa mesure, celle de la sortie du lac', () => {
  const stations = parseMeasuredStations(RHONE_LATEST, RHONE_META)
    .map((s) => ({ ...s, at: new Date(NOW - 10 * 60 * 1000) }));
  const r = bestReading(SPOTS.find((s) => s.key === 'geneve'), stations, [{ at: new Date(NOW), value: 24 }], NOW);
  assert.equal(r.kind, 'measured');
  assert.equal(r.value, 25.71);
  assert.match(r.label, /sortie du lac/);
});

console.log('\nmesures in situ (existenz.ch)');

const META = {
  2027: { name: 'Genève, Sécheron', water: 'Lac Léman', lat: 46.2205, lon: 6.1478 },
  2606: { name: 'Genève, Halle de l’Île', water: 'Rhône', lat: 46.2058, lon: 6.1435 },
  2033: { name: 'Ouchy', water: 'Lac Léman', lat: 46.5062, lon: 6.6266 },
  2135: { name: 'Bâle, Rhin', water: 'Rhein', lat: 47.5590, lon: 7.5900 },
};

const LATEST = {
  ok: true,
  payload: [
    { loc: '2027', parameter: 'temperature', timestamp: 1785844800, unit: '°C', value: 21.4 },
    { loc: '2606', parameter: 'temperature', timestamp: 1785844800, unit: '°C', value: 20.9 },
    { loc: '2033', parameter: 'temperature', timestamp: 1785844800, unit: '°C', value: 21.8 },
    { loc: '2135', parameter: 'temperature', timestamp: 1785844800, unit: '°C', value: 24.1 },
    { loc: '2027', parameter: 'level', timestamp: 1785844800, unit: 'm', value: 372.1 },
  ],
};

test('seules les stations du Léman sont retenues, Bâle est écartée', () => {
  const list = parseMeasuredStations(LATEST, META);
  assert.deepEqual(list.map((s) => s.id).sort(), ['2027', '2033', '2606']);
  assert.ok(!list.some((s) => s.name.includes('Bâle')));
});

test('les paramètres autres que la température sont ignorés', () => {
  const list = parseMeasuredStations(LATEST, META);
  assert.ok(list.every((s) => s.value < 30), 'un niveau de 372 m est passé pour une température');
});

test('les valeurs aberrantes sont rejetées', () => {
  const list = parseMeasuredStations({
    payload: [
      { loc: '2027', parameter: 'temperature', value: 999, timestamp: 1785844800 },
      { loc: '2033', parameter: 'temperature', value: null, timestamp: 1785844800 },
      { loc: '2606', parameter: 'temperature', value: 19.2, timestamp: 1785844800 },
    ],
  }, META);
  assert.deepEqual(list.map((s) => s.id), ['2606']);
});

test('sans métadonnées, le nom sert de filtre de repli', () => {
  const list = parseMeasuredStations({
    payload: [
      { loc: '2027', name: 'Genève, Lac Léman', parameter: 'temperature', value: 21.4, timestamp: 1785844800 },
      { loc: '2135', name: 'Basel, Rheinhalle', parameter: 'temperature', value: 24.1, timestamp: 1785844800 },
    ],
  }, null);
  assert.deepEqual(list.map((s) => s.id), ['2027']);
});

test('les coordonnées et l’horodatage sont exposés au reste de l’app', () => {
  const s = parseMeasuredStations(LATEST, META).find((x) => x.id === '2033');
  assert.deepEqual(s.coords, { lat: 46.5062, lon: 6.6266 });
  assert.equal(s.at.toISOString(), '2026-08-04T12:00:00.000Z');
});

console.log('\nsérie du modèle (Alplakes / Eawag)');

test('parseSeries lit variables.temperature.data', () => {
  const pts = parseSeries({
    time: ['2026-08-04T10:00:00+00:00', '2026-08-04T11:00:00+00:00', '2026-08-04T12:00:00+00:00'],
    variables: { temperature: { unit: 'degC', data: [21.1, 21.3, 21.5] } },
  });
  assert.equal(pts.length, 3);
  assert.equal(pts[2].value, 21.5);
  assert.equal(pts[0].at.toISOString(), '2026-08-04T10:00:00.000Z');
});

test('parseSeries accepte une variable donnée comme tableau nu', () => {
  const pts = parseSeries({ time: [1785841200, 1785844800], variables: { temperature: [20.5, 20.7] } });
  assert.deepEqual(pts.map((p) => p.value), [20.5, 20.7]);
});

test('les kelvins sont convertis en degrés Celsius', () => {
  const pts = parseSeries({
    time: ['2026-08-04T12:00:00Z'],
    variables: { temperature: { unit: 'K', data: [294.35] } },
  });
  assert.ok(Math.abs(pts[0].value - 21.2) < 0.05, `obtenu ${pts[0].value}`);
});

test('les trous du modèle (null, NaN) sont ignorés, la série reste triée', () => {
  const pts = parseSeries({
    time: ['2026-08-04T12:00:00Z', '2026-08-04T10:00:00Z', '2026-08-04T11:00:00Z'],
    variables: { temperature: { data: [21.5, null, 21.3] } },
  });
  assert.deepEqual(pts.map((p) => p.value), [21.3, 21.5]);
});

test('une réponse vide ou inattendue donne une série vide, sans lever', () => {
  assert.deepEqual(parseSeries({}), []);
  assert.deepEqual(parseSeries({ detail: 'Not Found' }), []);
  assert.deepEqual(parseSeries({ time: ['2026-08-04T12:00:00Z'], variables: {} }), []);
});

console.log('\ninstantané précalculé par la CI');

const SNAPSHOT = {
  generatedAt: '2026-08-04T11:17:00Z',
  unit: 'degC',
  spots: {
    lausanne: { t: ['2026-08-04T09:00:00Z', '2026-08-04T12:00:00Z'], v: [25.1, 25.4] },
    vevey: { t: ['2026-08-04T09:00:00Z'], v: [24.8] },
  },
};

test('parseSnapshot extrait la série du lieu demandé', () => {
  const pts = parseSnapshot(SNAPSHOT, 'lausanne');
  assert.deepEqual(pts.map((p) => p.value), [25.1, 25.4]);
  assert.equal(pts[0].at.toISOString(), '2026-08-04T09:00:00.000Z');
});

test('parseSnapshot renvoie une série vide pour un lieu absent', () => {
  assert.deepEqual(parseSnapshot(SNAPSHOT, 'yvoire'), []);
  assert.deepEqual(parseSnapshot({}, 'lausanne'), []);
  assert.deepEqual(parseSnapshot(null, 'lausanne'), []);
});

test('parseSnapshot ignore les trous et trie la série', () => {
  const pts = parseSnapshot({
    spots: { x: { t: ['2026-08-04T12:00:00Z', '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z'], v: [25.4, null, 999] } },
  }, 'x');
  assert.deepEqual(pts.map((p) => p.value), [25.4]);
});

test('snapshotAge mesure la fraîcheur de l’instantané', () => {
  assert.equal(snapshotAge(SNAPSHOT, Date.parse('2026-08-04T12:17:00Z')), 3600 * 1000);
  assert.equal(snapshotAge({}, NOW), null);
});

test('chaque lieu de SPOTS a une clé unique — l’instantané est indexé dessus', () => {
  const keys = SPOTS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((k) => /^[a-z]+$/.test(k)), 'clés utilisables comme noms de champs JSON');
});

console.log('\nchoix de la valeur affichée');

const STATIONS = [
  { id: '2033', name: 'Ouchy', value: 21.8, at: hoursAgo(1), coords: { lat: 46.5062, lon: 6.6266 } },
  { id: '2027', name: 'Sécheron', value: 21.4, at: hoursAgo(1), coords: { lat: 46.2205, lon: 6.1478 } },
];

const SERIES = [
  { at: new Date(NOW - 3600 * 1000), value: 20.0 },
  { at: new Date(NOW + 600 * 1000), value: 20.2 },
  { at: new Date(NOW + 7200 * 1000), value: 20.6 },
];

test('une station proche et récente est préférée au modèle', () => {
  const r = bestReading(SPOTS.find((s) => s.key === 'lausanne'), STATIONS, SERIES, NOW);
  assert.equal(r.kind, 'measured');
  assert.equal(r.value, 21.8);
  assert.match(r.label, /Ouchy/);
});

test('un lieu éloigné de toute station retombe sur le modèle', () => {
  const r = bestReading(SPOTS.find((s) => s.key === 'montreux'), STATIONS, SERIES, NOW);
  assert.equal(r.kind, 'model');
  assert.equal(r.value, 20.2, 'le point le plus proche de maintenant doit être choisi');
});

test('une mesure proche mais périmée cède la place au modèle', () => {
  const vieilles = STATIONS.map((s) => ({ ...s, at: hoursAgo(30) }));
  const r = bestReading(SPOTS.find((s) => s.key === 'lausanne'), vieilles, SERIES, NOW);
  assert.equal(r.kind, 'model');
});

test('sans modèle, la mesure périmée est affichée plutôt que rien', () => {
  const vieilles = STATIONS.map((s) => ({ ...s, at: hoursAgo(30) }));
  const r = bestReading(SPOTS.find((s) => s.key === 'lausanne'), vieilles, [], NOW);
  assert.equal(r.kind, 'measured');
  assert.equal(r.value, 21.8);
});

test('sans aucune donnée, la lecture est explicitement indisponible', () => {
  const r = bestReading(SPOTS[0], [], [], NOW);
  assert.equal(r.value, null);
  assert.equal(r.kind, 'error');
  assert.equal(r.label, 'indisponible');
});

test('la distance de rattachement respecte la configuration', () => {
  const loin = [{ ...STATIONS[0], coords: { lat: 46.5062, lon: 6.6266 } }];
  const lausanne = SPOTS.find((s) => s.key === 'lausanne');
  assert.ok(distanceKm(lausanne, loin[0].coords) < CFG.nearStationKm);
  assert.ok(distanceKm(SPOTS.find((s) => s.key === 'vevey'), loin[0].coords) > CFG.nearStationKm);
});

console.log('\naffirmation et bande de couleur');

test('chaque palier donne un adjectif, une remarque et une bande', () => {
  for (const t of [2, 9, 13, 16, 19.5, 22.5, 27]) {
    const m = mood(t);
    assert.ok(m.adj && m.aside && m.band, `palier incomplet à ${t} °C`);
    assert.match(m.band, /^(cold|cool|fresh|good|warm)$/);
  }
});

test('les adjectifs suivent la température', () => {
  assert.equal(mood(4).adj, 'glaciale');
  assert.equal(mood(13).adj, 'froide');
  assert.equal(mood(16).adj, 'fraîche');
  assert.equal(mood(19.5).adj, 'bonne');
  assert.equal(mood(27).adj, 'chaude');
});

test('les bandes vont du froid au chaud sans trou', () => {
  const bands = [0, 5, 10, 13, 16, 19, 22, 25, 30].map((t) => mood(t).band);
  assert.deepEqual(bands, ['cold', 'cold', 'cold', 'cool', 'fresh', 'good', 'good', 'warm', 'warm']);
});

test('une valeur absente donne une bande neutre, pas une erreur', () => {
  for (const bad of [null, undefined, NaN, 'chaud']) {
    assert.equal(mood(bad).band, 'unknown');
    assert.equal(mood(bad).adj, 'inconnue');
  }
});

console.log('\ncarte du lac');

// Ce test a une valeur au-delà de la carte : un lieu posé sur la terre ferme
// n'obtiendrait aucune valeur du modèle. Il a d'ailleurs pris Genève et Nyon
// en défaut, tous deux trop près de la rive.
test('les dix lieux sont dans l’eau, pas sur la rive', () => {
  const dehors = SPOTS.filter((s) => !pointInPolygon(s.lat, s.lon)).map((s) => s.name);
  assert.deepEqual(dehors, [], `hors du lac : ${dehors.join(', ')}`);
});

test('le contour est fermé et couvre l’étendue du lac', () => {
  assert.ok(LAKE_OUTLINE.length > 30, 'silhouette trop grossière');
  const lats = LAKE_OUTLINE.map((p) => p[0]);
  const lons = LAKE_OUTLINE.map((p) => p[1]);
  // Du Rhône à Genève jusqu'à Villeneuve : environ 0,8° de longitude.
  assert.ok(Math.max(...lons) - Math.min(...lons) > 0.7);
  assert.ok(Math.max(...lats) - Math.min(...lats) > 0.25);
  assert.ok(LAKE_OUTLINE.every(([la, lo]) => la > 46.1 && la < 46.6 && lo > 6.1 && lo < 7.0));
});

test('un point hors du lac est bien rejeté', () => {
  assert.equal(pointInPolygon(46.5197, 6.6323), false, 'centre de Lausanne : à terre');
  assert.equal(pointInPolygon(46.2044, 6.1432), false, 'centre de Genève : à terre');
  assert.equal(pointInPolygon(46.45, 6.60), true, 'plein lac');
});

test('la projection tient dans la boîte et respecte les proportions', () => {
  const { points } = projectPoints(LAKE_OUTLINE, { width: 340, height: 208, pad: 22 });
  assert.equal(points.length, LAKE_OUTLINE.length);
  assert.ok(points.every(([x, y]) => x >= 0 && x <= 340 && y >= 0 && y <= 208), 'débordement');
  // Le lac est nettement plus large que haut : la projection doit le montrer.
  const w = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]));
  const h = Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1]));
  assert.ok(w / h > 1.2, `rapport ${(w / h).toFixed(2)} : le lac paraît trop haut`);
});

test('la projection place le nord en haut et l’ouest à gauche', () => {
  const { project } = projectPoints(LAKE_OUTLINE, { width: 340, height: 208 });
  const geneve = project(46.2210, 6.1610);
  const villeneuve = project(46.4000, 6.9300);
  assert.ok(geneve[0] < villeneuve[0], 'Genève est à l’ouest de Villeneuve');
  assert.ok(geneve[1] > villeneuve[1], 'Genève est au sud de Villeneuve');
});

test('snapshotCurrentTemps prend, pour chaque lieu, le point le plus proche de maintenant', () => {
  const iso = (h) => new Date(NOW + h * 3600 * 1000).toISOString();
  const temps = snapshotCurrentTemps({
    spots: {
      geneve: { t: [iso(-3), iso(0), iso(3)], v: [20, 21, 22] },
      vevey: { t: [iso(-6), iso(-3)], v: [18, 19] },
      vide: { t: [], v: [] },
    },
  }, NOW);
  assert.equal(temps.geneve, 21);
  assert.equal(temps.vevey, 19, 'le plus proche de maintenant, même dans le passé');
  assert.ok(!('vide' in temps), 'un lieu sans point ne doit pas apparaître');
});

const serie = (offsetsH, vals) => offsetsH.map((h, i) => ({
  at: new Date(NOW + h * 3600 * 1000), value: vals[i],
}));

console.log('\ntendance sur 24 h');

test('l’écart se mesure entre la veille et maintenant', () => {
  const delta = trend(serie([-24, -12, 0], [18, 19, 20]), NOW);
  assert.equal(Number(delta.toFixed(2)), 2);
});

test('un refroidissement donne un écart négatif', () => {
  assert.ok(trend(serie([-24, 0], [21, 19.5]), NOW) < 0);
});

test('une série trop courte ne donne pas de tendance', () => {
  // Le point le plus ancien est à six heures : le prendre pour la veille
  // annoncerait un écart de vingt-quatre heures qui n’en est pas un.
  assert.equal(trend(serie([-6, 0], [19, 20]), NOW), null);
});

test('sans série, pas de tendance', () => {
  assert.equal(trend([], NOW), null);
  assert.equal(trend(null, NOW), null);
});

test('une série qui s’arrête hier ne donne pas de tendance', () => {
  assert.equal(trend(serie([-48, -36], [18, 19]), NOW), null);
});

console.log('\nrespiration guidée');

test('quatre secondes d’inspiration, six d’expiration', () => {
  assert.equal(breathCue(0).word, 'Inspirez');
  assert.equal(breathCue(3.9).phase, 'in');
  assert.equal(breathCue(4).phase, 'out');
  assert.equal(breathCue(9.9).phase, 'out');
  assert.equal(breathCue(10).phase, 'in', 'le cycle se répète');
});

test('le décompte affiché ne descend jamais à zéro', () => {
  for (const t of [0, 1.5, 3.99, 4, 7, 9.99]) {
    const cue = breathCue(t);
    assert.ok(cue.seconds >= 1 && cue.seconds <= 6, `${t} s → ${cue.seconds}`);
  }
});

test('la progression va de zéro à un dans chaque phase', () => {
  assert.ok(Math.abs(breathCue(0).progress - 0) < 1e-9);
  assert.ok(Math.abs(breathCue(2).progress - 0.5) < 1e-9);
  assert.ok(Math.abs(breathCue(4).progress - 0) < 1e-9);
  assert.ok(Math.abs(breathCue(7).progress - 0.5) < 1e-9);
});

test('un temps écoulé négatif ne casse pas le cycle', () => {
  const cue = breathCue(-1);
  assert.equal(cue.phase, 'out');
  assert.ok(cue.progress >= 0 && cue.progress <= 1);
});

console.log('\nlieu le plus proche');

test('depuis une rive, le lieu retenu est bien le plus proche', () => {
  // Depuis Ouchy, à Lausanne.
  const a = nearestSpot({ lat: 46.5070, lon: 6.6280 });
  assert.equal(a.spot.key, 'lausanne');
  assert.ok(a.km < 3, `${a.km.toFixed(1)} km`);

  // Depuis les quais de Montreux.
  const b = nearestSpot({ lat: 46.4340, lon: 6.9110 });
  assert.equal(b.spot.key, 'montreux');

  // Depuis Thonon, sur la rive française.
  const c = nearestSpot({ lat: 46.3760, lon: 6.4780 });
  assert.equal(c.spot.key, 'thonon');
});

test('depuis loin, un lieu est tout de même désigné, avec sa distance', () => {
  const zurich = nearestSpot({ lat: 47.3769, lon: 8.5417 });
  assert.ok(zurich, 'un lieu doit toujours être proposé');
  assert.ok(zurich.km > 150, `${zurich.km.toFixed(0)} km : l’app doit pouvoir le signaler`);
});

test('une position invalide ne désigne aucun lieu', () => {
  assert.equal(nearestSpot(null), null);
  assert.equal(nearestSpot({ lat: NaN, lon: 6.6 }), null);
  assert.equal(nearestSpot({ lat: 46.5 }), null);
  assert.equal(nearestSpot({ lat: 46.5, lon: 6.6 }, []), null);
});

test('le lieu le plus proche est unique et cohérent avec distanceKm', () => {
  const from = { lat: 46.4500, lon: 6.7000 };
  const near = nearestSpot(from);
  const toutes = SPOTS.map((s) => distanceKm(from, s));
  assert.ok(Math.abs(near.km - Math.min(...toutes)) < 1e-9);
});

console.log('\nbalayage entre les lieux');

test('un balayage franc vers la gauche va au lieu suivant', () => {
  assert.equal(swipeDecision(-120, 8, 220), 'next');
  assert.equal(swipeDecision(120, -8, 220), 'prev');
});

test('un geste trop court n’est qu’une touche', () => {
  assert.equal(swipeDecision(-20, 2, 120), null);
  assert.equal(swipeDecision(44, 0, 120), null);
  assert.equal(swipeDecision(46, 0, 120), 'prev');
});

test('un geste vertical reste un défilement, jamais un balayage', () => {
  assert.equal(swipeDecision(-60, 200, 300), null, 'défilement vers le bas');
  assert.equal(swipeDecision(-60, -200, 300), null, 'défilement vers le haut');
  // En diagonale, l'horizontale doit dominer nettement.
  assert.equal(swipeDecision(-100, 70, 300), null);
  assert.equal(swipeDecision(-100, 50, 300), 'next');
});

test('un geste lent doit être plus ample pour compter', () => {
  assert.equal(swipeDecision(-60, 0, 1500), null, 'lent et court : hésitation');
  assert.equal(swipeDecision(-120, 0, 1500), 'next', 'lent mais franc : intention');
});

test('les extrémités bornent le déplacement au lieu de boucler', () => {
  assert.equal(nextIndex(0, 'prev', 10), 0, 'premier lieu : on y reste');
  assert.equal(nextIndex(9, 'next', 10), 9, 'dernier lieu : on y reste');
  assert.equal(nextIndex(4, 'next', 10), 5);
  assert.equal(nextIndex(4, 'prev', 10), 3);
  assert.equal(nextIndex(4, null, 10), 4);
});

console.log('\nbain froid : durée conseillée');

test('une minute par degré, arrondie', () => {
  assert.equal(bathPlan(10).minutes, 10);
  assert.equal(bathPlan(6.4).minutes, 6);
  assert.equal(bathPlan(6.6).minutes, 7);
  assert.equal(bathPlan(13.2).minutes, 13);
});

test('la durée est plafonnée : la règle vise l’eau froide', () => {
  assert.equal(bathPlan(25).minutes, BATH_MAX_MINUTES);
  assert.equal(bathPlan(25).capped, true);
  assert.equal(bathPlan(14).capped, false);
});

test('jamais moins d’une minute, même près de zéro', () => {
  assert.equal(bathPlan(0.4).minutes, 1);
  assert.equal(bathPlan(0).minutes, 1);
  assert.equal(bathPlan(-1).minutes, 1);
});

test('au-delà de 18 °C, ce n’est plus un bain froid', () => {
  assert.equal(bathPlan(12).cold, true);
  assert.equal(bathPlan(17.9).cold, true);
  assert.equal(bathPlan(18).cold, false);
  assert.equal(bathPlan(24).cold, false);
});

test('sans température, aucun plan n’est inventé', () => {
  assert.equal(bathPlan(null), null);
  assert.equal(bathPlan(NaN), null);
  assert.equal(bathPlan('froid'), null);
});

console.log('\nbain froid : phases de l’immersion');

test('l’entrée dans l’eau parle de respiration', () => {
  const p = bathPhase(5, 600);
  assert.equal(p.key, 'shock');
  assert.match(p.hint, /inspirations/);
});

test('le milieu rappelle de rester près du bord', () => {
  assert.equal(bathPhase(300, 600).key, 'steady');
  assert.match(bathPhase(300, 600).label, /bord/);
});

test('la dernière minute annonce la sortie', () => {
  assert.equal(bathPhase(545, 600).key, 'exit');
  assert.equal(bathPhase(539, 600).key, 'steady');
});

test('les seuils se resserrent sur une immersion courte', () => {
  // Sur 2 minutes, une phase d'entrée de 60 s occuperait la moitié du bain :
  // elle vaut donc 25 % du total, soit 30 s ici, contre 60 s sur un bain long.
  assert.equal(bathPhase(29, 120).key, 'shock');
  assert.equal(bathPhase(31, 120).key, 'steady');
  assert.equal(bathPhase(91, 120).key, 'exit');
  // Sur une minute, le plancher de 15 s empêche des phases dérisoires.
  assert.equal(bathPhase(14, 60).key, 'shock');
  assert.equal(bathPhase(16, 60).key, 'steady');
});

test('l’échéance et le dépassement sont un même état, sans ambiguïté', () => {
  assert.equal(bathPhase(600, 600).key, 'done');
  assert.equal(bathPhase(900, 600).key, 'done');
  assert.match(bathPhase(600, 600).label, /Sors/);
});

test('une durée absurde ne fait pas planter les phases', () => {
  assert.equal(bathPhase(10, 0).key, 'idle');
  assert.equal(bathPhase(10, -5).key, 'idle');
});

console.log('\nbain froid : messages du coach');

test('les quatre premiers seuils, sur un bain de dix minutes', () => {
  const msg = (el) => bathCoach(el, 600);
  assert.match(msg(0), /Installe-toi/);
  assert.match(msg(10), /Installe-toi/, 'rien de nouveau avant le seuil suivant');
  assert.match(msg(15), /premier souffle/);
  assert.match(msg(59), /premier souffle/);
  assert.match(msg(60), /s’ajuste/);
});

test('mi-parcours puis dernière minute, avant la fin', () => {
  assert.match(bathCoach(300, 600), /Rien à prouver/);
  assert.match(bathCoach(539, 600), /Rien à prouver/);
  assert.match(bathCoach(540, 600), /Encore un souffle/);
  assert.match(bathCoach(599, 600), /Encore un souffle/);
});

test('la fin l’emporte à l’échéance, et reste pendant le dépassement', () => {
  assert.match(bathCoach(600, 600), /Voilà/);
  assert.match(bathCoach(900, 600), /Voilà/, 'un dépassement ne doit pas revenir à un seuil antérieur');
});

test('sur un bain très court, les seuils relatifs priment sur ceux à heure fixe', () => {
  // À 60 s, mi-parcours (30 s), dernière minute (0 s) et le seuil fixe « corps
  // qui s'ajuste » (60 s) coïncident tous avec la fin. C'est elle qui doit
  // l'emporter : la fin est un fait, pas un seuil parmi d'autres.
  assert.match(bathCoach(60, 60), /Voilà/);
  assert.match(bathCoach(30, 60), /Rien à prouver/, 'mi-parcours prime sur le seuil à 15 s ou 0 s');
});

test('sans durée, aucun message n’est inventé', () => {
  assert.equal(bathCoach(10, 0), '');
  assert.equal(bathCoach(10, -5), '');
});

console.log('\nphrase du jour');

test('la phrase suit la bande de température', () => {
  const jour = new Date('2026-08-04T12:00:00');
  assert.match(greeting(6, jour), /vive|mérite|précipitation/);
  assert.match(greeting(16, jour), /clémente|Fraîche|facile/);
  assert.match(greeting(26, jour), /tiède|fin d’été/);
});

test('elle ne bouge pas dans la journée, et change le lendemain', () => {
  const matin = new Date('2026-08-04T06:30:00');
  const soir = new Date('2026-08-04T22:45:00');
  assert.equal(greeting(16, matin), greeting(16, soir));
  assert.notEqual(greeting(16, matin), greeting(16, new Date('2026-08-05T06:30:00')));
});

test('sans température, l’app ne fait pas semblant', () => {
  assert.match(greeting(null), /Aucune source/);
});

test('dayNumber change à minuit local, pas à minuit UTC', () => {
  // 23 h 30 puis 00 h 30 : deux jours distincts, quelle que soit la zone.
  assert.equal(dayNumber(new Date('2026-08-04T23:30:00')), dayNumber(new Date('2026-08-04T08:00:00')));
  assert.equal(dayNumber(new Date('2026-08-05T00:30:00')), dayNumber(new Date('2026-08-04T23:30:00')) + 1);
});

console.log('\nbilan des immersions');

const bain = (jours, minutes = 10, temp = 14) => ({
  at: new Date(NOW - jours * 86400000).toISOString(), minutes, temp,
});

test('la série compte les jours consécutifs', () => {
  assert.equal(bathStats([bain(0), bain(1), bain(2)], NOW).streak, 3);
});

test('un jour manqué au milieu arrête la série là', () => {
  assert.equal(bathStats([bain(0), bain(1), bain(3), bain(4)], NOW).streak, 2);
});

test('s’être baigné hier suffit : la série tient jusqu’à la fin de la journée', () => {
  // Sans cette tolérance, la série tomberait à zéro chaque matin avant le bain.
  assert.equal(bathStats([bain(1), bain(2)], NOW).streak, 2);
});

test('une série interrompue avant-hier ne vaut plus rien', () => {
  assert.equal(bathStats([bain(2), bain(3), bain(4)], NOW).streak, 0);
});

test('deux bains le même jour ne comptent qu’un jour de série', () => {
  assert.equal(bathStats([bain(0), bain(0.2), bain(1)], NOW).streak, 2);
});

test('la plus froide et les minutes de la semaine', () => {
  const s = bathStats([bain(0, 5, 12.4), bain(2, 8, 9.1), bain(20, 30, 4.0)], NOW);
  assert.equal(s.coldest, 4);
  assert.equal(s.minutesWeek, 13, 'le bain d’il y a vingt jours ne compte pas');
  assert.equal(s.count, 3);
});

test('un journal vide ou abîmé ne fait rien planter', () => {
  assert.deepEqual(bathStats([], NOW), { count: 0, streak: 0, coldest: null, minutesWeek: 0, last: null });
  assert.equal(bathStats(null, NOW).count, 0);
  assert.equal(bathStats([{ at: 'nawak', minutes: 5 }, { at: NOW, minutes: 0 }], NOW).count, 0);
});

test('la phrase de bilan reste une habitude, pas un score', () => {
  assert.match(statsPhrase(bathStats([bain(0), bain(1)], NOW)), /2 jours que tu réponds présent/);
  assert.match(statsPhrase(bathStats([bain(0)], NOW)), /Première fois/);
  assert.match(statsPhrase(bathStats([bain(0), bain(5)], NOW)), /2 immersions/);
  assert.equal(statsPhrase(bathStats([], NOW)), '');
});

test('statsPhrase ne récompense jamais la durée ni le froid, même sur un extrême', () => {
  // Un bain long et glacial ne doit pas produire une phrase différente d'un
  // bain bref et tiède : seule la régularité — présence, jours consécutifs —
  // peut varier la formule. C'est la garantie testée ici, pas un hasard de
  // formulation : la mécanique ne doit jamais donner de raison de pousser plus
  // loin la durée ou le froid pour « mieux » réussir sa série.
  const scénarios = [
    bathStats([bain(0, 45, 1.5), bain(1, 60, 0.5)], NOW),        // long et glacial
    bathStats([bain(0, 3, 22)], NOW),                             // bref et tiède
    bathStats([bain(0), bain(1), bain(2), bain(3), bain(4)], NOW), // longue série
  ];
  for (const s of scénarios) {
    const p = statsPhrase(s);
    assert.ok(!/\d+([.,]\d+)?\s*°|degr[ée]|minutes?\b|record|plus (froid|long|dur|fort)/i.test(p),
      `phrase suspecte de récompenser l’escalade : « ${p} »`);
  }
});

test('le texte de partage dit la donnée, sans triomphe', () => {
  assert.equal(shareText({ minutes: 20, temp: 12.4, place: 'Vevey' }), '20 min à 12,4° — Vevey, lac Léman.');
  assert.equal(shareText({ minutes: 8, temp: 9 }), '8 min à 9,0° dans le Léman.');
  assert.equal(shareText({}), 'un bain dans le Léman.');
});

test('formatClock affiche minutes et secondes, toujours sur deux chiffres', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(9), '00:09');
  assert.equal(formatClock(65), '01:05');
  assert.equal(formatClock(600), '10:00');
  assert.equal(formatClock(-3), '00:00', 'un reste négatif ne doit pas s’afficher tel quel');
});

console.log(`\n${passed} tests passés${process.exitCode ? ' — échecs ci-dessus' : ''}`);
