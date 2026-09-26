/**
 * Minimal QR Code encoder: byte mode, error correction level L.
 *
 * Self-contained on purpose. The plugin ships no runtime dependency, so the
 * one thing it must do — turn a URL into a module matrix — cannot break on an
 * installed version of somebody else's package. Versions 1..10 are
 * implemented, which covers any DSH login URL with room to spare; an
 * oversized payload is refused rather than truncated.
 *
 * The module exports the matrix; rendering (PNG on the Host, SVG in the
 * browser) consumes the matrix and never touches the encoding logic.
 *
 * @module dsh-qr-phone-login/qr
 */

/**
 * Per-version block layout at error correction level L, indexed by version-1.
 * `ecPerBlock` is the EC codeword count per block; group 2 is absent for the
 * versions that interleave a single group.
 */
const LAYOUT_L = [
  { ecPerBlock: 7, g1Blocks: 1, g1Data: 19 },
  { ecPerBlock: 10, g1Blocks: 1, g1Data: 34 },
  { ecPerBlock: 15, g1Blocks: 1, g1Data: 55 },
  { ecPerBlock: 20, g1Blocks: 1, g1Data: 80 },
  { ecPerBlock: 26, g1Blocks: 1, g1Data: 108 },
  { ecPerBlock: 18, g1Blocks: 2, g1Data: 68 },
  { ecPerBlock: 20, g1Blocks: 2, g1Data: 78 },
  { ecPerBlock: 24, g1Blocks: 2, g1Data: 97 },
  { ecPerBlock: 30, g1Blocks: 2, g1Data: 116 },
  { ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 2, g2Data: 69 },
]

/** Alignment-pattern centre coordinates per version; versions 1 has none. */
const ALIGNMENT = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
]

/** Version-information bit strings for version 7 and above. */
const VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 }

/**
 * Format-information bit strings for error correction level L, indexed by mask.
 * Each word is the 15-bit BCH(15,5) encoding of `(01 << 3) | mask` with the
 * standard `0x5412` mask applied.
 */
const FORMAT_INFO_L = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
]

/** Highest implemented version. */
const MAX_VERSION = LAYOUT_L.length

/** One reusable bit buffer. */
class BitBuffer {
  /** @type {number[]} */
  bytes = []

  /** @type {number} */
  length = 0

  /**
   * Append the low `count` bits of `value`, most significant first.
   * @param value - value to append.
   * @param count - number of bits to take.
   * @returns nothing.
   */
  put(value, count) {
    for (let i = count - 1; i >= 0; i -= 1) {
      this.putBit(((value >>> i) & 1) === 1)
    }
  }

  /**
   * Append one bit.
   * @param bit - the bit value.
   * @returns nothing.
   */
  putBit(bit) {
    const index = this.length >>> 3
    if (this.bytes.length <= index) this.bytes.push(0)
    if (bit) this.bytes[index] |= 0x80 >>> (this.length & 7)
    this.length += 1
  }
}

/**
 * Multiply two elements of GF(256) modulo the QR primitive polynomial 0x11d.
 * @param a - first factor.
 * @param b - second factor.
 * @returns the product.
 */
function gfMul(a, b) {
  let result = 0
  let x = a
  let y = b
  for (let i = 0; i < 8; i += 1) {
    if ((y & 1) !== 0) result ^= x
    const carry = x & 0x80
    x = (x << 1) & 0xff
    if (carry !== 0) x ^= 0x1d
    y >>>= 1
  }
  return result
}

/**
 * Build the Reed-Solomon generator polynomial of the given degree.
 *
 * The polynomial is the product of `(x - alpha^i)` for `i` in `0..degree-1`;
 * in GF(256) subtraction is XOR, so each factor multiplies the running
 * coefficient list by `x` and adds `alpha^i` times the previous coefficient.
 *
 * @param degree - number of error correction codewords.
 * @returns generator coefficients, highest order first, length `degree + 1`.
 */
function generatorPoly(degree) {
  // Alpha powers, computed once: alpha^0..alpha^(degree-1).
  const roots = [1]
  for (let i = 1; i < degree; i += 1) roots.push(gfMul(roots[i - 1], 2))

  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      // Times x.
      next[j] ^= poly[j]
      // Times alpha^i.
      next[j + 1] ^= gfMul(poly[j], roots[i])
    }
    poly = next
  }
  return poly
}

/**
 * Compute Reed-Solomon error correction codewords for one block.
 * @param data - data codewords of the block.
 * @param ecCount - number of EC codewords to produce.
 * @returns the EC codewords.
 */
