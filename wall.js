// Le carrousel de bocaux : dix bocaux de verre, un par lieu, posés de biais sur
// un fond crème. Chacun contient de l'eau dont le niveau monte avec la
// température et dont la teinte suit la bande de froid ; l'étiquette porte le
// nom du lieu et le chiffre. On les fait glisser, ils se rangent sur le plus
// proche, et celui du centre devient le lieu choisi.
//
// WebGL2 brut, sans dépendance. Chaque bocal est un quad en perspective dont le
// fragment shader dessine tout : verre, eau, couvercle, étiquette. Le même calcul
// de projection sert à savoir quel bocal est sous le doigt.
//
// Sans WebGL2, `initWall` renvoie null : le fond reste crème et la température
// se lit sans bocaux.

/* ------------------------------------------------------------------ scène */

const SCENE = {
  fov: 32 * Math.PI / 180,
  H: 0.98,              // hauteur d'un bocal, en unités où la fenêtre fait 2 de haut
  W: 0.7,               // largeur
  spacing: 0.9,         // écart entre deux bocaux voisins (paysage)
  spacingNarrow: 0.74,  // idem en portrait
  count: 10,
};

// Eau par bande de température : [fond, surface]. Des teintes pleines, assez
// chaudes pour s'accorder au crème et au bordeaux de la page.
const WATER = {
  cold:    [[0.16, 0.20, 0.50], [0.34, 0.46, 0.86]],
  cool:    [[0.05, 0.36, 0.52], [0.24, 0.72, 0.84]],
  fresh:   [[0.06, 0.42, 0.36], [0.32, 0.76, 0.58]],
  good:    [[0.46, 0.50, 0.10], [0.84, 0.84, 0.28]],
  warm:    [[0.78, 0.26, 0.10], [0.98, 0.62, 0.22]],
  unknown: [[0.55, 0.50, 0.50], [0.82, 0.78, 0.76]],
};

const TILE_W = 768;       // étiquette : environ 2,7 de large pour 1 de haut
const TILE_H = 280;
const COLS = 2;
const ROWS = 5;

/* ---------------------------------------------------------------- shaders */

