// Le diorama : un panorama en papier découpé, dix tableaux posés en rond autour
// du spectateur — un par lieu du lac. Chaque tableau prend la saison de sa
// température : hiver bleu et glaçons quand l'eau est mordante, printemps vert
// et fleurs quand elle est fraîche, été orange et parasol quand elle est bonne.
// On fait tourner le décor au doigt ; le tableau du centre est le lieu choisi.
//
// WebGL2 brut, sans dépendance, et sans image : tout le papier est calculé dans
// un seul fragment shader. Chaque pixel remonte son rayon jusqu'à des cylindres
// concentriques (le mur du fond, la couche du milieu) et jusqu'au sol ; sur
// chacun, des formes à distance signée — arbres, bonhomme de neige, soleil,
// parasol — sont peintes comme des feuilles superposées, avec leur ombre portée
// sur la feuille de dessous et un grain de papier.
//
// Sans WebGL2, `initWall` renvoie null : le fond reste un papier uni et la
// température se lit sans le décor.

/* ------------------------------------------------------------------ scène */

const SCENE = {
  count: 10,
  tanHalf: 0.62,        // tangente de la moitié du champ vertical
  pitch: -0.12,         // la caméra regarde un peu vers le bas (rad)
};

// Une bande de température → un décor.
const BAND_ID = { cold: 0, cool: 1, fresh: 2, good: 3, warm: 4, unknown: 5 };

const TILE_W = 512;
const TILE_H = 242;
const COLS = 2;
const ROWS = 5;

/* ---------------------------------------------------------------- shaders */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform vec2  uRes;
uniform float uTime;
uniform float uYaw;          // direction du regard, en tableaux
uniform vec2  uCam;          // décalage de la caméra (parallaxe)
uniform float uTan;
uniform float uPitch;
uniform float uBand[10];
uniform float uSel;          // tableau choisi
uniform float uGrowTag;
uniform sampler2D uAtlas;

out vec4 outColor;

const float PI = 3.14159265;
const float N = 10.0;
const float SEC = 2.0 * PI / N;
const float R1 = 9.0;        // mur du fond
const float R2 = 8.0;        // couche du milieu
const float HW = 3.5;        // hauteur du mur
const float EYE = 1.0;      // hauteur de l'œil au-dessus du sol

/* ---- bruit et formes */

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

// Le grain du papier : un peu de fibres, un peu de taches.
float grain(vec2 p) { return 0.55 * vnoise(p * 70.0) + 0.45 * vnoise(p * 19.0 + 3.0); }

float sdCircle(vec2 p, vec2 c, float r) { return length(p - c) - r; }

