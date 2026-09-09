type SliderProps = {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

export function Slider({ label, value, display, min, max, step, onChange }: SliderProps) {
  return (
    <label className="control">
      <span className="control-label">
        {label}
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
