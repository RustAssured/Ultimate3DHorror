// lab-smoke.mjs — load the Character Lab headless, drive it, screenshot,
// and assert zero console/page errors.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

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
  const PORT = 8155;
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

  // exercise the optional Meshy-body load path against the GLB fixture
  await page.addInitScript(() => { window.LAB_MONSTER_MODEL = '/tools/fixtures/triangle.glb'; });
  await page.goto(`http://localhost:${PORT}/lab.html`, { waitUntil: 'load' });
  await sleep(1500);
  const ready = await page.evaluate(() => !!window.__lab);
  const meshyOk = await page.evaluate(() => !!(window.__lab && window.__lab.meshyBody && window.__lab._meshyBtn));
  console.log('meshy body load path:', meshyOk ? 'PASS' : 'FAIL');
  // WARDEN: walk pose, stop auto-rotate to a 3/4 for a clean frame
  await page.evaluate(() => { const l = window.__lab; l.animSpeed = 3.5; l.autoRotate = false; l.yaw = 0.6; l.camYaw = 0.7; l.camPitch = 0.1; });
  await sleep(900);
  const diag = await page.evaluate(() => {
    const l = window.__lab;
    const rig = l.player.rig;
    // project head world position to screen
    const head = l.player.head.getWorldPosition(new l.camera.position.constructor());
    const ndc = head.clone().project(l.camera);
    return {
      wardenVisible: l.player.object.visible,
      objPos: [l.player.object.position.x, l.player.object.position.y, l.player.object.position.z],
      rigScale: rig.scale.x,
      headWorld: [+head.x.toFixed(2), +head.y.toFixed(2), +head.z.toFixed(2)],
      headScreen: [+ndc.x.toFixed(2), +ndc.y.toFixed(2), +ndc.z.toFixed(2)],
      camPos: [+l.camera.position.x.toFixed(2), +l.camera.position.y.toFixed(2), +l.camera.position.z.toFixed(2)],
      camDist: +l.camDist.toFixed(2), target: [l.target.x, l.target.y, l.target.z],
    };
  });
  console.log('WARDEN DIAG:', JSON.stringify(diag));
  await shot('lab-warden');
  // wireframe + tight zoom to confirm geometry renders
  await page.evaluate(() => { const l = window.__lab; l.wire = true; l._applyWire(); l.camDist = 3.2; l.target.set(0, 1.2, 0); });
  await sleep(500);
  await shot('lab-warden-wire');
  await page.evaluate(() => { const l = window.__lab; l.wire = false; l._applyWire(); });
  // MONSTER
  await page.evaluate(() => { const l = window.__lab; l._show('monster'); l.autoRotate = false; l.yaw = 0.5; l.menace = 0.8; l.materialize = 1; l.camYaw = 0.6; l.camPitch = 0.12; });
  await sleep(900);
  await shot('lab-monster');

  await browser.close(); server.close();
  console.log('lab ready:', ready);
  console.log('=== ERRORS (' + errors.length + ') ===');
  for (const e of errors.slice(0, 30)) console.log(e);
  console.log(ready && errors.length === 0 ? '\nLAB OK' : '\nLAB FAIL');
  process.exit(ready && errors.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