float sdBox(vec2 p, vec2 c, vec2 h) {
  vec2 q = abs(p - c) - h;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

// Triangle isocèle pointe en haut : base en c, largeur w, hauteur h.
float sdTri(vec2 p, vec2 c, float w, float h) {
  p -= c;
  vec2 n = normalize(vec2(h, w * 0.5));
  float side = abs(p.x) * n.x + p.y * n.y - (w * 0.5) * n.x;
  return max(side, -p.y);
}

vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// Une feuille découpée : on empile la couleur sur ce qui est déjà posé, en
// alpha prémultiplié. La teinte s'éclaircit tout au bord : l'épaisseur du papier.
void put(inout vec4 acc, float d, vec3 c, float aa) {
  float m = 1.0 - smoothstep(-aa, aa, d);
  c *= 1.0 + 0.16 * smoothstep(-0.05, 0.0, d);
  acc.rgb = acc.rgb * (1.0 - m) + c * m;
  acc.a = acc.a * (1.0 - m) + m;
}

/* ---- palette */

vec3 wallCol(int b) {
  if (b == 0) return vec3(0.48, 0.60, 0.77);
  if (b == 1) return vec3(0.31, 0.56, 0.63);
  if (b == 2) return vec3(0.42, 0.60, 0.30);
  if (b == 3) return vec3(0.88, 0.54, 0.13);
  if (b == 4) return vec3(0.85, 0.42, 0.38);
  return vec3(0.72, 0.68, 0.58);
}

vec3 floorCol(int b) {
  if (b == 0) return vec3(0.93, 0.94, 0.96);
  if (b == 1) return vec3(0.76, 0.87, 0.91);
  if (b == 2) return vec3(0.55, 0.74, 0.31);
  if (b == 3) return vec3(0.24, 0.38, 0.72);
  if (b == 4) return vec3(0.93, 0.66, 0.34);
  return vec3(0.90, 0.86, 0.76);
}

vec3 hillCol(int b) {
  if (b == 0) return vec3(0.97, 0.97, 0.99);
  if (b == 1) return vec3(0.64, 0.79, 0.84);
  if (b == 2) return vec3(0.38, 0.58, 0.27);
  if (b == 3) return vec3(0.91, 0.76, 0.46);
  if (b == 4) return vec3(0.80, 0.40, 0.22);
  return vec3(0.82, 0.78, 0.68);
}

const vec3 SNOW = vec3(0.97, 0.98, 1.0);
const vec3 FIR = vec3(0.17, 0.40, 0.24);
const vec3 TRUNK = vec3(0.45, 0.29, 0.18);
const vec3 SUN = vec3(1.0, 0.82, 0.30);
const vec3 RED = vec3(0.85, 0.24, 0.20);

/* ---- décor du fond (le mur) */

float snowflake(vec2 p, vec2 c, float r) {
  vec2 q = p - c;
  float an = PI / 3.0;
  float a = mod(atan(q.y, q.x) + an * 0.5, an) - an * 0.5;
  vec2 f = length(q) * vec2(cos(a), abs(sin(a)));
  float arm = sdBox(f, vec2(r * 0.5, 0.0), vec2(r * 0.5, r * 0.035));
  float tw = sdBox(rot(f - vec2(r * 0.62, 0.0), 0.7), vec2(0.0), vec2(r * 0.16, r * 0.03));
  return min(arm, tw);
}

float sunShape(vec2 p, vec2 c, float r) {
  vec2 q = p - c;
  float an = PI / 4.0;
  float a = mod(atan(q.y, q.x) + an * 0.5, an) - an * 0.5;
  vec2 f = length(q) * vec2(cos(a), abs(sin(a)));
  // un petit triangle par huitième de tour, pointe vers l'extérieur
  float ray = sdTri(vec2(f.y, f.x), vec2(0.0, r * 1.05), r * 0.34, r * 0.46);
  return min(sdCircle(p, c, r), ray);
}

float cloud(vec2 p, vec2 c, float s) {
  float d = sdCircle(p, c + vec2(0.0, 0.0) * s, 0.34 * s);
  d = min(d, sdCircle(p, c + vec2(0.34, -0.06) * s, 0.27 * s));
  d = min(d, sdCircle(p, c + vec2(-0.34, -0.08) * s, 0.25 * s));
  d = min(d, sdBox(p, c + vec2(0.0, -0.17) * s, vec2(0.5, 0.1) * s));
  return d;
}

vec4 decorBack(int b, vec2 p, float aa, vec3 wc) {
  vec4 a = vec4(0.0);
  if (b == 0) {
    // glaçons accrochés en haut, flocons dans l'air
    for (int k = 0; k < 6; k++) {
      float fk = float(k);
      float x = -2.45 + fk * 0.98 + 0.25 * hash(vec2(fk, 1.0));
      float len = 0.40 + 0.40 * hash(vec2(fk, 7.0));
      put(a, sdTri(vec2(p.x, HW - p.y), vec2(x, 0.0), 0.22, len), SNOW, aa);
    }
    put(a, snowflake(p, vec2(0.15, 2.55), 0.34), SNOW, aa);
    put(a, snowflake(p, vec2(1.35, 1.9), 0.28), SNOW, aa);
    put(a, snowflake(p, vec2(2.25, 2.7), 0.22), SNOW, aa);
  } else if (b == 1) {
    // montagnes de papier, sommets enneigés
    put(a, sdTri(p, vec2(0.6, 0.0), 3.6, 2.5), mix(wc, vec3(0.1, 0.2, 0.3), 0.35), aa);
    put(a, sdTri(p, vec2(0.6, 1.75), 1.0, 0.75), SNOW, aa);
    put(a, sdTri(p, vec2(2.1, 0.0), 2.6, 1.7), mix(wc, vec3(1.0), 0.18), aa);
    put(a, sdTri(p, vec2(2.1, 1.19), 0.78, 0.51), SNOW, aa);
  } else if (b == 2) {
    put(a, cloud(p, vec2(1.7, 2.6), 0.9), SNOW, aa);
    put(a, cloud(p, vec2(0.1, 2.05), 0.6), SNOW, aa);
  } else if (b == 3) {
    put(a, sunShape(p, vec2(1.9, 2.45), 0.5), SUN, aa);
  } else if (b == 4) {
    put(a, sunShape(p, vec2(0.9, 1.55), 0.85), SUN, aa);
  } else {
    put(a, cloud(p, vec2(1.2, 2.2), 0.7), mix(wc, vec3(1.0), 0.4), aa);
  }
  return a;
}

/* ---- décor du milieu (posé sur le sol) */

void fir(inout vec4 a, vec2 p, vec2 c, float s, float aa, bool snowy) {
  put(a, sdBox(p, c + vec2(0.0, 0.13 * s), vec2(0.08, 0.14) * s), TRUNK, aa);
  put(a, sdTri(p, c + vec2(0.0, 0.18 * s), 1.05 * s, 0.85 * s), FIR, aa);
  put(a, sdTri(p, c + vec2(0.0, 0.62 * s), 0.82 * s, 0.75 * s), FIR * 1.08, aa);
  put(a, sdTri(p, c + vec2(0.0, 1.02 * s), 0.55 * s, 0.62 * s), FIR * 1.16, aa);
  if (snowy) put(a, sdTri(p, c + vec2(0.0, 1.38 * s), 0.2 * s, 0.26 * s), SNOW, aa);
}

float hillH(float x, float s) {
  return 0.30 + 0.10 * sin(x * 1.8 + s) + 0.05 * sin(x * 4.3 + s * 2.0);
}

vec4 decorMid(int b, vec2 p, float aa, float seed) {
  vec4 a = vec4(0.0);
  // la colline de papier qui borde le tableau
  put(a, p.y - hillH(p.x, seed), hillCol(b), aa);

  if (b == 0) {
    // bonhomme de neige, deux sapins
    vec2 s = vec2(-0.05, hillH(-0.05, seed));
    put(a, sdCircle(p, s + vec2(0.0, 0.40), 0.42), SNOW * 0.99, aa);
    put(a, sdCircle(p, s + vec2(0.0, 1.05), 0.31), SNOW, aa);
    put(a, sdCircle(p, s + vec2(0.0, 1.55), 0.22), SNOW, aa);
    put(a, sdBox(p, s + vec2(0.0, 1.74), vec2(0.17, 0.04)), vec3(0.15, 0.15, 0.2), aa);
    put(a, sdBox(p, s + vec2(0.0, 1.88), vec2(0.11, 0.13)), vec3(0.15, 0.15, 0.2), aa);
    put(a, sdBox(p, s + vec2(0.0, 1.33), vec2(0.23, 0.04)), RED, aa);
    put(a, sdTri(rot(p - s - vec2(0.12, 1.55), -1.57), vec2(0.0), 0.07, 0.17), vec3(0.95, 0.5, 0.15), aa);
    fir(a, p, vec2(1.05, hillH(1.05, seed) - 0.02), 1.0, aa, true);
    fir(a, p, vec2(1.8, hillH(1.8, seed) - 0.02), 0.72, aa, true);
  } else if (b == 1) {
    fir(a, p, vec2(0.25, hillH(0.25, seed) - 0.02), 1.15, aa, true);
    fir(a, p, vec2(1.0, hillH(1.0, seed) - 0.02), 0.85, aa, true);
    fir(a, p, vec2(1.75, hillH(1.75, seed) - 0.02), 1.0, aa, true);
    put(a, sdCircle(p, vec2(-0.55, hillH(-0.55, seed) + 0.04), 0.16), vec3(0.62, 0.64, 0.68), aa);
  } else if (b == 2) {
    // un arbre à tronc, des fleurs
    vec2 t = vec2(0.7, hillH(0.7, seed) - 0.02);
    put(a, sdBox(p, t + vec2(0.0, 0.5), vec2(0.15, 0.5)), TRUNK, aa);
    put(a, sdCircle(p, t + vec2(0.0, 1.5), 0.62), vec3(0.50, 0.72, 0.40), aa);
    put(a, sdCircle(p, t + vec2(-0.45, 1.25), 0.42), vec3(0.46, 0.68, 0.36), aa);
    put(a, sdCircle(p, t + vec2(0.45, 1.25), 0.42), vec3(0.54, 0.76, 0.44), aa);
    put(a, sdCircle(p, t + vec2(0.0, 0.85), 0.14), vec3(0.85, 0.35, 0.3), aa);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float x = 1.55 + fk * 0.5;
      vec2 f = vec2(x, hillH(x, seed) - 0.01);
      put(a, sdBox(p, f + vec2(0.0, 0.3), vec2(0.025, 0.3)), vec3(0.2, 0.45, 0.2), aa);
      vec3 pc = fk < 0.5 ? vec3(0.95, 0.75, 0.12) : (fk < 1.5 ? vec3(0.88, 0.32, 0.36) : vec3(0.95, 0.75, 0.12));
      put(a, sdCircle(p, f + vec2(0.0, 0.68), 0.2), pc, aa);
      put(a, sdCircle(p, f + vec2(0.0, 0.68), 0.08), vec3(0.45, 0.28, 0.12), aa);
    }
  } else if (b == 3) {
    // un parasol rayé
    vec2 u = vec2(0.8, hillH(0.8, seed) - 0.02);
    put(a, sdBox(p, u + vec2(0.0, 0.7), vec2(0.03, 0.7)), vec3(0.4, 0.3, 0.2), aa);
    float dome = max(sdCircle(p, u + vec2(0.0, 1.35), 0.8), -(p.y - (u.y + 1.35)));
    float stripe = step(0.0, sin((p.x - u.x) * 9.0));
    put(a, dome, mix(RED, SNOW, stripe), aa);
    put(a, sdBox(p, vec2(-0.1, hillH(-0.1, seed) + 0.05), vec2(0.4, 0.05)), vec3(0.95, 0.85, 0.6), aa);
    put(a, sdBox(p, vec2(1.9, hillH(1.9, seed) + 0.28), vec2(0.28, 0.28)), vec3(0.75, 0.45, 0.2), aa);
  } else if (b == 4) {
    // des cactus
    vec2 c1 = vec2(0.7, hillH(0.7, seed) - 0.02);
    vec3 cc = vec3(0.30, 0.52, 0.30);
    put(a, sdBox(p, c1 + vec2(0.0, 0.7), vec2(0.18, 0.7)) - 0.12, cc, aa);
    put(a, sdBox(p, c1 + vec2(-0.42, 0.85), vec2(0.04, 0.22)) - 0.1, cc, aa);
    put(a, sdBox(p, c1 + vec2(-0.3, 0.62), vec2(0.14, 0.03)) - 0.08, cc, aa);
    put(a, sdBox(p, c1 + vec2(0.42, 1.05), vec2(0.04, 0.2)) - 0.1, cc, aa);
    put(a, sdBox(p, c1 + vec2(0.3, 0.82), vec2(0.14, 0.03)) - 0.08, cc, aa);
    vec2 c2 = vec2(1.75, hillH(1.75, seed) - 0.02);
    put(a, sdBox(p, c2 + vec2(0.0, 0.4), vec2(0.1, 0.4)) - 0.09, cc * 1.1, aa);
  } else {
    put(a, sdCircle(p, vec2(0.6, hillH(0.6, seed) + 0.1), 0.22), vec3(0.7, 0.68, 0.6), aa);
    put(a, sdCircle(p, vec2(1.4, hillH(1.4, seed) + 0.08), 0.16), vec3(0.66, 0.64, 0.56), aa);
  }
  return a;
}

