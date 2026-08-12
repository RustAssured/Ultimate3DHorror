# Custom 3D models (Meshy, Blender, etc.)

COSMIC FALL runs entirely on procedural rigs, but it can load real 3D models —
**yes, including models you generate in [Meshy](https://www.meshy.ai)** — through
the standard Three.js glTF pipeline. No engine, no build step.

## TL;DR

1. In Meshy, export your model as **GLB** (`.glb`) — see settings below.
2. Drop the file in this folder, e.g. `assets/models/warden.glb`.
3. Tell the game to use it by setting `window.COSMIC_CONFIG` **before** the
   module script runs. Add this to `index.html`, just above the
   `<script type="module" src="./src/main.js">` line:

   ```html
   <script>
     window.COSMIC_CONFIG = {
       wardenModel: './assets/models/warden.glb',
       wardenModelOpts: {
         height: 1.9,                 // metres — the model is auto-scaled to this
         clips: { idle: 'Idle', walk: 'Walk', run: 'Run' } // your clip names (optional)
       }
     };
   </script>
   ```

That's it. The loader (`src/models.js`) centres the model on the ground,
scales it to `height`, plays its animations via an `AnimationMixer`, and the
existing third-person controller drives it (position, turning, walk/idle/run).
If the file is missing or fails to load, the game silently falls back to the
procedural Warden — it never breaks.

## Meshy export settings that work best

- **Format:** glTF Binary (`.glb`) — one self-contained file with textures baked in.
- **Compression:** leave **Draco / meshopt OFF** for a zero-config drop-in. (If you
  must use Draco, say so and I'll vendor `DRACOLoader` + the decoder wasm — it's a
  small addition.)
- **Textures:** embedded, ≤ 2K is plenty for web.
- **Rig/animations:** if you want it to walk, export **rigged + animated** with at
  least `Idle` and `Walk` clips (and optionally `Run`). Put the clip names in
  `clips` above. If you don't map them, the loader guesses by name
  (anything containing "idle" / "walk" / "run").
- **Up axis / scale:** don't worry about it — the loader re-centres and re-scales
  to `height`. Face the model along **+Z** if you can, so "forward" matches.

## What can be swapped

- **Warden (player):** supported today via `COSMIC_CONFIG.wardenModel` — with
  animation state machine (idle / walk / run).
- **The Stalker (monster):** the same `CharacterModel` adapter in `src/models.js`
  works for it; wiring a `stalkerModel` config is a one-liner to add — ask and
  I'll enable it. (Note: the current monster's horror comes from its *wet
  shader*; a Meshy mesh would use its own PBR materials, so if you want the
  From-Beyond translucent look on a custom mesh, I can re-apply the flesh shader
  to it.)
- **Props / monoliths / relics:** can be swapped for models the same way.

## Monster body (Meshy body/head core)

The **Character Lab** can also load a Meshy-generated monster body and compare it
live against the procedural one:

1. Commit your GLB as `assets/models/monster.glb`.
2. In `lab.html`, uncomment the `window.LAB_MONSTER_MODEL` line.
3. Open the Lab → **MONSTER**; a **BODY: PROCEDURAL / MESHY** toggle appears.

Recommended: keep Meshy's **baked PBR** (the eye + mouth are baked into the
texture — gorgeous) and let the rig layer the procedural life on top
(breathing, materialize fade, wet/veined living-skin). Scale/orientation is
auto-normalised to ~3.4 units tall. `.glb` is the right format — no need to
convert to OBJ/FBX.

### Tentacle sockets + eye: model them as REAL HOLES for automatic rigging

The rig can place tentacles and the eye **automatically and exactly, with no
markers** — as long as the sockets are actual openings in the mesh (delete the
polygons so the tube ends and the eye socket are open boundaries, e.g. in
Blender). At load, `detectHoles()` (src/meshyrig.js) welds the vertices, finds
every open boundary loop, and computes each hole's centre, outward axis and
radius in model space. The highest forward-facing hole becomes the **eye**; the
lower holes become **tentacle sockets**. Each tentacle grows *out of* its hole —
its base radius is matched to the hole and recessed slightly so it flows out
instead of clipping through the rim.

- **Do:** open the tentacle tubes and the eye socket (real holes).
- **Don't:** leave them as closed dents — then topology can't locate them and
  placement falls back to hand-tuned anchors.
- The mouth can stay closed/baked (it isn't used as a socket).

## Formats supported

`.glb` and `.gltf` (glTF 2.0) via the vendored `GLTFLoader`. FBX/OBJ from Meshy
work too, but **prefer GLB** — convert if needed. If you only have FBX, I can
vendor `FBXLoader` as well.

## How to get a model to me

Commit it into this folder on the branch (`git add assets/models/yourfile.glb`)
and I'll wire it up and verify it loads. The headless test already proves the
GLB pipeline works end-to-end against a fixture, so once your file is in, hooking
it up is quick.