const VERT = `#version 300 es
in vec2 aPos;
uniform mat4 uMVP;
uniform vec2 uSize;
uniform float uGrow;
out vec2 vUv;
void main() {
  vUv = aPos;
  vec2 p = (aPos - 0.5) * uSize * uGrow;
  gl_Position = uMVP * vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
uniform vec2  uSize;
uniform int   uMode;        // 0 bocal, 1 ombre
uniform float uTime;
uniform float uFill;        // niveau d'eau, 0..1
uniform float uAlpha;
uniform float uSeed;
uniform float uHover;
uniform vec3  uDeep;
uniform vec3  uSurf;
uniform vec2  uTile;        // colonne et rangée dans l'atlas
uniform float uGrow;
uniform sampler2D uAtlas;

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

float sdRR(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec4 over(vec4 top, vec4 bot) { return top + bot * (1.0 - top.a); }
vec4 premul(vec3 c, float a) { return vec4(c * a, a); }

void main() {
  if (uMode == 1) {
    vec2 e = (vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, length(e));
    a *= a * 0.34 * uAlpha;
    outColor = vec4(vec3(0.43, 0.10, 0.19) * a, a);
    return;
  }

  vec2 q = (vUv - 0.5) * uSize * uGrow;
  float W = uSize.x, H = uSize.y;
  float aa = max(fwidth(q.y) * 1.1, 1e-4);

  vec4 col = vec4(0.0);

  /* ---- corps de verre */
  vec2 bc = vec2(0.0, -H * 0.1175);
  vec2 bh = vec2(W * 0.5, H * 0.3825);
  float db = sdRR(q - bc, bh, W * 0.17);
  float bodyA = 1.0 - smoothstep(-aa, aa, db);

  if (bodyA > 0.0) {
    vec2 b = (q - bc) / bh;                        // -1..1

    // air : verre à peine teinté
    vec4 body = premul(vec3(0.97, 0.93, 0.90), 0.22);

    // eau : niveau selon la température, surface qui ondule
    float level = -1.0 + 2.0 * uFill;
    float wave = 0.030 * sin(b.x * 5.0 + uTime * 1.25 + uSeed)
               + 0.018 * sin(b.x * 9.0 - uTime * 0.9 + uSeed * 2.0);
    float surfY = level + wave;
    float inWater = 1.0 - smoothstep(-0.012, 0.012, b.y - surfY);
    float n = vnoise(vec2(b.x * 3.0 + uTime * 0.08, b.y * 4.0 - uTime * 0.12) + uSeed);
    float cau = pow(1.0 - abs(vnoise(vec2(b.x * 6.0, b.y * 6.0 + uTime * 0.2) + uSeed * 3.0) - 0.5) * 2.0, 4.0);
    vec3 water = mix(uDeep, uSurf, smoothstep(-1.0, surfY + 0.3, b.y) * 0.75 + n * 0.25);
    water += cau * 0.16;
    float foam = smoothstep(0.05, 0.0, abs(b.y - surfY)) * 0.38;
    water = mix(water, vec3(1.0), foam);
    body = over(premul(water, 0.97 * inWater), body);

    // étiquette : bande crème, comme sur un pot de confiture
    float lab = (1.0 - smoothstep(-0.02, 0.02, abs(b.y + 0.42) - 0.34));
    vec3 paper = vec3(0.957, 0.918, 0.851) * (0.97 + 0.03 * vnoise(q * 90.0));
    vec4 label = premul(paper, lab);
    // filet de couleur en haut de l'étiquette, teinte de l'eau
    float band = (1.0 - smoothstep(-0.02, 0.02, abs(b.y + 0.12) - 0.035)) * lab;
    label.rgb = mix(label.rgb, uSurf * 0.92, band);
    // texte
    vec2 tuv = vec2(b.x * 0.5 + 0.5, 1.0 - (b.y + 0.76) / 0.68);
    if (tuv.y > 0.0 && tuv.y < 1.0) {
      vec4 t = texture(uAtlas, vec2((uTile.x + tuv.x) / 2.0, (uTile.y + tuv.y) / 5.0));
      label.rgb = mix(label.rgb, vec3(0.43, 0.10, 0.19), t.a * lab);
    }
    body = over(label, body);

    // reflets sur le verre
    float hl = smoothstep(0.10, 0.0, abs(b.x + 0.74)) * smoothstep(-0.95, 0.4, b.y) * smoothstep(1.0, 0.55, b.y);
    float hr = smoothstep(0.045, 0.0, abs(b.x - 0.80)) * smoothstep(-0.8, 0.3, b.y);
    body = over(premul(vec3(1.0), (hl * 0.42 + hr * 0.30) * (1.0 - lab * 0.85)), body);
    // arête : un filet clair sur le contour
    float rim = 1.0 - smoothstep(0.0, W * 0.028, -db);
    body = over(premul(vec3(1.0, 0.98, 0.95), rim * 0.34 * (1.0 - lab * 0.6)), body);

    col = body * bodyA;
  }

  /* ---- col */
  float dn = sdRR(q - vec2(0.0, H * 0.272), vec2(W * 0.40, H * 0.014), 0.0);
  col = over(premul(vec3(0.42, 0.42, 0.45), 1.0 - smoothstep(-aa, aa, dn)), col);

  /* ---- couvercle d'argent */
  float dl = sdRR(q - vec2(0.0, H * 0.39), vec2(W * 0.465, H * 0.11), W * 0.05);
  float lidA = 1.0 - smoothstep(-aa, aa, dl);
  if (lidA > 0.0) {
    float x = q.x / (W * 0.465);
    float y = (q.y - H * 0.39) / (H * 0.11);
    float sheen = 0.70 + 0.22 * cos(x * 3.1 + 0.6) + 0.10 * smoothstep(0.1, 0.0, abs(x + 0.35));
    sheen *= 0.92 + 0.08 * y;
    sheen -= 0.05 * smoothstep(0.0, -1.0, y);
    float ridge = 0.025 * sin(q.x / W * 150.0);
    vec3 metal = vec3(sheen + ridge) * vec3(0.97, 0.97, 1.0);
    col = over(premul(metal, lidA), col);
  }

  // survol : le bocal se réchauffe d'un voile clair
  col.rgb += col.a * uHover * 0.05;
  outColor = col * uAlpha;
}`;