/* ---- repères d'un pixel sur un cylindre */

struct Cell { int idx; float lx; };

Cell cellAt(vec3 P) {
  float ang = atan(P.x, P.z) + uYaw * SEC;
  float a = ang / SEC;
  float s = floor(a + 0.5);
  Cell c;
  c.idx = int(mod(s, N) + 0.5);
  c.lx = (a - s) * (R1 * SEC);
  return c;
}

float bandAt(int i) { return uBand[i]; }
int bandI(int i) { return int(bandAt(i) + 0.5); }

float cylT(vec3 C, vec3 d, float R) {
  float a = dot(d.xz, d.xz);
  float b = dot(C.xz, d.xz);
  float c = dot(C.xz, C.xz) - R * R;
  return (-b + sqrt(max(b * b - a * c, 0.0))) / a;
}

/* ---- l'étiquette : une feuille crème, une punaise, le nom et le chiffre */

vec4 tag(int idx, vec2 p, float aa, bool sel) {
  vec4 a = vec4(0.0);
  vec2 c = vec2(-1.35, 2.38);
  vec2 h = vec2(1.08, 0.5);
  vec2 q = rot(p - c, 0.035);
  float d = sdBox(q, vec2(0.0), h) - 0.04;
  put(a, d, vec3(0.98, 0.95, 0.86) * (0.97 + 0.05 * grain(p * 3.0)), aa);
  if (sel) {
    // couture rouge, en pointillé, tout autour de la feuille sélectionnée
    float inner = sdBox(q, vec2(0.0), h - 0.07);
    float dash = step(0.0, sin((q.x + q.y * 1.3) * 34.0));
    float line = smoothstep(0.012 + aa, 0.012, abs(inner)) * dash;
    a.rgb = mix(a.rgb, vec3(0.85, 0.24, 0.20) * a.a, line * a.a);
  }
  vec2 uv = q / (2.0 * h) + 0.5;
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
    vec4 t = texture(uAtlas, vec2((mod(float(idx), 2.0) + uv.x) / 2.0,
                                 (floor(float(idx) / 2.0) + (1.0 - uv.y)) / 5.0));
    a.rgb = mix(a.rgb, vec3(0.24, 0.22, 0.17) * a.a, t.a * a.a);
  }
  put(a, sdCircle(p, c + vec2(0.0, h.y + 0.02), 0.07), RED, aa);
  return a;
}

