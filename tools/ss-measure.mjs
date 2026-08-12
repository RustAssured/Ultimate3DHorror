// ss-measure.mjs — load the side-scroller and report the player's real world
// bounding box + camera, so we can diagnose the on-screen scale.
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
  const PORT = 8216;
  const server = await serve(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://localhost:${PORT}/sidescroller.html`, { waitUntil: 'load' });
  await sleep(3000);
  // start + walk so we measure the exact play-state camera
  await page.evaluate(() => document.getElementById('ss-start').click());
  await page.evaluate(() => window.__ss.keys.add('ArrowRight'));
  await sleep(2500);
  const proj = await page.evaluate(async () => {
    const s = window.__ss;
    const three = await import('/vendor/three/three.module.js');
    const cam = s.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const projectBox = (b) => {
      const corners = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const v = new three.Vector3(x, y, z).project(cam);
        corners.push({ sx: Math.round((v.x * 0.5 + 0.5) * W), sy: Math.round((-v.y * 0.5 + 0.5) * H) });
      }
      const sy = corners.map((c) => c.sy), sx = corners.map((c) => c.sx);
      return { top: Math.min(...sy), bottom: Math.max(...sy), left: Math.min(...sx), right: Math.max(...sx), worldMinY: +b.min.y.toFixed(2), worldMaxY: +b.max.y.toFixed(2) };
    };
    // rest-pose box
    const bRest = new three.Box3().setFromObject(s.player.object);
    // true skinned world bounds
    s.player.object.updateWorldMatrix(true, true);
    const bSkin = new three.Box3();
    const tmp = new three.Vector3();
    s.player.object.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.skeleton.update();
        const pos = o.geometry.attributes.position; const n = pos.count;
        for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 800))) {
          tmp.fromBufferAttribute(pos, i);
          o.applyBoneTransform ? o.applyBoneTransform(i, tmp) : o.boneTransform(i, tmp);
          o.localToWorld(tmp);
          bSkin.expandByPoint(tmp);
        }
      }
    });
    return {
      cam: [cam.position.x, cam.position.y, cam.position.z].map((v) => +v.toFixed(2)),
      rest: projectBox(bRest), skin: projectBox(bSkin),
    };
  });
  proj.screenTop = proj.skin.top; proj.screenBottom = proj.skin.bottom; proj.screenLeft = proj.skin.left; proj.screenRight = proj.skin.right;
  console.log('PROJECTED:', JSON.stringify(proj, null, 2));
  // draw debug rectangles: pink = rest-pose box, cyan = true skinned bounds
  await page.evaluate((p) => {
    const rect = (b, color) => { const d = document.createElement('div'); d.style.cssText = `position:fixed;left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;border:2px solid ${color};pointer-events:none;z-index:9999`; document.body.appendChild(d); };
    rect(p.rest, '#ff2f8a'); rect(p.skin, '#2fffd0');
  }, proj);
  await page.screenshot({ path: path.join(ROOT, 'tools/shots/ss-measure.png'), timeout: 60000 });
  const m = await page.evaluate(() => {
    const s = window.__ss; const THREE = s.camera.constructor.__proto__ ? null : null;
    const T = window.__three || null;
    // build a Box3 via three imported on the object graph
    const box = new (s.player.object.constructor.prototype.constructor ? Object : Object)();
    // use the global THREE from module: reach via player.object
    return (async () => {
      const three = await import('/vendor/three/three.module.js');
      const b = new three.Box3().setFromObject(s.player.object);
      const size = new three.Vector3(); b.getSize(size);
      return {
        playerObjScale: s.player.object.scale.toArray(),
        childScale: s.player.object.children[0] ? s.player.object.children[0].scale.toArray() : null,
        bboxMin: [b.min.x, b.min.y, b.min.z].map((v) => +v.toFixed(2)),
        bboxMax: [b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(2)),
        size: [size.x, size.y, size.z].map((v) => +v.toFixed(2)),
        cam: [s.camera.position.x, s.camera.position.y, s.camera.position.z].map((v) => +v.toFixed(2)),
        playerX: +s.playerX.toFixed(2),
      };
    })();
  });
  console.log(JSON.stringify(m, null, 2));
  await browser.close(); server.close();
}
main().catch((e) => { console.error(e); process.exit(2); });
