// meshy-view.mjs — load the committed Meshy monster.glb in the Lab, inspect its
// geometry, toggle BODY:MESHY, and screenshot it from a few angles.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };

function serve(port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lab.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(port, () => resolve(s));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const PORT = 8165;
  const server = await serve(PORT);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });

  await page.addInitScript(() => { window.LAB_MONSTER_MODEL = '/assets/models/monster.glb'; });
  await page.goto(`http://localhost:${PORT}/lab.html`, { waitUntil: 'load' });
  await sleep(2500); // allow the 10MB GLB to load + parse

  const stats = await page.evaluate(() => {
    const l = window.__lab;
    if (!l || !l.meshyBody) return { loaded: false };
    const THREE = l.camera.position.constructor;
    let meshes = 0, verts = 0, mats = new Set();
    l.meshyBody.traverse((o) => { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; if (o.material) mats.add(o.material.uuid); o.geometry.computeBoundingBox && o.geometry.computeBoundingBox(); } });
    // bbox of whole body
    const box = new (l.meshyBody.constructor); // placeholder
    return { loaded: true, meshes, verts, materials: mats.size };
  });
  console.log('MESHY STATS:', JSON.stringify(stats));

  // switch to monster subject + toggle Meshy body on, frame it
  await page.evaluate(() => {
    const l = window.__lab;
    l._show('monster');
    l.useMeshy = true; l._applyMeshy();
    l.autoRotate = false; l.yaw = 0; l.materialize = 1; l.menace = 0.6;
    l.camYaw = 0.0; l.camPitch = 0.05; l.camDist = 8; l.target.set(0, 2.0, 0);
  });
  await sleep(800);
  await shot('meshy-front');
  await page.evaluate(() => { const l = window.__lab; l.camYaw = 0.9; l.camPitch = 0.2; });
  await sleep(600);
  await shot('meshy-3q');
  await page.evaluate(() => { const l = window.__lab; l.wire = true; l._applyWire(); });
  await sleep(400);
  await shot('meshy-wire');

  await browser.close(); server.close();
  console.log('=== ERRORS (' + errors.length + ') ===');
  for (const e of errors.slice(0, 20)) console.log(e);
  console.log(errors.length === 0 && stats.loaded ? '\nMESHY OK' : '\nMESHY ISSUE');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
