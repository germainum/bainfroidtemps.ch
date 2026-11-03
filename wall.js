// Le mur du lac : un plan en perspective, courbé sur les bords, couvert de
// tuiles — une par lieu, avec sa température sur une eau qui bouge. On le fait
// glisser, il continue sur sa lancée ; le curseur allume la grille, un clic
// sélectionne un lieu et le ramène au centre.
//
// WebGL2 brut, aucune dépendance : tout tient dans un seul fragment shader qui
// remonte chaque pixel jusqu'au plan (lancer de rayon sur un sol incliné). Le
// même calcul existe côté JavaScript (`screenToWorld`) pour savoir quelle
// tuile se trouve sous le doigt — les deux doivent rester d'accord, c'est pour
// cela que les constantes de la scène sont poussées au shader plutôt que
// recopiées.
//
// Sans WebGL2, `initWall` renvoie null et la page garde son fond uni : le mur
// est un décor, jamais une condition pour lire la température.

/* ------------------------------------------------------------------ scène */

const SCENE = {
  pitch: 1.0,          // inclinaison de la caméra (rad), 0 = à l'horizontale
  focal: 1.45,
  height: 6.4,          // hauteur de la caméra au-dessus du plan
  curve: 0.075,         // relèvement des bords de l'écran
  pitch_scroll: 0.28,   // inclinaison ajoutée en quittant le premier écran
  pitch_mouse: 0.035,
  pitchMin: 0.5,
  // Pas de la grille, en unités du monde. Une tuile occupe 2,5 × 1,5 dans une
  // maille de 3,5 × 2,5 ; les rangées impaires sont décalées d'un demi-pas.
  pitchX: 3.5,
  pitchZ: 2.5,
  tileX0: 0.5, tileX1: 3.0,
  tileZ0: 0.5, tileZ1: 2.0,
  shift: 1.5,
  spots: 10,
  rowStep: 4,           // d'une rangée à l'autre, on avance de 4 lieux
};

// Couleurs de l'eau par bande de température : [profond, surface].
const WATER = {
  cold:    [[0.04, 0.10, 0.30], [0.30, 0.52, 0.94]],
  cool:    [[0.02, 0.16, 0.30], [0.22, 0.72, 0.92]],
  fresh:   [[0.02, 0.20, 0.22], [0.20, 0.78, 0.64]],
  good:    [[0.10, 0.20, 0.06], [0.66, 0.80, 0.26]],
  warm:    [[0.30, 0.10, 0.04], [0.96, 0.58, 0.20]],
  unknown: [[0.08, 0.09, 0.11], [0.26, 0.28, 0.33]],
};

const TILE_W = 640;
const TILE_H = 384;
const COLS = 5;

/* ---------------------------------------------------------------- shaders */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPan;
uniform float uPitch;
uniform float uFocal;
uniform float uHeight;
uniform float uCurve;
uniform vec2  uMouse;        // position du curseur dans le monde
uniform float uMouseOn;      // 0..1 : le curseur est-il sur le mur ?
uniform vec2  uHover;        // colonne et rangée de la tuile survolée
uniform float uHoverOn;
uniform float uSel;          // lieu sélectionné (0..9), -1 si aucun
uniform vec4  uRip[4];       // x, z, début, actif
uniform float uFade;         // 1 = plein éclat, 0 = éteint (défilement)
uniform vec3  uDeep[10];
uniform vec3  uSurf[10];
uniform sampler2D uAtlas;

uniform vec2  uPitchXZ;      // pas de la grille
uniform vec4  uTile;         // x0, x1, z0, z1
uniform float uShift;
uniform float uRowStep;

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