/* ---- le sol */

vec3 floorColor(vec3 P, float aaw) {
  Cell c = cellAt(P);
  int b = bandI(c.idx);
  vec3 fc = floorCol(b);
  float r = length(P.xz);
  float ang = atan(P.x, P.z) + uYaw * SEC;
  float a = ang / SEC;
  float fr = (a - floor(a + 0.5)) * SEC;
  vec2 F = r * vec2(sin(fr), cos(fr));
  vec3 col = fc;

  if (b == 3) {
    // une mer de papier : des vagues festonnées, plus claires
    float w = fract(r * 1.05 + 0.11 * sin(ang * 26.0));
    float strip = smoothstep(0.0, 0.05, w) * (1.0 - smoothstep(0.42, 0.47, w));
    col = mix(col, fc * 1.18 + 0.04, strip * 0.7);
  }

  // une bande de papier plus proche, d'un ton à peine différent
  float e0 = 3.6 + 0.22 * sin(ang * 9.0 + 2.0) + 0.08 * sin(ang * 23.0);
  vec3 h0 = mix(fc, wallCol(b), 0.14);
  col *= 1.0 - 0.14 * smoothstep(0.45, 0.0, e0 - r) * step(r, e0);
  col = mix(col, h0, 1.0 - smoothstep(-aaw, aaw, e0 - r));

  // de petites touffes et cailloux de papier, posés au hasard sur le sol
  {
    vec2 g = F * 0.62;
    vec2 gi = floor(g), gf = fract(g) - 0.5;
    float hh = hash(gi + float(b) * 7.0);
    if (hh > 0.62 && r > 2.0 && r < 7.0) {
      vec2 o = (vec2(hash(gi + 3.0), hash(gi + 9.0)) - 0.5) * 0.5;
      vec2 lp = (gf - o) * 1.6;
      float sz = 0.16 + 0.16 * hash(gi + 5.0);
      float dt = 1.0;
      vec3 tc = vec3(0.0);
      if (b == 0) { dt = length(lp * vec2(1.0, 1.6)) - sz * 0.9; tc = vec3(0.86, 0.89, 0.94); }
      else if (b == 4) { dt = length(lp * vec2(1.0, 1.4)) - sz * 0.8; tc = vec3(0.70, 0.40, 0.25); }
      else if (b != 3) {
        dt = min(sdTri(lp, vec2(-0.1, -0.1), 0.16, 0.34),
                 min(sdTri(lp, vec2(0.04, -0.1), 0.16, 0.44), sdTri(lp, vec2(0.18, -0.1), 0.16, 0.3)));
        tc = b == 1 ? vec3(0.45, 0.65, 0.62) : vec3(0.27, 0.5, 0.2);
      }
      float m = 1.0 - smoothstep(-aaw * 1.6, aaw * 1.6, dt);
      col = mix(col, tc, m);
    }
  }

  // l'étang, par-dessus : un ovale de papier bleu, avec son ombre
  if (b <= 2) {
    vec2 q = (F - vec2(-0.7, 5.0)) / vec2(1.7, 0.95);
    float dpond = (length(q) - 1.0) * 0.9;
    col *= 1.0 - 0.18 * smoothstep(0.35, 0.0, dpond) * step(0.0, dpond);
    float m = 1.0 - smoothstep(-aaw, aaw, dpond);
    vec3 water = b == 0 ? vec3(0.78, 0.88, 0.96) : vec3(0.30, 0.52, 0.80);
    col = mix(col, water, m);
    if (b == 2) {
      float pad = 1.0 - smoothstep(-aaw, aaw, length((F - vec2(-0.3, 5.1)) * vec2(1.0, 1.7)) - 0.26);
      col = mix(col, vec3(0.35, 0.6, 0.25), pad * m);
    }
  }

  // les collines au pied du mur : deux bandes festonnées, la plus lointaine dessous
  float e1 = 6.8 + 0.20 * sin(ang * 15.0) + 0.1 * sin(ang * 31.0);
  float e2 = 7.7 + 0.18 * sin(ang * 11.0 + 1.0);
  vec3 h1 = mix(fc, wallCol(b), 0.35);
  vec3 h2 = mix(fc, wallCol(b), 0.65);
  col *= 1.0 - 0.22 * smoothstep(0.5, 0.0, e1 - r) * step(r, e1);
  col = mix(col, h1, 1.0 - smoothstep(-aaw, aaw, e1 - r));
  col *= 1.0 - 0.22 * smoothstep(0.5, 0.0, e2 - r) * step(r, e2);
  col = mix(col, h2, 1.0 - smoothstep(-aaw, aaw, e2 - r));
  return col;
}

