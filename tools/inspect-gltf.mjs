// inspect-gltf.mjs <model.glb> — report a GLB's structure: animations, skinned
// meshes (rig), mesh/vertex counts, and bounding box. Tells us if a model can
// be driven as an animated character or is a static mesh.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODEL = process.argv.find((a) => a.endsWith('.glb')) || 'dreamwalker.glb';
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
  const PORT = 8205;
  const server = await serve(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/lab.html`, { waitUntil: 'load' });
  await sleep(500);
  const info = await page.evaluate(async (model) => {
    const m = await import('/src/models.js');
    const THREE = await import('/vendor/three/three.module.js');
    const gltf = await m.loadGLTF('/assets/models/' + model);
    let meshes = 0, verts = 0, skinned = 0, bones = 0, mats = new Set();
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3(); box.getSize(size);
    gltf.scene.traverse((o) => {
      if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; if (o.material) mats.add(o.material.uuid); }
      if (o.isSkinnedMesh) { skinned++; if (o.skeleton) bones = Math.max(bones, o.skeleton.bones.length); }
      if (o.isBone) bones = Math.max(bones, 1);
    });
    return {
      animations: gltf.animations.map((c) => ({ name: c.name, dur: +c.duration.toFixed(2), tracks: c.tracks.length })),
      meshes, verts, skinnedMeshes: skinned, bones, materials: mats.size,
      size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
      min: [+box.min.x.toFixed(2), +box.min.y.toFixed(2), +box.min.z.toFixed(2)],
      max: [+box.max.x.toFixed(2), +box.max.y.toFixed(2), +box.max.z.toFixed(2)],
    };
  }, MODEL);
  console.log(MODEL, JSON.stringify(info, null, 1));
  await browser.close(); server.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