// Une ligne de grille d'épaisseur constante à l'écran, quelle que soit la
// perspective : la dérivée de la coordonnée donne la taille d'un pixel.
float gridLine(float c, float w) {
  float d = abs(fract(c - 0.5) - 0.5);
  return 1.0 - smoothstep(0.0, w, d / max(fwidth(c), 1e-5));
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(ndc.x * aspect, ndc.y);
  // Le relèvement des bords donne l'allure de bol de la maquette.
  p.y -= uCurve * p.x * p.x;

  float cp = cos(uPitch), sp = sin(uPitch);
  vec3 d = vec3(p.x, p.y * cp - uFocal * sp, p.y * sp + uFocal * cp);
  vec3 bg = vec3(0.047, 0.047, 0.051);
  if (d.y > -0.02) { outColor = vec4(bg, 1.0); return; }

  float t = uHeight / -d.y;
  vec2 w = vec2(t * d.x, t * d.z) + uPan;

  float dist = length(vec3(t * d.x, uHeight, t * d.z));
  float fog = exp(-dist * 0.021);
  float horizon = smoothstep(-0.02, -0.55, d.y);          // s'éteint vers le haut

  /* ---- grille */
  float gx = gridLine(w.x * 2.0, 0.9);
  float gz = gridLine(w.y * 2.0, 0.9);
  float grid = max(gx, gz);
  float majX = gridLine(w.x / uPitchXZ.x, 1.2);
  float majZ = gridLine(w.y / uPitchXZ.y, 1.2);
  float major = max(majX, majZ);

  float md = distance(w, uMouse);
  float glow = uMouseOn * smoothstep(5.0, 0.0, md);
  vec3 lineCol = vec3(0.92, 0.90, 0.86);
  vec3 hot = mix(vec3(0.95, 0.16, 0.24), vec3(0.45, 0.35, 1.0), smoothstep(0.0, 4.0, md));
  vec3 col = bg;
  col += lineCol * grid * (0.085 + 0.07 * major);
  col += hot * grid * glow * 0.75;
  col += vec3(0.95, 0.16, 0.24) * major * 0.05;

  /* ondes : cercles qui partent du clic, plus un anneau autour du curseur */
  float ring = uMouseOn * smoothstep(0.12, 0.0, abs(md - 1.15 - 0.1 * sin(uTime * 3.0)));
  col += hot * ring * 0.18 * smoothstep(5.0, 0.0, md);
  for (int i = 0; i < 4; i++) {
    float age = uTime - uRip[i].z;
    if (uRip[i].w > 0.5 && age > 0.0 && age < 2.2) {
      float rr = age * 4.2;
      float rd = distance(w, uRip[i].xy);
      float k = smoothstep(0.3, 0.0, abs(rd - rr)) * (1.0 - age / 2.2);
      col += vec3(1.0, 0.45, 0.50) * k * 0.55;
      col += vec3(0.95, 0.16, 0.24) * k * grid * 1.2;
    }
  }

  /* ---- tuiles */
  vec2 q = vec2(w.x, w.y);
  float row = floor(q.y / uPitchXZ.y);
  float oddRow = abs(mod(row, 2.0));
  float colX = (q.x - uShift * oddRow) / uPitchXZ.x;
  float colI = floor(colX);
  vec2 loc = vec2(fract(colX) * uPitchXZ.x, q.y - row * uPitchXZ.y);

  bool inTile = loc.x > uTile.x && loc.x < uTile.y && loc.y > uTile.z && loc.y < uTile.w;
  if (inTile) {
    float id = mod(colI + row * uRowStep, 10.0);
    id = id < 0.0 ? id + 10.0 : id;
    int ii = int(id + 0.5);
    vec2 uv = vec2((loc.x - uTile.x) / (uTile.y - uTile.x),
                   (loc.y - uTile.z) / (uTile.w - uTile.z));
    // Le sens de la profondeur est inversé : la rangée proche est en bas.
    vec2 tuv = vec2(uv.x, 1.0 - uv.y);

    bool hovered = uHoverOn > 0.5 && abs(colI - uHover.x) < 0.5 && abs(row - uHover.y) < 0.5;
    bool selected = abs(id - uSel) < 0.5;

    // eau
    vec2 wp = tuv * vec2(5.0, 3.0) + float(ii) * 7.31;
    float tt = uTime * 0.07;
    float warp = fbm(wp * 0.9 - vec2(tt * 0.8, -tt));
    float n = fbm(wp + vec2(tt, tt * 0.6) + warp * 1.6);
    float cau = pow(1.0 - abs(fbm(wp * 1.7 + warp * 2.2 + tt * 2.0) - 0.5) * 2.0, 5.0);
    vec3 deep = uDeep[ii], surf = uSurf[ii];
    vec3 water = mix(deep, surf, smoothstep(0.25, 0.85, n));
    water += cau * 0.22 * (surf + 0.4);
    // lumière qui glisse sur la tuile survolée
    float sweep = hovered ? smoothstep(0.35, 0.0, abs(uv.x - fract(uTime * 0.6)) ) * 0.25 : 0.0;
    water *= hovered ? 1.22 : 1.0;
    water += sweep;
    // dégradé vers le bas : le chiffre se lit sur le sombre
    water *= mix(1.0, 0.45, smoothstep(0.35, 1.0, tuv.y));

    vec4 atlas = texture(uAtlas, vec2((mod(float(ii), 5.0) + uv.x) / 5.0,
                                     (floor(float(ii) / 5.0) + tuv.y) / 2.0));
    vec3 tile = mix(water, atlas.rgb, atlas.a);

    // cadre : filet clair, rouge si la tuile est choisie
    vec2 e = min(uv, 1.0 - uv) * vec2(uTile.y - uTile.x, uTile.w - uTile.z);
    float edge = min(e.x, e.y);
    float px = fwidth(edge);
    float frame = 1.0 - smoothstep(px, px * 2.0, edge);
    float sframe = 1.0 - smoothstep(px * 2.0, px * 4.5, edge);
    tile = mix(tile, vec3(1.0, 0.92, 0.88), frame * (hovered ? 0.8 : 0.22));
    if (selected) tile = mix(tile, vec3(0.97, 0.16, 0.24), sframe);

    float tileFog = mix(0.18, 1.0, fog) * mix(0.35, 1.0, horizon);
    col = mix(col, tile, 1.0) * tileFog + (selected ? vec3(0.97, 0.16, 0.24) * 0.06 : vec3(0.0));
  } else {
    col *= mix(0.25, 1.0, fog) * mix(0.0, 1.0, horizon);
  }

  col *= uFade;
  // vignette : le bas de l'écran s'assombrit sous le chiffre et le bouton
  float vy = smoothstep(-1.0, -0.15, ndc.y);
  col *= mix(0.55, 1.0, vy);
  outColor = vec4(col, 1.0);
}`;

/* ---------------------------------------------------------------- module */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mod = (a, n) => ((a % n) + n) % n;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader : ${log}`);
  }
  return sh;
}

