// WebGL2 point renderer for pseudocolour plots. Events are drawn as points coloured by local density.
// All positions are display coordinates in [0, 1].

const VERT = `#version 300 es
in vec2 pos;
in float t;
uniform float size;
out float vt;
void main() {
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = size;
  vt = t;
}`

const FRAG = `#version 300 es
precision mediump float;
in float vt;
uniform vec3 ramp[6];
out vec4 color;
void main() {
  float f = clamp(vt, 0.0, 1.0) * 5.0;
  int i = int(min(floor(f), 4.0));
  color = vec4(mix(ramp[i], ramp[i + 1], f - float(i)), 1.0);
}`

function parseCssColor(value: string): [number, number, number] {
  const v = value.trim()
  const m = /^#([0-9a-f]{6})$/i.exec(v)
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const DENSITY_GRID = 128

// Density per point (0..1) from a coarse 2D histogram; also returns draw order so hot points end up on top.
export function densityPoints(xs: Float32Array, ys: Float32Array, mask: Uint8Array | null): { pos: Float32Array; t: Float32Array } {
  const n = xs.length
  const grid = new Uint32Array(DENSITY_GRID * DENSITY_GRID)
  const cell = (v: number): number => Math.min(DENSITY_GRID - 1, Math.max(0, Math.floor(v * DENSITY_GRID)))
  let included = 0
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue
    grid[cell(ys[i]) * DENSITY_GRID + cell(xs[i])]++
    included++
  }
  let max = 1
  for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i]
  const denom = Math.log1p(max)

  // counting sort on 256 density levels
  const level = new Uint8Array(included)
  const idx = new Uint32Array(included)
  const counts = new Uint32Array(257)
  let k = 0
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue
    const l = Math.round((Math.log1p(grid[cell(ys[i]) * DENSITY_GRID + cell(xs[i])]) / denom) * 255)
    level[k] = l
    idx[k] = i
    counts[l + 1]++
    k++
  }
  for (let i = 1; i < 257; i++) counts[i] += counts[i - 1]
  const pos = new Float32Array(included * 2)
  const t = new Float32Array(included)
  for (let j = 0; j < included; j++) {
    const slot = counts[level[j]]++
    const i = idx[j]
    pos[slot * 2] = xs[i]
    pos[slot * 2 + 1] = ys[i]
    t[slot] = level[j] / 255
  }
  return { pos, t }
}

// The raw view: every event as one plain dot in acquisition order, with no density colouring.
export function rawPoints(xs: Float32Array, ys: Float32Array, mask: Uint8Array | null): { pos: Float32Array; t: Float32Array } {
  let n = 0
  for (let i = 0; i < xs.length; i++) if (!mask || mask[i]) n++
  const pos = new Float32Array(n * 2)
  let k = 0
  for (let i = 0; i < xs.length; i++) {
    if (mask && !mask[i]) continue
    pos[k * 2] = xs[i]; pos[k * 2 + 1] = ys[i]; k++
  }
  return { pos, t: new Float32Array(n) }
}

export class GlPlot {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private posBuf: WebGLBuffer
  private tBuf: WebGLBuffer
  private count = 0
  private ramp: Float32Array

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('WebGL2 is not available on this machine')
    this.gl = gl
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error')
    this.program = p
    this.posBuf = gl.createBuffer()!
    this.tBuf = gl.createBuffer()!
    const css = getComputedStyle(document.documentElement)
    this.ramp = new Float32Array(Array.from({ length: 6 }, (_, i) => parseCssColor(css.getPropertyValue(`--plot-heat-${i}`))).flat())
  }

  setPoints(pos: Float32Array, t: Float32Array): void {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tBuf)
    gl.bufferData(gl.ARRAY_BUFFER, t, gl.STATIC_DRAW)
    this.count = t.length
  }

  draw(backgroundCss: string, pointSize: number): void {
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    const [r, g, b] = parseCssColor(backgroundCss)
    gl.clearColor(r, g, b, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (this.count === 0) return
    gl.useProgram(this.program)
    gl.uniform3fv(gl.getUniformLocation(this.program, 'ramp'), this.ramp)
    gl.uniform1f(gl.getUniformLocation(this.program, 'size'), pointSize)
    const posLoc = gl.getAttribLocation(this.program, 'pos')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
    const tLoc = gl.getAttribLocation(this.program, 't')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tBuf)
    gl.enableVertexAttribArray(tLoc)
    gl.vertexAttribPointer(tLoc, 1, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.POINTS, 0, this.count)
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteBuffer(this.posBuf)
    gl.deleteBuffer(this.tBuf)
    gl.deleteProgram(this.program)
  }
}
