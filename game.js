/*
 * PHOSPHOR ACE
 * An original first-person vector-graphics WWI dogfight, in the spirit of
 * late-70s / early-80s vector arcade cabinets.
 *
 * Plain canvas 2D, no dependencies. Open index.html to play.
 */
'use strict';
(() => {
  // =====================================================================
  // Utilities
  // =====================================================================
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const wrapAngle = (a) => {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  };
  const zpad = (n, w = 6) => String(Math.max(0, Math.floor(n))).padStart(w, '0');

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(i, j) {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* storage unavailable: settings just won't persist */
      }
    },
  };

  // =====================================================================
  // Canvas + bloom buffers
  // =====================================================================
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d', { alpha: false });
  const bloomCanvases = [0, 1, 2].map(() => document.createElement('canvas'));
  const bloomCtx = bloomCanvases.map((c) => c.getContext('2d'));

  let W = 2, H = 2, CX = 1, CY = 1, F = 1, U = 1, lineW = 1, DPR = 1, dprCap = 2;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, dprCap);
    W = Math.max(2, Math.floor(window.innerWidth * DPR));
    H = Math.max(2, Math.floor(window.innerHeight * DPR));
    canvas.width = W;
    canvas.height = H;
    CX = W / 2;
    CY = H / 2;
    F = Math.min(H * 0.95, W * 0.8); // focal length in pixels
    U = Math.min(W / 1280, H / 720); // HUD unit
    lineW = Math.max(1, 1.5 * U);
    let w = W, h = H;
    for (const c of bloomCanvases) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      c.width = w;
      c.height = h;
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // =====================================================================
  // Vector renderer: lines are bucketed by colour + brightness, then
  // stroked in a handful of batched paths. A cheap downsample bloom adds
  // the phosphor glow at the end of the frame.
  // =====================================================================
  const COLORS = ['#46ff7e', '#eafff2', '#ff4636', '#fff27a', '#ff8a3a', '#8fa898', '#ffc04a', '#a8ffc4'];
  const C_WORLD = 0, C_ENEMY = 1, C_ACE = 2, C_TRACER = 3, C_ETRACER = 4, C_SMOKE = 5, C_FIRE = 6, C_HUD = 7;
  const LEVELS = 6;
  const lineBk = [], dotBk = [];
  for (let i = 0; i < COLORS.length * LEVELS; i++) {
    lineBk.push([]);
    dotBk.push([]);
  }
  let dimMul = 1;

  function line2(x1, y1, x2, y2, col, inten) {
    inten *= dimMul;
    if (inten < 0.04) return;
    let l = (inten * LEVELS) | 0;
    if (l >= LEVELS) l = LEVELS - 1;
    lineBk[col * LEVELS + l].push(x1, y1, x2, y2);
  }

  function dot2(x, y, s, col, inten) {
    inten *= dimMul;
    if (inten < 0.04) return;
    let l = (inten * LEVELS) | 0;
    if (l >= LEVELS) l = LEVELS - 1;
    dotBk[col * LEVELS + l].push(x, y, s);
  }

  function flush() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineW;
    for (let c = 0; c < COLORS.length; c++) {
      ctx.strokeStyle = COLORS[c];
      ctx.fillStyle = COLORS[c];
      for (let l = 0; l < LEVELS; l++) {
        const lb = lineBk[c * LEVELS + l];
        const db = dotBk[c * LEVELS + l];
        if (!lb.length && !db.length) continue;
        ctx.globalAlpha = Math.min(1, (l + 0.75) / LEVELS);
        if (lb.length) {
          ctx.beginPath();
          for (let i = 0; i < lb.length; i += 4) {
            ctx.moveTo(lb[i], lb[i + 1]);
            ctx.lineTo(lb[i + 2], lb[i + 3]);
          }
          ctx.stroke();
          lb.length = 0;
        }
        if (db.length) {
          ctx.beginPath();
          for (let i = 0; i < db.length; i += 3) {
            const s = db[i + 2];
            ctx.rect(db[i] - s / 2, db[i + 1] - s / 2, s, s);
          }
          ctx.fill();
          db.length = 0;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function bloom() {
    let src = canvas;
    for (let i = 0; i < bloomCanvases.length; i++) {
      const b = bloomCtx[i], c = bloomCanvases[i];
      b.globalCompositeOperation = 'copy';
      b.drawImage(src, 0, 0, c.width, c.height);
      src = c;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45;
    ctx.drawImage(bloomCanvases[1], 0, 0, W, H);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(bloomCanvases[2], 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // =====================================================================
  // 3D camera + projection
  // =====================================================================
  function makeBasis() {
    return { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1 };
  }

  // yaw: from +z toward +x; pitch: nose up positive; roll: right wing down positive
  function setBasis(b, yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    b.fx = sy * cp; b.fy = sp; b.fz = cy * cp;
    const r0x = cy, r0z = -sy;
    const u0x = -sy * sp, u0y = cp, u0z = -cy * sp;
    b.rx = r0x * cr - u0x * sr; b.ry = -u0y * sr; b.rz = r0z * cr - u0z * sr;
    b.ux = u0x * cr + r0x * sr; b.uy = u0y * cr; b.uz = u0z * cr + r0z * sr;
    return b;
  }

  const IDB = makeBasis();
  const cam = { x: 0, y: 0, z: 0, b: makeBasis(), ox: 0, oy: 0 };
  const T = { x: 0, y: 0, z: 0 };
  const L = { x: 0, y: 0, z: 0 };
  const NEAR = 0.4;

  function toCam(wx, wy, wz) {
    const dx = wx - cam.x, dy = wy - cam.y, dz = wz - cam.z, b = cam.b;
    T.x = dx * b.rx + dy * b.ry + dz * b.rz;
    T.y = dx * b.ux + dy * b.uy + dz * b.uz;
    T.z = dx * b.fx + dy * b.fy + dz * b.fz;
  }

  function dirCam(dx, dy, dz) {
    const b = cam.b;
    T.x = dx * b.rx + dy * b.ry + dz * b.rz;
    T.y = dx * b.ux + dy * b.uy + dz * b.uz;
    T.z = dx * b.fx + dy * b.fy + dz * b.fz;
  }

  // local -> world for an object with position o and basis b (result in L)
  function l2w(o, b, lx, ly, lz) {
    L.x = o.x + lx * b.rx + ly * b.ux + lz * b.fx;
    L.y = o.y + lx * b.ry + ly * b.uy + lz * b.fy;
    L.z = o.z + lx * b.rz + ly * b.uz + lz * b.fz;
  }

  // camera-space segment -> clipped, projected, bucketed
  function seg3(ax, ay, az, bx, by, bz, col, inten) {
    if (az < NEAR) {
      if (bz < NEAR) return;
      const t = (NEAR - az) / (bz - az);
      ax += (bx - ax) * t; ay += (by - ay) * t; az = NEAR;
    } else if (bz < NEAR) {
      const t = (NEAR - bz) / (az - bz);
      bx += (ax - bx) * t; by += (ay - by) * t; bz = NEAR;
    }
    const ox = CX + cam.ox, oy = CY + cam.oy;
    const x1 = ox + (ax / az) * F, y1 = oy - (ay / az) * F;
    const x2 = ox + (bx / bz) * F, y2 = oy - (by / bz) * F;
    if ((x1 < 0 && x2 < 0) || (x1 > W && x2 > W) || (y1 < 0 && y2 < 0) || (y1 > H && y2 > H)) return;
    line2(x1, y1, x2, y2, col, inten);
  }

  function wseg(ax, ay, az, bx, by, bz, col, inten) {
    toCam(ax, ay, az);
    const a1 = T.x, a2 = T.y, a3 = T.z;
    toCam(bx, by, bz);
    seg3(a1, a2, a3, T.x, T.y, T.z, col, inten);
  }

  // project the current T; returns false when not visible
  const S = { x: 0, y: 0 };
  function projT(margin = 0) {
    if (T.z < NEAR) return false;
    S.x = CX + cam.ox + (T.x / T.z) * F;
    S.y = CY + cam.oy - (T.y / T.z) * F;
    return S.x > -margin && S.x < W + margin && S.y > -margin && S.y < H + margin;
  }

  const FAR = 1500;
  function fade(d) {
    const n = FAR * 0.3;
    return d < n ? 1 : Math.max(0, 1 - (d - n) / (FAR - n));
  }

  // =====================================================================
  // Wireframe models
  // =====================================================================
  class Model {
    constructor() {
      this.v = [];
      this.e = [];
    }
    vert(x, y, z) {
      this.v.push(x, y, z);
      return this.v.length / 3 - 1;
    }
    edge(a, b) {
      this.e.push(a, b);
    }
    poly(pts, closed) {
      const idx = pts.map((p) => this.vert(p[0], p[1], p[2]));
      for (let i = 0; i < idx.length - 1; i++) this.edge(idx[i], idx[i + 1]);
      if (closed) this.edge(idx[idx.length - 1], idx[0]);
      return idx;
    }
    line(a, b) {
      this.edge(this.vert(a[0], a[1], a[2]), this.vert(b[0], b[1], b[2]));
    }
    join(A, B) {
      for (let i = 0; i < A.length; i++) this.edge(A[i], B[i]);
    }
    finish() {
      let r = 0;
      for (let i = 0; i < this.v.length; i += 3) r = Math.max(r, Math.hypot(this.v[i], this.v[i + 1], this.v[i + 2]));
      this.r = r;
      this.v = new Float32Array(this.v);
      this.e = new Uint16Array(this.e);
      this.out = new Float32Array(this.v.length);
      return this;
    }
  }

  function drawModel(m, px, py, pz, b, col, inten, scale = 1) {
    toCam(px, py, pz);
    const ccx = T.x, ccy = T.y, ccz = T.z;
    const rad = m.r * scale;
    if (ccz < -rad) return;
    if (ccz > rad) {
      const hw = ((W / 2) / F) * ccz, hh = ((H / 2) / F) * ccz;
      if (Math.abs(ccx) - rad > hw || Math.abs(ccy) - rad > hh) return;
    }
    const cb = cam.b;
    const m00 = b.rx * cb.rx + b.ry * cb.ry + b.rz * cb.rz;
    const m01 = b.ux * cb.rx + b.uy * cb.ry + b.uz * cb.rz;
    const m02 = b.fx * cb.rx + b.fy * cb.ry + b.fz * cb.rz;
    const m10 = b.rx * cb.ux + b.ry * cb.uy + b.rz * cb.uz;
    const m11 = b.ux * cb.ux + b.uy * cb.uy + b.uz * cb.uz;
    const m12 = b.fx * cb.ux + b.fy * cb.uy + b.fz * cb.uz;
    const m20 = b.rx * cb.fx + b.ry * cb.fy + b.rz * cb.fz;
    const m21 = b.ux * cb.fx + b.uy * cb.fy + b.uz * cb.fz;
    const m22 = b.fx * cb.fx + b.fy * cb.fy + b.fz * cb.fz;
    const v = m.v, out = m.out;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i] * scale, y = v[i + 1] * scale, z = v[i + 2] * scale;
      out[i] = ccx + m00 * x + m01 * y + m02 * z;
      out[i + 1] = ccy + m10 * x + m11 * y + m12 * z;
      out[i + 2] = ccz + m20 * x + m21 * y + m22 * z;
    }
    const e = m.e;
    for (let i = 0; i < e.length; i += 2) {
      const a = e[i] * 3, c = e[i + 1] * 3;
      seg3(out[a], out[a + 1], out[a + 2], out[c], out[c + 1], out[c + 2], col, inten);
    }
  }

  function buildBiplane() {
    const m = new Model();
    const nose = m.poly([[-0.6, 0.55, 3], [0.6, 0.55, 3], [0.6, -0.6, 3], [-0.6, -0.6, 3]], true);
    const mid = m.poly([[-0.7, 0.75, 0.6], [0.7, 0.75, 0.6], [0.7, -0.7, 0.6], [-0.7, -0.7, 0.6]], true);
    const tail = m.poly([[-0.15, 0.3, -5], [0.15, 0.3, -5], [0.15, 0, -5], [-0.15, 0, -5]], true);
    m.join(nose, mid);
    m.join(mid, tail);
    // cockpit opening
    m.poly([[-0.45, 0.74, -0.2], [0.45, 0.74, -0.2], [0.4, 0.62, -1.3], [-0.4, 0.62, -1.3]], true);
    // upper + lower wings
    m.poly([[-5, 2.1, 1.6], [5, 2.1, 1.6], [5, 2.1, 0.2], [-5, 2.1, 0.2]], true);
    m.poly([[-4.5, -0.55, 1.5], [4.5, -0.55, 1.5], [4.5, -0.55, 0.2], [-4.5, -0.55, 0.2]], true);
    for (const sx of [-3.5, 3.5]) {
      m.line([sx, 2.1, 1.4], [sx, -0.55, 1.35]);
      m.line([sx, 2.1, 0.4], [sx, -0.55, 0.35]);
      m.line([sx, 2.1, 1.4], [sx * 0.2, -0.55, 1.35]); // flying wire
    }
    m.line([-0.5, 0.75, 1.4], [-0.7, 2.1, 1.4]);
    m.line([0.5, 0.75, 1.4], [0.7, 2.1, 1.4]);
    m.line([-0.5, 0.75, 0.6], [-0.7, 2.1, 0.4]);
    m.line([0.5, 0.75, 0.6], [0.7, 2.1, 0.4]);
    // tailplane
    for (const s of [-1, 1]) m.poly([[0.15 * s, 0.1, -4], [2.3 * s, 0.1, -4.3], [2.1 * s, 0.1, -5], [0.15 * s, 0.1, -5]], false);
    // fin + rudder
    m.poly([[0, 0.3, -3.9], [0, 1.5, -4.6], [0, 1.6, -5.2], [0, 0.2, -5.3]], false);
    // landing gear
    for (const s of [-1, 1]) {
      m.line([0.55 * s, -0.6, 1.9], [0.9 * s, -1.7, 2.2]);
      m.line([0.55 * s, -0.6, 0.9], [0.9 * s, -1.7, 2.2]);
    }
    m.line([-1.1, -1.7, 2.2], [1.1, -1.7, 2.2]);
    return m.finish();
  }

  function ellipsoid(m, len, R, zs, sides, taper) {
    const rad = (z) => R * Math.sqrt(Math.max(0, 1 - (z / len) ** 2)) * (z < 0 ? 1 - taper * (-z / len) : 1);
    const rings = [];
    for (const z of zs) {
      const r = rad(z), pts = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * TAU;
        pts.push([Math.cos(a) * r, Math.sin(a) * r, z]);
      }
      rings.push(m.poly(pts, true));
    }
    const nose = m.vert(0, 0, len), tail = m.vert(0, 0, -len);
    for (let k = 0; k < sides; k++) {
      m.edge(nose, rings[rings.length - 1][k]);
      m.edge(tail, rings[0][k]);
      for (let i = 0; i < rings.length - 1; i++) m.edge(rings[i][k], rings[i + 1][k]);
    }
    return rad;
  }

  const ZEP_L = 42, ZEP_R = 8.5;
  function buildZeppelin() {
    const m = new Model();
    const rad = ellipsoid(m, ZEP_L, ZEP_R, [-36, -27, -18, -9, 0, 9, 18, 27, 36], 10, 0.12);
    const gy = -ZEP_R - 2.4;
    const gondola = (z0, z1) => {
      const top = m.poly([[-1.4, gy + 1.4, z0], [1.4, gy + 1.4, z0], [1.4, gy + 1.4, z1], [-1.4, gy + 1.4, z1]], true);
      const bot = m.poly([[-1.2, gy, z0 + 0.4], [1.2, gy, z0 + 0.4], [1.2, gy, z1 - 0.4], [-1.2, gy, z1 - 0.4]], true);
      m.join(top, bot);
      const zm = (z0 + z1) / 2;
      m.line([0, gy + 1.4, zm], [0, -rad(zm) * 0.97, zm]);
    };
    gondola(10, 18);
    gondola(-16, -10);
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const r1 = rad(-28), r2 = rad(-38);
      m.poly([[dx * r1, dy * r1, -28], [dx * (r1 + 5), dy * (r1 + 5), -34], [dx * (r2 + 5.5), dy * (r2 + 5.5), -40], [dx * r2, dy * r2, -38]], false);
    }
    m.rad = rad;
    return m.finish();
  }

  function buildBalloon() {
    const m = new Model();
    const rad = ellipsoid(m, 8, 4.2, [-5.5, -2.5, 0.5, 3.5, 6], 8, 0.25);
    for (const a of [Math.PI / 2, (Math.PI * 7) / 6, -Math.PI / 6]) {
      const c = Math.cos(a), s = Math.sin(a), r = rad(-4), r2 = rad(-6.5);
      m.poly([[c * r, s * r, -2.5], [c * (r + 3), s * (r + 3), -6], [c * (r + 3), s * (r + 3), -8], [c * r2, s * r2, -6.5]], false);
    }
    const by = -8.2;
    const top = m.poly([[-0.8, by + 1, -0.8], [0.8, by + 1, -0.8], [0.8, by + 1, 0.8], [-0.8, by + 1, 0.8]], true);
    const bot = m.poly([[-0.8, by, -0.8], [0.8, by, -0.8], [0.8, by, 0.8], [-0.8, by, 0.8]], true);
    m.join(top, bot);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) m.line([0.8 * sx, by + 1, 0.8 * sz], [2 * sx, -3.4, 2.5 * sz]);
    return m.finish();
  }

  function buildTank() {
    const m = new Model();
    const r = 6, h = 8, n = 10;
    const ring = (y, rr) => {
      const p = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        p.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
      }
      return p;
    };
    const b = m.poly(ring(0, r), true), t = m.poly(ring(h, r), true);
    m.poly(ring(h * 0.5, r), true);
    const apex = m.vert(0, h + 2.2, 0);
    for (let k = 0; k < n; k += 2) {
      m.edge(b[k], t[k]);
      m.edge(t[k], apex);
    }
    return m.finish();
  }

  function buildBarn() {
    const m = new Model();
    const w = 6, d = 10, h = 6, rh = 10;
    const base = m.poly([[-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d]], true);
    const top = m.poly([[-w, h, -d], [w, h, -d], [w, h, d], [-w, h, d]], true);
    m.join(base, top);
    const r0 = m.vert(0, rh, -d), r1 = m.vert(0, rh, d);
    m.edge(r0, r1);
    m.edge(top[0], r0); m.edge(top[1], r0); m.edge(top[2], r1); m.edge(top[3], r1);
    m.poly([[-2.2, 0, d], [-2.2, 4.2, d], [2.2, 4.2, d], [2.2, 0, d]], false);
    m.line([-2.2, 4.2, d], [2.2, 0, d]);
    m.line([2.2, 4.2, d], [-2.2, 0, d]);
    return m.finish();
  }

  function buildTree() {
    const m = new Model();
    m.line([0, 0, 0], [0, 3, 0]);
    const apex = m.vert(0, 11, 0);
    const base = m.poly([[2.6, 3, 0], [-1.3, 3, 2.25], [-1.3, 3, -2.25]], true);
    for (const i of base) m.edge(i, apex);
    return m.finish();
  }

  function buildHill(sx, sz, h) {
    const m = new Model();
    const base = m.poly([[-sx, 0, -sz], [sx, 0, -sz], [sx, 0, sz], [-sx, 0, sz]], true);
    const apex = m.vert(0, h, 0);
    for (const i of base) m.edge(i, apex);
    for (const k of [0.62, 0.3]) {
      const y = h * (1 - k);
      m.poly([[-sx * k, y, -sz * k], [sx * k, y, -sz * k], [sx * k, y, sz * k], [-sx * k, y, sz * k]], true);
    }
    return m.finish();
  }

  // flat-bottomed cumulus built from stacked irregular rings
  function buildCloud(rnd) {
    const m = new Model();
    const n = 11, base = 30 + rnd() * 35;
    const jit = [];
    for (let k = 0; k < n; k++) jit.push(0.75 + rnd() * 0.5);
    const rings = [[0, 1], [7 + rnd() * 3, 0.85], [14 + rnd() * 5, 0.5]].map(([y, s], li) => {
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU, r = base * s * (li ? 0.85 + rnd() * 0.3 : 1) * jit[k];
        pts.push([Math.cos(a) * r, y, Math.sin(a) * r * 0.7]);
      }
      return m.poly(pts, true);
    });
    for (let k = 0; k < n; k += 3) {
      m.edge(rings[0][k], rings[1][k]);
      m.edge(rings[1][k], rings[2][k]);
    }
    return m.finish();
  }

  const PLANE = buildBiplane();
  const ZEP = buildZeppelin();
  const BALLOON = buildBalloon();
  const TANK = buildTank();
  const BARN = buildBarn();
  const TREE = buildTree();

  // =====================================================================
  // Vector font (4 x 6 grid, y down)
  // =====================================================================
  const GLYPHS = {
    A: '0,6 0,2 2,0 4,2 4,6|0,4 4,4',
    B: '0,6 0,0 3,0 4,1 4,2 3,3 0,3|3,3 4,4 4,5 3,6 0,6',
    C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5',
    D: '0,0 0,6 2,6 4,4 4,2 2,0 0,0',
    E: '4,0 0,0 0,6 4,6|0,3 3,3',
    F: '4,0 0,0 0,6|0,3 3,3',
    G: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3',
    H: '0,0 0,6|4,0 4,6|0,3 4,3',
    I: '1,0 3,0|2,0 2,6|1,6 3,6',
    J: '4,0 4,5 3,6 1,6 0,5',
    K: '0,0 0,6|4,0 0,3 4,6',
    L: '0,0 0,6 4,6',
    M: '0,6 0,0 2,3 4,0 4,6',
    N: '0,6 0,0 4,6 4,0',
    O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
    P: '0,6 0,0 3,0 4,1 4,2 3,3 0,3',
    Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2,4 4,6',
    R: '0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6',
    S: '4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5',
    T: '0,0 4,0|2,0 2,6',
    U: '0,0 0,5 1,6 3,6 4,5 4,0',
    V: '0,0 2,6 4,0',
    W: '0,0 1,6 2,3 3,6 4,0',
    X: '0,0 4,6|4,0 0,6',
    Y: '0,0 2,3 4,0|2,3 2,6',
    Z: '0,0 4,0 0,6 4,6',
    0: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|4,1 0,5',
    1: '1,1 2,0 2,6|1,6 3,6',
    2: '0,1 1,0 3,0 4,1 4,2 0,6 4,6',
    3: '0,0 4,0 2,2 3,2 4,3 4,5 3,6 1,6 0,5',
    4: '3,6 3,0 0,4 4,4',
    5: '4,0 0,0 0,3 3,3 4,4 4,5 3,6 0,6',
    6: '4,0 1,0 0,1 0,5 1,6 3,6 4,5 4,4 3,3 0,3',
    7: '0,0 4,0 4,1 1,6',
    8: '1,0 3,0 4,1 4,2 3,3 1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3|1,3 0,2 0,1 1,0',
    9: '4,3 1,3 0,2 0,1 1,0 3,0 4,1 4,5 3,6 0,6',
    '-': '1,3 3,3',
    '.': '2,5.4 2,6',
    ',': '2,5 1,7',
    '!': '2,0 2,4|2,5.4 2,6',
    '?': '0,1 1,0 3,0 4,1 4,2 2,3 2,4|2,5.4 2,6',
    ':': '2,1.4 2,2|2,4 2,4.6',
    '/': '0,6 4,0',
    '+': '2,1.5 2,4.5|0.5,3 3.5,3',
    '(': '3,0 1,2 1,4 3,6',
    ')': '1,0 3,2 3,4 1,6',
    "'": '2,0 2,1.5',
    '<': '3,0 0,3 3,6',
    '>': '1,0 4,3 1,6',
    '=': '0.5,2 3.5,2|0.5,4 3.5,4',
    '*': '2,1 2,5|0,2 4,4|0,4 4,2',
  };
  const FONT = {};
  for (const k in GLYPHS) {
    FONT[k] = GLYPHS[k].split('|').map((pl) => pl.trim().split(/\s+/).map((p) => p.split(',').map(Number)));
  }

  function text(str, x, y, size, col, inten = 1, align = 'left') {
    str = String(str).toUpperCase();
    const s = size / 6, adv = 6 * s;
    const width = str.length * adv - 2 * s;
    let x0 = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    for (const ch of str) {
      const g = FONT[ch];
      if (g) {
        for (const pl of g) {
          for (let i = 0; i < pl.length - 1; i++) {
            line2(x0 + pl[i][0] * s, y + pl[i][1] * s, x0 + pl[i + 1][0] * s, y + pl[i + 1][1] * s, col, inten);
          }
        }
      }
      x0 += adv;
    }
  }
  const fitSize = (str, size) => Math.min(size, (W * 0.92) / Math.max(1, String(str).length));

  function circle(x, y, r, col, inten, n = 24) {
    let px = x + r, py = y;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * TAU;
      const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
      line2(px, py, nx, ny, col, inten);
      px = nx;
      py = ny;
    }
  }

  function rect(x, y, w, h, col, inten) {
    line2(x, y, x + w, y, col, inten);
    line2(x + w, y, x + w, y + h, col, inten);
    line2(x + w, y + h, x, y + h, col, inten);
    line2(x, y + h, x, y, col, inten);
  }

  function bar(x, y, w, h, v, col, inten) {
    rect(x, y, w, h, col, inten * 0.8);
    const step = 3.2 * U;
    const n = Math.round((clamp(v, 0, 1) * (w - 4 * U)) / step);
    for (let i = 0; i < n; i++) {
      const lx = x + 2.5 * U + i * step;
      line2(lx, y + 2.5 * U, lx, y + h - 2.5 * U, col, inten);
    }
  }

  // =====================================================================
  // World: a seamlessly wrapping tile of countryside along the front
  // =====================================================================
  const WORLD = 3200;
  const wrapW = (v) => v - Math.round(v / WORLD) * WORLD;
  const hills = [], objects = [], targets = [], groundSegs = [], clouds = [];
  const riverX = (z) => 2250 + 110 * Math.sin((z / WORLD) * TAU + 0.6) + 40 * Math.sin((z / WORLD) * TAU * 3 + 1.1);
  const ROAD_Z = 2500, FRONT_Z = 940;

  function terrainHeight(x, z) {
    let h = 0;
    for (let i = 0; i < hills.length; i++) {
      const hl = hills[i];
      const dx = Math.abs(wrapW(x - hl.x));
      if (dx >= hl.sx) continue;
      const dz = Math.abs(wrapW(z - hl.z));
      if (dz >= hl.sz) continue;
      const y = hl.h * (1 - Math.max(dx / hl.sx, dz / hl.sz));
      if (y > h) h = y;
    }
    return h;
  }

  (function buildWorld() {
    const r = mulberry32(1917);
    let tries = 0;
    while (hills.length < 18 && tries++ < 3000) {
      const x = r() * WORLD, z = r() * WORLD;
      const sx = 45 + r() * 85, sz = 45 + r() * 85, h = 35 + r() * 95;
      if (Math.abs(wrapW(z - FRONT_Z)) < 140 + sz) continue;
      if (Math.abs(wrapW(x - riverX(z))) < sx + 30) continue;
      if (Math.abs(wrapW(z - ROAD_Z)) < sz + 15) continue;
      let ok = true;
      for (const o of hills) {
        if (Math.hypot(wrapW(o.x - x), wrapW(o.z - z)) < (Math.max(o.sx, o.sz) + Math.max(sx, sz)) * 0.75) {
          ok = false;
          break;
        }
      }
      if (ok) hills.push({ x, z, sx, sz, h, model: buildHill(sx, sz, h) });
    }

    const free = (x, z, rad) => {
      for (const hl of hills) {
        if (Math.abs(wrapW(x - hl.x)) < hl.sx + rad && Math.abs(wrapW(z - hl.z)) < hl.sz + rad) return false;
      }
      if (Math.abs(wrapW(x - riverX(z))) < 22 + rad) return false;
      if (Math.abs(wrapW(z - ROAD_Z)) < 10 + rad) return false;
      if (Math.abs(wrapW(z - FRONT_Z)) < 80 + rad) return false;
      for (const o of objects) if (Math.hypot(wrapW(o.x - x), wrapW(o.z - z)) < o.rad + rad) return false;
      return true;
    };
    const place = (rad, fn) => {
      for (let i = 0; i < 300; i++) {
        const x = r() * WORLD, z = r() * WORLD;
        if (free(x, z, rad)) return fn(x, z);
      }
      return null;
    };

    for (let i = 0; i < 12; i++) {
      place(14, (x, z) => {
        const yaw = r() * TAU;
        objects.push({ kind: 'barn', x, y: 0, z, yaw, b: setBasis(makeBasis(), yaw, 0, 0), model: BARN, scale: 1, rad: 12, alive: true });
      });
    }
    for (let g = 0; g < 14; g++) {
      place(30, (gx, gz) => {
        const n = 3 + Math.floor(r() * 6);
        for (let k = 0; k < n; k++) {
          const x = gx + (r() - 0.5) * 55, z = gz + (r() - 0.5) * 55;
          if (!free(x, z, 2)) continue;
          objects.push({ kind: 'tree', x, y: 0, z, b: IDB, model: TREE, scale: 0.8 + r() * 0.7, rad: 3, alive: true });
        }
      });
    }
    for (let i = 0; i < 6; i++) {
      place(30, (x, z) => {
        for (let k = 0; k < 2; k++) {
          const o = { kind: 'tank', x: x + k * 16, y: 0, z: z + (r() - 0.5) * 6, b: IDB, model: TANK, scale: 1, rad: 7, alive: true, hp: 2, maxhp: 2, respawn: 0, hy: 5, hr: 7, pts: 150 };
          objects.push(o);
          targets.push(o);
        }
      });
    }
    for (let i = 0; i < 7; i++) {
      place(20, (x, z) => {
        const o = { kind: 'balloon', x, y: 90 + r() * 70, z, b: setBasis(makeBasis(), 0.7, 0.08, 0), model: BALLOON, scale: 1, rad: 7, alive: true, hp: 3, maxhp: 3, respawn: 0, hy: 0, hr: 6.5, pts: 300, phase: r() * TAU, bob: 0 };
        objects.push(o);
        targets.push(o);
      });
    }

    const seg = (ax, az, bx, bz, i) => groundSegs.push({ ax, az, bx, bz, mx: (ax + bx) / 2, mz: (az + bz) / 2, i });
    // two zig-zag trench lines facing each other across no-man's land
    for (const [base, ph] of [[FRONT_Z - 40, 0], [FRONT_Z + 45, 1.3]]) {
      const N = 80, step = WORLD / N;
      const zAt = (k) => base + 35 * Math.sin((k / N) * TAU * 2 + ph) + 14 * Math.sin((k / N) * TAU * 5 + ph * 2) + (k % 2) * 9;
      for (let k = 0; k < N; k++) {
        const x0 = k * step, x1 = x0 + step, z0 = zAt(k), z1 = zAt(k + 1);
        seg(x0, z0, x1, z0, 0.6);
        seg(x1, z0, x1, z1, 0.6);
      }
    }
    // shell craters
    const crater = (cx, cz, rr, inten) => {
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU;
        seg(cx + Math.cos(a0) * rr, cz + Math.sin(a0) * rr, cx + Math.cos(a1) * rr, cz + Math.sin(a1) * rr, inten);
      }
    };
    for (let i = 0; i < 90; i++) crater(r() * WORLD, FRONT_Z - 50 + r() * 100, 2 + r() * 6, 0.4);
    for (let i = 0; i < 25; i++) {
      const x = r() * WORLD, z = r() * WORLD;
      if (free(x, z, 8)) crater(x, z, 3 + r() * 6, 0.3);
    }
    // river
    const NR = 80;
    for (let k = 0; k < NR; k++) {
      const z0 = (k / NR) * WORLD, z1 = ((k + 1) / NR) * WORLD;
      const w0 = 9 + 4 * Math.sin((k / NR) * TAU * 6), w1 = 9 + 4 * Math.sin(((k + 1) / NR) * TAU * 6);
      const xa = riverX(z0), xb = riverX(z1);
      seg(xa - w0, z0, xb - w1, z1, 0.55);
      seg(xa + w0, z0, xb + w1, z1, 0.55);
    }
    // clouds
    for (let i = 0; i < 16; i++) {
      clouds.push({ x: r() * WORLD, y: 330 + r() * 110, z: r() * WORLD, model: buildCloud(r) });
    }
    // road
    for (let k = 0; k < 40; k++) {
      const x0 = (k / 40) * WORLD, x1 = ((k + 1) / 40) * WORLD;
      seg(x0, ROAD_Z - 4, x1, ROAD_Z - 4, 0.35);
      seg(x0, ROAD_Z + 4, x1, ROAD_Z + 4, 0.35);
    }
  })();

  // distant mountain silhouette, drawn at infinity
  const MTN_N = 144;
  const MTN = new Float32Array(MTN_N);
  (function () {
    const r = mulberry32(77);
    const ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU];
    for (let i = 0; i < MTN_N; i++) {
      const a = (i / MTN_N) * TAU;
      const e = 0.032 * Math.sin(2 * a + ph[0]) + 0.024 * Math.sin(5 * a + ph[1]) + 0.014 * Math.sin(11 * a + ph[2]) +
        0.008 * Math.sin(23 * a + ph[3]) + 0.016 + (r() - 0.5) * 0.012;
      MTN[i] = Math.max(0, e);
    }
  })();

  function objectCollide(x, y, z) {
    if (y > 175) return null;
    for (const o of objects) {
      if (!o.alive) continue;
      const dx = wrapW(x - o.x), dz = wrapW(z - o.z);
      if (Math.abs(dx) > 20 || Math.abs(dz) > 20) continue;
      switch (o.kind) {
        case 'barn': {
          const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
          const lx = dx * c - dz * s, lz = dx * s + dz * c;
          if (Math.abs(lx) < 7 && Math.abs(lz) < 11 && y < 10) return o;
          break;
        }
        case 'tank':
          if (dx * dx + dz * dz < 49 && y < 11) return o;
          break;
        case 'tree':
          if (dx * dx + dz * dz < 6 && y < 11 * o.scale) return o;
          break;
        case 'balloon': {
          const dy = y - (o.y + o.bob);
          if (dx * dx + dy * dy + dz * dz < 49) return o;
          break;
        }
      }
    }
    return null;
  }

  // =====================================================================
  // Sound: everything is synthesized with WebAudio
  // =====================================================================
  const Sfx = (() => {
    let ac = null, master = null, nbuf = null, eng = null, lastEng = 0;
    let muted = store.get('phosphorAce.muted', false);

    function init() {
      if (ac) {
        if (ac.state === 'suspended') ac.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
      } catch (e) {
        ac = null;
        return;
      }
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ac.destination);
      const len = Math.floor(ac.sampleRate * 2.5);
      nbuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = nbuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // rotary engine: sawtooth + sub, low-passed, chopped by a square LFO
      const o1 = ac.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
      const o2 = ac.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
      const o2g = ac.createGain(); o2g.gain.value = 0.5;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 1.5;
      const am = ac.createGain(); am.gain.value = 0.55;
      const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 15;
      const lfoAmt = ac.createGain(); lfoAmt.gain.value = 0.4;
      const out = ac.createGain(); out.gain.value = 0;
      lfo.connect(lfoAmt); lfoAmt.connect(am.gain);
      o1.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(am); am.connect(out); out.connect(master);
      o1.start(); o2.start(); lfo.start();
      eng = { o1, o2, lfo, out };
    }

    function envGain(t, a, peak, d) {
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      g.connect(master);
      return g;
    }

    function noise(dur, ftype, f, f2, q, vol, delay = 0) {
      if (!ac || vol < 0.003) return;
      const t = ac.currentTime + delay;
      const src = ac.createBufferSource();
      src.buffer = nbuf;
      const fl = ac.createBiquadFilter();
      fl.type = ftype;
      fl.frequency.setValueAtTime(f, t);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
      fl.Q.value = q;
      const g = envGain(t, 0.004, vol, dur);
      src.connect(fl);
      fl.connect(g);
      src.start(t, Math.random(), dur + 0.1);
    }

    function tone(f, dur, type, vol, delay = 0, f2 = 0) {
      if (!ac || vol < 0.003) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      const g = envGain(t, 0.005, vol, dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    return {
      init,
      get muted() {
        return muted;
      },
      toggleMute() {
        muted = !muted;
        store.set('phosphorAce.muted', muted);
        if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.55, ac.currentTime, 0.02);
        return muted;
      },
      engine(on, speed, sputter) {
        if (!ac) return;
        const t = ac.currentTime;
        if (t - lastEng < 0.08) return;
        lastEng = t;
        const f = 42 + speed * 0.42;
        eng.out.gain.setTargetAtTime(on ? 0.12 : 0, t, 0.25);
        eng.o1.frequency.setTargetAtTime(f, t, 0.15);
        eng.o2.frequency.setTargetAtTime(f / 2, t, 0.15);
        eng.lfo.frequency.setTargetAtTime(sputter ? 4 + Math.random() * 7 : f / 4, t, 0.1);
      },
      gun() {
        noise(0.05, 'bandpass', 1800, 0, 0.7, 0.2);
        tone(150, 0.05, 'square', 0.06, 0, 60);
      },
      enemyGun(v) {
        noise(0.05, 'bandpass', 900, 0, 0.8, 0.12 * v);
      },
      ping() {
        tone(1400, 0.035, 'square', 0.04);
        noise(0.03, 'highpass', 3000, 0, 1, 0.07);
      },
      boom(v = 1) {
        noise(1.3, 'lowpass', 1000, 60, 0.6, 0.9 * v);
        tone(75, 0.6, 'sine', 0.45 * v, 0, 28);
      },
      hurt() {
        noise(0.14, 'bandpass', 600, 0, 3, 0.35);
        tone(240, 0.14, 'sawtooth', 0.12, 0, 80);
      },
      jam() {
        tone(320, 0.05, 'square', 0.1);
        tone(190, 0.09, 'square', 0.1, 0.07);
      },
      warn() {
        tone(880, 0.09, 'square', 0.05);
      },
      fanfare() {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.13, 'square', 0.05, i * 0.11));
      },
      extra() {
        [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => tone(f, 0.09, 'square', 0.05, i * 0.08));
      },
      gameOver() {
        [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'triangle', 0.12, i * 0.25));
      },
    };
  })();

  // =====================================================================
  // Input: keyboard + gamepad
  // =====================================================================
  const K = Object.create(null);
  const GP = { roll: 0, pitch: 0, fire: false, prevA: false, prevStart: false };
  let invert = store.get('phosphorAce.invert', false);

  // ---- touch + tilt state (iPad / tablets / phones) ----
  const DEG = Math.PI / 180;
  const STICK_R = 70;
  const touch = {
    // start in touch mode on touch-first devices; any key press switches back to keyboard mode
    active: !!(navigator.maxTouchPoints > 0 && window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches),
    mode: store.get('phosphorAce.touchMode', 'tilt'), // 'tilt' | 'stick'
    points: new Map(), // touch id -> { x, y, role: 'fire' | 'stick' | 'ui' | 'none' }
    stickId: null, stickOX: 0, stickOY: 0, stickX: 0, stickY: 0,
  };
  const tilt = {
    state: 'off', // off | requesting | on | failed
    beta: 0, gamma: 0, seen: false, fresh: true, waitT: 0,
    roll: 0, pitch: 0, p0: 0, calibT: 0, flip: 0, ok: false,
  };
  let firingNow = false;

  window.addEventListener('keydown', (e) => {
    Sfx.init();
    touch.active = false;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!e.repeat) onKey(e.code);
    K[e.code] = true;
  });
  window.addEventListener('keyup', (e) => {
    K[e.code] = false;
  });
  function releaseAll() {
    for (const k in K) K[k] = false;
    touch.points.clear();
    touch.stickId = null;
  }
  window.addEventListener('blur', () => {
    releaseAll();
    if (tilt.state === 'requesting') return; // the iOS permission sheet steals focus
    if (state === 'playing' || state === 'dying') paused = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    releaseAll();
    if (state === 'playing' || state === 'dying') paused = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return; // fingers and pens go through the touch listeners
    Sfx.init();
    uiTap(e.clientX * DPR, e.clientY * DPR);
  });

  // ---- touch listeners ----
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touch.active = true;
    for (const t of e.changedTouches) {
      const x = t.clientX * DPR, y = t.clientY * DPR;
      let role;
      if (paused || state === 'title' || state === 'gameover' || hitButton(x, y)) role = 'ui';
      else if (state !== 'playing' && state !== 'dying') role = 'none';
      else if (touch.mode === 'stick' && x < W * 0.5 && touch.stickId === null) {
        role = 'stick';
        touch.stickId = t.identifier;
        touch.stickOX = touch.stickX = x;
        touch.stickOY = touch.stickY = y;
      } else role = 'fire';
      touch.points.set(t.identifier, { x, y, role });
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const p = touch.points.get(t.identifier);
      if (!p) continue;
      p.x = t.clientX * DPR;
      p.y = t.clientY * DPR;
      if (t.identifier === touch.stickId) {
        touch.stickX = p.x;
        touch.stickY = p.y;
      }
    }
  }, { passive: false });
  function endTouches(e, tap) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const p = touch.points.get(t.identifier);
      if (t.identifier === touch.stickId) touch.stickId = null;
      touch.points.delete(t.identifier);
      if (tap && p && p.role === 'ui') uiTap(p.x, p.y);
    }
  }
  // touchend counts as a user gesture on iOS: unlock audio and ask for tilt permission here
  canvas.addEventListener('touchend', (e) => {
    Sfx.init();
    endTouches(e, true);
  }, { passive: false });
  canvas.addEventListener('touchcancel', (e) => endTouches(e, false), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault()); // stop Safari pinch-zoom
  window.addEventListener('orientationchange', recalibrate);
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', recalibrate);

  // ---- tilt ----
  function reportedScreenAngle() {
    let a = 0;
    if (typeof window.orientation === 'number') a = window.orientation;
    else if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
    // the reported angle has to agree with the window's shape
    const landscape = window.innerWidth > window.innerHeight;
    if (landscape !== (Math.abs(a % 180) === 90)) a = landscape ? 90 : 0;
    return a;
  }
  function screenAngle() {
    return (reportedScreenAngle() + tilt.flip) % 360;
  }

  // Device beta/gamma -> gravity in screen coordinates -> bank + pitch angles (radians).
  // roll: screen tipped right-side-down is positive. pitch: 0 = lying flat, 90deg = held upright.
  function tiltMath(beta, gamma, angleDeg) {
    const b = beta * DEG, g = gamma * DEG, a = angleDeg * DEG;
    const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);
    const c = Math.cos(a), s = Math.sin(a);
    const sx = dx * c - dy * s, sy = dx * s + dy * c;
    return { roll: Math.asin(clamp(sx, -1, 1)), pitch: Math.atan2(-sy, -dz), sy, dz };
  }

  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    tilt.beta = e.beta;
    tilt.gamma = e.gamma;
    tilt.seen = true;
  }

  // must be called from inside a tap handler (iOS only shows the permission prompt for a user gesture)
  function requestTilt() {
    if (tilt.state === 'on' || tilt.state === 'requesting') return;
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) {
      tiltFail('NO TILT SENSOR');
      return;
    }
    if (typeof DOE.requestPermission === 'function') {
      tilt.state = 'requesting';
      DOE.requestPermission()
        .then((res) => (res === 'granted' ? startTilt() : tiltFail('TILT PERMISSION DENIED')))
        .catch(() => tiltFail(window.isSecureContext ? 'TILT NOT ALLOWED' : 'TILT NEEDS AN HTTPS ADDRESS'));
    } else {
      startTilt();
    }
  }

  function startTilt() {
    window.removeEventListener('deviceorientation', onOrient);
    window.addEventListener('deviceorientation', onOrient);
    tilt.state = 'on';
    tilt.waitT = 2.5;
    tilt.fresh = true;
    recalibrate();
  }

  function tiltFail(msg) {
    window.removeEventListener('deviceorientation', onOrient);
    tilt.state = 'failed';
    tilt.ok = false;
    tilt.seen = false;
    touch.mode = 'stick';
    notice(msg + ' - USING TOUCH STICK', 4.5);
  }

  function recalibrate() {
    tilt.calibT = 0.7;
  }

  function updateTilt(dt) {
    if (tilt.state !== 'on') return;
    if (!tilt.seen) {
      tilt.waitT -= dt;
      if (tilt.waitT <= 0) tiltFail(window.isSecureContext ? 'NO TILT SENSOR FOUND' : 'TILT NEEDS AN HTTPS ADDRESS');
      return;
    }
    const a = tiltMath(tilt.beta, tilt.gamma, screenAngle());
    // Held normally, gravity always points toward the bottom of the screen. If it points to the
    // top, the browser reported the rotation the other way round: flip our mapping once.
    if (tilt.calibT > 0 && Math.abs(a.dz) < 0.85 && a.sy > 0.35) {
      tilt.flip = (tilt.flip + 180) % 360;
      tilt.fresh = true;
      return;
    }
    if (tilt.fresh) {
      tilt.roll = a.roll;
      tilt.pitch = a.pitch;
      tilt.fresh = false;
    }
    const k = Math.min(1, dt * 14);
    tilt.roll += (a.roll - tilt.roll) * k;
    tilt.pitch = wrapAngle(tilt.pitch + wrapAngle(a.pitch - tilt.pitch) * k);
    tilt.ok = true;
    if (tilt.calibT > 0) {
      tilt.calibT -= dt;
      tilt.p0 = tilt.pitch; // whatever angle you hold it at becomes level
      if (tilt.calibT <= 0 && touch.active && touch.mode === 'tilt' && state === 'playing') notice('TILT CENTERED');
    }
  }

  function shapeAxis(v, deadDeg, rangeDeg) {
    const a = Math.abs(v) / DEG;
    if (a < deadDeg) return 0;
    return Math.sign(v) * Math.min(1, (a - deadDeg) / (rangeDeg - deadDeg));
  }

  // ---- on-screen buttons (touch + mouse) ----
  function uiButtons() {
    const out = [];
    const bh = 40 * U;
    const modeLabel = 'CONTROLS: ' + (touch.mode === 'tilt' ? 'TILT' : 'STICK');
    const invLabel = 'INVERT: ' + (invert ? 'ON' : 'OFF');
    const sndLabel = 'SOUND: ' + (Sfx.muted ? 'OFF' : 'ON');
    if (paused) {
      const items = [['RESUME', resume]];
      if (touch.active) items.push([modeLabel, toggleMode]);
      items.push([invLabel, toggleInvert], [sndLabel, toggleSound]);
      const bw = Math.min(320 * U, W * 0.8);
      items.forEach(([label, action], i) => out.push({ x: CX - bw / 2, y: H * 0.42 + i * (bh + 14 * U), w: bw, h: bh, label, action }));
    } else if (state === 'title' || state === 'gameover') {
      if (touch.active && canStart()) {
        const gap = 16 * U, bw = Math.min(230 * U, (W * 0.94 - 2 * gap) / 3);
        const x0 = CX - (bw * 3 + gap * 2) / 2;
        [[modeLabel, toggleMode], [invLabel, toggleInvert], [sndLabel, toggleSound]].forEach(([label, action], i) =>
          out.push({ x: x0 + i * (bw + gap), y: H * 0.84, w: bw, h: bh, label, action }));
      }
    } else if ((state === 'playing' || state === 'dying') && touch.active) {
      out.push({ x: CX - 22 * U, y: 14 * U, w: 44 * U, h: 38 * U, label: '', kind: 'pause', action: () => { paused = true; } });
    }
    return out;
  }

  function hitButton(x, y) {
    const pad = 10 * U;
    for (const b of uiButtons()) {
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return b;
    }
    return null;
  }

  function uiTap(x, y) {
    const b = hitButton(x, y);
    if (b) {
      b.action();
      return;
    }
    if (state === 'title' || state === 'gameover') {
      if (canStart()) {
        if (touch.active && touch.mode === 'tilt') requestTilt();
        startGame();
      }
    } else if (paused) {
      resume();
    }
  }

  function resume() {
    paused = false;
    recalibrate();
  }

  function toggleMode() {
    touch.mode = touch.mode === 'tilt' ? 'stick' : 'tilt';
    store.set('phosphorAce.touchMode', touch.mode);
    if (touch.mode === 'tilt') {
      if (tilt.state === 'failed') tilt.state = 'off';
      requestTilt();
      recalibrate();
    }
    notice(touch.mode === 'tilt' ? 'TILT CONTROLS' : 'TOUCH STICK CONTROLS');
  }

  function toggleInvert() {
    invert = !invert;
    store.set('phosphorAce.invert', invert);
    if (touch.active && touch.mode === 'tilt') notice(invert ? 'PITCH INVERTED - TOP TOWARD YOU DIVES' : 'PITCH NORMAL - TOP TOWARD YOU CLIMBS');
    else notice(invert ? 'PITCH INVERTED - UP DIVES' : 'PITCH NORMAL - UP CLIMBS');
  }

  function toggleSound() {
    notice(Sfx.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
  }

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let g = null;
    for (const p of pads) {
      if (p && p.connected) {
        g = p;
        break;
      }
    }
    if (!g) {
      GP.roll = GP.pitch = 0;
      GP.fire = false;
      return;
    }
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    GP.roll = dz(g.axes[0] || 0);
    GP.pitch = -dz(g.axes[1] || 0);
    const btn = (i) => !!(g.buttons[i] && g.buttons[i].pressed);
    GP.fire = btn(0) || btn(5) || btn(7);
    const a = btn(0), st = btn(9);
    if ((a && !GP.prevA) || (st && !GP.prevStart)) {
      Sfx.init();
      if (state === 'title' || state === 'gameover') {
        if (canStart()) startGame();
      } else if (st && !GP.prevStart) {
        if (paused) resume();
        else paused = true;
      }
    }
    GP.prevA = a;
    GP.prevStart = st;
  }

  // rollAbs (when set) is a target bank angle -1..1 from tilt or the touch stick;
  // r is a keyboard/gamepad roll rate. p is pitch rate, +1 = nose up.
  function readControls() {
    let r = 0, p = 0, rollAbs = null;
    let fire = !!(K.Space || K.KeyJ || K.ControlLeft || GP.fire);
    if (K.ArrowLeft || K.KeyA) r -= 1;
    if (K.ArrowRight || K.KeyD) r += 1;
    if (K.ArrowUp || K.KeyW) p += 1;
    if (K.ArrowDown || K.KeyS) p -= 1;
    r = clamp(r + GP.roll, -1, 1);
    p += GP.pitch;
    if (touch.active) {
      if (touch.mode === 'tilt' && tilt.ok) {
        rollAbs = shapeAxis(tilt.roll, 3, 28);
        if (tilt.calibT <= 0) p += shapeAxis(wrapAngle(tilt.pitch - tilt.p0), 4, 22);
      }
      if (touch.stickId !== null) {
        const R = STICK_R * U, dz = (v) => (Math.abs(v) < 0.08 ? 0 : v);
        rollAbs = dz(clamp((touch.stickX - touch.stickOX) / R, -1, 1));
        p -= dz(clamp((touch.stickY - touch.stickOY) / R, -1, 1)); // drag up = climb
      }
      for (const t of touch.points.values()) if (t.role === 'fire') fire = true;
    }
    if (r) rollAbs = null; // keys / gamepad win
    p = clamp(p, -1, 1);
    if (invert) p = -p;
    return { r, p, fire, rollAbs };
  }

  function onKey(code) {
    if (code === 'KeyM') {
      toggleSound();
      return;
    }
    if (code === 'KeyI') {
      toggleInvert();
      return;
    }
    if (state === 'title' || state === 'gameover') {
      if ((code === 'Space' || code === 'Enter') && canStart()) startGame();
      return;
    }
    if (code === 'KeyP' || code === 'Escape') {
      if (paused) resume();
      else paused = true;
      return;
    }
    if (paused && (code === 'Space' || code === 'Enter')) resume();
  }

  // =====================================================================
  // Game state
  // =====================================================================
  const MAX_HULL = 8;
  const EXTRA_EVERY = 15000;
  let state = 'title', paused = false, time = 0;
  let score = 0, hi = store.get('phosphorAce.hi', 0), lives = 3, nextExtra = EXTRA_EVERY, newHi = false;
  let wave = 0, waveQueue = [], spawnT = 0, clearT = 0, maxActive = 2;
  let overT = 0, deadT = 0, shake = 0, hitFlash = 0, warnT = 0;
  let noticeText = '', noticeT = 0;
  const cracks = [], enemies = [], bullets = [], parts = [], debris = [], popups = [], banners = [];
  let zeppelin = null;

  const P = {
    x: 1600, y: 185, z: 1600, yaw: 0.4, pitch: 0, roll: 0, speed: 72,
    vx: 0, vy: 0, vz: 0, b: makeBasis(),
    hull: MAX_HULL, heat: 0, jammed: false, gunT: 0, gunSide: 1, flash: 0, flashSide: 1,
    alive: true, inv: 0, spin: 0, dieT: 0, cause: '',
  };
  setBasis(P.b, P.yaw, 0, 0);

  function banner(textStr, dur = 2, size = 26, col = C_HUD) {
    banners.push({ text: textStr, t: dur, dur, size, col });
    while (banners.length > 3) banners.shift();
  }

  function notice(t, dur = 2) {
    noticeText = t;
    noticeT = dur;
  }

  function canStart() {
    return state === 'title' || overT > 1.2;
  }

  function addScore(n) {
    score += n;
    while (score >= nextExtra) {
      nextExtra += EXTRA_EVERY;
      lives++;
      banner('EXTRA PLANE!', 2.5, 24, C_TRACER);
      Sfx.extra();
    }
  }

  function popup(x, y, z, t) {
    popups.push({ x, y, z, text: t, life: 1.6 });
  }

  function startGame() {
    state = 'playing';
    paused = false;
    score = 0;
    lives = 3;
    nextExtra = EXTRA_EVERY;
    newHi = false;
    enemies.length = bullets.length = parts.length = debris.length = popups.length = banners.length = 0;
    zeppelin = null;
    for (const o of targets) {
      o.alive = true;
      o.hp = o.maxhp;
    }
    resetPlayer();
    recalibrate();
    document.body.classList.add('flying');
    startWave(1);
    banner('SHOOT DOWN EVERY ENEMY PLANE', 3, 16);
  }

  function resetPlayer() {
    P.y = Math.max(170, terrainHeight(P.x, P.z) + 120);
    P.pitch = 0;
    P.roll = 0;
    P.speed = 72;
    P.hull = MAX_HULL;
    P.heat = 0;
    P.jammed = false;
    P.alive = true;
    P.inv = 2.5;
    P.flash = 0;
    cracks.length = 0;
    setBasis(P.b, P.yaw, 0, 0);
  }

  function startWave(n) {
    wave = n;
    waveQueue = [];
    const count = Math.min(2 + n, 10);
    const aces = n >= 3 ? Math.min(Math.floor(n / 3), 3) : 0;
    for (let i = 0; i < count; i++) waveQueue.push(i >= count - aces);
    maxActive = Math.min(2 + Math.floor(n / 2), 5);
    spawnT = 1.5;
    clearT = 0;
    banner('WAVE ' + n, 2.5, 34);
    if (n % 3 === 2 && !zeppelin) spawnZeppelin();
    Sfx.fanfare();
  }

  function updateWave(dt) {
    if (state !== 'playing' && state !== 'dying' && state !== 'dead') return;
    if (clearT > 0) {
      clearT -= dt;
      if (clearT <= 0) startWave(wave + 1);
      return;
    }
    let active = 0;
    for (const e of enemies) if (!e.falling) active++;
    spawnT -= dt;
    if (waveQueue.length && active < maxActive && spawnT <= 0) {
      spawnEnemy(waveQueue.shift());
      spawnT = 2.5;
    }
    if (!waveQueue.length && active === 0 && state === 'playing') {
      const bonus = 250 * wave;
      addScore(bonus);
      clearT = 3.5;
      banner('WAVE ' + wave + ' CLEARED', 3, 28, C_TRACER);
      banner('BONUS ' + bonus, 3, 20, C_TRACER);
      P.hull = Math.min(MAX_HULL, P.hull + 3);
      cracks.splice(0, 3);
    }
  }

  // ---------------------------------------------------------------------
  // FX
  // ---------------------------------------------------------------------
  function sparks(x, y, z, n, spd, col, life, up = 0) {
    for (let i = 0; i < n && parts.length < 1800; i++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      const s = (spd * (0.3 + Math.random() * 0.7)) / l;
      parts.push({ t: 0, x, y, z, vx: dx * s, vy: dy * s + up, vz: dz * s, life: life * (0.5 + Math.random() * 0.5), max: life, col, g: -25, size: 0 });
    }
  }

  function puff(x, y, z, size, life = 1.6) {
    if (parts.length >= 1800) return;
    parts.push({ t: 1, x, y, z, vx: rand(-1, 1), vy: rand(1, 3), vz: rand(-1, 1), life, max: life, col: C_SMOKE, g: 0, size });
  }

  function shock(x, y, z, size, life) {
    parts.push({ t: 2, x, y, z, vx: 0, vy: 0, vz: 0, life, max: life, col: C_FIRE, g: 0, size });
  }

  function dust(x, y, z) {
    for (let i = 0; i < 3 && parts.length < 1800; i++) {
      parts.push({ t: 0, x, y, z, vx: rand(-4, 4), vy: rand(6, 16), vz: rand(-4, 4), life: 0.5, max: 0.5, col: C_WORLD, g: -40, size: 0 });
    }
  }

  function shatter(m, o, b, col, scale, vx, vy, vz, power = 1) {
    const v = m.v, e = m.e;
    for (let i = 0; i < e.length; i += 2) {
      if (debris.length > 700) break;
      const a = e[i] * 3, c = e[i + 1] * 3;
      l2w(o, b, v[a] * scale, v[a + 1] * scale, v[a + 2] * scale);
      const ax = L.x, ay = L.y, az = L.z;
      l2w(o, b, v[c] * scale, v[c + 1] * scale, v[c + 2] * scale);
      const cx = (ax + L.x) / 2, cy = (ay + L.y) / 2, cz = (az + L.z) / 2;
      let kx = rand(-1, 1), ky = rand(-1, 1), kz = rand(-1, 1);
      const kl = Math.hypot(kx, ky, kz) || 1;
      const sp = rand(1.5, 5) * power;
      debris.push({
        cx, cy, cz, hx: (L.x - ax) / 2, hy: (L.y - ay) / 2, hz: (L.z - az) / 2,
        vx: (cx - o.x) * sp * 0.5 + vx * 0.5 + rand(-10, 10) * power,
        vy: (cy - o.y) * sp * 0.5 + vy * 0.5 + rand(0, 18) * power,
        vz: (cz - o.z) * sp * 0.5 + vz * 0.5 + rand(-10, 10) * power,
        kx: kx / kl, ky: ky / kl, kz: kz / kl, w: rand(-9, 9), life: rand(1.6, 3.4), max: 3.4, col,
      });
    }
  }

  function explosion(x, y, z, size, vol) {
    sparks(x, y, z, 30 * size, 45 * size, C_FIRE, 1.1);
    sparks(x, y, z, 10 * size, 25 * size, C_ETRACER, 1.5);
    shock(x, y, z, 2 * size, 0.6);
    for (let i = 0; i < 6 * size; i++) puff(x + rand(-3, 3), y + rand(-2, 2), z + rand(-3, 3), 2.5 * size, 2.5);
    const d = Math.hypot(x - P.x, y - P.y, z - P.z);
    Sfx.boom(clamp(vol * (1 - d / 1600), 0.05, 1));
    if (d < 140) shake = Math.max(shake, (1 - d / 140) * 0.8);
  }

  function updateFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts[i] = parts[parts.length - 1];
        parts.pop();
        continue;
      }
      if (p.t === 1) {
        p.vx *= 1 - dt * 0.5;
        p.vz *= 1 - dt * 0.5;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0 && p.t === 0) {
        p.y = 0;
        p.vy *= -0.3;
      }
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        debris[i] = debris[debris.length - 1];
        debris.pop();
        continue;
      }
      // rotate half-vector around axis k (Rodrigues)
      const th = d.w * dt, c = Math.cos(th), s = Math.sin(th);
      const kx = d.kx, ky = d.ky, kz = d.kz, hx = d.hx, hy = d.hy, hz = d.hz;
      const kd = kx * hx + ky * hy + kz * hz;
      d.hx = hx * c + (ky * hz - kz * hy) * s + kx * kd * (1 - c);
      d.hy = hy * c + (kz * hx - kx * hz) * s + ky * kd * (1 - c);
      d.hz = hz * c + (kx * hy - ky * hx) * s + kz * kd * (1 - c);
      d.vy -= 30 * dt;
      d.cx += d.vx * dt;
      d.cy += d.vy * dt;
      d.cz += d.vz * dt;
      if (d.cy < 0) {
        d.cy = 0;
        d.vy *= -0.3;
        d.vx *= 0.5;
        d.vz *= 0.5;
        d.w *= 0.5;
      }
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.life -= dt;
      p.y += 6 * dt;
      if (p.life <= 0) popups.splice(i, 1);
    }
    for (let i = banners.length - 1; i >= 0; i--) {
      banners[i].t -= dt;
      if (banners[i].t <= 0) banners.splice(i, 1);
    }
    if (noticeT > 0) noticeT -= dt;
    shake = Math.max(0, shake - dt * 1.8);
    hitFlash = Math.max(0, hitFlash - dt * 2.5);
    cam.ox = (Math.random() - 0.5) * shake * 16 * U;
    cam.oy = (Math.random() - 0.5) * shake * 16 * U;
  }

  // ---------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------
  function movePlayer(dt) {
    P.vx = P.b.fx * P.speed;
    P.vy = P.b.fy * P.speed;
    P.vz = P.b.fz * P.speed;
    P.x += P.vx * dt;
    P.y += P.vy * dt;
    P.z += P.vz * dt;
  }

  function autopilot(dt) {
    const tr = 0.45 * Math.sin(time * 0.21);
    P.roll += (tr - P.roll) * Math.min(1, dt);
    const tp = clamp((185 - P.y) * 0.01, -0.25, 0.25);
    P.pitch += (tp - P.pitch) * Math.min(1, dt);
    P.yaw = wrapAngle(P.yaw + Math.sin(P.roll) * dt);
    P.speed = 70;
    setBasis(P.b, P.yaw, P.pitch, P.roll);
    movePlayer(dt);
  }

  function firePlayerGun() {
    P.gunSide = -P.gunSide;
    const s = P.gunSide, b = P.b;
    const mx = P.x + b.rx * 0.42 * s - b.ux * 0.78 + b.fx * 3.2;
    const my = P.y + b.ry * 0.42 * s - b.uy * 0.78 + b.fy * 3.2;
    const mz = P.z + b.rz * 0.42 * s - b.uz * 0.78 + b.fz * 3.2;
    let ax = P.x + b.fx * 220 - mx, ay = P.y + b.fy * 220 - my, az = P.z + b.fz * 220 - mz;
    const l = Math.hypot(ax, ay, az);
    ax /= l; ay /= l; az /= l;
    const v = 480;
    if (bullets.length < 500) {
      bullets.push({ x: mx, y: my, z: mz, vx: ax * v + P.vx, vy: ay * v + P.vy, vz: az * v + P.vz, dx: ax, dy: ay, dz: az, life: 1.3, age: 0, owner: 0 });
    }
    P.flash = 0.05;
    P.flashSide = s;
    Sfx.gun();
  }

  function updatePlayer(dt) {
    const c = readControls();
    if (c.rollAbs !== null) P.roll += (c.rollAbs * 1.3 - P.roll) * Math.min(1, 4.5 * dt);
    else if (c.r) P.roll += c.r * 2.4 * dt;
    else P.roll -= P.roll * Math.min(1, 2.2 * dt);
    firingNow = c.fire;
    P.roll = clamp(P.roll, -1.3, 1.3);
    const cr = Math.cos(P.roll), sr = Math.sin(P.roll);
    P.pitch += c.p * 1.1 * cr * dt;
    if (!c.p) P.pitch -= P.pitch * Math.min(1, 0.3 * dt);
    if (P.speed < 46) P.pitch -= (46 - P.speed) * 0.025 * dt;
    if (P.y > 470) P.pitch -= 1.0 * dt;
    P.pitch = clamp(P.pitch, -1.15, 1.15);
    // bank turns the plane; pulling back while banked tightens the turn
    P.yaw = wrapAngle(P.yaw + (1.0 + 0.75 * c.p) * sr * dt);
    const tgt = 72 - 70 * Math.sin(P.pitch);
    P.speed = clamp(P.speed + (tgt - P.speed) * 0.7 * dt, 36, 140);
    setBasis(P.b, P.yaw, P.pitch, P.roll);
    movePlayer(dt);
    if (P.inv > 0) P.inv -= dt;

    // guns
    P.heat = Math.max(0, P.heat - 0.3 * dt);
    if (P.jammed && P.heat <= 0.3) {
      P.jammed = false;
      notice('GUNS CLEAR');
    }
    if (P.flash > 0) P.flash -= dt;
    P.gunT -= dt;
    if (c.fire && !P.jammed && P.gunT <= 0) {
      firePlayerGun();
      P.gunT = Math.max(P.gunT, -0.02) + 0.085;
      P.heat += 0.042;
      if (P.heat >= 1) {
        P.heat = 1;
        P.jammed = true;
        Sfx.jam();
      }
    }

    // collisions
    const th = terrainHeight(P.x, P.z);
    if (P.y < th + 1.2) {
      killPlayer(th > 0.5 ? 'CRASHED INTO A HILL' : 'CRASHED', false);
      return;
    }
    const o = objectCollide(P.x, P.y, P.z);
    if (o) {
      if (o.kind === 'balloon' || o.kind === 'tank') destroyTarget(o, o.x + Math.round((P.x - o.x) / WORLD) * WORLD, o.kind === 'balloon' ? o.y + o.bob : o.hy, o.z + Math.round((P.z - o.z) / WORLD) * WORLD, false);
      killPlayer('CRASHED', false);
      return;
    }
    if (zeppelin && !zeppelin.falling && zepContains(P.x, P.y, P.z, 2)) {
      killPlayer('RAMMED THE ZEPPELIN', false);
      return;
    }

    // warnings
    const agl = P.y - th;
    warnT -= dt;
    if ((agl < 45 && P.pitch < -0.12) || agl < 18) {
      if (warnT <= 0) {
        Sfx.warn();
        warnT = 0.4;
      }
    }
  }

  function damagePlayer() {
    P.hull--;
    hitFlash = 1;
    shake = Math.max(shake, 0.6);
    Sfx.hurt();
    addCrack();
    if (P.hull <= 0) killPlayer('SHOT DOWN', true);
  }

  function addCrack() {
    const segs = [];
    const n = 5 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      let a = (i / n) * TAU + rand(-0.3, 0.3), x = 0, y = 0;
      const len = rand(22, 65);
      for (let s = 0; s < 3; s++) {
        const nx = x + Math.cos(a) * (len / 3), ny = y + Math.sin(a) * (len / 3);
        segs.push(x, y, nx, ny);
        x = nx;
        y = ny;
        a += rand(-0.5, 0.5);
      }
    }
    cracks.push({ fx: rand(0.15, 0.85), fy: rand(0.22, 0.72), segs });
    if (cracks.length > 8) cracks.shift();
  }

  function killPlayer(cause, spin) {
    if (!P.alive) return;
    P.alive = false;
    P.cause = cause;
    lives--;
    // expire enemy fire (this can run inside the bullet loop, so never mutate the array here)
    for (const bl of bullets) if (bl.owner === 1) bl.life = 0;
    if (spin) {
      state = 'dying';
      P.dieT = 0;
      P.spin = (Math.random() < 0.5 ? -1 : 1) * rand(2.5, 3.5);
      banner(cause, 2.5, 30, C_ACE);
    } else {
      crashPlayer(true);
    }
  }

  function crashPlayer(showBanner) {
    state = 'dead';
    deadT = 3;
    explosion(P.x, P.y, P.z, 2, 1.2);
    for (let i = 0; i < 24; i++) {
      const a = rand(0, TAU), l = rand(1, 3);
      debris.push({ cx: P.x, cy: P.y + 1, cz: P.z, hx: Math.cos(a) * l, hy: rand(-1, 1), hz: Math.sin(a) * l, vx: rand(-25, 25) + P.vx * 0.3, vy: rand(5, 35), vz: rand(-25, 25) + P.vz * 0.3, kx: 0, ky: 1, kz: 0, w: rand(-8, 8), life: rand(2, 3.5), max: 3.5, col: C_WORLD });
    }
    shake = 1.5;
    if (showBanner) banner(P.cause, 2.6, 30, C_ACE);
    // pull the camera back to watch the wreck burn
    const b = P.b;
    const fx = b.fx, fz = b.fz, fl = Math.hypot(fx, fz) || 1;
    P.x -= (fx / fl) * 40;
    P.z -= (fz / fl) * 40;
    P.y = Math.max(P.y, terrainHeight(P.x, P.z)) + 18;
    P.pitch = -0.35;
    P.roll = 0;
    P.speed = 0;
    setBasis(P.b, P.yaw, P.pitch, P.roll);
  }

  function updateDying(dt) {
    P.dieT += dt;
    P.roll += P.spin * dt;
    P.pitch = Math.max(-1.25, P.pitch - 0.8 * dt);
    P.yaw = wrapAngle(P.yaw + P.spin * 0.25 * dt);
    P.speed = Math.min(P.speed + 25 * dt, 130);
    setBasis(P.b, P.yaw, P.pitch, P.roll);
    movePlayer(dt);
    if (Math.random() < dt * 30) puff(P.x + P.b.fx * 6, P.y + P.b.fy * 6, P.z + P.b.fz * 6, 1.6, 1.2);
    if (Math.random() < dt * 20) sparks(P.x + P.b.fx * 5, P.y + P.b.fy * 5, P.z + P.b.fz * 5, 1, 8, C_FIRE, 0.5);
    if (P.y < terrainHeight(P.x, P.z) + 2 || P.dieT > 4.5) crashPlayer(false);
  }

  function afterDeath() {
    if (lives > 0) {
      state = 'playing';
      resetPlayer();
      for (const e of enemies) {
        if (e.falling) continue;
        e.mode = 'attack';
        const d = Math.hypot(e.x - P.x, e.z - P.z);
        if (d < 500) {
          const a = rand(0, TAU);
          e.x = P.x + Math.sin(a) * 900;
          e.z = P.z + Math.cos(a) * 900;
          e.yaw = wrapAngle(a + Math.PI);
        }
      }
      banner('GET READY', 1.6, 28);
      recalibrate();
    } else {
      state = 'gameover';
      overT = 0;
      if (score > hi) {
        hi = score;
        newHi = true;
        store.set('phosphorAce.hi', hi);
      }
      P.y = 185;
      P.pitch = 0;
      P.roll = 0;
      P.speed = 70;
      P.alive = true;
      setBasis(P.b, P.yaw, 0, 0);
      document.body.classList.remove('flying');
      Sfx.gameOver();
    }
  }

  // ---------------------------------------------------------------------
  // Enemies
  // ---------------------------------------------------------------------
  function spawnEnemy(ace) {
    const ang = rand(0, TAU), d = rand(900, 1200);
    const x = P.x + Math.sin(ang) * d, z = P.z + Math.cos(ang) * d;
    const e = {
      ace, x, y: Math.max(rand(120, 260), terrainHeight(x, z) + 60), z,
      yaw: wrapAngle(ang + Math.PI), pitch: 0, roll: 0, b: makeBasis(),
      speed: ace ? 76 : Math.min(58 + wave * 1.5, 72),
      turn: ace ? 1.35 : Math.min(0.85 + wave * 0.04, 1.25),
      hp: ace ? 7 : 3, maxhp: ace ? 7 : 3,
      mode: 'attack', modeT: 0, fireT: rand(1.5, 3), burst: 0, burstT: 0,
      ox: rand(-80, 80), oy: rand(-30, 30), oz: rand(-80, 80),
      extYaw: 0, extPitch: 0, jink: 1, jinkT: 0, jinkP: 0,
      prop: rand(0, TAU), hitT: 0, smokeT: 0, falling: false, spin: 0,
    };
    setBasis(e.b, e.yaw, 0, 0);
    enemies.push(e);
    if (ace && state === 'playing') banner('ENEMY ACE SIGHTED!', 2.5, 22, C_ACE);
    return e;
  }

  function enemyShoot(e, dist) {
    const t = dist / 330;
    let ax = P.x + P.vx * t - e.x, ay = P.y + P.vy * t - e.y, az = P.z + P.vz * t - e.z;
    let l = Math.hypot(ax, ay, az) || 1;
    const sp = e.ace ? 0.012 : Math.max(0.016, 0.034 - wave * 0.004);
    ax = ax / l + (Math.random() - 0.5) * 2 * sp;
    ay = ay / l + (Math.random() - 0.5) * 2 * sp;
    az = az / l + (Math.random() - 0.5) * 2 * sp;
    l = Math.hypot(ax, ay, az);
    ax /= l; ay /= l; az /= l;
    if (bullets.length < 500) {
      bullets.push({ x: e.x + e.b.fx * 4, y: e.y + e.b.fy * 4, z: e.z + e.b.fz * 4, vx: ax * 330, vy: ay * 330, vz: az * 330, dx: ax, dy: ay, dz: az, life: 2, age: 0, owner: 1 });
    }
    Sfx.enemyGun(clamp(1 - dist / 700, 0.1, 1));
  }

  function updateEnemies(dt, demo) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const b = e.b;
      e.prop += dt * 45;
      if (e.hitT > 0) e.hitT -= dt;

      if (e.falling) {
        e.roll += e.spin * dt;
        e.pitch = Math.max(-1.2, e.pitch - 0.55 * dt);
        e.yaw = wrapAngle(e.yaw + e.spin * 0.15 * dt);
        e.speed = Math.min(e.speed + 20 * dt, 110);
        setBasis(b, e.yaw, e.pitch, e.roll);
        e.x += b.fx * e.speed * dt;
        e.y += b.fy * e.speed * dt;
        e.z += b.fz * e.speed * dt;
        e.smokeT -= dt;
        if (e.smokeT <= 0) {
          e.smokeT = 0.035;
          puff(e.x, e.y, e.z, 1.8);
          if (Math.random() < 0.5) sparks(e.x, e.y, e.z, 1, 6, C_FIRE, 0.5);
        }
        if (e.y <= terrainHeight(e.x, e.z) + 1) {
          explosion(e.x, Math.max(e.y, 0.5), e.z, 1.4, 0.9);
          shatter(PLANE, e, b, e.ace ? C_ACE : C_ENEMY, 1, 0, 0, 0, 0.8);
          enemies.splice(i, 1);
        }
        continue;
      }

      const dx = P.x - e.x, dy = P.y - e.y, dz = P.z - e.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const facing = (dx * b.fx + dy * b.fy + dz * b.fz) / dist; // >0: player ahead of this enemy
      const pdot = -(dx * P.b.fx + dy * P.b.fy + dz * P.b.fz) / dist; // >0: enemy ahead of player
      let dYaw = e.yaw, dPitch = 0, haveDir = false, tx = 0, ty = 0, tz = 0;

      if (!P.alive && !demo) e.mode = 'wander';
      switch (e.mode) {
        case 'attack': {
          const lead = Math.min(dist / 320, 1.5);
          const k = Math.min(1, dist / 500);
          tx = P.x + P.vx * lead + e.ox * k - e.x;
          ty = P.y + P.vy * lead + e.oy * k - e.y;
          tz = P.z + P.vz * lead + e.oz * k - e.z;
          haveDir = true;
          if (dist < 60) {
            e.mode = 'extend';
            e.modeT = rand(2, 3.5);
            e.extYaw = wrapAngle(e.yaw + rand(-0.9, 0.9));
            e.extPitch = rand(-0.1, 0.5);
          } else if (pdot > 0.9 && facing < -0.3 && dist < 320 && Math.random() < dt * (e.ace ? 1.5 : 0.7)) {
            e.mode = 'evade';
            e.modeT = rand(1.5, 3);
            e.jinkT = 0;
          }
          break;
        }
        case 'extend':
          dYaw = e.extYaw;
          dPitch = e.extPitch;
          e.modeT -= dt;
          if (e.modeT <= 0) e.mode = 'attack';
          break;
        case 'evade':
          e.jinkT -= dt;
          if (e.jinkT <= 0) {
            e.jink = Math.random() < 0.5 ? -1 : 1;
            e.jinkT = rand(0.5, 1.2);
            e.jinkP = rand(-0.4, 0.6);
          }
          dYaw = e.yaw + e.jink * 1.2;
          dPitch = e.jinkP;
          e.modeT -= dt;
          if (e.modeT <= 0) e.mode = 'attack';
          break;
        default: // wander while the player is down
          dYaw = e.yaw + 0.3;
          dPitch = 0;
          if (P.alive) e.mode = 'attack';
      }
      if (haveDir) {
        dYaw = Math.atan2(tx, tz);
        dPitch = Math.atan2(ty, Math.hypot(tx, tz));
      }
      const floor = terrainHeight(e.x, e.z) + 45;
      if (e.y < floor) dPitch = Math.max(dPitch, 0.5);
      if (e.y > 420) dPitch = Math.min(dPitch, -0.2);
      dPitch = clamp(dPitch, -0.75, 0.75);
      const yawRate = clamp(wrapAngle(dYaw - e.yaw) * 2.5, -e.turn, e.turn);
      e.yaw = wrapAngle(e.yaw + yawRate * dt);
      e.pitch += clamp((dPitch - e.pitch) * 2.5, -1, 1) * dt;
      e.roll += (clamp(yawRate * 1.1, -1.2, 1.2) - e.roll) * Math.min(1, dt * 3);
      setBasis(b, e.yaw, e.pitch, e.roll);
      // open the throttle to catch up when chasing from long range
      const boost = e.mode === 'attack' && dist > 300 && facing > 0.5 ? 1.3 : 1;
      e.x += b.fx * e.speed * boost * dt;
      e.y += b.fy * e.speed * boost * dt;
      e.z += b.fz * e.speed * boost * dt;

      if (e.hp < e.maxhp) {
        e.smokeT -= dt;
        if (e.smokeT <= 0) {
          e.smokeT = 0.04 + 0.12 * (e.hp / e.maxhp);
          puff(e.x, e.y, e.z, 1.2, 1.3);
        }
      }

      // gunnery
      e.fireT -= dt;
      if (!demo && P.alive && state === 'playing' && e.mode === 'attack' && dist < 430 && facing > 0.985 && e.fireT <= 0) {
        e.burst = e.ace ? 8 : 5;
        e.fireT = (e.ace ? 1.3 : 2.2) + Math.random() * 1.5;
        e.burstT = 0;
      }
      if (e.burst > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) {
          if (P.alive) enemyShoot(e, dist);
          e.burst--;
          e.burstT = 0.09;
        }
      }

      if (!demo && P.alive && state === 'playing' && P.inv <= 0 && dist < 7) {
        explodeEnemy(e, i);
        killPlayer('MID-AIR COLLISION', false);
      }
    }
  }

  function explodeEnemy(e, idx) {
    explosion(e.x, e.y, e.z, 1.3, 1);
    shatter(PLANE, e, e.b, e.ace ? C_ACE : C_ENEMY, 1, e.b.fx * e.speed, e.b.fy * e.speed, e.b.fz * e.speed);
    enemies.splice(idx, 1);
  }

  function hitEnemy(e, bl) {
    e.hp--;
    e.hitT = 0.08;
    sparks(bl.x, bl.y, bl.z, 4, 25, C_FIRE, 0.4);
    Sfx.ping();
    if (e.mode === 'attack' && Math.random() < 0.3) {
      e.mode = 'evade';
      e.modeT = rand(1, 2);
      e.jinkT = 0;
    }
    if (e.hp <= 0) {
      const pts = e.ace ? 750 : 200;
      addScore(pts);
      popup(e.x, e.y + 5, e.z, '+' + pts);
      if (e.ace) banner('ACE DOWN!', 2, 26, C_ACE);
      if (Math.random() < 0.45) {
        explodeEnemy(e, enemies.indexOf(e));
      } else {
        e.falling = true;
        e.spin = (Math.random() < 0.5 ? -1 : 1) * rand(2, 4);
        e.smokeT = 0;
        sparks(e.x, e.y, e.z, 14, 30, C_FIRE, 0.8);
        Sfx.boom(0.35);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Zeppelin
  // ---------------------------------------------------------------------
  function spawnZeppelin() {
    const ang = rand(0, TAU), d = 1300;
    const yaw = wrapAngle(ang + Math.PI + rand(-0.6, 0.6));
    zeppelin = { x: P.x + Math.sin(ang) * d, y: rand(230, 300), z: P.z + Math.cos(ang) * d, yaw, pitch: 0, roll: 0, b: makeBasis(), hp: 14, maxhp: 14, speed: 14, fireT: 3, hitT: 0, falling: false };
    setBasis(zeppelin.b, yaw, 0, 0);
    banner('ZEPPELIN SIGHTED!', 2.5, 22, C_FIRE);
  }

  function zepLocal(z, x, y, w) {
    const dx = x - z.x, dy = y - z.y, dz = w - z.z, b = z.b;
    L.x = dx * b.rx + dy * b.ry + dz * b.rz;
    L.y = dx * b.ux + dy * b.uy + dz * b.uz;
    L.z = dx * b.fx + dy * b.fy + dz * b.fz;
  }

  function zepContains(x, y, w, pad) {
    const z = zeppelin;
    zepLocal(z, x, y, w);
    const r = ZEP_R + pad, l = ZEP_L + pad;
    return (L.x * L.x) / (r * r) + (L.y * L.y) / (r * r) + (L.z * L.z) / (l * l) < 1;
  }

  function updateZeppelin(dt) {
    const z = zeppelin;
    if (!z) return;
    if (z.hitT > 0) z.hitT -= dt;
    if (z.falling) {
      z.pitch = Math.max(-0.45, z.pitch - 0.1 * dt);
      z.roll += 0.12 * dt;
      z.speed = 24;
      if (Math.random() < dt * 25) {
        l2w(z, z.b, rand(-6, 6), rand(-6, 6), rand(-38, 38));
        sparks(L.x, L.y, L.z, 2, 10, C_FIRE, 0.7, 6);
        puff(L.x, L.y, L.z, 4, 2.5);
      }
    }
    setBasis(z.b, z.yaw, z.pitch, z.roll);
    z.x += z.b.fx * z.speed * dt;
    z.y += z.b.fy * z.speed * dt;
    z.z += z.b.fz * z.speed * dt;
    if (z.falling) {
      if (z.y < 8) {
        explosion(z.x, 4, z.z, 3, 1.2);
        shatter(ZEP, z, z.b, C_ENEMY, 1, 0, 0, 0, 1.2);
        zeppelin = null;
      }
      return;
    }
    const dx = P.x - z.x, dy = P.y - z.y, dz = P.z - z.z;
    const dist = Math.hypot(dx, dy, dz);
    z.fireT -= dt;
    if (P.alive && state === 'playing' && dist < 320 && z.fireT <= 0) {
      z.fireT = rand(0.25, 0.6);
      l2w(z, z.b, rand(-2, 2), Math.random() < 0.5 ? -ZEP_R - 2 : ZEP_R, rand(-20, 20));
      const sx = L.x, sy = L.y, sz = L.z;
      const t = dist / 300;
      let ax = P.x + P.vx * t - sx + rand(-8, 8), ay = P.y + P.vy * t - sy + rand(-8, 8), az = P.z + P.vz * t - sz + rand(-8, 8);
      const l = Math.hypot(ax, ay, az) || 1;
      ax /= l; ay /= l; az /= l;
      bullets.push({ x: sx, y: sy, z: sz, vx: ax * 300, vy: ay * 300, vz: az * 300, dx: ax, dy: ay, dz: az, life: 1.6, age: 0, owner: 1 });
      Sfx.enemyGun(clamp(1 - dist / 700, 0.1, 1) * 0.7);
    }
    if (Math.hypot(dx, dz) > 3600) zeppelin = null;
  }

  function zepHitTest(bl, ox, oy, oz) {
    if (!zeppelin || zeppelin.falling) return false;
    if (Math.abs(bl.x - zeppelin.x) > 60 || Math.abs(bl.z - zeppelin.z) > 60) return false;
    if (!zepContains(bl.x, bl.y, bl.z, 0.5) && !zepContains((bl.x + ox) / 2, (bl.y + oy) / 2, (bl.z + oz) / 2, 0.5)) return false;
    const z = zeppelin;
    z.hp--;
    z.hitT = 0.08;
    sparks(bl.x, bl.y, bl.z, 4, 20, C_FIRE, 0.5);
    Sfx.ping();
    if (z.hp <= 0) {
      z.falling = true;
      addScore(1500);
      popup(z.x, z.y + 12, z.z, '+1500');
      banner('ZEPPELIN DOWN!', 2.5, 26, C_FIRE);
      explosion(z.x, z.y, z.z, 2, 1);
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // Ground targets (observation balloons + fuel tanks)
  // ---------------------------------------------------------------------
  function destroyTarget(o, wx, wy, wz, scoreIt = true) {
    o.alive = false;
    o.respawn = 45;
    if (scoreIt) {
      addScore(o.pts);
      popup(wx, wy + 8, wz, '+' + o.pts);
    }
    explosion(wx, wy, wz, o.kind === 'tank' ? 1.8 : 1.4, 0.9);
    if (o.kind === 'tank') sparks(wx, wy + 4, wz, 30, 20, C_FIRE, 1.6, 25);
    shatter(o.model, { x: wx, y: o.kind === 'balloon' ? wy : 0, z: wz }, o.b, C_WORLD, o.scale, 0, 0, 0, 1);
  }

  function updateTargets(dt) {
    for (const o of targets) {
      if (o.kind === 'balloon') o.bob = Math.sin(time * 0.7 + o.phase) * 1.5;
      if (!o.alive) {
        o.respawn -= dt;
        if (o.respawn <= 0) {
          o.alive = true;
          o.hp = o.maxhp;
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Bullets
  // ---------------------------------------------------------------------
  function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const fx = ax - cx, fy = ay - cy, fz = az - cz;
    const dd = dx * dx + dy * dy + dz * dz;
    const t = dd > 0 ? clamp(-(fx * dx + fy * dy + fz * dz) / dd, 0, 1) : 0;
    const px = fx + dx * t, py = fy + dy * t, pz = fz + dz * t;
    return px * px + py * py + pz * pz <= r * r;
  }

  function playerBulletHits(ox, oy, oz, bl) {
    for (const e of enemies) {
      if (e.falling) continue;
      if (segSphere(ox, oy, oz, bl.x, bl.y, bl.z, e.x, e.y, e.z, 5.5)) {
        hitEnemy(e, bl);
        return true;
      }
    }
    if (zepHitTest(bl, ox, oy, oz)) return true;
    if (bl.y < 135 && bl.y < terrainHeight(bl.x, bl.z)) {
      dust(bl.x, bl.y, bl.z);
      return true;
    }
    for (const o of targets) {
      if (!o.alive) continue;
      const wx = o.x + Math.round((bl.x - o.x) / WORLD) * WORLD;
      const wz = o.z + Math.round((bl.z - o.z) / WORLD) * WORLD;
      const cy = o.kind === 'balloon' ? o.y + o.bob : o.hy;
      if (segSphere(ox, oy, oz, bl.x, bl.y, bl.z, wx, cy, wz, o.hr)) {
        o.hp--;
        sparks(bl.x, bl.y, bl.z, 4, 20, C_FIRE, 0.4);
        Sfx.ping();
        if (o.hp <= 0) destroyTarget(o, wx, cy, wz);
        return true;
      }
    }
    return false;
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bl = bullets[i];
      const ox = bl.x, oy = bl.y, oz = bl.z;
      bl.x += bl.vx * dt;
      bl.y += bl.vy * dt;
      bl.z += bl.vz * dt;
      bl.life -= dt;
      bl.age += dt;
      let dead = bl.life <= 0;
      if (!dead && bl.y < 0.5) {
        dead = true;
        dust(bl.x, 0.3, bl.z);
      }
      if (!dead) {
        if (bl.owner === 0) {
          dead = playerBulletHits(ox, oy, oz, bl);
        } else if (P.alive && state === 'playing' && P.inv <= 0 && segSphere(ox, oy, oz, bl.x, bl.y, bl.z, P.x, P.y, P.z, 3.2)) {
          dead = true;
          damagePlayer();
        }
      }
      if (dead) {
        bullets[i] = bullets[bullets.length - 1];
        bullets.pop();
      }
    }
  }

  function driftClouds(dt) {
    for (const c of clouds) c.x += 4 * dt;
  }

  // ---------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------
  function update(dt) {
    time += dt;
    if (state === 'title' || state === 'gameover') {
      if (state === 'gameover') overT += dt;
      autopilot(dt);
      let active = 0;
      for (const e of enemies) if (!e.falling) active++;
      if (active < 3 && Math.random() < dt) spawnEnemy(Math.random() < 0.25);
      updateEnemies(dt, true);
      updateZeppelin(dt);
      updateBullets(dt);
      updateTargets(dt);
      updateFx(dt);
      driftClouds(dt);
      Sfx.engine(false, 70, false);
      return;
    }
    if (state === 'playing') updatePlayer(dt);
    else if (state === 'dying') updateDying(dt);
    else if (state === 'dead') {
      deadT -= dt;
      if (deadT <= 0) afterDeath();
    }
    updateEnemies(dt, false);
    updateZeppelin(dt);
    updateBullets(dt);
    updateTargets(dt);
    updateWave(dt);
    updateFx(dt);
    driftClouds(dt);
    Sfx.engine(state === 'playing' || state === 'dying', P.speed, state === 'dying');
  }

  // =====================================================================
  // Rendering
  // =====================================================================
  function drawSky() {
    const D = 5000;
    for (let i = 0; i < MTN_N; i++) {
      const j = (i + 1) % MTN_N;
      const a0 = (i / MTN_N) * TAU, a1 = (j / MTN_N) * TAU;
      const s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1);
      dirCam(s0 * D, 0, c0 * D);
      let x0 = T.x, y0 = T.y, z0 = T.z;
      dirCam(s1 * D, 0, c1 * D);
      seg3(x0, y0, z0, T.x, T.y, T.z, C_WORLD, 0.5);
      const e0 = MTN[i], e1 = MTN[j];
      if (e0 > 0.002 || e1 > 0.002) {
        dirCam(s0 * Math.cos(e0) * D, Math.sin(e0) * D, c0 * Math.cos(e0) * D);
        x0 = T.x; y0 = T.y; z0 = T.z;
        dirCam(s1 * Math.cos(e1) * D, Math.sin(e1) * D, c1 * Math.cos(e1) * D);
        seg3(x0, y0, z0, T.x, T.y, T.z, C_WORLD, 0.62);
      }
    }
  }

  function drawGroundDots() {
    const SP = 70, R = 11, maxD = R * SP;
    const gx0 = Math.floor(cam.x / SP), gz0 = Math.floor(cam.z / SP);
    const minS = 1.6 * U, maxS = 3.6 * U;
    for (let i = -R; i <= R; i++) {
      for (let j = -R; j <= R; j++) {
        const ix = gx0 + i, iz = gz0 + j;
        const h = hash2(ix, iz);
        if (h < 0.18) continue;
        const wx = (ix + 0.5) * SP + (h - 0.5) * SP * 0.8;
        const wz = (iz + 0.5) * SP + (hash2(iz + 17, ix - 5) - 0.5) * SP * 0.8;
        const dx = wx - cam.x, dz = wz - cam.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > maxD) continue;
        toCam(wx, 0, wz);
        if (T.z < 2 || !projT()) continue;
        dot2(S.x, S.y, clamp((F * 0.6) / T.z, minS, maxS), C_WORLD, 0.85 * (1 - d / maxD) + 0.1);
      }
    }
  }

  function drawGround() {
    const R2 = 1150 * 1150;
    for (const s of groundSegs) {
      const ox = Math.round((cam.x - s.mx) / WORLD) * WORLD;
      const oz = Math.round((cam.z - s.mz) / WORLD) * WORLD;
      const dx = s.mx + ox - cam.x, dz = s.mz + oz - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      const d = Math.sqrt(d2 + cam.y * cam.y);
      const k = s.i * fade(d * 1.25);
      if (k < 0.05) continue;
      wseg(s.ax + ox, 0, s.az + oz, s.bx + ox, 0, s.bz + oz, C_WORLD, k);
    }
    for (const hl of hills) {
      const x = hl.x + Math.round((cam.x - hl.x) / WORLD) * WORLD;
      const z = hl.z + Math.round((cam.z - hl.z) / WORLD) * WORLD;
      const d = Math.hypot(x - cam.x, cam.y, z - cam.z);
      const k = fade(d - Math.max(hl.sx, hl.sz));
      if (k > 0.04) drawModel(hl.model, x, 0, z, IDB, C_WORLD, k * 0.9);
    }
    for (const o of objects) {
      const x = o.x + Math.round((cam.x - o.x) / WORLD) * WORLD;
      const z = o.z + Math.round((cam.z - o.z) / WORLD) * WORLD;
      const y = o.kind === 'balloon' ? o.y + o.bob : 0;
      const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      const k = fade(d);
      if (k < 0.04) continue;
      if (o.alive) {
        const tgt = o.kind === 'balloon' || o.kind === 'tank';
        drawModel(o.model, x, y, z, o.b, C_WORLD, k * (tgt ? 1 : 0.8), o.scale);
        if (o.kind === 'balloon') wseg(x, y - 8.2, z, x, 0, z, C_WORLD, k * 0.35);
      } else if (o.kind === 'tank') {
        for (let n = 0; n < 8; n++) {
          const a0 = (n / 8) * TAU, a1 = ((n + 1) / 8) * TAU;
          wseg(x + Math.cos(a0) * 8, 0, z + Math.sin(a0) * 8, x + Math.cos(a1) * 8, 0, z + Math.sin(a1) * 8, C_SMOKE, k * 0.5);
        }
      }
    }
  }

  function drawClouds() {
    for (const c of clouds) {
      const x = c.x + Math.round((cam.x - c.x) / WORLD) * WORLD;
      const z = c.z + Math.round((cam.z - c.z) / WORLD) * WORLD;
      const d = Math.hypot(x - cam.x, c.y - cam.y, z - cam.z);
      const k = fade(d - 60);
      if (k > 0.04) drawModel(c.model, x, c.y, z, IDB, C_SMOKE, k * 0.55);
    }
  }

  function drawPlane(e) {
    const d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z);
    if (d > 3200) return;
    const col = e.hitT > 0 ? C_FIRE : e.ace ? C_ACE : C_ENEMY;
    const k = Math.max(0.35, fade(d));
    drawModel(PLANE, e.x, e.y, e.z, e.b, col, k);
    if (d < 600) {
      const a = e.prop;
      l2w(e, e.b, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 3.15);
      const x0 = L.x, y0 = L.y, z0 = L.z;
      l2w(e, e.b, -Math.cos(a) * 1.5, -Math.sin(a) * 1.5, 3.15);
      wseg(x0, y0, z0, L.x, L.y, L.z, col, k * 0.6);
    }
  }

  function drawActors() {
    for (const e of enemies) drawPlane(e);
    if (zeppelin) {
      const z = zeppelin;
      const d = Math.hypot(z.x - cam.x, z.y - cam.y, z.z - cam.z);
      drawModel(ZEP, z.x, z.y, z.z, z.b, z.hitT > 0 ? C_FIRE : C_ENEMY, Math.max(0.35, fade(d - 40)));
    }
    for (const bl of bullets) {
      const len = Math.min(bl.owner === 0 ? 9 : 7, bl.age * 480);
      wseg(bl.x, bl.y, bl.z, bl.x - bl.dx * len, bl.y - bl.dy * len, bl.z - bl.dz * len, bl.owner === 0 ? C_TRACER : C_ETRACER, 1);
    }
    for (const d of debris) {
      const k = Math.min(1, (d.life / d.max) * 1.6);
      wseg(d.cx - d.hx, d.cy - d.hy, d.cz - d.hz, d.cx + d.hx, d.cy + d.hy, d.cz + d.hz, d.col, k);
    }
    for (const p of parts) {
      toCam(p.x, p.y, p.z);
      if (T.z < 1 || !projT(50 * U)) continue;
      const k = p.life / p.max;
      if (p.t === 0) {
        dot2(S.x, S.y, clamp((F * 0.6) / T.z, 1.6 * U, 5 * U), p.col, Math.min(1, k * 1.4));
      } else if (p.t === 1) {
        const r = Math.min((p.size * (1 + (1 - k) * 1.5) * F) / T.z, 220 * U);
        if (r > 0.8) circle(S.x, S.y, r, C_SMOKE, 0.5 * k, 6);
      } else {
        const r = Math.min((p.size * (1 + (1 - k) * 6) * F) / T.z, 600 * U);
        circle(S.x, S.y, r, C_FIRE, k * 0.9, 18);
      }
    }
    for (const p of popups) {
      toCam(p.x, p.y, p.z);
      if (!projT()) continue;
      text(p.text, S.x, S.y, 13 * U, C_TRACER, Math.min(1, p.life), 'center');
    }
  }

  function renderWorld() {
    cam.x = P.x;
    cam.y = P.y;
    cam.z = P.z;
    cam.b = P.b;
    drawSky();
    drawClouds();
    drawGroundDots();
    drawGround();
    drawActors();
  }

  // ---------------------------------------------------------------------
  // Cockpit (drawn immediately so it occludes the world behind it)
  // ---------------------------------------------------------------------
  function gunAt(s, z) {
    return { x: CX + ((0.42 * s) / z) * F, y: CY + (0.78 / z) * F, w: (0.085 / z) * F };
  }

  function drawCockpit() {
    const green = COLORS[C_WORLD], hud = COLORS[C_HUD];
    ctx.save();
    ctx.lineWidth = lineW;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const fillStroke = (color, alpha) => {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    // interplane struts at the edges of the view
    const wy = 56 * U;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(CX + s * W * 0.44, wy - 2);
      ctx.lineTo(CX + s * W * 0.455, wy - 2);
      ctx.lineTo(CX + s * W * 0.555, H + 2);
      ctx.lineTo(CX + s * W * 0.535, H + 2);
      ctx.closePath();
      fillStroke(green, 0.5);
    }

    // upper wing with centre cut-out
    const cut = 120 * U, cutTop = 18 * U;
    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.lineTo(W + 5, -5);
    ctx.lineTo(W + 5, wy);
    ctx.lineTo(CX + cut, wy);
    ctx.quadraticCurveTo(CX, 2 * cutTop - wy, CX - cut, wy);
    ctx.lineTo(-5, wy);
    ctx.closePath();
    fillStroke(green, 0.75);
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let x = 40 * U; x < W; x += 80 * U) {
      if (Math.abs(x - CX) < cut + 12 * U) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, wy - 3 * U);
    }
    ctx.stroke();

    // fuselage hump / cowling
    ctx.beginPath();
    ctx.moveTo(CX - W * 0.3, H + 4);
    ctx.quadraticCurveTo(CX, H - 150 * U, CX + W * 0.3, H + 4);
    ctx.closePath();
    fillStroke(green, 0.6);
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.moveTo(CX - W * 0.22, H + 4);
    ctx.quadraticCurveTo(CX, H - 105 * U, CX + W * 0.22, H + 4);
    ctx.stroke();

    // twin machine guns
    for (const s of [-1, 1]) {
      const t = gunAt(s, 3.2), b = gunAt(s, 1.2);
      ctx.beginPath();
      ctx.moveTo(t.x - t.w, t.y);
      ctx.lineTo(t.x + t.w, t.y);
      ctx.lineTo(b.x + b.w, b.y);
      ctx.lineTo(b.x - b.w, b.y);
      ctx.closePath();
      fillStroke(hud, 0.85);
      // cooling-jacket slots
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const g = gunAt(s, 3.0 - k * 0.17);
        ctx.moveTo(g.x - g.w * 0.45, g.y);
        ctx.lineTo(g.x + g.w * 0.45, g.y);
      }
      ctx.stroke();
      // muzzle
      ctx.beginPath();
      ctx.rect(t.x - t.w * 1.35, t.y - 5 * U, t.w * 2.7, 6 * U);
      fillStroke(hud, 0.9);
      // muzzle flash
      if (P.flash > 0 && P.flashSide === s) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COLORS[C_FIRE];
        ctx.beginPath();
        for (let r = 0; r < 7; r++) {
          const a = -Math.PI / 2 + (r - 3) * 0.38 + rand(-0.1, 0.1);
          const len = rand(14, 34) * U;
          ctx.moveTo(t.x, t.y - 5 * U);
          ctx.lineTo(t.x + Math.cos(a) * len, t.y - 5 * U + Math.sin(a) * len);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------
  function planeIcon(x, y, s, col, inten) {
    line2(x - s, y, x + s, y, col, inten);
    line2(x, y - s * 0.6, x, y + s, col, inten);
    line2(x - s * 0.4, y + s * 0.9, x + s * 0.4, y + s * 0.9, col, inten);
  }

  function drawRadar() {
    const rx = 95 * U, ry = H - 95 * U, rr = 72 * U, range = 1600;
    circle(rx, ry, rr, C_HUD, 0.6, 40);
    circle(rx, ry, rr * 0.5, C_HUD, 0.22, 32);
    line2(rx - rr, ry, rx + rr, ry, C_HUD, 0.14);
    line2(rx, ry - rr, rx, ry + rr, C_HUD, 0.14);
    const sa = time * 2.2;
    line2(rx, ry, rx + Math.cos(sa) * rr, ry + Math.sin(sa) * rr, C_HUD, 0.35);
    line2(rx, ry - 6 * U, rx - 4 * U, ry + 4 * U, C_HUD, 0.9);
    line2(rx, ry - 6 * U, rx + 4 * U, ry + 4 * U, C_HUD, 0.9);
    text('SCOPE', rx, ry - rr - 16 * U, 10 * U, C_HUD, 0.5, 'center');
    const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
    const blip = (dx, dz, col, inten, s, wide) => {
      let px = ((dx * cy - dz * sy) / range) * rr;
      let pz = ((dx * sy + dz * cy) / range) * rr;
      const d = Math.hypot(px, pz), lim = rr - 4 * U;
      if (d > lim) {
        px *= lim / d;
        pz *= lim / d;
        inten *= 0.55;
      }
      const x = rx + px, y = ry - pz;
      if (wide) {
        line2(x - s * 2, y, x + s * 2, y, col, inten);
        line2(x - s * 2, y - s * 0.6, x + s * 2, y - s * 0.6, col, inten);
      } else {
        line2(x - s, y, x + s, y, col, inten);
        line2(x, y - s, x, y + s, col, inten);
      }
    };
    for (const o of targets) {
      if (!o.alive) continue;
      const dx = wrapW(o.x - P.x), dz = wrapW(o.z - P.z);
      if (dx * dx + dz * dz < range * range) blip(dx, dz, C_WORLD, 0.45, 1.5 * U, false);
    }
    if (zeppelin) blip(zeppelin.x - P.x, zeppelin.z - P.z, C_FIRE, 0.9, 3 * U, true);
    for (const e of enemies) if (!e.falling) blip(e.x - P.x, e.z - P.z, e.ace ? C_ACE : C_ENEMY, 1, 3.5 * U, false);
  }

  function drawTargetMarkers() {
    const list = enemies.filter((e) => !e.falling);
    if (zeppelin && !zeppelin.falling) list.push(zeppelin);
    for (const e of list) {
      const isZep = e === zeppelin;
      toCam(e.x, e.y, e.z);
      const cx = T.x, cy = T.y, cz = T.z;
      const d = Math.hypot(cx, cy, cz);
      const col = isZep ? C_FIRE : e.ace ? C_ACE : C_ENEMY;
      let on = false;
      if (cz > 1) {
        projT();
        on = S.x > 40 * U && S.x < W - 40 * U && S.y > 70 * U && S.y < H - 40 * U;
      }
      if (on) {
        if (d > 200) {
          const s = (isZep ? 22 : 12) * U, c = 5 * U, x = S.x, y = S.y;
          line2(x - s, y - s, x - s + c, y - s, col, 0.7); line2(x - s, y - s, x - s, y - s + c, col, 0.7);
          line2(x + s, y - s, x + s - c, y - s, col, 0.7); line2(x + s, y - s, x + s, y - s + c, col, 0.7);
          line2(x - s, y + s, x - s + c, y + s, col, 0.7); line2(x - s, y + s, x - s, y + s - c, col, 0.7);
          line2(x + s, y + s, x + s - c, y + s, col, 0.7); line2(x + s, y + s, x + s, y + s - c, col, 0.7);
          if (e.ace) text('ACE', x, y - s - 13 * U, 9 * U, C_ACE, 0.8, 'center');
        }
      } else {
        let ax = cx, ay = -cy;
        if (Math.hypot(ax, ay) < 1e-3) ay = 1;
        const a = Math.atan2(ay, ax);
        const ex = CX + Math.cos(a) * W * 0.4, ey = CY + Math.sin(a) * H * 0.36;
        const s = 13 * U;
        const tx = ex + Math.cos(a) * s, ty = ey + Math.sin(a) * s;
        line2(tx, ty, ex + Math.cos(a + 2.4) * s * 0.7, ey + Math.sin(a + 2.4) * s * 0.7, col, 0.85);
        line2(tx, ty, ex + Math.cos(a - 2.4) * s * 0.7, ey + Math.sin(a - 2.4) * s * 0.7, col, 0.85);
      }
    }
  }

  function drawPlayHUD() {
    const ts = 14 * U;
    text('SCORE ' + zpad(score), 22 * U, 12 * U, ts, C_HUD, 1);
    text('WAVE ' + wave, 22 * U, 33 * U, ts, C_HUD, 0.75);
    text('HIGH ' + zpad(Math.max(hi, score)), W - 22 * U, 12 * U, ts, C_HUD, 0.75, 'right');
    for (let i = 0; i < Math.min(lives, 8); i++) planeIcon(W - 34 * U - i * 30 * U, 40 * U, 10 * U, C_HUD, 0.85);

    // ring-and-bead sight
    const sr = 36 * U;
    circle(CX, CY, sr, C_HUD, 0.5, 36);
    circle(CX, CY, 2.5 * U, C_HUD, 0.8, 8);
    line2(CX - sr - 12 * U, CY, CX - sr - 2 * U, CY, C_HUD, 0.6);
    line2(CX + sr + 2 * U, CY, CX + sr + 12 * U, CY, C_HUD, 0.6);
    line2(CX, CY - sr - 12 * U, CX, CY - sr - 2 * U, C_HUD, 0.6);

    if (state === 'playing') drawTargetMarkers();
    drawRadar();

    // gauges
    const gx = W - 250 * U, gy = H - 112 * U, ls = 12 * U;
    text('ALT  ' + zpad(P.y, 4), gx, gy, ls, C_HUD, 0.85);
    text('SPD  ' + zpad(P.speed * 1.6, 3), gx + 130 * U, gy, ls, C_HUD, 0.85);
    text('HEAT', gx, gy + 30 * U, ls, P.jammed ? C_ACE : C_HUD, 0.85);
    bar(gx + 62 * U, gy + 28 * U, 160 * U, 16 * U, P.heat, P.jammed || P.heat > 0.8 ? C_ACE : C_HUD, 0.9);
    text('HULL', gx, gy + 60 * U, ls, P.hull <= 2 ? C_ACE : C_HUD, 0.85);
    bar(gx + 62 * U, gy + 58 * U, 160 * U, 16 * U, P.hull / MAX_HULL, P.hull <= 2 ? C_ACE : C_HUD, 0.9);

    // windscreen cracks
    for (const c of cracks) {
      const x = c.fx * W, y = c.fy * H, sg = c.segs;
      for (let i = 0; i < sg.length; i += 4) line2(x + sg[i] * U, y + sg[i + 1] * U, x + sg[i + 2] * U, y + sg[i + 3] * U, C_ENEMY, 0.5);
      circle(x, y, 4 * U, C_ENEMY, 0.6, 8);
    }

    if (hitFlash > 0) {
      const m = 8 * U;
      rect(m, m, W - 2 * m, H - 2 * m, C_ACE, hitFlash);
      rect(m * 2, m * 2, W - 4 * m, H - 4 * m, C_ACE, hitFlash * 0.5);
    }

    if (state === 'playing') {
      const blink = Math.floor(time * 4) % 2 === 0;
      const agl = P.y - terrainHeight(P.x, P.z);
      if (((agl < 45 && P.pitch < -0.12) || agl < 18) && blink) text('PULL UP!', CX, CY - 90 * U, 24 * U, C_ACE, 1, 'center');
      if (P.jammed && blink) text('GUNS JAMMED', CX, CY + 62 * U, 16 * U, C_ACE, 1, 'center');
      else if (P.heat > 0.8 && blink) text('GUNS HOT', CX, CY + 62 * U, 14 * U, C_FIRE, 0.9, 'center');
      if (P.speed < 44 && blink) text('STALL', CX, CY + 86 * U, 16 * U, C_FIRE, 1, 'center');
      if (P.y > 455 && blink) text('CEILING', CX, CY - 90 * U, 16 * U, C_FIRE, 1, 'center');
    }
    if (touch.active) drawTouchControls();
  }

  function drawTouchControls() {
    const firing = state === 'playing' && firingNow;
    const fx = W - 120 * U, fy = H - 255 * U, fr = 56 * U;
    const col = firing ? C_FIRE : C_HUD;
    circle(fx, fy, fr, col, firing ? 0.95 : 0.45, 36);
    circle(fx, fy, fr * 0.7, col, firing ? 0.6 : 0.2, 28);
    text('FIRE', fx, fy - 7 * U, 14 * U, col, firing ? 1 : 0.6, 'center');
    if (touch.mode === 'stick') {
      const R = STICK_R * U;
      if (touch.stickId !== null) {
        let dx = touch.stickX - touch.stickOX, dy = touch.stickY - touch.stickOY;
        const l = Math.hypot(dx, dy);
        if (l > R) {
          dx *= R / l;
          dy *= R / l;
        }
        circle(touch.stickOX, touch.stickOY, R, C_HUD, 0.4, 32);
        circle(touch.stickOX + dx, touch.stickOY + dy, 22 * U, C_HUD, 0.85, 20);
      } else {
        const hx = 180 * U, hy = H - 280 * U;
        circle(hx, hy, R, C_HUD, 0.14, 32);
        text('DRAG TO FLY', hx, hy - 6 * U, 11 * U, C_HUD, 0.3, 'center');
      }
    } else if (state === 'playing') {
      if (!tilt.ok) {
        const msg = tilt.state === 'requesting' ? 'ALLOW MOTION ACCESS TO TILT' : 'WAITING FOR TILT SENSOR';
        text(msg, CX, CY + 110 * U, fitSize(msg, 14 * U), C_HUD, 0.8, 'center');
      } else if (tilt.calibT > 0) {
        text('HOLD STEADY', CX, CY + 110 * U, 16 * U, C_HUD, 0.9, 'center');
      }
    }
  }

  function drawButtons() {
    for (const b of uiButtons()) {
      if (b.kind === 'pause') {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        rect(b.x, b.y, b.w, b.h, C_HUD, 0.45);
        line2(cx - 6 * U, cy - 9 * U, cx - 6 * U, cy + 9 * U, C_HUD, 0.85);
        line2(cx + 6 * U, cy - 9 * U, cx + 6 * U, cy + 9 * U, C_HUD, 0.85);
      } else {
        rect(b.x, b.y, b.w, b.h, C_HUD, 0.6);
        const ts = Math.min(13 * U, (b.w - 16 * U) / b.label.length);
        text(b.label, b.x + b.w / 2, b.y + b.h / 2 - ts / 2, ts, C_HUD, 0.95, 'center');
      }
    }
  }

  function drawTitle() {
    // spinning showcase biplane
    const saved = { x: cam.x, y: cam.y, z: cam.z, b: cam.b, ox: cam.ox, oy: cam.oy };
    cam.x = cam.y = cam.z = 0;
    cam.ox = cam.oy = 0;
    cam.b = IDB;
    const tb = setBasis(titleBasis, time * 0.7, 0.25 * Math.sin(time * 0.5), 0.3 * Math.sin(time * 0.9));
    const z = 26, y = ((CY - H * 0.2) / F) * z;
    drawModel(PLANE, 0, y, z, tb, C_ENEMY, 0.95);
    const a = time * 40, o = { x: 0, y, z };
    l2w(o, tb, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 3.15);
    const x0 = L.x, y0 = L.y, z0 = L.z;
    l2w(o, tb, -Math.cos(a) * 1.5, -Math.sin(a) * 1.5, 3.15);
    wseg(x0, y0, z0, L.x, L.y, L.z, C_ENEMY, 0.6);
    Object.assign(cam, saved);

    const title = 'PHOSPHOR ACE';
    const ts = fitSize(title, 64 * U);
    text(title, CX, H * 0.4, ts, C_WORLD, 1, 'center');
    const sub = 'A VECTOR DOGFIGHT OVER THE WESTERN FRONT - 1917';
    text(sub, CX, H * 0.4 + ts * 1.45, fitSize(sub, 13 * U), C_HUD, 0.7, 'center');
    const press = touch.active ? 'TAP TO TAKE OFF' : 'PRESS SPACE TO TAKE OFF';
    if (Math.floor(time * 2) % 2 === 0) text(press, CX, H * 0.62, fitSize(press, 20 * U), C_HUD, 1, 'center');
    const scoring = 'PLANES 200   ACES 750   BALLOONS 300   FUEL 150   ZEPPELIN 1500';
    let lines;
    if (!touch.active) {
      lines = [
        'ARROWS / WASD  FLY          SPACE  FIRE',
        'P  PAUSE     M  SOUND     I  INVERT PITCH (' + (invert ? 'ON' : 'OFF') + ')',
        scoring,
        'WATCH YOUR GUN HEAT - OVERHEATED GUNS JAM',
      ];
    } else if (touch.mode === 'tilt') {
      lines = [
        'TILT TO FLY: TIP SIDEWAYS TO BANK, TOP EDGE ' + (invert ? 'AWAY FROM YOU' : 'TOWARD YOU') + ' TO CLIMB',
        'HOLD A FINGER ANYWHERE ON THE SCREEN TO FIRE',
        'THE ANGLE YOU HOLD IT AT WHEN YOU TAKE OFF BECOMES LEVEL',
      ];
    } else {
      lines = ['DRAG ON THE LEFT SIDE TO FLY', 'HOLD THE RIGHT SIDE TO FIRE', scoring];
    }
    if (touch.active && H > W) lines.push('TURN SIDEWAYS FOR A WIDER VIEW');
    lines.forEach((l, i) => text(l, CX, H * 0.71 + i * 24 * U, fitSize(l, 12 * U), C_HUD, l === scoring ? 0.5 : 0.75, 'center'));
    text('HIGH SCORE ' + zpad(hi), CX, H - 46 * U, 14 * U, C_TRACER, 0.85, 'center');
  }
  const titleBasis = makeBasis();

  function drawGameOver() {
    text('GAME OVER', CX, H * 0.34, fitSize('GAME OVER', 56 * U), C_ACE, 1, 'center');
    text('FINAL SCORE ' + zpad(score), CX, H * 0.34 + 86 * U, 20 * U, C_HUD, 1, 'center');
    text('REACHED WAVE ' + wave, CX, H * 0.34 + 118 * U, 14 * U, C_HUD, 0.7, 'center');
    if (newHi && Math.floor(time * 3) % 2 === 0) text('NEW HIGH SCORE!', CX, H * 0.34 + 152 * U, 20 * U, C_TRACER, 1, 'center');
    const again = touch.active ? 'TAP TO FLY AGAIN' : 'PRESS SPACE TO FLY AGAIN';
    if (overT > 1.2 && Math.floor(time * 2) % 2 === 0) text(again, CX, H * 0.68, fitSize(again, 18 * U), C_HUD, 1, 'center');
  }

  function drawBanners() {
    let y = H * 0.24;
    for (const b of banners) {
      const a = Math.min(1, b.t / 0.4, (b.dur - b.t) / 0.15 + 0.2);
      const s = fitSize(b.text, b.size * U);
      text(b.text, CX, y, s, b.col, a, 'center');
      y += s * 1.7;
    }
  }

  function drawOverlay() {
    if (state === 'playing' || state === 'dying') {
      if (paused) dimMul = 0.35; // keep the pause menu readable
      drawPlayHUD();
      dimMul = 1;
    } else if (state === 'dead') {
      text('SCORE ' + zpad(score), 22 * U, 12 * U, 14 * U, C_HUD, 1);
      text(lives > 0 ? 'PLANES LEFT ' + lives : 'NO PLANES LEFT', CX, H * 0.62, 16 * U, C_HUD, 0.8, 'center');
    } else if (state === 'title') drawTitle();
    else if (state === 'gameover') drawGameOver();
    if (state !== 'title' && !paused) drawBanners();
    if (paused) {
      text('PAUSED', CX, H * 0.24, 40 * U, C_HUD, 1, 'center');
      const hint = touch.active ? 'TAP RESUME, OR ANYWHERE ELSE' : 'PRESS P TO RESUME';
      text(hint, CX, H * 0.24 + 60 * U, fitSize(hint, 14 * U), C_HUD, 0.7, 'center');
    }
    drawButtons();
    if (noticeT > 0) text(noticeText, CX, H - 34 * U, fitSize(noticeText, 13 * U), C_TRACER, Math.min(1, noticeT), 'center');
  }

  function render() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    dimMul = state === 'title' || state === 'gameover' ? 0.5 : paused ? 0.4 : 1;
    renderWorld();
    flush();
    dimMul = 1;
    if (state === 'playing' || state === 'dying') drawCockpit();
    drawOverlay();
    flush();
    bloom();
  }

  // =====================================================================
  // Main loop
  // =====================================================================
  let last = performance.now(), errorLogged = false, perfT = 0, perfN = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    last = now;
    let dt = raw;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    // on slow devices (older iPads) drop render resolution a step; never raised again
    if (raw > 0 && raw < 0.1 && document.visibilityState === 'visible' && dprCap > 1 && (window.devicePixelRatio || 1) > 1) {
      perfT += raw;
      perfN++;
      if (perfT > 3) {
        if (perfT / perfN > 0.026) {
          dprCap = Math.max(1, dprCap - 0.5);
          resize();
        }
        perfT = perfN = 0;
      }
    }
    try {
      pollGamepad();
      updateTilt(dt);
      if (!paused) update(dt);
      else Sfx.engine(false, 0, false);
      render();
    } catch (err) {
      if (!errorLogged) console.error(err);
      errorLogged = true;
    }
  }
  requestAnimationFrame(frame);

  // small hook for debugging from the console
  window.__phosphorAce = {
    get state() {
      return state;
    },
    P, enemies, bullets, targets, startGame, touch, tilt, tiltMath, screenAngle, readControls,
    get dprCap() {
      return dprCap;
    },
    get score() {
      return score;
    },
    get paused() {
      return paused;
    },
    get wave() {
      return wave;
    },
    get zeppelin() {
      return zeppelin;
    },
  };
})();
