import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ConfigPanel } from '../ConfigPanel'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { Workspace } from '../Workspace'
import { TAB_SHOW, creatureSpec, defaultCreatureSettings, type CreatureSettings, type CreatureTab } from '../config/creatureConfig'
import { RULES, TIRED, RESTED, HUNGRY, type RuleId } from '../creatures/behavior'
import { ATTACH_COLOUR, JOINT_COLOURS } from '../creatures/creatureMeshes'
import { CreatureViewport, type DebugShow } from '../creatures/CreatureViewport'
import { EXPLANATIONS } from '../creatures/explanations'
import {
  DISCRETE_LABELS,
  GENES,
  LEG_COUNTS,
  formatGene,
  geneSpec,
  mutate,
  randomGenome,
  repair,
  type GeneChange,
  type GeneGroup,
  type Genome,
  type LegCount,
  type Symmetry,
  type Topology,
} from '../creatures/genome'
import { Lab, effortOf, type LabReport } from '../creatures/lab'
import type { Creature, Joint } from '../creatures/skeleton'
import '../study/study.css'
import '../creatures/creatures.css'

const TABS: { id: CreatureTab; letter: string; title: string }[] = [
  { id: 'body', letter: 'A', title: 'Body' },
  { id: 'anatomy', letter: 'B', title: 'Anatomy' },
  { id: 'motion', letter: 'C', title: 'Motion' },
  { id: 'behavior', letter: 'D', title: 'Behaviour' },
  { id: 'variation', letter: 'E', title: 'Variation' },
]

const DEBUG: { key: keyof DebugShow; label: string; info: string }[] = [
  { key: 'skeleton', label: 'Skeleton', info: 'A line from every joint to its parent: the hierarchy itself. The spine runs from the root at mid-torso forward to the head and back to the tail tip; every limb hangs from a spine joint.' },
  { key: 'joints', label: 'Joints', info: 'A marker on every joint, coloured by kind: spine pale yellow, legs blue, sense organs green, wings and fronds lilac.' },
  { key: 'attachments', label: 'Attachment points', info: 'Where each appendage is fixed to the body: hips, antenna sockets, wing roots, frond roots, the tail base. Each is an anchor — a position along the spine plus an offset in its frame — so it moves with the spine.' },
  { key: 'sensors', label: 'Sensor radius', info: 'On the ground under the head: the sight wedge (range × field of view, from the eyes), the smell ring (antennae) and the touch ring. In the habitat, a ring on each food item perceived now, coloured by the sense that found it.' },
  { key: 'target', label: 'Movement target', info: 'Where it is going and a line to it: the food it seeks, the rock it avoids, its wander goal. In the studio, the circle it walks.' },
  { key: 'path', label: 'Locomotion path', info: 'The trail of the body\'s centre, and a footprint at every touchdown — blue for left feet, green for right. Planted feet do not slide, so each print is exactly where a foot stood.' },
]

const STATE_LABEL: Record<string, string> = { idle: 'Idle', wander: 'Wandering', seek: 'Seeking food', avoid: 'Avoiding obstacle', rest: 'Resting' }

