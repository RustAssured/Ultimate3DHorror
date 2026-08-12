// dw-scale.mjs — diagnose why the animated Dreamwalker renders far larger than
// its rest-pose bbox. Measures rest vs animated bounds and inspects the rig.
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
  const PORT = 8217;
  const server = await serve(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/lab.html`, { waitUntil: 'load' });
  await sleep(500);
  const info = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.js');
    const { loadGLTF } = await import('/src/models.js');
    const gltf = await loadGLTF('/assets/models/dreamwalker.glb');
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const boxRest = new THREE.Box3().setFromObject(scene);
    const sRest = new THREE.Vector3(); boxRest.getSize(sRest);

    // node scales
    const nodes = [];
    scene.traverse((o) => { nodes.push({ name: o.name, type: o.type, scale: o.scale.toArray().map((v) => +v.toFixed(3)), pos: o.position.toArray().map((v) => +v.toFixed(2)) }); });

    // animation tracks summary
    const clip = gltf.animations[0];
    const trackKinds = {};
    let firstScaleTrack = null;
    for (const t of clip.tracks) {
      const kind = t.name.split('.').pop();
      trackKinds[kind] = (trackKinds[kind] || 0) + 1;
      if (kind === 'scale' && !firstScaleTrack) {
        firstScaleTrack = { name: t.name, values: Array.from(t.values.slice(0, 3)).map((v) => +v.toFixed(3)) };
      }
    }

    // animated bounds: play the clip a bit and re-measure via SkinnedMesh.boundingBox
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(clip).play();
    mixer.update(clip.duration * 0.5);
    scene.updateMatrixWorld(true);
    // compute skinned bounds — MUST update the skeleton bone matrices first
    let smin = new THREE.Vector3(Infinity, Infinity, Infinity), smax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const tmp = new THREE.Vector3();
    scene.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.skeleton.update();
        const pos = o.geometry.attributes.position; const n = pos.count;
        for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 600))) {
          tmp.fromBufferAttribute(pos, i);
          o.applyBoneTransform ? o.applyBoneTransform(i, tmp) : o.boneTransform(i, tmp);
          o.localToWorld(tmp);
          smin.min(tmp); smax.max(tmp);
        }
      }
    });
    const animSize = new THREE.Vector3().subVectors(smax, smin);

    return {
      restSize: sRest.toArray().map((v) => +v.toFixed(2)),
      restMinY: +boxRest.min.y.toFixed(2), restMaxY: +boxRest.max.y.toFixed(2),
      animSize: animSize.toArray().map((v) => +v.toFixed(2)),
      animMinY: +smin.y.toFixed(2), animMaxY: +smax.y.toFixed(2),
      trackKinds, firstScaleTrack,
      nodes: nodes.slice(0, 8),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close(); server.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
