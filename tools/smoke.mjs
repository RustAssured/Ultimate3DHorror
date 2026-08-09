// smoke.mjs — headless load + drive + screenshot harness.
// Serves the repo, loads the game in Chromium, captures all errors, drives
// title -> prologue -> play, and screenshots each stage.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

function serve(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, () => resolve(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const PORT = 8137;
  const server = await serve(PORT);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const state = async () => page.evaluate(() => window.__game && window.__game.state);
  const info = async () => page.evaluate(() => {
    const g = window.__game; if (!g) return null;
    return { state: g.state, resolve: +g.resolve.toFixed(2), dread: +g.dread.toFixed(2),
      echoes: g.relics.collected, stalker: g.stalker.active,
      px: +g.player.pos.x.toFixed(1), pz: +g.player.pos.z.toFixed(1) };
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await sleep(1500);
  console.log('after load:', await info());
  await shot('01-title');

  // click DESCEND
  await page.evaluate(() => window.__game.hud.startBtn.click());
  await sleep(600);
  await shot('02-prologue');
  console.log('after descend:', await state());

  // advance prologue cards: each card needs a reveal-click then a close-click,
  // and closing the last card enters play.
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const wasProlog = g.state === 'prologue';
      g.hud.advanceCard();
      if (wasProlog && !g.hud.cardActive()) g._advancePrologue();
    });
    await sleep(120);
    if ((await state()) === 'play') break;
  }
  await sleep(500);
  console.log('after prologue:', await info());
  await shot('03-play-start');

  // drive movement forward for a while, toggle lantern, sample dread
  await page.evaluate(() => window.__game.input.keys.add('KeyW'));
  await sleep(2500);
  await shot('04-play-move');
  console.log('after move:', await info());

  await page.evaluate(() => window.__game.input.keys.delete('KeyW'));

  // log camera + player state at the player-cam framing
  const camState = await page.evaluate(() => {
    const g = window.__game, c = g.camera, p = g.player;
    return {
      camPos: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)],
      camRotZ: +c.rotation.z.toFixed(3), camUp: [c.up.x, c.up.y, c.up.z],
      facing: +p.facing.toFixed(3), camYaw: +p.camYaw.toFixed(3), camPitch: +p.camPitch.toFixed(3),
      playerPos: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
      aspect: +c.aspect.toFixed(3),
    };
  });
  console.log('CAM STATE:', JSON.stringify(camState));

  // overhead shot to see island shape + player location (fog off)
  await page.evaluate(() => {
    const g = window.__game; const p = g.player.pos;
    g._savedFog = g.scene.fog; g.scene.fog = null;
    g.world.ambient.intensity = 25;
    g.setFreeCam([p.x, p.y + 70, p.z + 0.5], [p.x, p.y, p.z]);
    g._debugSimulate(0.1);
  });
  await sleep(300);
  await shot('08-overhead');
  await page.evaluate(() => { const g = window.__game; g.clearFreeCam(); g.world.ambient.intensity = 1.5; g.scene.fog = g._savedFog; });

  // --- diagnostic: player-cam but fully lit, to reveal any occluding geometry ---
  await page.evaluate(() => {
    const g = window.__game;
    g.world.ambient.intensity = 40; g.world.moon.intensity = 20;
    g.renderer.toneMappingExposure = 2.2;
    g._debugSimulate(0.1);
  });
  await sleep(300);
  await shot('04b-bright');
  await page.evaluate(() => {
    const g = window.__game;
    g.world.ambient.intensity = 1.5; g.world.moon.intensity = 1.6;
    g.renderer.toneMappingExposure = 1.4;
  });

  // --- diagnostic: 3/4 free-cam view of the Warden to inspect the rig/scene ---
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player.pos;
    g.setFreeCam([p.x + 5, p.y + 4, p.z + 6], [p.x, p.y + 1.4, p.z]);
  });
  await sleep(500);
  await shot('07-warden-3q');
  await page.evaluate(() => window.__game.clearFreeCam());
  await sleep(200);

  // --- WIN path: collect all echoes, activate beacon, stand on it, simulate ---
  const winResult = await page.evaluate(() => {
    const g = window.__game;
    for (const e of g.relics.echoes) { if (!e.collected) { e.collected = true; g.relics.collected++; } }
    g.relics.activateBeacon(g.audio);
    g.player.pos.set(0, g.world.heightAt(0, 0), 0);
    return g._debugSimulate(0.5);
  });
  await sleep(300);
  console.log('WIN path ->', winResult.state, '| final:', await info());
  await shot('06-win');

  // --- restart, then LOSE path: dark for 25s -> stalker spawns, resolve dies ---
  await page.evaluate(() => window.__game._restart());
  await sleep(400);
  const midHunt = await page.evaluate(() => {
    const g = window.__game;
    g._graceT = 0; g.player.lanternOn = false; g.player.fuel = 0.5;
    return g._debugSimulate(6); // spawn the stalker while still alive
  });
  console.log('mid-hunt (6s dark) ->', midHunt);
  await sleep(300);
  await shot('05-play-dread');
  const loseResult = await page.evaluate(() => window.__game._debugSimulate(25));
  console.log('LOSE path ->', loseResult.state, '| stalker was active:', midHunt.stalker);

  // --- diagnostic: the Stalker, materialised in front of the Warden ---
  await page.evaluate(() => window.__game._restart());
  await sleep(300);
  await page.evaluate(() => {
    const g = window.__game; const p = g.player.pos;
    g.stalker.active = true; g.stalker.materialize = 1; g.stalker.menace = 0.8;
    g.stalker.group.visible = true;
    g.stalker.pos.set(p.x, g.world.heightAt(p.x, p.z - 6), p.z - 6);
    g.stalker.group.position.copy(g.stalker.pos);
    g.setFreeCam([p.x + 3.5, p.y + 3, p.z + 3], [p.x, p.y + 1.5, p.z - 5]);
    g._debugSimulate(0.05);
  });
  await sleep(400);
  await shot('09-stalker');

  await browser.close();
  server.close();

  const ok = errors.length === 0
    && winResult.state === 'win'
    && midHunt.stalker === true
    && loseResult.state === 'lose';
  console.log('\n=== ERRORS (' + errors.length + ') ===');
  for (const e of errors.slice(0, 40)) console.log(e);
  console.log('\n=== CHECKS ===');
  console.log('win reachable   :', winResult.state === 'win' ? 'PASS' : 'FAIL(' + winResult.state + ')');
  console.log('stalker spawns  :', midHunt.stalker ? 'PASS' : 'FAIL');
  console.log('dark is lethal  :', loseResult.state === 'lose' ? 'PASS' : 'FAIL(' + loseResult.state + ')');
  console.log(ok ? '\nALL GOOD' : '\nFAILURES PRESENT');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
