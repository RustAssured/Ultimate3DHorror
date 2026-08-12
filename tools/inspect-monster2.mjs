// inspect-monster2.mjs — load monster2.glb in the Lab, report its normalized
// bounding box + orientation, and screenshot it from front/bottom/top/side so
// the eye socket and tentacle sockets can be located in local coordinates.
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
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    s.listen(port, () => resolve(s));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const PORT = 8175;
  const server = await serve(PORT);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });

  await page.addInitScript(() => { window.LAB_MONSTER_MODEL = '/assets/models/monster2.glb'; });
  await page.goto(`http://localhost:${PORT}/lab.html`, { waitUntil: 'load' });
  await sleep(2600);

  // switch to monster + meshy, drop the procedural bits, add axes + a debug grid
  const info = await page.evaluate(() => {
    const l = window.__lab;
    l._show('monster'); l.useMeshy = true; l._applyMeshy(); l.autoRotate = false; l.materialize = 1; l.menace = 0.15;
    // hide the placeholder procedural tentacles so the sockets are visible
    for (const t of l.stalker.tentacles) t.mesh.visible = false;
    // reveal light so sockets read
    l.key.intensity = 140; l.rim.intensity = 110; l.kick.intensity = 40;
    // bounding box of the normalized meshy body
    const THREE = l.camera.position.constructor;
    // compute bbox by walking geometry
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    l.meshyBody.updateMatrixWorld(true);
    l.meshyBody.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry; g.computeBoundingBox();
        const bb = g.boundingBox;
        for (const c of [[bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]]) {
          const v = new (l.camera.position.constructor)(c[0], c[1], c[2]).applyMatrix4(o.matrixWorld);
          min = [Math.min(min[0], v.x), Math.min(min[1], v.y), Math.min(min[2], v.z)];
          max = [Math.max(max[0], v.x), Math.max(max[1], v.y), Math.max(max[2], v.z)];
        }
      }
    });
    // add axes helper at body center for orientation
    const ax = new (window.__labTHREE ? window.__labTHREE.AxesHelper : Object)(2);
    return { min: min.map((n) => +n.toFixed(2)), max: max.map((n) => +n.toFixed(2)) };
  });
  console.log('NORMALIZED BBOX:', JSON.stringify(info));

  const view = async (name, cam, tgt) => {
    await page.evaluate(({ cam, tgt }) => {
      const l = window.__lab; l._freezeCam = true;
      l.target.set(tgt[0], tgt[1], tgt[2]);
      l.camYaw = 0; l.camPitch = 0; l.camDist = 0; // we override position directly next frame via hook
      l._labCamOverride = cam;
    }, { cam, tgt });
    await sleep(500);
    await shot(name);
  };

  // We can't easily override the orbit; instead set yaw/pitch/dist to hit angles.
  const angle = async (name, yaw, pitch, dist, ty) => {
    await page.evaluate(({ yaw, pitch, dist, ty }) => {
      const l = window.__lab; l.autoRotate = false; l.camYaw = yaw; l.camPitch = pitch; l.camDist = dist; l.target.set(0, ty, 0);
    }, { yaw, pitch, dist, ty });
    await sleep(500);
    await shot(name);
  };

  await angle('m2-front', 0, 0.05, 8, 1.9);
  await angle('m2-side', 1.3, 0.05, 8, 1.9);
  await angle('m2-bottom', 0.2, -0.7, 7, 1.6);   // look up at the sockets
  await angle('m2-top', 0.0, 1.1, 7, 1.6);       // look down at the eye socket
  await angle('m2-lowfront', 0.0, -0.35, 7, 1.4);

  await browser.close(); server.close();
  console.log('errors:', errors.length);
  for (const e of errors.slice(0, 10)) console.log(' -', e);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