/* ------------------------------------------------------------------ matrices */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mod = (a, n) => ((a % n) + n) % n;

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const translate = (x, y, z) => { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; };
const scaleM = (s) => { const m = ident(); m[0] = m[5] = m[10] = s; return m; };
function rotZ(a) { const m = ident(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
function rotY(a) { const m = ident(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
function rotX(a) { const m = ident(); const c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

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

/* ---------------------------------------------------------------- module */

// `spots` : [{ key, name, sub }] dans l'ordre du lac. `bandOf(temp)` donne la
// bande de couleur, `format(temp)` le texte du chiffre. `onSelect` est appelé
// quand un bocal s'immobilise au centre ; `onTap` quand on touche le bocal
// central.
export function initWall({ canvas, spots, bandOf, format, onSelect, onTap, area }) {
  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance',
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
    console.warn('Carrousel 3D indisponible —', err.message);
    return null;
  }
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ['uMVP', 'uSize', 'uGrow', 'uMode', 'uTime', 'uFill', 'uAlpha', 'uSeed', 'uHover',
    'uDeep', 'uSurf', 'uTile', 'uAtlas']) U[n] = gl.getUniformLocation(program, n);
  gl.uniform2f(U.uSize, SCENE.W, SCENE.H);
  gl.uniform1i(U.uAtlas, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  /* ---- atlas des étiquettes */
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = TILE_W * COLS;
  atlasCanvas.height = TILE_H * ROWS;
  const actx = atlasCanvas.getContext('2d');
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const SERIF = 'Marcellus,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
  let temps = {};

  function paintAtlas() {
    actx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    actx.fillStyle = '#000';
    actx.textBaseline = 'alphabetic';
    actx.textAlign = 'center';
    spots.forEach((spot, i) => {
      const ox = (i % COLS) * TILE_W + TILE_W / 2;
      const oy = Math.floor(i / COLS) * TILE_H;
      // Le haut de l'étiquette est occupé par le filet de couleur : le nom
      // commence en dessous.
      let size = 66;
      actx.font = `400 ${size}px ${SERIF}`;
      const name = spot.name.toUpperCase();
      while (actx.measureText(name).width > TILE_W - 70 && size > 36) {
        size -= 4;
        actx.font = `400 ${size}px ${SERIF}`;
      }
      actx.fillText(name, ox, oy + 98);

      const t = temps[spot.key];
      const known = typeof t === 'number' && isFinite(t);
      actx.font = `400 ${known ? 128 : 96}px ${SERIF}`;
      actx.fillText(known ? `${format(t)}°` : '—', ox, oy + TILE_H - 22);
    });
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    dirty = true;
  }

  /* ---- état */
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const N = spots.length;
  let pos = 0;                       // position du carrousel, en bocaux
  let vel = 0;                       // bocaux par seconde
  let target = null;                 // entier visé
  let settledIdx = -1;               // dernier bocal annoncé
  let dragging = false;
  let width = 1, height = 1;
  let scale = 1;
  let clock = 0;
  let dirty = true;
  let running = false;
  let inView = true;
  let aspect = 1;
  let fit = 1;                       // échelle des bocaux, selon la place libre
  let cyUnits = 0.1;                 // hauteur du centre, en unités du monde
  const mouse = { x: 0, y: 0, on: false };       // en pixels CSS, dans le canvas
  const hv = new Float32Array(N);                // survol lissé, par bocal
  const tilt = { x: new Float32Array(N), y: new Float32Array(N) };
  const quads = Array.from({ length: N }, () => ({ pts: null, d: 99 }));

  const spacing = () => SCENE.W * fit * (aspect < 1 ? 1.16 : 1.34);
  const camZ = () => 1 / Math.tan(SCENE.fov / 2);

  // Disposition d'un bocal selon sa distance au centre (en bocaux).
  function place(i) {
    const d = mod(i - pos + N / 2, N) - N / 2;
    const ad = Math.abs(d);
    const t = reduce.matches ? 0 : clock;
    const float = Math.sin(t * 0.7 + i * 1.7);
    return {
      d,
      x: d * spacing(),
      y: cyUnits - 0.03 * d * d * fit + float * 0.012 + (ad < 0.5 ? 0.02 : 0),
      z: -0.5 * Math.pow(ad, 1.05),
      rz: -d * 0.17 + Math.sin(t * 0.5 + i) * 0.025 + (d > 0 ? 0.05 : d < 0 ? -0.05 : 0),
      ry: -d * 0.10,
      s: (1 - 0.04 * ad) * fit,
      alpha: clamp(1 - (ad - 2.8) * 0.9, 0, 1),
    };
  }

  function matrices(i, p) {
    const proj = perspective(SCENE.fov, aspect, 0.1, 30);
    const view = translate(0, 0, -camZ());
    const lift = hv[i];
    let m = translate(p.x, p.y, p.z + lift * 0.12);
    m = mul(m, rotZ(p.rz));
    m = mul(m, rotY(p.ry + tilt.x[i] * 0.35));
    m = mul(m, rotX(-tilt.y[i] * 0.25));
    m = mul(m, scaleM(p.s * (1 + lift * 0.05)));
    return { mvp: mul(proj, mul(view, m)), model: m, proj, view };
  }

  // Coins d'un bocal à l'écran (px CSS), pour savoir ce qu'on touche.
  function project(mvp, w, h) {
    const hw = SCENE.W / 2, hh = SCENE.H / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
      const cx = mvp[0] * x + mvp[4] * y + mvp[12];
      const cy = mvp[1] * x + mvp[5] * y + mvp[13];
      const cw = mvp[3] * x + mvp[7] * y + mvp[15];
      return [(cx / cw * 0.5 + 0.5) * w, (1 - (cy / cw * 0.5 + 0.5)) * h];
    });
  }

  function inQuad(pt, q) {
    // convexe : même signe pour les quatre arêtes
    let sign = 0;
    for (let k = 0; k < 4; k++) {
      const a = q[k], b = q[(k + 1) % 4];
      const cr = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
      if (cr === 0) continue;
      const sg = cr > 0 ? 1 : -1;
      if (sign && sg !== sign) return false;
      sign = sg;
    }
    return true;
  }

  function pickIndex(px, py) {
    let best = -1;
    let bestD = 99;
    for (let i = 0; i < N; i++) {
      const q = quads[i];
      if (!q.pts || Math.abs(q.d) > 3) continue;
      if (inQuad([px, py], q.pts) && Math.abs(q.d) < bestD) { best = i; bestD = Math.abs(q.d); }
    }
    return best;
  }

  /* ---- couleurs & dessin */
  function colorsFor(i) {
    return WATER[bandOf(temps[spots[i].key])] || WATER.unknown;
  }

  function fillFor(i) {
    const t = temps[spots[i].key];
    if (typeof t !== 'number' || !isFinite(t)) return 0.4;
    return 0.30 + 0.56 * clamp(t / 24, 0, 1);
  }

  function draw() {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.uTime, clock);

    const order = [];
    for (let i = 0; i < N; i++) order.push([i, place(i)]);
    // du plus loin au plus proche
    order.sort((a, b) => a[1].z - b[1].z);

    for (const [i, p] of order) {
      const { mvp, proj, view } = matrices(i, p);
      quads[i].pts = project(mvp, width, height);
      quads[i].d = p.d;
      if (p.alpha <= 0.01) continue;

      // ombre posée sous le bocal
      let sh = translate(p.x + p.rz * 0.1, p.y - SCENE.H * 0.52 * p.s, p.z - 0.02);
      sh = mul(sh, scaleM(p.s));
      gl.uniformMatrix4fv(U.uMVP, false, mul(proj, mul(view, sh)));
      gl.uniform1i(U.uMode, 1);
      gl.uniform1f(U.uAlpha, p.alpha);
      gl.uniform1f(U.uGrow, 1.0);
      gl.uniform2f(U.uSize, SCENE.W * 1.25, SCENE.H * 0.1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.uniform2f(U.uSize, SCENE.W, SCENE.H);

      const [deep, surf] = colorsFor(i);
      gl.uniformMatrix4fv(U.uMVP, false, mvp);
      gl.uniform1i(U.uMode, 0);
      gl.uniform1f(U.uAlpha, p.alpha);
      gl.uniform1f(U.uGrow, 1.0);
      gl.uniform1f(U.uFill, fillFor(i));
      gl.uniform1f(U.uSeed, i * 3.7);
      gl.uniform1f(U.uHover, hv[i]);
      gl.uniform3f(U.uDeep, deep[0], deep[1], deep[2]);
      gl.uniform3f(U.uSurf, surf[0], surf[1], surf[2]);
      gl.uniform2f(U.uTile, i % COLS, Math.floor(i / COLS));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    width = Math.max(1, r.width);
    height = Math.max(1, r.height);
    aspect = width / height;
    // Place libre : sous l'en-tête, au-dessus de la pastille du lieu. Les bocaux
    // s'y rangent, quelle que soit la forme de l'écran.
    const [top, bottom] = area ? area(width, height) : [height * 0.12, height * 0.68];
    const freeUnits = Math.max(0.4, ((bottom - top) / height) * 2);
    const byHeight = (freeUnits * 0.84) / SCENE.H;
    const byWidth = aspect < 1 ? (2 * aspect * 0.62) / SCENE.W : 9;
    fit = clamp(Math.min(byHeight, byWidth), 0.45, 1.05);
    cyUnits = (1 - ((top + bottom) / 2 / height) * 2) - 0.02;
    const w = Math.round(width * dpr * scale);
    const h = Math.round(height * dpr * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    dirty = true;
  }

  function announce() {
    const idx = mod(Math.round(pos), N);
    if (idx === settledIdx) return;
    settledIdx = idx;
    onSelect?.(spots[idx]);
  }

  let slow = 0, frames = 0, prev = 0;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const rawDt = now - prev || 16;
    const dt = Math.min(0.05, rawDt / 1000);
    prev = now;
    if (!inView || document.hidden) return;

    if (!reduce.matches) clock += dt;
    let moving = false;

    if (target !== null) {
      const k = 1 - Math.exp(-dt * 7);
      pos += (target - pos) * k;
      moving = true;
      if (Math.abs(target - pos) < 0.003) { pos = target; target = null; announce(); }
    } else if (!dragging) {
      if (Math.abs(vel) > 0.04) {
        pos += vel * dt;
        vel *= Math.exp(-dt * 3.4);
        moving = true;
        if (Math.abs(vel) <= 0.04) target = Math.round(pos);
      } else if (Math.abs(pos - Math.round(pos)) > 0.003) {
        target = Math.round(pos);
      }
    }

    // survol et inclinaison lissés
    const centerD = [];
    for (let i = 0; i < N; i++) {
      const q = quads[i];
      let want = 0, tx = 0, ty = 0;
      if (mouse.on && !dragging && q.pts && Math.abs(q.d) < 3 && inQuad([mouse.x, mouse.y], q.pts)
          && pickIndex(mouse.x, mouse.y) === i) {
        want = 1;
        const cx = (q.pts[0][0] + q.pts[2][0]) / 2, cy = (q.pts[0][1] + q.pts[2][1]) / 2;
        const bw = Math.abs(q.pts[1][0] - q.pts[0][0]) || 1, bh = Math.abs(q.pts[3][1] - q.pts[0][1]) || 1;
        tx = clamp((mouse.x - cx) / bw * 2, -1, 1);
        ty = clamp((mouse.y - cy) / bh * 2, -1, 1);
      }
      const k = 1 - Math.exp(-dt * 9);
      if (Math.abs(hv[i] - want) > 0.001 || Math.abs(tilt.x[i] - tx) > 0.001) moving = true;
      hv[i] += (want - hv[i]) * k;
      tilt.x[i] += (tx - tilt.x[i]) * k;
      tilt.y[i] += (ty - tilt.y[i]) * k;
      centerD.push(want);
    }
    const hovering = centerD.some(Boolean);
    if (canvas.style.cursor !== (dragging ? 'grabbing' : hovering ? 'pointer' : 'grab')) {
      canvas.style.cursor = dragging ? 'grabbing' : hovering ? 'pointer' : 'grab';
    }

    if (!reduce.matches || dirty || moving || dragging) { draw(); dirty = false; }

    frames++;
    if (rawDt > 34) slow++; else slow = Math.max(0, slow - 0.2);
    if (frames > 60 && slow > 40 && scale > 0.6) {
      scale = Math.max(0.6, scale - 0.15);
      slow = 0;
      resize();
    }
  }

  /* ---- pointeur */
  let down = null;
  let lastMove = 0;

  const rel = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function onDown(e) {
    if (!e.isPrimary || e.button > 0) return;
    const [x, y] = rel(e);
    down = { x, y, px: x, t: performance.now(), moved: false };
    dragging = false;
    target = null;
    vel = 0;
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onMovePtr(e) {
    const [x, y] = rel(e);
    mouse.x = x; mouse.y = y;
    mouse.on = e.pointerType !== 'touch';
    dirty = true;
    if (!down) return;
    const dx = x - down.x, dy = y - down.y;
    if (!dragging && dx * dx + dy * dy > 49) {
      // Le geste est-il surtout vertical ? Alors c'est la page qui défile.
      if (Math.abs(dy) > Math.abs(dx) * 1.3 && e.pointerType === 'touch') { down = null; return; }
      dragging = true;
      down.moved = true;
    }
    if (dragging) {
      const now = performance.now();
      const unitsPerPx = 2 / height;
      const delta = -(x - down.px) * unitsPerPx / spacing();
      pos += delta;
      const dt = Math.max(0.008, (now - (lastMove || now - 16)) / 1000);
      vel = vel * 0.6 + (delta / dt) * 0.4;
      lastMove = now;
      down.px = x;
    }
  }

  function onUp(e) {
    if (!down) return;
    const d = down;
    down = null;
    const wasDrag = dragging;
    dragging = false;
    if (wasDrag) {
      if (performance.now() - lastMove > 90) vel = 0;
      vel = clamp(vel, -9, 9);
      if (Math.abs(vel) <= 0.04) target = Math.round(pos);
      return;
    }
    // simple appui
    const i = pickIndex(d.x, d.y);
    if (i < 0) return;
    const q = quads[i];
    if (Math.abs(q.d) < 0.5) { onTap?.(spots[i]); return; }
    target = Math.round(pos + q.d);
    vel = 0;
  }

  function onWheel(e) {
    // Seul un geste surtout horizontal fait tourner les bocaux ; le vertical
    // reste à la page.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 0.8) return;
    e.preventDefault();
    target = null;
    pos += e.deltaX * 0.0025;
    vel = 0;
    dirty = true;
    clearTimeout(onWheel.timer);
    onWheel.timer = setTimeout(() => { target = Math.round(pos); }, 140);
  }

  function onLeave() { mouse.on = false; dirty = true; }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMovePtr);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { down = null; dragging = false; });
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  // La taille du canvas vient du CSS, qui peut arriver après ce script : on suit
  // la boîte elle-même plutôt que la fenêtre, sans quoi le tampon resterait à
  // 1 × 1 pixel, étiré sur tout l'écran.
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  reduce.addEventListener?.('change', () => { dirty = true; });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  // Rien à dessiner quand le premier écran n'est plus visible.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      dirty = true;
    }).observe(canvas);
  }

  resize();
  paintAtlas();
  // La police du titre arrive après le premier dessin : on repeint l'atlas.
  document.fonts?.load('400 40px Marcellus').then(paintAtlas).catch(() => {});
  running = true;
  prev = performance.now();
  requestAnimationFrame(frame);

  /* ---- API */
  return {
    // Températures par lieu (clé → °C) : repeint les chiffres, l'eau et sa couleur.
    setTemps(next) {
      temps = next || {};
      paintAtlas();
    },
    // Lieu choisi ailleurs (liste, clavier, géolocalisation) : le carrousel suit.
    setSelected(key) {
      const idx = spots.findIndex((s) => s.key === key);
      if (idx < 0) return;
      settledIdx = idx;           // déjà connu de l'extérieur : pas d'écho
      const cur = mod(Math.round(pos), N);
      if (cur === idx && target === null) return;
      let delta = idx - cur;
      if (delta > N / 2) delta -= N;
      if (delta < -N / 2) delta += N;
      target = Math.round(pos) + delta;
      vel = 0;
      dirty = true;
    },
    // La place libre a changé (la phrase du jour passe sur deux lignes, par exemple).
    relayout: resize,
    destroy() { running = false; },
  };
}