export function CreaturesPage() {
  const [settings, setSettings] = useState<CreatureSettings>(defaultCreatureSettings)
  const [running, setRunning] = useState(true)
  const [stepToken, setStepToken] = useState(0)
  const [frameToken, setFrameToken] = useState(0)
  const [selected, setSelected] = useState(-1)
  const [rep, setRep] = useState<LabReport | null>(null)
  const [changes, setChanges] = useState<GeneChange[]>([])
  const s = settings
  const g = s.genome
  // The lab is built once and steered from here: React state holds the
  // settings, the lab holds the living creature.
  const [lab] = useState(() => new Lab(defaultCreatureSettings().genome, 'studio', 1))

  const scene = s.tab === 'behavior' ? 'habitat' : 'studio'
  const showParent = s.tab === 'variation' && s.parent !== null
  useEffect(() => {
    lab.setGenome(g)
  }, [lab, g])
  useEffect(() => {
    lab.setScene(scene)
  }, [lab, scene])
  useEffect(() => {
    lab.setParent(showParent ? s.parent : null)
  }, [lab, showParent, s.parent])
  useEffect(() => {
    lab.setDrive(s.drive)
    lab.setInPlace(s.inPlace)
  }, [lab, s.drive, s.inPlace])

  const set = <K extends keyof CreatureSettings>(key: K, value: CreatureSettings[K]) => setSettings((c) => ({ ...c, [key]: value }))
  const setGene = <K extends keyof Genome>(key: K, value: Genome[K]) => {
    setSelected(-1)
    setSettings((c) => ({ ...c, genome: repair({ ...c.genome, [key]: value }) }))
  }
  const roll = (seed: number) => {
    const genome = randomGenome(seed)
    setSelected(-1)
    setChanges([])
    lab.reseed(seed)
    setSettings((c) => ({ ...c, seed, genome, origin: genome, parent: null, generation: 0 }))
    setFrameToken((t) => t + 1)
  }
  const resetCreature = () => {
    setSelected(-1)
    setChanges([])
    lab.reset()
    setSettings((c) => ({ ...c, genome: c.origin, parent: null, generation: 0 }))
    setFrameToken((t) => t + 1)
  }
  const doMutate = () => {
    const m = mutate(g, s.mutation, s.seed * 1009 + s.generation + 1)
    setSelected(-1)
    setChanges(m.changes)
    setSettings((c) => ({ ...c, parent: c.genome, genome: m.genome, generation: c.generation + 1 }))
  }

  const onReport = useCallback((r: LabReport) => setRep(r), [])

  const gene = (key: Parameters<typeof geneSpec>[0]) => {
    const spec = geneSpec(key)
    const value = g[key] as number
    return (
      <Slider
        key={key}
        label={spec.label}
        info={spec.info}
        value={value}
        display={spec.format ? spec.format(value) : String(value)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(v) => setGene(key, v as Genome[typeof key])}
      />
    )
  }
  const segmented = <T extends string | number>(label: string, value: T, options: [T, string][], onChange: (v: T) => void) => (
    <div className="segmented creature-segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`segmented-option${value === v ? ' is-active' : ''}`} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
  const toggle = (label: string, info: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <label className="control control-toggle">
      <span className="control-label">
        <InfoTip text={info}>{label}</InfoTip>
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )

  const explanation = EXPLANATIONS[s.tab]
  const c = lab.creature

  return (
    <Workspace
      topic="creatures"
      library={
        <ConfigPanel
          spec={creatureSpec}
          settings={settings}
          onLoad={(next) => {
            setSelected(-1)
            setChanges([])
            lab.reseed(next.seed)
            setSettings(next)
          }}
        />
      }
      inspector={
        <aside className="control-sidebar creature-sidebar" aria-label="Creature lab controls">
          <header className="creature-header">
            <h2>Topic 11: Creatures</h2>
            <p>
              An interactive creature laboratory: a body grown from a genome, legs placed by gait and inverse kinematics,
              senses and decisions that choose how it moves, and mutation that makes the next one.
            </p>
          </header>

          <div className="creature-tabs" role="tablist" aria-label="Systems">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={s.tab === t.id}
                className={`creature-tab${s.tab === t.id ? ' is-active' : ''}`}
                onClick={() => {
                  setSelected(-1)
                  setSettings((cur) => ({ ...cur, tab: t.id, show: { ...TAB_SHOW[t.id] } }))
                }}
              >
                <span className="creature-tab-letter">{t.letter}</span>
                <span className="creature-tab-title">{t.title}</span>
              </button>
            ))}
          </div>
          <p className="creature-lede">{explanation.lede}</p>

          <div className="creature-row">
            <label className="creature-seed">
              <InfoTip text="A seed rolls a whole creature: every gene drawn from the middle of its range, and the body seed that decides each segment's girth and an asymmetric creature's uneven legs. It also lays out the habitat.">Seed</InfoTip>
              <input
                type="number"
                min={1}
                max={9999}
                value={s.seed}
                aria-label="Seed"
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value))
                  if (Number.isFinite(v) && v >= 1 && v <= 9999) roll(v)
                }}
              />
            </label>
            <button type="button" className="reset-button is-primary" onClick={() => roll((s.seed % 9999) + 1)} title="Roll a new creature from the next seed">
              Randomize
            </button>
            <button type="button" className="reset-button" onClick={resetCreature} title="Back to the creature this seed rolled: undo every edit and mutation, and restart the habitat">
              Reset
            </button>
          </div>
          <div className="creature-transport">
            <button type="button" className="reset-button" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setRunning(false)
                setStepToken((t) => t + 1)
              }}
              title="One fixed step of 1/60 s"
            >
              Step
            </button>
          </div>
          <Slider
            label="Animation speed"
            info="Simulated seconds per real second. The step is always 1/60 s; slower runs fewer steps per frame, never shorter ones, so slow motion shows exactly the motion at full speed."
            value={s.animSpeed}
            display={`${s.animSpeed.toFixed(2)}×`}
            min={0.1}
            max={2}
            step={0.05}
            onChange={(v) => set('animSpeed', v)}
          />

          {s.tab === 'body' && (
            <>
              <Group title="Body plan" info="Topology is how the torso is shaped; symmetry is how the appendages are laid out on it.">
                {segmented<Topology>('Topology', g.topology, [['continuous', 'Continuous'], ['segmented', 'Segmented'], ['branching', 'Branching']], (v) => setGene('topology', v))}
                {segmented<Symmetry>('Symmetry', g.symmetry, [['bilateral', 'Bilateral'], ['radial', 'Radial'], ['asymmetric', 'Asymmetric']], (v) => setGene('symmetry', v))}
                {g.symmetry === 'radial' && g.legs < 4 && <p className="hint">Radial symmetry needs four legs or more; with fewer, repair keeps it bilateral.</p>}
                {gene('bodyLength')}
                {gene('bodyWidth')}
                {gene('bodyHeight')}
                {gene('segments')}
                {gene('segmentVariation')}
                {gene('scale')}
              </Group>
              <Group title="Look" info="Colour and markings: genes too, so they are inherited and mutate.">
                {gene('hue')}
                {gene('pattern')}
              </Group>
            </>
          )}

          {s.tab === 'anatomy' && (
            <>
              <Group title="Legs" info="Changing the count rebuilds the skeleton: each leg is a hip, a chain of joints and a gait phase of its own.">
                {segmented<LegCount>('Number of legs', g.legs, LEG_COUNTS.map((n) => [n, String(n)]), (v) => setGene('legs', v))}
                {g.legs > 0 && (
                  <>
                    {gene('legLength')}
                    {gene('legSegments')}
                    {gene('legPlacement')}
                    {gene('legSpread')}
                  </>
                )}
              </Group>
              <Group title="Tail" info="Spine joints behind the torso, skinned like the rest of it.">
                {toggle('Tail', 'A tail is more spine: its joints follow the same path as the body, droop toward the ground and wag with the gait.', g.tail, (v) => setGene('tail', v))}
                {g.tail && (
                  <>
                    {gene('tailLength')}
                    {gene('tailSegments')}
                  </>
                )}
              </Group>
              <Group title="Head and senses" info="The head is an ellipsoid on the front spine joint. Eyes and antennae are joints on it, and they decide what the creature can perceive.">
                {gene('headSize')}
                {gene('eyes')}
                {g.eyes > 0 && (
                  <>
                    {gene('eyeSize')}
                    {gene('eyePlacement')}
                  </>
                )}
                {gene('antennae')}
                {g.antennae > 0 && gene('antennaLength')}
              </Group>
              <Group title="Wings" info="Simplified: three finger bones with a membrane between, folded on the back and beating at a run. They do not fly.">
                {toggle('Wings', 'A pair of wings on the shoulders.', g.wings, (v) => setGene('wings', v))}
                {g.wings && gene('wingSpan')}
              </Group>
            </>
          )}

          {s.tab === 'motion' && (
            <>
              <Group title="Animation" info="The movement command. Walk and run are speeds — 1× and 2.2× the movement speed — and the gait follows from the speed.">
                {segmented('Animation mode', s.drive, [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run']], (v) => set('drive', v))}
                {toggle('Walk in place', 'A treadmill: the ground slides back under the creature so it stays in view. Off, it walks a circle round the pad.', s.inPlace, (v) => set('inPlace', v))}
              </Group>
              <Group title="Gait parameters" info="Genes: they mutate and are saved with the creature.">
                {gene('speed')}
                {gene('stride')}
                {gene('stepHeight')}
                {gene('sway')}
              </Group>
              {rep && <GaitReadout rep={rep} creature={c} />}
            </>
          )}

          {s.tab === 'behavior' && (
            <>
              <Group title="Perception and drive" info="Detection and curiosity are genes. Energy and hunger are the creature's live state: set them and watch it react.">
                {gene('detection')}
                {gene('curiosity')}
                <Slider
                  label="Energy"
                  info={`Falls with movement, by speed² × body mass; rises 0.06 a second at rest. Under ${TIRED} it rests until ${RESTED}.`}
                  value={rep?.energy ?? 0.9}
                  display={(rep?.energy ?? 0.9).toFixed(2)}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => {
                    lab.setNeeds(v, lab.brain.hunger)
                    setRep((r) => (r ? { ...r, energy: v } : r))
                  }}
                />
                <Slider
                  label="Hunger"
                  info={`Rises with time and effort; eating takes 0.55 off. Over ${HUNGRY}, food it perceives is sought.`}
                  value={rep?.hunger ?? 0.3}
                  display={(rep?.hunger ?? 0.3).toFixed(2)}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => {
                    lab.setNeeds(lab.brain.energy, v)
                    setRep((r) => (r ? { ...r, hunger: v } : r))
                  }}
                />
                {toggle('Follow with camera', 'Keep the creature in the middle of the view as it moves; your orbit angle is kept.', s.follow, (v) => set('follow', v))}
              </Group>
              <Group title="Decision rules" info="Read top to bottom every step; the first that holds sets the state. The highlighted rule is the one that fired.">
                <RuleList active={rep?.rule ?? null} />
              </Group>
              <div className="readout creature-readout">
                <SensesLine creature={c} />
                {rep && (
                  <>
                    <br />
                    Perceiving <strong>{rep.perceived.sight}</strong> by sight, <strong>{rep.perceived.smell}</strong> by smell, <strong>{rep.perceived.touch}</strong> by touch · eaten <strong>{rep.eaten}</strong>
                  </>
                )}
              </div>
              <button type="button" className="reset-button" onClick={() => lab.reset()}>
                Restart habitat
              </button>
            </>
          )}

          {s.tab === 'variation' && (
            <>
              <Group title="Mutation" info="Each mutation makes the current creature the parent and builds a child from a copy with a few genes changed.">
                <Slider
                  label="Mutation strength"
                  info="Each gene is hit with probability strength × 0.35 (at least one always), and a hit real gene moves by a Gaussian of σ = strength × 25% of its range."
                  value={s.mutation}
                  display={`${Math.round(s.mutation * 100)}%`}
                  min={0.05}
                  max={1}
                  step={0.05}
                  onChange={(v) => set('mutation', v)}
                />
                <button type="button" className="reset-button is-primary" onClick={doMutate}>
                  Mutate current creature
                </button>
                <p className="hint">
                  Generation <strong>{s.generation}</strong>
                  {s.parent ? ' · the parent stands on the left, its offspring on the right.' : ' · mutate to see a parent and its offspring side by side.'}
                </p>
                {changes.length > 0 && (
                  <ul className="creature-changes" aria-label="Genes changed">
                    {changes.map((ch) => (
                      <li key={ch.gene}>
                        <strong>{ch.label}</strong>: {ch.from} → {ch.to}
                      </li>
                    ))}
                  </ul>
                )}
              </Group>
              <Group title="Genotype" info="Every gene of the creature on screen. The phenotype — skeleton, mesh, gait, senses — is rebuilt from these alone. Highlighted: changed by the last mutation.">
                <Genotype genome={g} changed={new Set(changes.map((ch) => ch.gene))} />
              </Group>
            </>
          )}

          <h3 className="control-group">
            <InfoTip text="Overlays that show how the creature works. They are drawn over the body, so they can be seen through it.">Debug</InfoTip>
          </h3>
          <div className="creature-toggles">
            {DEBUG.map((d) => (
              <label key={d.key} className="control control-toggle">
                <span className="control-label">
                  <InfoTip text={d.info}>{d.label}</InfoTip>
                </span>
                <input type="checkbox" checked={s.show[d.key]} onChange={(e) => setSettings((cur) => ({ ...cur, show: { ...cur.show, [d.key]: e.target.checked } }))} />
              </label>
            ))}
          </div>
          {Object.entries(s.show).some(([k, v]) => v !== TAB_SHOW[s.tab][k as keyof DebugShow]) && (
            <button type="button" className="reset-button" onClick={() => set('show', { ...TAB_SHOW[s.tab] })}>
              This system's overlays
            </button>
          )}

          <h3 className="control-group">
            <InfoTip text="Counted from the creature on screen. Contact error is the furthest any planted foot is from where it was planted, decaying over a third of a second: 0 means the IK reached every stance foot.">Statistics</InfoTip>
          </h3>
          <Stats creature={c} rep={rep} scene={scene} />

          <Explanation id={s.tab} />
        </aside>
      }
    >
      <CreatureViewport
        lab={lab}
        running={running}
        animSpeed={s.animSpeed}
        stepToken={stepToken}
        frameToken={frameToken}
        show={s.show}
        follow={s.follow}
        selected={selected}
        onSelect={setSelected}
        onReport={onReport}
      />
      {selected >= 0 && selected < c.joints.length && <Inspector creature={c} lab={lab} joint={selected} rep={rep} onClose={() => setSelected(-1)} />}
      {scene === 'habitat' && rep?.state && (
        <div className="study-overlay creature-status" role="status">
          <span className="state">{STATE_LABEL[rep.state]}</span>
          {rep.target && <> → {rep.target}</>}
          <br />
          <span className="creature-dim">
            energy {rep.energy.toFixed(2)} · hunger {rep.hunger.toFixed(2)}
          </span>
        </div>
      )}
      {(s.show.joints || s.show.attachments) && <JointLegend />}
    </Workspace>
  )
}

