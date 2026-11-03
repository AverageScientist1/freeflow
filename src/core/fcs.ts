// FCS 2.0 to 3.2 reader, written from the public ISAC FCS specification.
// Events are returned as one Float32Array per parameter (columnar). The reader is lenient where real files from
// different instruments bend the rules, and says so in `warnings` instead of refusing the file.

export interface FcsParameter {
  index: number // 1-based, as in $PnN
  name: string // $PnN, e.g. FL1-A
  stain: string // $PnS, e.g. FDG FITC-A (may be empty)
  range: number // $PnR
  bits: number // $PnB
}

export interface FcsFile {
  version: string
  keywords: Record<string, string>
  parameters: FcsParameter[]
  eventCount: number
  columns: Float32Array[]
  warnings: string[] // things that were off in the file but did not stop it from loading
}

export class FcsError extends Error {}

function ascii(view: Uint8Array, start: number, end: number): string {
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(view[i])
  return s
}

function headerOffset(header: string, from: number): number {
  const v = parseInt(header.slice(from, from + 8).trim(), 10)
  return Number.isFinite(v) ? v : 0
}

// TEXT segment: the first character is the delimiter, then key, value, key, value, ...
// A doubled delimiter inside a value is a literal delimiter. Keys never contain it, and a value may be empty
// (two delimiters in a row where a value is expected), which several instruments write.
export function parseKeywords(text: string): Record<string, string> {
  if (text.length < 2) throw new FcsError('The TEXT segment is empty')
  const delim = text[0]
  const body = text.slice(1)
  const tokens: string[] = []
  let i = 0
  while (i < body.length) {
    const isKey = tokens.length % 2 === 0
    if (body[i] === delim) { // an empty value (or a stray delimiter before a key)
      if (!isKey) tokens.push('')
      i++
      continue
    }
    let cur = ''
    while (i < body.length) {
      const ch = body[i]
      if (ch === delim) {
        if (!isKey && body[i + 1] === delim) { cur += delim; i += 2; continue }
        i++
        break
      }
      cur += ch
      i++
    }
    tokens.push(cur)
  }
  const out: Record<string, string> = {}
  for (let k = 0; k + 1 < tokens.length; k += 2) out[tokens[k].trim().toUpperCase()] = tokens[k + 1]
  return out
}

