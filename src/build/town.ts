import { BUILDING_STONE, CAMPUS_STONE } from '../site/siteLook'

/**
 * The town as data: which cells of a small grid hold a block, and in which
 * colour. Everything you see is worked out from this by townMesh.ts — the
 * player only ever places and removes blocks, as in Townscaper.
 *
 * Two kinds of block. The **existing** buildings the scenario starts with are
 * locked: free, and not removable. The player's own blocks cost one each
 * from a **budget**, so rigid architecture has to be spent where it matters —
 * and living architecture, grown by the plants, is the way to extend a
 * building without spending it.
 *
 * Plain data and no three.js, so the rules can be checked outside the browser.
 */

/** Columns across and deep, and storeys high. */
export const W = 14
export const D = 14
export const H = 8

/**
 * House colours: the Site page's building stones (siteLook.ts), so a town
 * built here sits in the same warm, neutral world as Roosevelt Island —
 * off-white, sandstone, cream, taupe, a little clay and terracotta, and the
 * campus's pale limestone. The first palette was Townscaper's sun-faded
 * pastels. Index + 1 is what a cell stores; 0 is empty.
 */
export const PALETTE = [...BUILDING_STONE.map(([c]) => c), CAMPUS_STONE]
/** How often a block on open ground takes each, after the Site's own weights: mostly the neutrals. */
const WEIGHTS = [...BUILDING_STONE.map(([, w]) => w), 0.1]
export const pickColour = (u: number) => {
  const total = WEIGHTS.reduce((a, w) => a + w, 0)
  let acc = 0
  for (let k = 0; k < WEIGHTS.length; k++) {
    acc += WEIGHTS[k] / total
    if (u < acc) return k + 1
  }
  return WEIGHTS.length
}

export type Edit = { x: number; y: number; z: number; before: number; after: number }

/** Structural blocks the player may place. */
export const BUDGET = 30
/** A block of each existing building, in the lawn scenario. */
export const WEST: [number, number, number] = [1, 0, 6]
export const EAST: [number, number, number] = [11, 0, 6]

export class Town {
  readonly cells = new Uint8Array(W * H * D)
  /** The scenario's existing buildings: free, and not removable. */
  readonly locked = new Uint8Array(W * H * D)
  private undoStack: Edit[][] = []

  static index(x: number, y: number, z: number) {
    return (y * D + z) * W + x
  }

  inBounds(x: number, y: number, z: number) {
    return x >= 0 && x < W && z >= 0 && z < D && y >= 0 && y < H
  }

  /** 0 if empty or outside the grid, else colour index + 1. */
  get(x: number, y: number, z: number): number {
    return this.inBounds(x, y, z) ? this.cells[Town.index(x, y, z)] : 0
  }

  filled(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) > 0
  }

  isLocked(x: number, y: number, z: number): boolean {
    return this.inBounds(x, y, z) && this.locked[Town.index(x, y, z)] === 1
  }

  /** Blocks the player has placed, against the budget. */
  placed(): number {
    let n = 0
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] && !this.locked[i]) n++
    return n
  }

  get left(): number {
    return BUDGET - this.placed()
  }

  /**
   * Sets a cell, recording it for undo. Returns false if nothing changed, if
   * the cell is an existing building, or if a new block would overspend.
   */
  set(x: number, y: number, z: number, value: number): boolean {
    if (!this.inBounds(x, y, z)) return false
    const i = Town.index(x, y, z)
    if (this.cells[i] === value || this.locked[i]) return false
    if (value && !this.cells[i] && this.left <= 0) return false
    this.undoStack.push([{ x, y, z, before: this.cells[i], after: value }])
    this.cells[i] = value
    return true
  }

  undo(): boolean {
    const edits = this.undoStack.pop()
    if (!edits) return false
    for (const e of [...edits].reverse()) this.cells[Town.index(e.x, e.y, e.z)] = e.before
    return true
  }

  /** A saved town, put back as it was: its blocks, which are existing buildings, and no undo history. */
  restore(cells: Uint8Array, locked: Uint8Array) {
    if (cells.length !== this.cells.length || locked.length !== this.locked.length) throw new Error(`A saved town has ${cells.length} cells; this grid has ${this.cells.length}`)
    this.cells.set(cells)
    this.locked.set(locked)
    this.undoStack = []
  }

  /** Forget the history: the starting town is where Undo stops. */
  forgetHistory() {
    this.undoStack = []
  }

  get canUndo() {
    return this.undoStack.length > 0
  }

  /** Removes the player's blocks, as one undoable edit; the existing buildings stay. */
  clear() {
    const edits: Edit[] = []
    for (let y = 0; y < H; y++)
      for (let z = 0; z < D; z++)
        for (let x = 0; x < W; x++) {
          const i = Town.index(x, y, z)
          if (this.cells[i] && !this.locked[i]) edits.push({ x, y, z, before: this.cells[i], after: 0 })
        }
    if (!edits.length) return
    for (const e of edits) this.cells[Town.index(e.x, e.y, e.z)] = 0
    this.undoStack.push(edits)
  }

  /**
   * The lawn scenario: two existing buildings eight columns apart — a
   * three-storey block to the west and a two-storey one to the east. A living
   * bridge reaches five, so the plants cannot join them alone: the player has
   * to spend blocks to bring them within reach. Four columns apart (the first
   * try), two bridges formed without a block spent, and there was no decision.
   */
  lawn() {
    this.cells.fill(0)
    this.locked.fill(0)
    const put = (x0: number, x1: number, z0: number, z1: number, h: number, colour: number) => {
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++)
          for (let y = 0; y < h; y++) {
            const i = Town.index(x, y, z)
            this.cells[i] = colour
            this.locked[i] = 1
          }
    }
    put(WEST[0], WEST[0] + 1, WEST[2], WEST[2] + 1, 3, 1)
    put(EAST[0], EAST[0] + 1, EAST[2], EAST[2] + 1, 2, 2)
    this.undoStack = []
  }

  /** Which mass each block belongs to: blocks joined face to face are one building. 0 for empty. */
  masses(): Int32Array {
    const id = new Int32Array(this.cells.length)
    let next = 0
    const stack: number[] = []
    for (let start = 0; start < this.cells.length; start++) {
      if (!this.cells[start] || id[start]) continue
      next++
      id[start] = next
      stack.push(start)
      while (stack.length) {
        const i = stack.pop()!
        const x = i % W
        const z = Math.floor(i / W) % D
        const y = Math.floor(i / (W * D))
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = x + dx
          const ny = y + dy
          const nz = z + dz
          if (!this.inBounds(nx, ny, nz)) continue
          const j = Town.index(nx, ny, nz)
          if (this.cells[j] && !id[j]) {
            id[j] = next
            stack.push(j)
          }
        }
      }
    }
    return id
  }

  /**
   * The colour a new block takes: that of the block it was placed against, so
   * stacking or extending carries a house on; on open ground, a stone from the
   * Site's weighted palette chosen by its position, so the same spot always
   * starts the same colour. There is no colour picker: the town colours itself.
   */
  colourFor(x: number, y: number, z: number, against: [number, number, number] | null): number {
    if (against && this.filled(...against)) return this.get(...against)
    let h = Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    return pickColour(((h ^ (h >>> 16)) >>> 0) / 4294967296)
  }

  count(): number {
    let n = 0
    for (const v of this.cells) if (v) n++
    return n
  }

  tallest(): number {
    let top = 0
    for (let y = 0; y < H; y++) for (let i = 0; i < W * D; i++) if (this.cells[y * W * D + i]) top = y + 1
    return top
  }
}
