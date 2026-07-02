'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar, Cell } from 'recharts'

// Distinct, readable colours for stacked circuit areas
const PALETTE = [
  '#16a34a', // green
  '#0891b2', // cyan
  '#7c3aed', // purple
  '#dc2626', // red
  '#d97706', // amber
  '#0369a1', // blue
  '#065f46', // dark teal
  '#92400e', // brown
]

interface Circuit { circuit: string; label: string; total_kwh?: number }

interface Props {
  circuits:      Circuit[]
  dailyTotals:   Record<string, number>[]
  hourlyProfile: Record<string, number>[]
  hourlyMain:    { hour: number; avg_kwh: number; max_kwh: number; min_kwh: number }[]
}

const sectionHead: React.CSSProperties = { fontWeight: 600, color: '#1a1a1a', margin: '0 0 4px', fontSize: '0.9375rem' }
const sectionNote: React.CSSProperties = { fontSize: 12, color: '#888', margin: '0 0 12px' }
const section: React.CSSProperties = { marginBottom: 36 }

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`
const mondayTick = (v: string) => { try { return new Date(v).getDay() === 1 ? v.slice(5) : '' } catch { return '' } }

export default function LoggerCharts({ circuits, dailyTotals, hourlyMain }: Props) {
  // Only circuits with actual data (excludes unconnected ports)
  const subCircuits = circuits.filter(c => c.circuit !== 'main' && (c.total_kwh ?? 0) > 0)
  const activeTotals = circuits.filter(c => (c.total_kwh ?? 0) > 0)

  return (
    <div>
      {/* Load profile — same style as tractor shed: max envelope + avg + min */}
      <div style={section}>
        <p style={sectionHead}>Average daily load profile</p>
        <p style={sectionNote}>Average kWh per hour across all recorded days</p>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={hourlyMain} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="hour" tickFormatter={hourLabel} tick={{ fontSize: 11 }} interval={1} />
            <YAxis unit=" kWh" tick={{ fontSize: 11 }} width={64} />
            <Tooltip
              formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(4)} kWh`, String(name)]}
              labelFormatter={(h: unknown) => hourLabel(Number(h))}
            />
            <Area type="monotone" dataKey="max_kwh" stroke="#bbf7d0" strokeWidth={1} fill="#dcfce7" name="Max" />
            <Area type="monotone" dataKey="avg_kwh" stroke="#16a34a" fill="#4ade80" fillOpacity={0.5} strokeWidth={2} name="Avg" />
            <Area type="monotone" dataKey="min_kwh" stroke="#166534" strokeWidth={1.5} strokeDasharray="4 2" fill="#ffffff" fillOpacity={1} name="Min" />
            <Legend />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Daily totals — stacked area by active sub-circuits only */}
      {subCircuits.length > 0 && (
        <div style={section}>
          <p style={sectionHead}>Daily consumption by circuit</p>
          <p style={sectionNote}>Total kWh per day broken down by circuit — Mon labels shown</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyTotals} reverseStackOrder margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={mondayTick} tick={{ fontSize: 11 }} />
              <YAxis unit=" kWh" tick={{ fontSize: 11 }} width={64} />
              <Tooltip labelFormatter={(l: unknown) => `Date: ${l}`} formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(3)} kWh`, String(name)]} />
              <Legend />
              {subCircuits.map((c, i) => (
                <Area
                  key={c.circuit}
                  type="monotone"
                  dataKey={c.circuit}
                  name={c.label}
                  stackId="a"
                  stroke={PALETTE[i % PALETTE.length]}
                  fill={PALETTE[i % PALETTE.length]}
                  fillOpacity={0.75}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Circuit totals — horizontal bar, active circuits only */}
      {activeTotals.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p style={sectionHead}>Circuit totals (all time)</p>
          <p style={sectionNote}>Total kWh recorded per circuit</p>
          <ResponsiveContainer width="100%" height={Math.max(160, activeTotals.length * 44)}>
            <BarChart
              data={activeTotals.map(c => ({ name: c.label, kwh: c.total_kwh ?? 0 }))}
              layout="vertical"
              margin={{ top: 4, right: 32, bottom: 4, left: 90 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" unit=" kWh" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={88} />
              <Tooltip formatter={(v: unknown) => [`${Number(v).toFixed(2)} kWh`, 'Total']} />
              <Bar dataKey="kwh" name="kWh" radius={[0, 3, 3, 0]}>
                {activeTotals.map((c, i) => (
                  <Cell
                    key={c.circuit}
                    fill={c.circuit === 'main' ? '#1e5631' : PALETTE[i % PALETTE.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