function ecCodewords(data, ecCount) {
  const gen = generatorPoly(ecCount)
  const remainder = new Array(ecCount).fill(0)
  for (const byte of data) {
    const factor = byte ^ remainder[0]
    remainder.shift()
    remainder.push(0)
    for (let i = 0; i < ecCount; i += 1) {
      remainder[i] ^= gfMul(gen[i + 1], factor)
    }
  }
  return remainder
}

/**
 * Choose the smallest version that holds `byteLength` bytes at level L.
 * @param byteLength - payload length in bytes.
 * @returns the version number.
 * @throws RangeError when the payload exceeds the largest implemented version.
 */
function chooseVersion(byteLength) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const layout = LAYOUT_L[version - 1]
    const capacity = (layout.g1Blocks * layout.g1Data)
      + (layout.g2Blocks ?? 0) * (layout.g2Data ?? 0)
    // 4 bits mode + 8/16 bits length at these versions, rounded up to bytes.
    const overhead = version < 10 ? 2 : 3
    if (capacity >= byteLength + overhead) return version
  }
  throw new RangeError(`QR payload of ${byteLength} bytes exceeds version ${MAX_VERSION} at level L`)
}

/**
 * Interleave data and EC codewords across the version's blocks.
 * @param data - complete data codeword stream.
 * @param version - chosen version.
 * @returns the interleaved codeword stream.
 */
function interleave(data, version) {
  const layout = LAYOUT_L[version - 1]
  const g2Blocks = layout.g2Blocks ?? 0

  /** @type {{ data: number[], ec: number[] }[]} */
  const blocks = []
  let offset = 0
  for (let i = 0; i < layout.g1Blocks; i += 1) {
    const slice = data.slice(offset, offset + layout.g1Data)
    offset += layout.g1Data
    blocks.push({ data: slice, ec: ecCodewords(slice, layout.ecPerBlock) })
  }
  for (let i = 0; i < g2Blocks; i += 1) {
    const size = layout.g2Data ?? 0
    const slice = data.slice(offset, offset + size)
    offset += size
    blocks.push({ data: slice, ec: ecCodewords(slice, layout.ecPerBlock) })
  }

  const out = []
  const maxData = Math.max(...blocks.map(block => block.data.length))
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) out.push(block.data[i])
    }
  }
  for (let i = 0; i < layout.ecPerBlock; i += 1) {
    for (const block of blocks) out.push(block.ec[i])
  }
  return out
}

/**
 * Encode the payload into the version's final codeword stream.
 * @param bytes - UTF-8 payload bytes.
 * @param version - chosen version.
 * @returns the interleaved codewords.
 */
function encodeCodewords(bytes, version) {
  const layout = LAYOUT_L[version - 1]
  const totalData = (layout.g1Blocks * layout.g1Data)
    + (layout.g2Blocks ?? 0) * (layout.g2Data ?? 0)

  const buffer = new BitBuffer()
  buffer.put(0b0100, 4)
  buffer.put(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) buffer.put(byte, 8)
  // Terminator: up to four zero bits, shortened when the payload already
  // reaches the capacity of this version.
  buffer.put(0, Math.min(4, totalData * 8 - buffer.length))
  // Flush to the next codeword boundary by appending zero bits. `putBit`
  // keeps `bytes` and `length` in step, so this cannot overwrite payload bits.
  while ((buffer.length & 7) !== 0) buffer.putBit(false)
  // Fill the remaining capacity with the alternating pad codewords.
  const pads = [0xec, 0x11]
  let padIndex = 0
  while (buffer.bytes.length < totalData) {
    buffer.put(pads[padIndex], 8)
    padIndex = (padIndex + 1) % 2
  }
  return interleave(buffer.bytes, version)
}

/**
 * Build the function-pattern mask for the version: `true` where a module is
 * reserved by a finder, separator, timing, alignment, or format pattern.
 * @param version - chosen version.
 * @returns `size` x `size` reservation matrix.
 */
function reservedMap(version) {
  const size = version * 4 + 17
  const map = Array.from({ length: size }, () => new Array(size).fill(false))

  const markFinder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r
        const cc = col + c
        if (rr >= 0 && rr < size && cc >= 0 && cc < size) map[rr][cc] = true
      }
    }
  }
  markFinder(0, 0)
  markFinder(0, size - 7)
  markFinder(size - 7, 0)

  for (let i = 0; i < size; i += 1) {
    map[6][i] = true
    map[i][6] = true
  }

  const centres = ALIGNMENT[version]
  for (const row of centres) {
    for (const col of centres) {
      // Skip the three positions that collide with the finder patterns.
      const nearFinder = (row <= 8 && col <= 8)
        || (row <= 8 && col >= size - 9)
        || (row >= size - 9 && col <= 8)
      if (nearFinder) continue
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) map[row + r][col + c] = true
      }
    }
  }

  // Format information, 31 modules. The first copy runs along row 8 columns
  // 0..8 and up column 8 rows 0..8, each skipping the timing line's own cell
  // at index 6; the two strips share the corner [8,8]. The second copy runs
  // along column 8 rows size-7..size-1 and row 8 columns size-8..size-1. The
  // always-dark module is the 31st.
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      map[8][i] = true
      map[i][8] = true
    }
  }
  for (let i = 0; i < 7; i += 1) map[size - 1 - i][8] = true
  for (let i = 0; i < 8; i += 1) map[8][size - 1 - i] = true
  map[size - 8][8] = true

  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        map[size - 11 + j][i] = true
        map[i][size - 11 + j] = true
      }
    }
  }
  return map
}

