// make-fixture.mjs — write a minimal valid GLB (one triangle) used to verify
// the vendored GLTFLoader pipeline in the headless harness.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'fixtures');
fs.mkdirSync(outDir, { recursive: true });

// BIN: three vec3 positions
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const bin = Buffer.from(positions.buffer);

const json = {
  asset: { version: '2.0', generator: 'cosmic-fall-fixture' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'TestTriangle' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length, target: 34962 }],
  accessors: [{
    bufferView: 0, byteOffset: 0, componentType: 5126, count: 3,
    type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0],
  }],
};

function padTo4(buf, padByte) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem, padByte)]);
}

const jsonBuf = padTo4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20); // pad with spaces
const binBuf = padTo4(bin, 0x00);

const chunkHeader = (len, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(len, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
const JSON_TYPE = 0x4e4f534a; // 'JSON'
const BIN_TYPE = 0x004e4942;  // 'BIN\0'

const body = Buffer.concat([
  chunkHeader(jsonBuf.length, JSON_TYPE), jsonBuf,
  chunkHeader(binBuf.length, BIN_TYPE), binBuf,
]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4);          // version
header.writeUInt32LE(12 + body.length, 8);

const glb = Buffer.concat([header, body]);
const outPath = path.join(outDir, 'triangle.glb');
fs.writeFileSync(outPath, glb);
console.log('wrote', outPath, glb.length, 'bytes');
