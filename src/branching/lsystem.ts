/**
 * The grammar: a string rewritten in parallel, nothing more.
 *
 * Every symbol of the current string is replaced by its production at once —
 * that parallelism is what separates an L-system from an ordinary rewriting
 * grammar, and it is why a branch that appears early has been rewritten more
 * times than one that appears late: the lower limbs of a conifer are longer
 * because they are older. Symbols with no production copy themselves.
 *
 * This module knows nothing about turtles or geometry. `F`, `+` and `[` are
 * only characters here; `skeleton.ts` decides what they mean.
 */

export type Productions = Record<string, string>

export type Expansion = {
  /** The final string, after every iteration that fit under the cap. */
  text: string
  /** Length after each step, iteration 0 (the axiom) first. */
  lengths: number[]
  /** Count of `F` after each step: the segments the turtle will draw. */
  draws: number[]
  /** Fewer than requested when the cap stopped the expansion. */
  iterations: number
  truncated: boolean
  ms: number
}

/**
 * The longest string the expander will produce.
 *
 * L-systems grow geometrically — `F → FF` doubles, `F → F[+F]F[-F]F` grows
 * fivefold — so one extra iteration on the wrong grammar is a frozen tab. At
 * this length a turtle walk and a mesh build still finish in tens of
 * milliseconds; the readout says when an iteration was refused.
 */
export const MAX_SYMBOLS = 250_000

/**
 * `X=F[+X]F[-X]+X` lines, one production each. Blank lines and anything that
 * is not `<one symbol>=<string>` are ignored rather than rejected, so a rule
 * half-typed in the editor degrades to "no rule" instead of an error.
 * `→` and `->` are accepted because that is how the textbook writes them.
 */
export function parseProductions(source: string): Productions {
  const rules: Productions = {}
  for (const raw of source.split(/[\n;]/)) {
    const line = raw.replace(/\s+/g, '').replace('->', '=').replace('→', '=')
    const at = line.indexOf('=')
    if (at !== 1) continue
    rules[line[0]] = line.slice(2)
  }
  return rules
}

export function formatProductions(rules: Productions): string {
  return Object.entries(rules)
    .map(([symbol, body]) => `${symbol} = ${body}`)
    .join('\n')
}

const countDraws = (text: string) => {
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 70 /* F */) n++
  return n
}

export function expand(axiom: string, rules: Productions, iterations: number): Expansion {
  const started = performance.now()
  let text = axiom.replace(/\s+/g, '')
  const lengths = [text.length]
  const draws = [countDraws(text)]
  let done = 0
  let truncated = false

  for (let step = 0; step < iterations; step++) {
    // The next length is known before building the string, so an iteration
    // that would blow the cap is refused whole rather than cut off mid-string —
    // a half-rewritten string would draw a tree that no grammar describes.
    let nextLength = 0
    for (let i = 0; i < text.length; i++) nextLength += rules[text[i]]?.length ?? 1
    if (nextLength > MAX_SYMBOLS) {
      truncated = true
      break
    }
    const parts: string[] = new Array(text.length)
    for (let i = 0; i < text.length; i++) parts[i] = rules[text[i]] ?? text[i]
    text = parts.join('')
    lengths.push(text.length)
    draws.push(countDraws(text))
    done++
  }

  return { text, lengths, draws, iterations: done, truncated, ms: performance.now() - started }
}
