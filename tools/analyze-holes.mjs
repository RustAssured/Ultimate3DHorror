// analyze-holes.mjs — detect open boundary loops (holes) in monster2.glb so the
// eye + tentacle sockets can be located EXACTLY, no markers needed. Vertices are
// welded by position first (GLTF splits verts at UV seams), then boundary edges
// (used by exactly one triangle) are grouped into loops; each loop's centroid,
// axis (Newell normal) and radius are reported in body-root-local space.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
function serve(port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lab.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    s.listen(port, () => resolve(s));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const PORT = 8195;
  const server = await serve(PORT);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(() => { window.LAB_MONSTER_MODEL = '/assets/models/monster2.glb'; });
  await page.goto(`http://localhost:${PORT}/lab.html`, { waitUntil: 'load' });
  await sleep(2600);

  const loops = await page.evaluate(() => {
    const l = window.__lab;
    const root = l.meshyBody;
    let mesh = null; root.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    root.updateMatrixWorld(true);
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index ? g.index.array : null;
    const nTri = idx ? idx.length / 3 : pos.count / 3;
    const V = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];

    // weld by quantized position
    const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;
    const remap = new Int32Array(pos.count);
    const welded = []; const map = new Map();
    for (let i = 0; i < pos.count; i++) {
      const p = V(i); const k = key(p);
      let w = map.get(k);
      if (w === undefined) { w = welded.length; map.set(k, w); welded.push(p); }
      remap[i] = w;
    }
    const tri = (t) => {
      if (idx) return [remap[idx[t * 3]], remap[idx[t * 3 + 1]], remap[idx[t * 3 + 2]]];
      return [remap[t * 3], remap[t * 3 + 1], remap[t * 3 + 2]];
    };
    // count edges
    const ecount = new Map(); const ekey = (a, b) => a < b ? a + '_' + b : b + '_' + a;
    for (let t = 0; t < nTri; t++) {
      const [a, b, c] = tri(t);
      for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = ekey(x, y); ecount.set(k, (ecount.get(k) || 0) + 1); }
    }
    // boundary edges (count 1) -> adjacency
    const adj = new Map();
    for (const [k, c] of ecount) if (c === 1) {
      const [a, b] = k.split('_').map(Number);
      (adj.get(a) || adj.set(a, []).get(a)).push(b);
      (adj.get(b) || adj.set(b, []).get(b)).push(a);
    }
    // group into loops (connected components)
    const seen = new Set(); const loops = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const stack = [start]; const comp = [];
      while (stack.length) { const v = stack.pop(); if (seen.has(v)) continue; seen.add(v); comp.push(v); for (const n of adj.get(v) || []) if (!seen.has(n)) stack.push(n); }
      if (comp.length < 3) continue;
      // centroid + radius + Newell normal, transformed to root-local
      const THREE = l.camera.position.constructor;
      const toLocal = (p) => { const v = new (l.camera.position.constructor)(p[0], p[1], p[2]); mesh.localToWorld(v); root.worldToLocal(v); return v; };
      const pts = comp.map((w) => toLocal(welded[w]));
      const cen = pts.reduce((a, v) => a.add(v), new (l.camera.position.constructor)()).multiplyScalar(1 / pts.length);
      let radius = 0; for (const v of pts) radius = Math.max(radius, v.distanceTo(cen));
      // Newell normal
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y); }
      const nl = Math.hypot(nx, ny, nz) || 1; let nrm = [nx / nl, ny / nl, nz / nl];
      // orient away from body centre (approx 0,1.7,0)
      const dir = [cen.x - 0, cen.y - 1.7, cen.z - 0];
      if (nrm[0] * dir[0] + nrm[1] * dir[1] + nrm[2] * dir[2] < 0) nrm = nrm.map((n) => -n);
      loops.push({ n: comp.length, c: [+cen.x.toFixed(3), +cen.y.toFixed(3), +cen.z.toFixed(3)], r: +radius.toFixed(3), dir: nrm.map((n) => +n.toFixed(3)) });
    }
    const big = loops.filter((L) => L.r > 0.08).sort((a, b) => b.r - a.r);
    return { welded: welded.length, verts: pos.count, loopCount: loops.length, bigCount: big.length, big };
  });

  console.log(JSON.stringify(loops, null, 1));
  await browser.close(); server.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
