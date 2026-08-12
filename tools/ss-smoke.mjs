// ss-smoke.mjs — load the side-scroller, start it, walk right, screenshot, and
// assert zero console/page errors.
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
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/sidescroller.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    s.listen(port, () => resolve(s));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const PORT = 8215;
  const server = await serve(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 60000 });

  await page.goto(`http://localhost:${PORT}/sidescroller.html`, { waitUntil: 'load' });
  await sleep(3000); // load dreamwalker + monster3
  await shot('ss-title');
  await page.evaluate(() => window.__ss && document.getElementById('ss-start').click());
  await sleep(600);
  await shot('ss-start');
  // walk right for a while
  await page.evaluate(() => window.__ss.keys.add('ArrowRight'));
  await sleep(3500);
  const info = await page.evaluate(() => { const s = window.__ss; return { state: s.state, playerX: +s.playerX.toFixed(1), monsterX: +s.monsterX.toFixed(1), dread: +s.dread.toFixed(2), mat: +s.monster.materialize.toFixed(2), usingMeshy: s.monster.usingMeshy }; });
  console.log('after walk:', JSON.stringify(info));
  await shot('ss-walk');
  await sleep(3500);
  await shot('ss-chase');
  const info2 = await page.evaluate(() => { const s = window.__ss; return { state: s.state, playerX: +s.playerX.toFixed(1), monsterX: +s.monsterX.toFixed(1) }; });
  console.log('later:', JSON.stringify(info2));

  await browser.close(); server.close();
  console.log('=== ERRORS (' + errors.length + ') ===');
  for (const e of errors.slice(0, 20)) console.log(e);
  console.log(errors.length === 0 ? '\nSS OK' : '\nSS FAIL');
  process.exit(errors.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