function num(kw: Record<string, string>, key: string): number | undefined {
  const v = kw[key]
  if (v === undefined || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function parseFcs(buffer: ArrayBuffer): FcsFile {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 58) throw new FcsError('This is too small to be an FCS file')
  const header = ascii(bytes, 0, 58)
  const version = header.slice(0, 6)
  if (!/^FCS[23]\.\d$/.test(version)) throw new FcsError(`This does not look like an FCS file (its header starts with "${version.replace(/[^\x20-\x7e]/g, '?')}")`)
  const warnings: string[] = []

  const textStart = headerOffset(header, 10)
  let textEnd = headerOffset(header, 18)
  let dataStart = headerOffset(header, 26)
  let dataEnd = headerOffset(header, 34)
  if (textEnd >= bytes.length) textEnd = bytes.length - 1
  if (textEnd <= textStart) throw new FcsError('The header points to a TEXT segment that is not there')

  const kw = parseKeywords(ascii(bytes, textStart, textEnd + 1))
  if (dataStart === 0 && dataEnd === 0) {
    dataStart = num(kw, '$BEGINDATA') ?? 0
    dataEnd = num(kw, '$ENDDATA') ?? 0
  }
  if (dataStart === 0) dataStart = textEnd + 1 // data directly after the text

  const mode = (kw['$MODE'] ?? 'L').trim().toUpperCase()
  if (mode !== 'L') throw new FcsError(`Only list-mode data is supported (this file says $MODE=${mode})`)
  const dataType = (kw['$DATATYPE'] ?? '').trim().toUpperCase()
  if (dataType === 'A') throw new FcsError('ASCII-encoded FCS data is not supported')
  if (!['F', 'D', 'I'].includes(dataType)) throw new FcsError(`Unsupported or missing $DATATYPE "${dataType}"`)
  const parCount = num(kw, '$PAR')
  if (!parCount || parCount < 1) throw new FcsError('The file does not say how many parameters it has ($PAR)')

  const byteOrd = (kw['$BYTEORD'] ?? '1,2,3,4').replace(/\s/g, '')
  let little: boolean
  if (byteOrd === '1,2,3,4' || byteOrd === '1,2' || byteOrd === '1') little = true
  else if (byteOrd === '4,3,2,1' || byteOrd === '2,1') little = false
  else throw new FcsError(`Unsupported byte order $BYTEORD=${byteOrd}`)

  const parameters: FcsParameter[] = []
  const logAmp: ({ f1: number; f2: number } | null)[] = []
  for (let p = 1; p <= parCount; p++) {
    const bits = dataType === 'F' ? 32 : dataType === 'D' ? 64 : (num(kw, `$P${p}B`) ?? 16)
    if (![8, 16, 32, 64].includes(bits)) throw new FcsError(`Unsupported bit width ${bits} for parameter ${p} ($P${p}B)`)
    parameters.push({
      index: p,
      name: (kw[`$P${p}N`] ?? '').trim() || `P${p}`,
      stain: (kw[`$P${p}S`] ?? '').trim(),
      range: num(kw, `$P${p}R`) ?? 0,
      bits,
    })
    const e = (kw[`$P${p}E`] ?? '0,0').split(',').map(Number)
    const f1 = e[0] || 0
    const f2 = e[1] || 0
    logAmp.push(f1 > 0 ? { f1, f2: f2 === 0 ? 1 : f2 } : null)
  }

  const stride = parameters.reduce((s, p) => s + p.bits / 8, 0)
  let declared = num(kw, '$TOT')
  if (declared === undefined || declared < 0) {
    // no usable event count: work it out from the data segment
    if (dataEnd >= dataStart) declared = Math.floor((dataEnd - dataStart + 1) / stride)
    else declared = Math.floor((bytes.length - dataStart) / stride)
    warnings.push(`The file does not give a usable event count ($TOT); ${declared.toLocaleString()} events were found in its data`)
  }
  const available = dataStart >= bytes.length ? 0 : Math.floor((bytes.length - dataStart) / stride)
  let total = declared
  if (available < declared) {
    if (available === 0) throw new FcsError('The data part of this file is missing or cut short, so no events could be read')
    total = available
    warnings.push(`Only ${available.toLocaleString()} of ${declared.toLocaleString()} events could be read: the file seems to be cut short`)
  }

  const view = new DataView(buffer)
  const columns = parameters.map(() => new Float32Array(total))
  const offsets: number[] = []
  let off = 0
  for (const p of parameters) {
    offsets.push(off)
    off += p.bits / 8
  }
  const masks = parameters.map((p) => {
    const r = p.range
    return r > 1 && (r & (r - 1)) === 0 && p.bits < 32 ? r - 1 : 0
  })

  for (let ev = 0; ev < total; ev++) {
    const rowStart = dataStart + ev * stride
    for (let p = 0; p < parCount; p++) {
      const at = rowStart + offsets[p]
      let v: number
      const bits = parameters[p].bits
      if (dataType === 'F') v = view.getFloat32(at, little)
      else if (dataType === 'D') v = view.getFloat64(at, little)
      else if (bits === 8) v = view.getUint8(at)
      else if (bits === 16) v = view.getUint16(at, little)
      else v = view.getUint32(at, little)
      if (dataType === 'I' && masks[p]) v = v & masks[p]
      const la = logAmp[p]
      if (la) v = Math.pow(10, (la.f1 * v) / (parameters[p].range || 1)) * la.f2
      columns[p][ev] = v
    }
  }

  return { version, keywords: kw, parameters, eventCount: total, columns, warnings }
}
