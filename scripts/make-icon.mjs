// Draws the Freeflow icon (a teal rounded square with a gated cloud of events) and writes build/icon.png.
// No image library is needed: the PNG is written by hand with Node's zlib.
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const N = 512
const px = new Uint8ClampedArray(N * N * 4)

const blend = (x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= N || y >= N || a <= 0) return
  const i = (y * N + x) * 4
  const ao = px[i + 3] / 255
  const out = a + ao * (1 - a)
  for (const [k, v] of [[0, r], [1, g], [2, b]]) px[i + k] = (v * a + px[i + k] * ao * (1 - a)) / (out || 1)
  px[i + 3] = out * 255
}

function shape(test, color) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // 3x3 supersampling for smooth edges
    let hit = 0
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) if (test(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hit++
    if (hit) blend(x, y, color[0], color[1], color[2], (hit / 9) * (color[3] ?? 1))
  }
}

// background: rounded square
const R = 96
shape((x, y) => {
  const cx = Math.min(Math.max(x, R), N - R)
  const cy = Math.min(Math.max(y, R), N - R)
  return Math.hypot(x - cx, y - cy) <= R && x >= 0 && y >= 0 && x <= N && y <= N
}, [11, 110, 117])

// a cloud of events, hot in the middle (blue to yellow to red, our own ramp)
let seed = 7
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd())
const ramp = (t) => (t < 0.5 ? [255 * (0.35 + t * 1.3), 255 * (0.85 + t * 0.1), 255 * (0.95 - t * 1.4)] : [255, 255 * (1.1 - t * 0.9), 255 * (0.3 - t * 0.2)])
for (let i = 0; i < 900; i++) {
  const gx = gauss() * 52
  const gy = gauss() * 38
  const x = 256 + gx - 20 + gy * 0.45
  const y = 270 - gy * 0.9
  const heat = Math.exp(-((gx / 70) ** 2 + (gy / 55) ** 2))
  const [r, g, b] = ramp(Math.min(1, heat))
  shape((px_, py_) => Math.hypot(px_ - x, py_ - y) <= 6.5, [r, g, b, 0.95])
}

// the gate: a white ellipse outline around the cloud
const ex = 244, ey = 262, rx = 150, ry = 112
shape((x, y) => {
  const d = ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2
  return d <= 1 && d >= 0.9
}, [255, 255, 255])

// PNG encoding
function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
const raw = Buffer.alloc((N * 4 + 1) * N)
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0
  Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`build/icon.png written (${png.length} bytes)`)