/* ---- le mur */

vec3 wallColor(vec3 P, float aaw, float tiltTime) {
  Cell c = cellAt(P);
  int b = bandI(c.idx);
  vec3 wc = wallCol(b);
  vec2 p = vec2(c.lx, P.y);
  float h = P.y;

  if (h > HW) {
    // au-dessus du mur : l'intérieur sombre du bord, courbé comme dans la maquette
    float k = smoothstep(HW, HW + 1.6, h);
    return wc * mix(0.74, 0.5, k);
  }

  vec3 col = wc * (0.96 + 0.08 * grain(p * 2.0 + float(c.idx)));
  // un dégradé doux : plus clair vers le haut
  col *= 0.94 + 0.08 * h / HW;

  vec4 back = decorBack(b, p, aaw, wc);
  // ombre du décor du fond sur le mur
  vec4 bs = decorBack(b, p - vec2(0.07, -0.09), aaw, wc);
  col *= 1.0 - 0.20 * bs.a * (1.0 - back.a);
  col = col * (1.0 - back.a) + back.rgb;

  vec4 tg = tag(c.idx, p, aaw, float(c.idx) == uSel);
  vec4 ts = tag(c.idx, p - vec2(0.06, -0.08), aaw, false);
  col *= 1.0 - 0.24 * ts.a * (1.0 - tg.a);
  col = col * (1.0 - tg.a) + tg.rgb;
  return col;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  vec2 q = vec2(ndc.x * aspect, ndc.y) * uTan;
  float cp = cos(uPitch), sp = sin(uPitch);
  vec3 d = normalize(vec3(q.x, q.y * cp + sp, q.y * -sp + cp));
  vec3 C = vec3(uCam.x, EYE + uCam.y, 0.0);

  // taille d'un pixel sur le papier, pour des bords nets quelle que soit la distance
  float pxw = (2.0 * uTan / uRes.y);

  float tf = d.y < -1e-4 ? C.y / -d.y : 1e9;
  float t1 = cylT(C, d, R1);
  float t2 = cylT(C, d, R2);
  vec3 col;

  vec3 Pf = C + d * tf;
  bool onFloor = tf < t1 && tf < 1e8;
  if (onFloor) {
    col = floorColor(Pf, pxw * tf * 1.4);
  } else {
    vec3 P1 = C + d * t1;
    col = wallColor(P1, pxw * t1 * 1.4, uTime);
  }

  // la couche du milieu : colline, arbres, bonhomme de neige, parasol…
  if (t2 < tf && t2 < t1) {
    vec3 P2 = C + d * t2;
    if (P2.y > -0.05 && P2.y < HW) {
      Cell c2 = cellAt(P2);
      int b2 = bandI(c2.idx);
      float seed = float(c2.idx) * 1.7;
      float aa2 = pxw * t2 * 1.4;
      vec4 mid = decorMid(b2, vec2(c2.lx, P2.y), aa2, seed);
      // ombre portée sur ce qui est derrière
      vec3 Pb = onFloor ? Pf : (C + d * t1);
      Cell cb = cellAt(Pb);
      if (!onFloor) {
        vec4 ms = decorMid(bandI(cb.idx), vec2(cb.lx, Pb.y) - vec2(0.12, -0.10), aa2, float(cb.idx) * 1.7);
        col *= 1.0 - 0.26 * ms.a;
      }
      float g = 0.96 + 0.08 * grain(vec2(c2.lx, P2.y) * 1.5 + float(c2.idx));
      col = col * (1.0 - mid.a) + mid.rgb * g;
    }
  }

  // le grain du papier, sur tout
  col *= 0.97 + 0.06 * grain(gl_FragCoord.xy / 5.0);
  // un voile de lumière doux, plus sombre dans les coins
  vec2 v = ndc * vec2(0.9, 1.0);
  col *= 1.0 - 0.18 * dot(v, v) * 0.5;
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
// bande de couleur, `format(temp)` le texte du chiffre. `onSelect` est appelé
// quand un tableau s'immobilise au centre ; `onTap` quand on touche celui du
// centre.
export function initWall({ canvas, spots, bandOf, format, onSelect, onTap }) {
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
    console.warn('Diorama 3D indisponible —', err.message);
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
  for (const n of ['uRes', 'uTime', 'uYaw', 'uCam', 'uTan', 'uPitch', 'uBand', 'uSel', 'uAtlas']) {
    U[n] = gl.getUniformLocation(program, n);
  }
  gl.uniform1i(U.uAtlas, 0);
  gl.uniform1f(U.uTan, SCENE.tanHalf);
  gl.uniform1f(U.uPitch, SCENE.pitch);

  /* ---- atlas : nom et chiffre de chaque étiquette, sur fond transparent */
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

  const ROUND = '"Sniglet","Patrick Hand","Comic Sans MS","Marker Felt",system-ui,sans-serif';
  const N = spots.length;
  let temps = {};

  function paintAtlas() {
    actx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    actx.fillStyle = '#000';
    actx.textBaseline = 'alphabetic';
    actx.textAlign = 'center';
    spots.forEach((spot, i) => {
      const ox = (i % COLS) * TILE_W + TILE_W / 2;
      const oy = Math.floor(i / COLS) * TILE_H;
      let size = 58;
      actx.font = `800 ${size}px ${ROUND}`;
      while (actx.measureText(spot.name).width > TILE_W - 70 && size > 30) {
        size -= 4;
        actx.font = `800 ${size}px ${ROUND}`;
      }
      actx.fillText(spot.name, ox, oy + 74);
      const t = temps[spot.key];
      const known = typeof t === 'number' && isFinite(t);
      actx.font = `800 ${known ? 112 : 84}px ${ROUND}`;
      actx.fillText(known ? `${format(t)}°` : '—', ox, oy + TILE_H - 36);
    });
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    dirty = true;
  }

  function paintBands() {
    const bands = new Float32Array(10);
    spots.forEach((spot, i) => { bands[i] = BAND_ID[bandOf(temps[spot.key])] ?? 5; });
    gl.uniform1fv(U.uBand, bands);
    dirty = true;
  }

  /* ---- état */
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pos = 0;                       // direction du regard, en tableaux
  let vel = 0;                       // tableaux par seconde
  let target = null;                 // entier visé
  let settledIdx = -1;               // dernier tableau annoncé
  let dragging = false;
  let width = 1, height = 1;
  let scale = 1;
  let clock = 0;
  let dirty = true;
  let running = false;
  let inView = true;
  let aspect = 1;
  const mouse = { x: 0, y: 0, nx: 0, ny: 0, on: false };
  const cam = { x: 0, y: 0 };

  // Tableaux couverts d'un coup d'œil, pour convertir un glissé en rotation.
  const sectorsPerWidth = () => (2 * Math.atan(SCENE.tanHalf * aspect)) / (2 * Math.PI / N);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    width = Math.max(1, r.width);
    height = Math.max(1, r.height);
    aspect = width / height;
    // Le shader est lourd (papier, ombres, grain) : on ne dépasse pas 1,5 de
    // définition, et on descend si l'appareil peine.
    const w = Math.round(width * Math.min(dpr, 1.5) * scale);
    const h = Math.round(height * Math.min(dpr, 1.5) * scale);
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
    gl.uniform1f(U.uYaw, pos);
    gl.uniform2f(U.uCam, cam.x, cam.y);
    gl.uniform1f(U.uSel, settledIdx);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function announce() {
    const idx = mod(Math.round(pos), N);
    if (idx === settledIdx) return;
    settledIdx = idx;
    dirty = true;
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
      const k = 1 - Math.exp(-dt * 6);
      pos += (target - pos) * k;
      moving = true;
      if (Math.abs(target - pos) < 0.002) { pos = target; target = null; announce(); }
    } else if (!dragging) {
      if (Math.abs(vel) > 0.05) {
        pos += vel * dt;
        vel *= Math.exp(-dt * 3.2);
        moving = true;
        if (Math.abs(vel) <= 0.05) target = Math.round(pos);
      } else if (Math.abs(pos - Math.round(pos)) > 0.003) {
        target = Math.round(pos);
      }
    }

    // la caméra suit doucement le curseur : un peu de parallaxe entre les feuilles
    const wantX = reduce.matches ? 0 : (mouse.on ? mouse.nx * 0.45 : Math.sin(clock * 0.25) * 0.12);
    const wantY = reduce.matches ? 0 : (mouse.on ? mouse.ny * 0.18 : 0);
    const k = 1 - Math.exp(-dt * 4);
    if (Math.abs(cam.x - wantX) > 0.0005 || Math.abs(cam.y - wantY) > 0.0005) moving = true;
    cam.x += (wantX - cam.x) * k;
    cam.y += (wantY - cam.y) * k;

    const cursor = dragging ? 'grabbing' : 'grab';
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;

    if (!reduce.matches || dirty || moving || dragging) { draw(); dirty = false; }

    frames++;
    if (rawDt > 40) slow++; else slow = Math.max(0, slow - 0.2);
    if (frames > 50 && slow > 30 && scale > 0.5) {
      scale = Math.max(0.5, scale - 0.15);
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

  // Le tableau sous un point de l'écran : l'angle horizontal du rayon suffit,
  // mur ou sol.
  function sectorAt(px) {
    const nx = (px / width) * 2 - 1;
    const ang = Math.atan(nx * aspect * SCENE.tanHalf);
    return pos + ang / (2 * Math.PI / N);
  }

  function onDown(e) {
    if (!e.isPrimary || e.button > 0) return;
    const [x, y] = rel(e);
    down = { x, y, px: x, t: performance.now() };
    dragging = false;
    target = null;
    vel = 0;
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onMovePtr(e) {
    const [x, y] = rel(e);
    mouse.x = x; mouse.y = y;
    mouse.nx = (x / width) * 2 - 1;
    mouse.ny = 1 - (y / height) * 2;
    mouse.on = e.pointerType !== 'touch';
    dirty = true;
    if (!down) return;
    const dx = x - down.x, dy = y - down.y;
    if (!dragging && dx * dx + dy * dy > 49) {
      // Un geste surtout vertical au doigt : c'est la page qui défile.
      if (Math.abs(dy) > Math.abs(dx) * 1.3 && e.pointerType === 'touch') { down = null; return; }
      dragging = true;
    }
    if (dragging) {
      const now = performance.now();
      const delta = -((x - down.px) / width) * sectorsPerWidth();
      pos += delta;
      const dt = Math.max(0.008, (now - (lastMove || now - 16)) / 1000);
      vel = vel * 0.6 + (delta / dt) * 0.4;
      lastMove = now;
      down.px = x;
    }
  }

  function onUp() {
    if (!down) return;
    const d = down;
    down = null;
    const wasDrag = dragging;
    dragging = false;
    if (wasDrag) {
      if (performance.now() - lastMove > 90) vel = 0;
      vel = clamp(vel, -6, 6);
      if (Math.abs(vel) <= 0.05) target = Math.round(pos);
      return;
    }
    // simple appui : on va au tableau touché, ou on descend s'il est déjà au centre
    const t = Math.round(sectorAt(d.x));
    if (t === Math.round(pos) && Math.abs(pos - t) < 0.2) { onTap?.(spots[mod(t, N)]); return; }
    target = t;
    vel = 0;
  }

  function onWheel(e) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 0.8) return;
    e.preventDefault();
    target = null;
    pos += e.deltaX * 0.0016;
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
  paintBands();
  paintAtlas();
  // La police arrive après le premier dessin : on repeint les étiquettes.
  document.fonts?.load('800 40px Sniglet').then(paintAtlas).catch(() => {});
  running = true;
  prev = performance.now();
  requestAnimationFrame(frame);

  /* ---- API */
  return {
    // Températures par lieu (clé → °C) : repeint les chiffres et la saison de chaque tableau.
    setTemps(next) {
      temps = next || {};
      paintBands();
      paintAtlas();
    },
    // Lieu choisi ailleurs (liste, clavier, géolocalisation) : le décor tourne.
    setSelected(key) {
      const idx = spots.findIndex((s) => s.key === key);
      if (idx < 0) return;
      settledIdx = idx;           // déjà connu de l'extérieur : pas d'écho
      const cur = mod(Math.round(pos), N);
      dirty = true;
      if (cur === idx && target === null) return;
      let delta = idx - cur;
      if (delta > N / 2) delta -= N;
      if (delta < -N / 2) delta += N;
      target = Math.round(pos) + delta;
      vel = 0;
    },
    relayout: resize,
    destroy() { running = false; },
  };
}
