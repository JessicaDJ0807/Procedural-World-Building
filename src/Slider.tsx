import { InfoTip } from './InfoTip'

type SliderProps = {
  label: string
  /** Shown on hover over the label. Omit for controls that explain themselves. */
  info?: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

export function Slider({ label, info, value, display, min, max, step, onChange }: SliderProps) {
  return (
    <label className="control">
      <span className="control-label">
        {info ? <InfoTip text={info}>{label}</InfoTip> : label}
        <span className="control-value">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
