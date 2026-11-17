import React from 'react'
import PropTypes from 'prop-types'

const WIDTH = 100
const HEIGHT = 40

const isValue = v => v !== null && v !== undefined && Number.isFinite(v)

// Line chart of the last `capacity` values, right-aligned so the newest value
// is always at the right edge. null values break the line.
// yTicks: values on the [yMin, yMax] scale; xTicks: [{ back: samples before newest, label }]
function Sparkline ({ values, capacity, yMin, yMax, yTicks = [], xTicks = [], formatY = String, color = 'currentColor', label }) {
  const range = yMax - yMin || 1
  const step = WIDTH / Math.max(capacity - 1, 1)
  const yPos = v => HEIGHT - ((Math.min(Math.max(v, yMin), yMax) - yMin) / range) * HEIGHT
  const xPct = back => Math.min(Math.max(100 - (back * step / WIDTH) * 100, 0), 100)
  const offset = capacity - values.length

  const segments = []
  let current = []
  values.forEach((v, i) => {
    if (!isValue(v)) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    current.push(`${((offset + i) * step).toFixed(2)},${yPos(v).toFixed(2)}`)
  })
  if (current.length) segments.push(current)

  return (
    <div className="sparkline">
      <div className="sparkline-y">
        {yTicks.map(t => (
          <span key={t} style={{ top: `${(yPos(t) / HEIGHT) * 100}%` }}>{formatY(t)}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <g className="sparkline-grid">
          {yTicks.map(t => <line key={'y' + t} x1="0" x2={WIDTH} y1={yPos(t)} y2={yPos(t)} />)}
          {xTicks.map(t => {
            const x = (xPct(t.back) / 100) * WIDTH
            return <line key={'x' + t.back} x1={x} x2={x} y1="0" y2={HEIGHT} />
          })}
        </g>
        {segments.map((pts, k) => (
          <polyline key={k} points={pts.join(' ')} fill="none" stroke={color}
            strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div />
      <div className="sparkline-x">
        {xTicks.map(t => {
          const pct = xPct(t.back)
          const align = pct <= 0 ? 'translateX(0)' : pct >= 100 ? 'translateX(-100%)' : 'translateX(-50%)'
          return <span key={t.back} style={{ left: `${pct}%`, transform: align }}>{t.label}</span>
        })}
      </div>
    </div>
  )
}

Sparkline.propTypes = {
  values: PropTypes.arrayOf(PropTypes.number).isRequired,
  capacity: PropTypes.number.isRequired,
  yMin: PropTypes.number.isRequired,
  yMax: PropTypes.number.isRequired,
  yTicks: PropTypes.arrayOf(PropTypes.number),
  xTicks: PropTypes.arrayOf(PropTypes.shape({ back: PropTypes.number, label: PropTypes.string })),
  formatY: PropTypes.func,
  color: PropTypes.string,
  label: PropTypes.string
}

export default Sparkline