/**
 * Draw the fixed function patterns into the matrix.
 * @param matrix - `size` x `size` module matrix, mutated in place.
 * @param version - chosen version.
 * @returns nothing.
 */
function drawFunctionPatterns(matrix, version) {
  const size = matrix.length

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r
        const cc = col + c
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
        const inner = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        matrix[rr][cc] = inner
      }
    }
  }
  finder(0, 0)
  finder(0, size - 7)
  finder(size - 7, 0)

  // Timing patterns run along row 6 and column 6, strictly between the two
  // finder separators they connect.
  for (let i = 8; i <= size - 9; i += 1) {
    matrix[6][i] = i % 2 === 0
    matrix[i][6] = i % 2 === 0
  }

  const centres = ALIGNMENT[version]
  for (const row of centres) {
    for (const col of centres) {
      const nearFinder = (row <= 8 && col <= 8)
        || (row <= 8 && col >= size - 9)
        || (row >= size - 9 && col <= 8)
      if (nearFinder) continue
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const ring = Math.max(Math.abs(r), Math.abs(c))
          matrix[row + r][col + c] = ring !== 1
        }
      }
    }
  }

  // Reserve the format strip as light; drawFormatInfo writes the real bits
  // after the mask is chosen.
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      matrix[8][i] = false
      matrix[i][8] = false
    }
  }
  for (let i = 0; i < 8; i += 1) matrix[8][size - 1 - i] = false
  for (let i = 0; i < 7; i += 1) matrix[size - 1 - i][8] = false
  matrix[size - 8][8] = true

  if (version >= 7) {
    const bits = VERSION_INFO[version]
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >>> i) & 1) === 1
      const row = Math.floor(i / 3)
      const col = size - 11 + (i % 3)
      matrix[col][row] = bit
      matrix[row][col] = bit
    }
  }
}

/**
 * Place the codeword bits into every non-reserved module, in the QR zigzag
 * order (two-module columns, right to left, alternating direction).
 * @param matrix - module matrix, mutated in place.
 * @param reserved - function-pattern reservation matrix.
 * @param codewords - interleaved codeword stream.
 * @returns nothing.
 */
function placeCodewords(matrix, reserved, codewords) {
  const size = matrix.length
  let bitIndex = 0
  const totalBits = codewords.length * 8
  // Walk the column pairs from the right edge leftwards. The timing column 6
  // is skipped entirely, so its left neighbour 5 pairs with 4 and the walk
  // then steps to 3/2, 1/0. Direction alternates upward first on each pair.
  let pair = 0

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5
    const upward = pair % 2 === 0
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const column = right - j
        const row = upward ? size - 1 - vert : vert
        if (reserved[row][column]) continue
        let bit = false
        if (bitIndex < totalBits) {
          bit = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1
        }
        matrix[row][column] = bit
        bitIndex += 1
      }
    }
    pair += 1
  }
}

/**
 * Apply one of the eight data masks.
 * @param row - module row.
 * @param col - module column.
 * @param mask - mask index 0..7.
 * @returns whether the module is inverted by this mask.
 */
function maskBit(row, col, mask) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0
    case 1: return row % 2 === 0
    case 2: return col % 3 === 0
    case 3: return (row + col) % 3 === 0
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
}

/**
 * Write both copies of the format information for the chosen mask.
 *
 * The 15-bit word is written most significant bit first. Copy 1 runs along
 * row 8 from column 0 to column 5, skips the timing column at 6, then takes
 * columns 7 and 8, drops to row 7 of column 8, and continues up column 8 to
 * row 0. Copy 2 is split: the next seven bits descend column 8 from row
 * `size-1` to `size-7`, and the final eight run along row 8 from column
 * `size-8` to `size-1`. The always-dark module sits at `[size-8][8]`.
 *
 * @param matrix - module matrix, mutated in place.
 * @param mask - chosen mask index.
 * @returns nothing.
 */
