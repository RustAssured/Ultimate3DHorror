// rig-view.mjs — render the rigged Meshy monster (socket tentacles + living eye)
// with optional debug markers, to align the rig anchors.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
const DEBUG = process.argv.includes('--debug');
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
  const PORT = 8185;
  const server = await serve(PORT);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });

  await page.addInitScript((dbg) => { window.LAB_MONSTER_MODEL = '/assets/models/monster2.glb'; if (dbg) window.LAB_RIG_DEBUG = true; }, DEBUG);
  await page.goto(`http://localhost:${PORT}/lab.html`, { waitUntil: 'load' });
  await sleep(2600);
  await page.evaluate(() => {
    const l = window.__lab;
    l._show('monster'); l.useMeshy = true; l._applyMeshy(); l.autoRotate = false;
    l.materialize = 1; l.menace = 0.55; l.key.intensity = 90; l.rim.intensity = 70; l.kick.intensity = 30;
    if (l.postfx && l.postfx.bloom) l.postfx.bloom.strength = 0.4;
  });
  const angle = async (name, yaw, pitch, dist, ty) => {
    await page.evaluate(({ yaw, pitch, dist, ty }) => { const l = window.__lab; l.camYaw = yaw; l.camPitch = pitch; l.camDist = dist; l.target.set(0, ty, 0); }, { yaw, pitch, dist, ty });
    await sleep(500); await shot(name);
  };
  await angle('rig-front', 0, 0.05, 8.5, 1.9);
  await angle('rig-lowfront', 0.0, -0.3, 8, 1.5);
  await angle('rig-3q', 0.8, 0.15, 8.5, 1.9);
  await angle('rig-side', 1.4, 0.05, 8.5, 1.9);

  await browser.close(); server.close();
  console.log('errors:', errors.length);
  for (const e of errors.slice(0, 10)) console.log(' -', e);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
