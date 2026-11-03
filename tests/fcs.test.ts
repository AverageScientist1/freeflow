import { describe, it, expect } from 'vitest'
import { parseFcs, parseKeywords, FcsError } from '../src/core/fcs'
import { writeFcs, makeDemoFcs } from '../src/core/synth'

const params = [
  { name: 'FSC-A', range: 262144 },
  { name: 'FL1-A', stain: 'FITC-A', range: 262144 },
]
const cols = [Float32Array.from([1, 2, 3.5, 4]), Float32Array.from([-5, 0, 10, 20000])]

describe('parseFcs', () => {
  it('round-trips float data, little endian', () => {
    const f = parseFcs(writeFcs(params, cols))
    expect(f.version).toBe('FCS3.1')
    expect(f.eventCount).toBe(4)
    expect(f.parameters.map((p) => p.name)).toEqual(['FSC-A', 'FL1-A'])
    expect(f.parameters[1].stain).toBe('FITC-A')
    expect(Array.from(f.columns[0])).toEqual([1, 2, 3.5, 4])
    expect(Array.from(f.columns[1])).toEqual([-5, 0, 10, 20000])
  })

  it('reads big endian float data', () => {
    const f = parseFcs(writeFcs(params, cols, { littleEndian: false }))
    expect(Array.from(f.columns[1])).toEqual([-5, 0, 10, 20000])
  })

  it('reads double data', () => {
    const f = parseFcs(writeFcs(params, cols, { dataType: 'D' }))
    expect(Array.from(f.columns[0])).toEqual([1, 2, 3.5, 4])
  })

  it('reads 16-bit integer data and masks to the range', () => {
    const p = [{ name: 'A', range: 1024 }]
    const f = parseFcs(writeFcs(p, [[5, 1023, 1024 + 7]], { dataType: 'I', bits: 16 }))
    expect(Array.from(f.columns[0])).toEqual([5, 1023, 7])
  })

  it('handles an empty file with zero events', () => {
    const f = parseFcs(writeFcs(params, [[], []]))
    expect(f.eventCount).toBe(0)
    expect(f.columns[0].length).toBe(0)
  })

  it('keeps keyword values that contain the delimiter', () => {
    const f = parseFcs(writeFcs(params, cols, { extraKeywords: { $FIL: 'a/b.fcs' } }))
    expect(f.keywords['$FIL']).toBe('a/b.fcs')
  })

  it('rejects files that are not FCS', () => {
    expect(() => parseFcs(new ArrayBuffer(100))).toThrow(FcsError)
    expect(() => parseFcs(new ArrayBuffer(10))).toThrow(/too small/)
  })

  it('loads the events that are there when the file is cut short, and says so', () => {
    const full = writeFcs(params, cols) // 4 events of 8 bytes
    const f = parseFcs(full.slice(0, full.byteLength - 8))
    expect(f.eventCount).toBe(3)
    expect(f.columns[0].length).toBe(3)
    expect(f.warnings.join(' ')).toMatch(/Only 3 of 4 events/)
  })

  it('refuses a file whose data part is missing entirely', () => {
    const full = writeFcs(params, cols)
    expect(() => parseFcs(full.slice(0, full.byteLength - 4 * 8))).toThrow(/missing or cut short/)
  })

  it('has no warnings for a good file', () => {
    expect(parseFcs(writeFcs(params, cols)).warnings).toEqual([])
  })

  it('works out the event count from the data when $TOT is missing', () => {
    const f = parseFcs(writeFcs(params, cols, { extraKeywords: { $TOT: '' } }))
    expect(f.eventCount).toBe(4)
    expect(f.warnings.join(' ')).toMatch(/event count/)
  })

  it('accepts newer FCS versions such as 3.2', () => {
    const buf = writeFcs(params, cols)
    new Uint8Array(buf).set(Array.from('FCS3.2').map((c) => c.charCodeAt(0)), 0)
    expect(parseFcs(buf).version).toBe('FCS3.2')
  })

  it('refuses unsupported modes and ASCII data with a plain explanation', () => {
    expect(() => parseFcs(writeFcs(params, cols, { extraKeywords: { $MODE: 'C' } }))).toThrow(/list-mode/)
    expect(() => parseFcs(writeFcs(params, cols, { extraKeywords: { $DATATYPE: 'A' } }))).toThrow(/ASCII/)
  })

  it('names the problem when the header is not an FCS header', () => {
    expect(() => parseFcs(new TextEncoder().encode('PK\x03\x04' + 'x'.repeat(200)).buffer as ArrayBuffer)).toThrow(/does not look like an FCS file/)
  })

  it('reads a file whose TEXT has empty values (written by several instruments)', () => {
    const f = parseFcs(writeFcs(params, cols, { extraKeywords: { $MODEL: '', $CYT: 'Some Cytometer', $COM: '' } }))
    expect(f.keywords['$MODEL']).toBe('')
    expect(f.keywords['$CYT']).toBe('Some Cytometer')
    expect(f.keywords['$BYTEORD']).toBe('1,2,3,4') // the keyword after the empty value is not swallowed
    expect(Array.from(f.columns[1])).toEqual([-5, 0, 10, 20000])
    expect(f.warnings).toEqual([])
  })

  it('parses a generated demo file', () => {
    const f = parseFcs(makeDemoFcs(7, 1000))
    expect(f.eventCount).toBe(1000)
    expect(f.parameters.length).toBe(7)
  })
})

describe('parseKeywords', () => {
  it('splits on the first character and unescapes doubled delimiters', () => {
    expect(parseKeywords('|$A|1|$B|x||y|')).toEqual({ $A: '1', $B: 'x|y' })
  })

  it('reads an empty value without eating the next keyword', () => {
    expect(parseKeywords('/$A/1/$MODEL//$BYTEORD/4,3,2,1/')).toEqual({ $A: '1', $MODEL: '', $BYTEORD: '4,3,2,1' })
  })

  it('reads an empty value at the very end and keys in any case', () => {
    expect(parseKeywords('/$a/1/$last//')).toEqual({ $A: '1', $LAST: '' })
  })

  it('keeps spaces inside values and works with an unusual delimiter character', () => {
    expect(parseKeywords('\f$FIL\fmy file.fcs\f$SYS\fWindows NT 6.2\f')).toEqual({ $FIL: 'my file.fcs', $SYS: 'Windows NT 6.2' })
  })

  it('rejects an empty segment', () => {
    expect(() => parseKeywords('')).toThrow(FcsError)
  })
})