function drawFormatInfo(matrix, mask) {
  const size = matrix.length
  const bits = FORMAT_INFO_L[mask]
  // `bitAt(14)` is the most significant bit of the 15-bit word.
  const bitAt = index => ((bits >>> index) & 1) === 1

  // Copy 1: row 8 columns 0..5, then 7 and 8, then column 8 rows 7..0.
  for (let i = 0; i <= 5; i += 1) matrix[8][i] = bitAt(14 - i)
  matrix[8][7] = bitAt(8)
  matrix[8][8] = bitAt(7)
  matrix[7][8] = bitAt(6)
  for (let i = 0; i <= 5; i += 1) matrix[i][8] = bitAt(5 - i)

  // Copy 2: column 8 rows size-1..size-7, then row 8 columns size-8..size-1.
  for (let i = 0; i < 7; i += 1) matrix[size - 1 - i][8] = bitAt(14 - i)
  for (let i = 0; i < 8; i += 1) matrix[8][size - 8 + i] = bitAt(7 - i)
  matrix[size - 8][8] = true
}

/**
 * Score a masked matrix with the four standard penalty rules.
 * @param matrix - the masked matrix.
 * @returns the penalty score; lower is better.
 */
function penalty(matrix) {
  const size = matrix.length
  let score = 0

  const runsIn = (get) => {
    for (let i = 0; i < size; i += 1) {
      let run = 1
      for (let j = 1; j < size; j += 1) {
        if (get(i, j) === get(i, j - 1)) {
          run += 1
        } else {
          if (run >= 5) score += 3 + (run - 5)
          run = 1
        }
      }
      if (run >= 5) score += 3 + (run - 5)
    }
  }
  runsIn((i, j) => matrix[i][j])
  runsIn((i, j) => matrix[j][i])

  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const value = matrix[r][c]
      if (matrix[r][c + 1] === value && matrix[r + 1][c] === value && matrix[r + 1][c + 1] === value) {
        score += 3
      }
    }
  }

  const pattern = [true, false, true, true, true, false, true]
  const hasPattern = (get, index, offset, reversed) => {
    for (let i = 0; i < 7; i += 1) {
      const expected = reversed ? pattern[6 - i] : pattern[i]
      if (get(index, offset + i) !== expected) return false
    }
    return true
  }
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 7 <= size; j += 1) {
      if (hasPattern((a, b) => matrix[a][b], i, j, false)) score += 40
      if (hasPattern((a, b) => matrix[a][b], i, j, true)) score += 40
      if (hasPattern((a, b) => matrix[b][a], i, j, false)) score += 40
      if (hasPattern((a, b) => matrix[b][a], i, j, true)) score += 40
    }
  }

  let dark = 0
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) if (matrix[r][c]) dark += 1
  }
  const total = size * size
  const percent = (dark * 100) / total
  score += Math.floor(Math.abs(percent - 50) / 5) * 10
  return score
}

/**
 * Encode a text payload into a QR module matrix at error correction level L.
 * @param text - the payload; encoded as UTF-8.
 * @returns the version and a `size` x `size` matrix of booleans, `true` dark.
 * @throws RangeError when the payload is too large or `text` is not a string.
 */
export function encodeQr(text) {
  if (typeof text !== 'string') throw new TypeError('encodeQr expects a string')
  const bytes = Array.from(new TextEncoder().encode(text))
  const version = chooseVersion(bytes.length)
  const codewords = encodeCodewords(bytes, version)
  const size = version * 4 + 17
  const reserved = reservedMap(version)

  let best = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = Array.from({ length: size }, () => new Array(size).fill(false))
    drawFunctionPatterns(matrix, version)
    placeCodewords(matrix, reserved, codewords)
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!reserved[r][c] && maskBit(r, c, mask)) matrix[r][c] = !matrix[r][c]
      }
    }
    drawFormatInfo(matrix, mask)
    const score = penalty(matrix)
    if (score < bestScore) {
      bestScore = score
      best = matrix
    }
  }
  return { version, size, matrix: best }
}

/**
 * Render a matrix to an SVG string.
 * @param matrix - module matrix from {@link encodeQr}.
 * @param options - `quiet` modules of border and `scale` pixels per module.
 * @returns a standalone SVG document string.
 */
export function qrToSvg(matrix, options = {}) {
  const quiet = options.quiet ?? 4
  const scale = options.scale ?? 8
  const size = matrix.length
  const extent = (size + quiet * 2) * scale
  const path = []
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!matrix[r][c]) continue
      const x = (c + quiet) * scale
      const y = (r + quiet) * scale
      path.push(`M${x} ${y}h${scale}v${scale}h-${scale}z`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${extent}" height="${extent}" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges">`
    + `<rect width="${extent}" height="${extent}" fill="#ffffff"/>`
    + `<path d="${path.join('')}" fill="#000000"/></svg>`
}