// `spots` : [{ key, name, sub }] dans l'ordre du lac. `bandOf(temp)` donne la
// bande de couleur, `format(temp)` le texte du chiffre.
export function initWall({ canvas, spots, bandOf, format, onSelect, onMove, onHover }) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, powerPreference: 'high-performance',
  });
  if (!gl) return null;

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (err) {
    console.warn('Mur 3D indisponible —', err.message);
    return null;
  }
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ['uRes', 'uTime', 'uPan', 'uPitch', 'uFocal', 'uHeight', 'uCurve', 'uMouse',
    'uMouseOn', 'uHover', 'uHoverOn', 'uSel', 'uRip', 'uFade', 'uDeep', 'uSurf', 'uAtlas',
    'uPitchXZ', 'uTile', 'uShift', 'uRowStep']) U[n] = gl.getUniformLocation(program, n);

  gl.uniform2f(U.uPitchXZ, SCENE.pitchX, SCENE.pitchZ);
  gl.uniform4f(U.uTile, SCENE.tileX0, SCENE.tileX1, SCENE.tileZ0, SCENE.tileZ1);
  gl.uniform1f(U.uShift, SCENE.shift);
  gl.uniform1f(U.uRowStep, SCENE.rowStep);
  gl.uniform1f(U.uFocal, SCENE.focal);
  gl.uniform1f(U.uHeight, SCENE.height);
  gl.uniform1f(U.uCurve, SCENE.curve);
  gl.uniform1i(U.uAtlas, 0);

  /* ---- atlas : nom et chiffre de chaque lieu, sur fond transparent */
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = TILE_W * COLS;
  atlasCanvas.height = TILE_H * 2;
  const actx = atlasCanvas.getContext('2d');
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif';
  const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  let temps = {};

  function spaced(ctx, text, x, y, gap) {
    for (const ch of text) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + gap; }
  }

  function paintAtlas() {
    actx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    spots.forEach((spot, i) => {
      const ox = (i % COLS) * TILE_W;
      const oy = Math.floor(i / COLS) * TILE_H;
      actx.save();
      actx.translate(ox, oy);
      actx.fillStyle = '#fff';
      actx.textBaseline = 'alphabetic';
      actx.font = `700 30px ${MONO}`;
      spaced(actx, spot.name.toUpperCase(), 36, 62, 4);
      if (spot.sub) {
        actx.globalAlpha = 0.7;
        actx.font = `400 22px ${MONO}`;
        spaced(actx, spot.sub.toUpperCase(), 36, 94, 3);
        actx.globalAlpha = 1;
      }
      actx.textAlign = 'right';
      actx.globalAlpha = 0.75;
      actx.font = `400 24px ${MONO}`;
      actx.fillText(String(i + 1).padStart(2, '0'), TILE_W - 36, 62);
      actx.globalAlpha = 1;
      actx.textAlign = 'left';

      const t = temps[spot.key];
      const known = typeof t === 'number' && isFinite(t);
      actx.font = `400 ${known ? 168 : 120}px ${SERIF}`;
      const txt = known ? format(t) : '—';
      actx.fillText(txt, 30, TILE_H - 44);
      if (known) {
        const w = actx.measureText(txt).width;
        actx.font = `italic 400 72px ${SERIF}`;
        actx.fillText('°C', 30 + w + 6, TILE_H - 108);
      }
      actx.restore();
    });
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function paintColors() {
    const deep = new Float32Array(30);
    const surf = new Float32Array(30);
    spots.forEach((spot, i) => {
      const [d, s] = WATER[bandOf(temps[spot.key])] || WATER.unknown;
      deep.set(d, i * 3);
      surf.set(s, i * 3);
    });
    gl.uniform3fv(U.uDeep, deep);
    gl.uniform3fv(U.uSurf, surf);
  }

  /* ---- état */
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pan = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  let target = null;                 // { x, y } : recentrage animé
  let selected = -1;
  let hover = null;                  // { col, row, id }
  let mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, on: false, px: 0, py: 0 };
  let scrollP = 0;
  let fade = 1;
  let width = 1, height = 1;
  let scale = 1;
  let running = false;
  let visible = true;
  let dirty = true;
  let lastInteract = -99;
  const ripples = [{ x: 0, y: 0, t: -99, on: 0 }, { x: 0, y: 0, t: -99, on: 0 },
    { x: 0, y: 0, t: -99, on: 0 }, { x: 0, y: 0, t: -99, on: 0 }];
  let ripN = 0;
  let clock = 0;

  const pitchNow = () => clamp(SCENE.pitch + scrollP * SCENE.pitch_scroll
    - mouse.ndcY * SCENE.pitch_mouse, SCENE.pitchMin, 1.4);

  // Même calcul que le shader : de l'écran (px CSS) au plan du monde.
  function screenToWorld(px, py, panX = pan.x, panY = pan.y) {
    const nx = (px / width) * 2 - 1;
    const ny = 1 - (py / height) * 2;
    const aspect = width / height;
    const x = nx * aspect;
    const y = ny - SCENE.curve * x * x;
    const pitch = pitchNow();
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dx = x, dy = y * cp - SCENE.focal * sp, dz = y * sp + SCENE.focal * cp;
    if (dy > -0.02) return null;
    const t = SCENE.height / -dy;
    return { x: t * dx + panX, y: t * dz + panY };
  }

  function tileAt(w) {
    if (!w) return null;
    const row = Math.floor(w.y / SCENE.pitchZ);
    const odd = mod(row, 2);
    const colX = (w.x - SCENE.shift * odd) / SCENE.pitchX;
    const col = Math.floor(colX);
    const lx = (colX - col) * SCENE.pitchX;
    const lz = w.y - row * SCENE.pitchZ;
    if (lx <= SCENE.tileX0 || lx >= SCENE.tileX1 || lz <= SCENE.tileZ0 || lz >= SCENE.tileZ1) return null;
    return { col, row, id: mod(col + row * SCENE.rowStep, SCENE.spots) };
  }

  function tileCenter(col, row) {
    return {
      x: (col + (SCENE.tileX0 + SCENE.tileX1) / 2 / SCENE.pitchX) * SCENE.pitchX + SCENE.shift * mod(row, 2),
      y: (row * SCENE.pitchZ) + (SCENE.tileZ0 + SCENE.tileZ1) / 2,
    };
  }

  // Le plus proche des tuiles portant ce lieu, vu depuis le centre actuel.
  function nearestTileOf(id) {
    const c = screenToWorld(width / 2, height * 0.36) || { x: pan.x, y: pan.y };
    const r0 = Math.round(c.y / SCENE.pitchZ);
    let best = null;
    for (let row = r0 - 4; row <= r0 + 4; row++) {
      // colonne telle que mod(col + row*step, 10) = id, la plus proche de c.x
      const base = mod(id - row * SCENE.rowStep, SCENE.spots);
      const colGuess = Math.round((c.x - SCENE.shift * mod(row, 2)) / SCENE.pitchX);
      for (let k = -SCENE.spots; k <= SCENE.spots; k++) {
        const col = colGuess + k;
        if (mod(col, SCENE.spots) !== base) continue;
        const ctr = tileCenter(col, row);
        const d = (ctr.x - c.x) ** 2 + ((ctr.y - c.y) * 2.2) ** 2;
        if (!best || d < best.d) best = { d, ctr };
      }
    }
    return best?.ctr || null;
  }

  function centerOn(ctr) {
    // Le point visé à l'écran est le milieu de la zone libre, au-dessus du chiffre.
    const ref = screenToWorld(width / 2, height * 0.36, 0, 0);
    if (!ref) return;
    target = { x: ctr.x - ref.x, y: ctr.y - ref.y };
    vel.x = vel.y = 0;
  }

  /* ---- taille et rendu */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    const w = Math.round(width * dpr * scale);
    const h = Math.round(height * dpr * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    dirty = true;
  }

  function draw() {
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, clock);
    gl.uniform2f(U.uPan, pan.x, pan.y);
    gl.uniform1f(U.uPitch, pitchNow());
    gl.uniform2f(U.uMouse, mouse.wx ?? 0, mouse.wy ?? 0);
    gl.uniform1f(U.uMouseOn, mouse.on && mouse.wx != null ? 1 : 0);
    gl.uniform2f(U.uHover, hover ? hover.col : 0, hover ? hover.row : 0);
    gl.uniform1f(U.uHoverOn, hover ? 1 : 0);
    gl.uniform1f(U.uSel, selected);
    gl.uniform1f(U.uFade, fade);
    const rip = new Float32Array(16);
    ripples.forEach((r, i) => rip.set([r.x, r.y, r.t, r.on], i * 4));
    gl.uniform4fv(U.uRip, rip);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Qualité adaptative : si l'appareil peine, on baisse la définition plutôt
  // que de saccader. Une fois baissée, elle ne remonte pas — elle ne ferait
  // qu'osciller.
  let slow = 0;
  let frames = 0;
  let prev = 0;
  let lastSend = 0;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000 || 0.016);
    const rawDt = (now - prev) || 16;
    prev = now;
    if (!visible) return;

    if (!reduce.matches) clock += dt;

    // recentrage animé, sinon inertie, sinon dérive lente au repos
    let moved = false;
    if (target) {
      const k = 1 - Math.exp(-dt * 5.5);
      pan.x += (target.x - pan.x) * k;
      pan.y += (target.y - pan.y) * k;
      if (Math.abs(target.x - pan.x) + Math.abs(target.y - pan.y) < 0.004) target = null;
      moved = true;
    } else if (!dragging) {
      if (Math.abs(vel.x) + Math.abs(vel.y) > 0.01) {
        pan.x += vel.x * dt;
        pan.y += vel.y * dt;
        const f = Math.exp(-dt * 3.2);
        vel.x *= f; vel.y *= f;
        moved = true;
      } else if (!reduce.matches && clock - lastInteract > 5) {
        pan.x += 0.16 * dt;
        pan.y += 0.04 * dt;
        moved = true;
      }
    }
    if (moved || dragging) refreshHover();
    if (moved && now - lastSend > 80) { lastSend = now; onMove?.(pan.x, pan.y); }

    if (!reduce.matches || dirty || moved) { draw(); dirty = false; }

    frames++;
    if (rawDt > 30) slow++; else slow = Math.max(0, slow - 0.2);
    if (frames > 60 && slow > 40 && scale > 0.55) {
      scale = Math.max(0.55, scale - 0.15);
      slow = 0;
      resize();
    }
  }

  function start() {
    if (running) return;
    running = true;
    prev = performance.now();
    requestAnimationFrame(frame);
  }

  /* ---- pointeur */
  let dragging = false;
  let down = null;
  let grab = null;

  const interactive = (el) => el && el.closest && el.closest(
    'button, a, select, input, label, summary, details, .card, .facts, .ticker, .timer, .onboarding, .toast, .head');

  function refreshHover() {
    if (!mouse.on) { setHover(null); return; }
    const w = screenToWorld(mouse.px, mouse.py);
    mouse.wx = w ? w.x : null;
    mouse.wy = w ? w.y : null;
    const t = dragging ? null : tileAt(w);
    setHover(t);
  }

  function setHover(t) {
    const same = (!t && !hover) || (t && hover && t.col === hover.col && t.row === hover.row);
    if (same) return;
    hover = t;
    canvas.style.cursor = t ? 'pointer' : (dragging ? 'grabbing' : 'grab');
    onHover?.(t ? spots[t.id] : null);
    dirty = true;
  }

  function onDown(e) {
    if (!e.isPrimary || e.button > 0 || interactive(e.target)) return;
    if (scrollP > 0.9) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    grab = screenToWorld(e.clientX, e.clientY);
    dragging = false;
    target = null;
    vel.x = vel.y = 0;
    lastInteract = clock;
  }

  function onMovePtr(e) {
    mouse.px = e.clientX; mouse.py = e.clientY;
    mouse.ndcX = (e.clientX / width) * 2 - 1;
    mouse.ndcY = 1 - (e.clientY / height) * 2;
    const over = !interactive(e.target) && scrollP < 0.9;
    mouse.on = over && e.pointerType !== 'touch';
    if (down && grab) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragging && dx * dx + dy * dy > 36) { dragging = true; canvas.style.cursor = 'grabbing'; }
      if (dragging) {
        // Le point saisi reste sous le doigt : on déplace le plan de l'écart.
        const w = screenToWorld(e.clientX, e.clientY);
        if (w) {
          const ddx = grab.x - w.x, ddy = grab.y - w.y;
          pan.x += ddx; pan.y += ddy;
          const dt = Math.max(0.008, (performance.now() - (onMovePtr.last || performance.now() - 16)) / 1000);
          vel.x = vel.x * 0.6 + (ddx / dt) * 0.4;
          vel.y = vel.y * 0.6 + (ddy / dt) * 0.4;
        }
        lastInteract = clock;
        dirty = true;
      }
    }
    onMovePtr.last = performance.now();
    refreshHover();
    dirty = true;
  }

  function onUp(e) {
    if (!down) return;
    const wasDrag = dragging;
    dragging = false;
    const d = down;
    down = null;
    canvas.style.cursor = hover ? 'pointer' : 'grab';
    if (wasDrag) {
      // Un geste lent ne doit pas partir en glissade.
      if (performance.now() - (onMovePtr.last || 0) > 90) vel.x = vel.y = 0;
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > 14) { vel.x *= 14 / sp; vel.y *= 14 / sp; }
      return;
    }
    // Un simple appui : onde, et sélection si une tuile est dessous.
    const w = screenToWorld(d.x, d.y);
    if (!w) return;
    ripples[ripN] = { x: w.x, y: w.y, t: clock, on: 1 };
    ripN = (ripN + 1) % ripples.length;
    const t = tileAt(w);
    if (t) {
      const ctr = tileCenter(t.col, t.row);
      centerOn(ctr);
      // Marqué avant d'appeler dehors : sinon `setSelected` recentrerait sur une
      // autre tuile du même lieu, plus proche du centre que celle qu'on a touchée.
      selected = t.id;
      onSelect?.(spots[t.id]);
    }
    dirty = true;
  }

  function onWheel(e) {
    if (scrollP > 0.5 || interactive(e.target)) return;
    // Sur le mur, la molette le fait glisser tant qu'on reste sur le premier
    // écran ; Maj ou un geste surtout horizontal suffit à le déplacer de côté.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.8) {
      e.preventDefault();
      target = null;
      pan.x += e.deltaX * 0.012;
      lastInteract = clock;
      dirty = true;
    }
  }

  function onLeave() { mouse.on = false; setHover(null); dirty = true; }

  function onScroll() {
    const p = clamp(window.scrollY / Math.max(1, window.innerHeight), 0, 1.6);
    if (p === scrollP) return;
    scrollP = p;
    fade = 1 - clamp((p - 0.15) / 0.85, 0, 1) * 0.9;
    visible = p < 1.4;
    dirty = true;
    if (!mouse.on) hover && setHover(null);
  }

  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointermove', onMovePtr, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', () => { down = null; dragging = false; });
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden && scrollP < 1.4; dirty = true; });
  reduce.addEventListener?.('change', () => { dirty = true; });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  resize();
  paintColors();
  paintAtlas();
  onScroll();
  centerOn(tileCenter(0, 1));
  pan.x = target.x; pan.y = target.y; target = null;
  start();
  canvas.style.cursor = 'grab';

  /* ---- API */
  return {
    // Températures par lieu (clé → °C) : repeint les chiffres et la couleur de l'eau.
    setTemps(next) {
      temps = next || {};
      paintColors();
      paintAtlas();
      dirty = true;
    },
    // Lieu choisi ailleurs (liste, clavier, géolocalisation) : le mur le suit.
    setSelected(key, { focus = true } = {}) {
      const id = spots.findIndex((s) => s.key === key);
      if (id < 0 || id === selected) return;
      selected = id;
      if (focus) {
        const ctr = nearestTileOf(id);
        if (ctr) centerOn(ctr);
        lastInteract = clock;
      }
      dirty = true;
    },
    pan: () => ({ ...pan }),
    destroy() { running = false; },
  };
}
