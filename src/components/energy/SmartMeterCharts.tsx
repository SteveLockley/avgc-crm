'use client'

import { AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

interface Props {
  loadProfile: { interval_time: string; avg_kwh: number; min_kwh: number; max_kwh: number; base_kwh?: number | null }[]
  dailyTotals: { reading_date: string; total_kwh: number }[]
  heatmap:     any[]  // kept in props for backwards compat, no longer rendered
}

const sectionHead: React.CSSProperties = { fontWeight: 600, color: '#1a1a1a', margin: '0 0 4px', fontSize: '0.9375rem' }
const sectionNote: React.CSSProperties = { fontSize: 12, color: '#888', margin: '0 0 12px' }
const section: React.CSSProperties = { marginBottom: 36 }

export default function SmartMeterCharts({ loadProfile, dailyTotals }: Props) {
  const tickEvery4 = (_v: string, i: number) => i % 4 === 0 ? _v : ''
  const mondayTick = (v: string) => new Date(v).getDay() === 1 ? v.slice(5) : ''

  return (
    <div>
      <div style={section}>
        <p style={sectionHead}>Average daily load profile</p>
        <p style={sectionNote}>Average kWh per 30-minute slot across all recorded days</p>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={loadProfile} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="interval_time" tickFormatter={tickEvery4} tick={{ fontSize: 11 }} />
            <YAxis unit=" kWh" tick={{ fontSize: 11 }} width={64} />
            <Tooltip formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(4)} kWh`, String(name)]} />
            <Area type="monotone" dataKey="max_kwh" stroke="#bbf7d0" strokeWidth={1} fill="#dcfce7" name="Max" />
            <Area type="monotone" dataKey="avg_kwh" stroke="#16a34a" fill="#4ade80" fillOpacity={0.5} strokeWidth={2} name="Avg" />
            <Area type="monotone" dataKey="min_kwh" stroke="#166534" strokeWidth={1.5} strokeDasharray="4 2" fill="#ffffff" fillOpacity={1} name="Min" />
            <Line type="monotone" dataKey="base_kwh" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Base load" connectNulls />
            <Legend />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginBottom: 8 }}>
        <p style={sectionHead}>Daily total consumption</p>
        <p style={sectionNote}>Total kWh per day — Mon labels shown</p>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={dailyTotals} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="reading_date" tickFormatter={mondayTick} tick={{ fontSize: 11 }} />
            <YAxis unit=" kWh" tick={{ fontSize: 11 }} width={64} />
            <Tooltip formatter={(v: unknown) => [`${Number(v).toFixed(2)} kWh`]} labelFormatter={(l: unknown) => `Date: ${l}`} />
            <Area type="monotone" dataKey="total_kwh" name="kWh" stroke="#166534" fill="#86efac" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
