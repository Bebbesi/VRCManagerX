// Generates the app icon (shield + check on a violet gradient tile) without external tools.
// Outputs: resources/icon.png (512), resources/tray.png (16), resources/tray@2x.png (32), build/icon.ico
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'

// Shapes are defined on a 24x24 grid (same as the UI icon set).
const SHIELD = [
  ['M', 12, 2.2],
  ['C', 14.2, 3.9, 16.6, 5, 19, 5],
  ['L', 20, 6],
  ['L', 20, 13],
  ['C', 20, 18, 16.5, 20.5, 12.3, 21.95],
  ['L', 11.7, 21.95],
  ['C', 7.5, 20.5, 4, 18, 4, 13],
  ['L', 4, 6],
  ['L', 5, 5],
  ['C', 7.4, 5, 9.8, 3.9, 12, 2.2]
]
const CHECK = [
  ['M', 9, 12],
  ['L', 11, 14],
  ['L', 15, 10]
]

function flatten(path) {
  const segs = []
  let x = 0
  let y = 0
  for (const [cmd, ...a] of path) {
    if (cmd === 'M') [x, y] = a
    else if (cmd === 'L') {
      segs.push([x, y, a[0], a[1]])
      ;[x, y] = a
    } else if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = a
      let px = x
      let py = y
      for (let i = 1; i <= 24; i++) {
        const t = i / 24
        const mt = 1 - t
        const nx = mt ** 3 * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x3
        const ny = mt ** 3 * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y3
        segs.push([px, py, nx, ny])
        px = nx
        py = ny
      }
      x = x3
      y = y3
    }
  }
  return segs
}

const glyph = [...flatten(SHIELD), ...flatten(CHECK)]

function distToSeg(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len))
  const cx = x1 + t * dx - px
  const cy = y1 + t * dy - py
  return Math.sqrt(cx * cx + cy * cy)
}

function insideRoundRect(x, y, size, r) {
  const cx = Math.max(r, Math.min(size - r, x))
  const cy = Math.max(r, Math.min(size - r, y))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

const lerp = (a, b, t) => a + (b - a) * t
const C1 = [141, 125, 255]
const C2 = [106, 88, 255]
const C3 = [75, 59, 214]

function render(size, { glyphScale = 0.62, stroke = 2, radius = 0.23 } = {}) {
  const ss = size <= 32 ? 6 : 4
  const px = new Uint8Array(size * size * 4)
  const r = size * radius
  const g = (size * glyphScale) / 24
  const off = (size - 24 * g) / 2
  const half = stroke / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = x + (sx + 0.5) / ss
          const fy = y + (sy + 0.5) / ss
          if (!insideRoundRect(fx, fy, size, r)) continue
          bg++
          const gx = (fx - off) / g
          const gy = (fy - off) / g
          let d = Infinity
          for (const s of glyph) {
            d = Math.min(d, distToSeg(gx, gy, s))
            if (d < half) break
          }
          if (d < half) fg++
        }
      }
      const n = ss * ss
      const t = (x + y) / (2 * size)
      const base = t < 0.55 ? C1.map((c, i) => lerp(c, C2[i], t / 0.55)) : C2.map((c, i) => lerp(c, C3[i], (t - 0.55) / 0.45))
      const f = bg ? fg / bg : 0
      const i = (y * size + x) * 4
      px[i] = Math.round(lerp(base[0], 255, f))
      px[i + 1] = Math.round(lerp(base[1], 255, f))
      px[i + 2] = Math.round(lerp(base[2], 255, f))
      px[i + 3] = Math.round((bg / n) * 255)
    }
  }
  return px
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

mkdirSync('resources', { recursive: true })
mkdirSync('build', { recursive: true })

const small = { glyphScale: 0.78, stroke: 2.6, radius: 0.24 }
writeFileSync('resources/icon.png', png(512, render(512)))
writeFileSync('resources/tray.png', png(16, render(16, small)))
writeFileSync('resources/tray@2x.png', png(32, render(32, small)))
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
writeFileSync(
  'build/icon.ico',
  ico(icoSizes.map((size) => ({ size, data: png(size, render(size, size <= 32 ? small : size <= 48 ? { glyphScale: 0.7, stroke: 2.3 } : {})) })))
)
writeFileSync('build/icon.png', png(512, render(512)))
console.log('Icons written: resources/icon.png, resources/tray.png, resources/tray@2x.png, build/icon.ico, build/icon.png')