function Group({ title, info, children }: { title: string; info: string; children: ReactNode }) {
  return (
    <>
      <h3 className="control-group">
        <InfoTip text={info}>{title}</InfoTip>
      </h3>
      {children}
    </>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`

function Stats({ creature: c, rep, scene }: { creature: Creature; rep: LabReport | null; scene: 'studio' | 'habitat' }) {
  const tiles: { label: string; value: string; meter?: number }[] = [
    { label: 'Body segments', value: String(c.segments) },
    { label: 'Limbs', value: String(c.limbs.length) },
    { label: 'Joints', value: String(c.joints.length) },
    { label: 'Animation', value: rep ? (rep.gait === 'idle' ? 'Idle' : rep.gait === 'walk' ? 'Walk' : 'Run') : '—' },
    { label: 'Behaviour', value: scene === 'habitat' && rep?.state ? STATE_LABEL[rep.state] : 'Studio' },
    { label: 'Speed, u/s', value: rep ? rep.speed.toFixed(2) : '—' },
    { label: 'Energy', value: rep ? pct(rep.energy) : '—', meter: rep?.energy },
    { label: 'Hunger', value: rep ? pct(rep.hunger) : '—', meter: rep?.hunger },
  ]
  return (
    <>
      <div className="creature-stats">
        {tiles.map((t) => (
          <div key={t.label} className="creature-stat">
            <span className="creature-stat-value" title={t.value}>
              {t.value}
            </span>
            <span className="creature-stat-label">{t.label}</span>
            {t.meter !== undefined && (
              <span className="creature-meter">
                <i style={{ width: `${Math.round(t.meter * 100)}%` }} />
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="readout creature-readout">
        {rep && (
          <>
            {rep.pattern}
            {c.limbs.length > 0 && (
              <>
                {' '}
                · contact error <strong>{rep.contactError.toFixed(3)} u</strong>
              </>
            )}{' '}
            · <strong>{rep.footprints}</strong> footfalls
            {rep.earlySteps > 0 && (
              <>
                {' '}
                (<InfoTip text="Steps a foot took before its turn because the body was about to outrun it — speeding up, or turning hard, mid-stance. The phase schedule assumes the speed and heading it planned for; when they change, the leg steps early rather than leave the ground.">{rep.earlySteps} early</InfoTip>)
              </>
            )}
            <br />
          </>
        )}
        <InfoTip text="Read off the body: mass is the skin's volume at density 1; foot travel is how far a planted foot can go past its hip before the leg is straight (the longest stance allowed); effort is the cube root of mass relative to the default creature, and multiplies the energy cost of moving.">
          mass <strong>{c.traits.mass.toFixed(2)}</strong> · foot travel <strong>{c.traits.footTravel.toFixed(2)} u</strong> · effort <strong>{effortOf(c).toFixed(2)}×</strong>
        </InfoTip>
      </div>
    </>
  )
}

function GaitReadout({ rep, creature }: { rep: LabReport; creature: Creature }) {
  const legs = creature.limbs
  const rowH = 11
  const labelW = 26
  const W = 260
  const H = Math.max(1, legs.length) * rowH + 6
  const x = (t: number) => labelW + t * (W - labelW - 4)
  const head = ((rep.phase % 1) + 1) % 1
  return (
    <>
      <h3 className="control-group">
        <InfoTip text="A footfall diagram over one gait cycle: one row per leg, filled where the foot is on the ground. Legs whose bars line up move together; the duty factor is the length of each bar. The line is now.">Gait</InfoTip>
      </h3>
      <div className="readout creature-readout">
        <strong>{rep.pattern}</strong>
        {legs.length > 0 && rep.gait !== 'idle' && <> · duty <strong>{rep.duty.toFixed(2)}</strong></>}
        <br />
        {rep.gait === 'idle' ? (
          <span className="creature-dim">standing — the clock stops once every foot is back under its hip</span>
        ) : (
          <>
            cycle <strong>{rep.cycle.toFixed(2)} s</strong> = stride <strong>{rep.stride.toFixed(2)} u</strong> ÷ speed <strong>{rep.speed.toFixed(2)} u/s</strong>
            <br />
            <span className="creature-dim">top speed the legs allow {rep.maxSpeed.toFixed(2)} u/s</span>
          </>
        )}
      </div>
      {legs.length > 0 && (
        <svg className="creature-gait" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Footfall diagram">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t} className="grid" x1={x(t)} x2={x(t)} y1={2} y2={H - 2} />
          ))}
          {legs.map((l, i) => {
            const off = rep.offsets[i] ?? 0
            // Stance where (t + offset) mod 1 < duty: one or two bars across [0, 1).
            const start = (((-off) % 1) + 1) % 1
            const end = start + rep.duty
            const y = 3 + i * rowH
            const bars = end <= 1 ? [[start, end]] : [[start, 1], [0, end - 1]]
            return (
              <g key={l.index}>
                <text x={2} y={y + 8}>
                  {l.name.replace('Leg ', '')}
                </text>
                {bars.map(([a, b]) => (
                  <rect key={a} className={`stance${l.side > 0 ? ' is-right' : ''}`} x={x(a)} y={y + 1} width={Math.max(0, x(b) - x(a))} height={rowH - 3} rx={2} />
                ))}
              </g>
            )
          })}
          <line className="playhead" x1={x(head)} x2={x(head)} y1={1} y2={H - 1} />
        </svg>
      )}
    </>
  )
}

function RuleList({ active }: { active: RuleId | null }) {
  return (
    <ol className="creature-rules" aria-label="Decision rules, in order">
      {RULES.map((r) => (
        <li key={r.id} className={active === r.id ? 'is-active' : undefined}>
          <span>{r.when}</span>
          <span className="creature-rule-to">→ {STATE_LABEL[r.then]}</span>
        </li>
      ))}
    </ol>
  )
}

function SensesLine({ creature: c }: { creature: Creature }) {
  const s = c.senses
  return (
    <InfoTip text="Computed from the anatomy. Sight range is the detection radius × (0.75 + eye size); the field of view runs from 120° for forward eyes to 300° for side eyes, and radial creatures see all round. Antennae smell all round; touch reaches just past the body.">
      {s.fov > 0 ? (
        <>
          sight <strong>{s.sight.toFixed(1)} u</strong> over <strong>{Math.round(s.fov)}°</strong>
        </>
      ) : (
        <>no eyes</>
      )}{' '}
      · smell <strong>{s.smell > 0 ? `${s.smell.toFixed(1)} u` : 'none'}</strong> · touch <strong>{s.touch.toFixed(1)} u</strong>
    </InfoTip>
  )
}

const GROUP_LABEL: Record<GeneGroup, string> = { body: 'Body', anatomy: 'Anatomy', motion: 'Locomotion', behaviour: 'Behaviour', look: 'Look' }

function Genotype({ genome, changed }: { genome: Genome; changed: Set<keyof Genome> }) {
  const rows: ReactNode[] = []
  const discrete: (keyof Genome)[] = ['topology', 'symmetry', 'legs', 'tail', 'wings']
  rows.push(<h4 key="h-plan">Plan</h4>)
  for (const k of discrete) {
    const cls = changed.has(k) ? ' is-changed' : ''
    rows.push(<span key={`${k}-l`} className={`gene-k${cls}`}>{DISCRETE_LABELS[k]}</span>)
    rows.push(<span key={`${k}-v`} className={`gene-v${cls}`}>{formatGene(k, genome[k])}</span>)
  }
  for (const grp of Object.keys(GROUP_LABEL) as GeneGroup[]) {
    rows.push(<h4 key={`h-${grp}`}>{GROUP_LABEL[grp]}</h4>)
    for (const spec of GENES.filter((x) => x.group === grp)) {
      const cls = changed.has(spec.key) ? ' is-changed' : ''
      rows.push(<span key={`${spec.key}-l`} className={`gene-k${cls}`}>{spec.label}</span>)
      rows.push(<span key={`${spec.key}-v`} className={`gene-v${cls}`}>{formatGene(spec.key, genome[spec.key])}</span>)
    }
  }
  rows.push(<span key="seed-l" className="gene-k">Body seed</span>)
  rows.push(<span key="seed-v" className="gene-v">{genome.bodySeed}</span>)
  return <div className="creature-genes">{rows}</div>
}

const KIND_LABEL: Record<Joint['kind'], string> = {
  root: 'Root of the hierarchy',
  spine: 'Spine joint',
  tail: 'Tail joint',
  head: 'Head',
  hip: 'Hip — attachment point',
  coxa: 'Coxa',
  knee: 'Knee (solved by IK)',
  ankle: 'Ankle',
  toe: 'Toe — contact point',
  digit: 'Digit (branch)',
  eye: 'Eye — sensor',
  antenna: 'Antenna joint — sprung',
  wing: 'Wing joint',
  frond: 'Frond joint — branching structure',
}

function Inspector({ creature: c, lab, joint, rep, onClose }: { creature: Creature; lab: Lab; joint: number; rep: LabReport | null; onClose: () => void }) {
  const j = c.joints[joint]
  const path: string[] = []
  for (let k = joint; k >= 0; k = c.joints[k].parent) path.unshift(c.joints[k].name)
  const children = c.joints.filter((x) => x.parent === joint).length
  const limb = c.limbs.find((l) => l.joints.includes(joint) || l.digits.includes(joint))
  const legIndex = limb ? limb.index : -1
  const eye = c.eyes.find((e) => e.joint === joint)
  const antenna = c.antennae.find((a) => a.joints.includes(joint))
  const spineAt = c.spine.indexOf(joint)
  let detail: ReactNode = null
  if (limb) {
    const st = lab.body.legs[legIndex]
    detail = (
      <>
        {limb.name}: {limb.lengths.length} bones of {limb.lengths.map((x) => x.toFixed(2)).join(' + ')} u · IK reach {(limb.a + limb.b).toFixed(2)} u
        <br />
        gait offset <strong>{(rep?.offsets[legIndex] ?? 0).toFixed(2)}</strong> · now <strong>{rep?.stance[legIndex] ? 'stance (planted)' : 'swing'}</strong>
        {st && st.planted && st.error > 1e-4 && <> · {st.error.toFixed(3)} u from its planted point</>}
      </>
    )
  } else if (eye) {
    detail = (
      <>
        Radius {eye.radius.toFixed(2)} u. Together the eyes see <strong>{Math.round(c.senses.fov)}°</strong> to <strong>{c.senses.sight.toFixed(1)} u</strong>.
      </>
    )
  } else if (antenna) {
    detail = (
      <>
        A chain of {antenna.joints.length} point masses, {antenna.segment.toFixed(2)} u apart, stiffness {antenna.stiffness.toFixed(2)}: Verlet-integrated and held at length, so it lags behind the head and springs back.
      </>
    )
  } else if (spineAt >= 0) {
    const x = c.spineX[spineAt]
    const ring = c.rings.reduce((best, r) => (Math.abs(r.x - x) < Math.abs(best.x - x) ? r : best), c.rings[0])
    detail = (
      <>
        Bone {spineAt + 1} of {c.spine.length} in the spine, {(c.spineX[c.spine.length - 1] - x).toFixed(2)} u behind the head on its path.
        {joint !== c.head && (
          <>
            {' '}
            Girth here {(ring.hw * 2).toFixed(2)} × {(ring.hh * 2).toFixed(2)} u; the skin either side is weighted between this bone and its neighbour.
          </>
        )}
      </>
    )
  } else if (j.kind === 'root') {
    detail = <>The middle of the torso. Every other joint is a descendant: {c.joints.length - 1} of them.</>
  }
  return (
    <div className="study-overlay creature-inspector" role="dialog" aria-label="Selected joint">
      <button type="button" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h3>{j.name}</h3>
      <div className="creature-path">{path.join(' › ')}</div>
      <div>
        {KIND_LABEL[j.kind]} · {children} child joint{children === 1 ? '' : 's'}
      </div>
      {detail && <div className="creature-dim" style={{ marginTop: 4 }}>{detail}</div>}
    </div>
  )
}

function JointLegend() {
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
  const keys: [string, number][] = [
    ['Spine', JOINT_COLOURS.spine],
    ['Legs', JOINT_COLOURS.knee],
    ['Senses', JOINT_COLOURS.eye],
    ['Wings, fronds', JOINT_COLOURS.wing],
    ['Attachment', ATTACH_COLOUR],
  ]
  return (
    <div className="study-overlay study-legend creature-legend" aria-hidden="true">
      {keys.map(([label, colour]) => (
        <span key={label} className="legend-key">
          <span className="dot" style={{ background: hex(colour) }} />
          {label}
        </span>
      ))}
    </div>
  )
}

function Explanation({ id }: { id: CreatureTab }) {
  const e = EXPLANATIONS[id]
  return (
    <section className="creature-explain" aria-label="How it works">
      <h3 className="control-group">How it works</h3>
      <dl>
        <dt>Concept</dt>
        <dd>{e.concept}</dd>
        <dt>Algorithm</dt>
        <dd>{e.algorithm}</dd>
        <dt>Parameters</dt>
        <dd>{e.parameters}</dd>
        <dt>In Wildform</dt>
        <dd>{e.application}</dd>
      </dl>
    </section>
  )
}
