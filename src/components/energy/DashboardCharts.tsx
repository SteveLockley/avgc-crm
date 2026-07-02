'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

const COLOURS = ['#166534', '#16a34a', '#4ade80', '#bbf7d0']
type Row = Record<string, string | number>

interface Props {
  data: { month: string; mpan: string; kwh: number }[]
  nameMap: Record<string, string>
}

function CustomTooltip({ active, payload, label, nameMap }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 13 }}>
      <p style={{ fontWeight: 600, marginBottom: 6, color: '#1a1a1a' }}>{label}</p>
      {payload.map((entry: any) => {
        const name = nameMap[entry.dataKey] ?? entry.dataKey
        return (
          <div key={entry.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: entry.fill, flexShrink: 0 }} />
            <span style={{ color: '#555' }}>{name}</span>
            <span style={{ fontWeight: 600, color: '#1a1a1a', marginLeft: 'auto', paddingLeft: 16 }}>{Number(entry.value).toLocaleString()} kWh</span>
          </div>
        )
      })}
    </div>
  )
}

export default function DashboardCharts({ data, nameMap }: Props) {
  const mpans = [...new Set(data.map(d => d.mpan))]
  const byMonth: Record<string, Row> = {}
  for (const row of data) {
    if (!byMonth[row.month]) byMonth[row.month] = { month: row.month }
    byMonth[row.month][row.mpan] = row.kwh
  }
  const chartData = Object.values(byMonth).sort((a, b) => String(a.month).localeCompare(String(b.month)))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis unit=" kWh" tick={{ fontSize: 12 }} width={70} />
        <Tooltip content={<CustomTooltip nameMap={nameMap} />} />
        <Legend formatter={k => nameMap[String(k)] ?? String(k)} />
        {mpans.map((mpan, i) => (
          <Bar key={mpan} dataKey={mpan} name={nameMap[mpan] ?? mpan} fill={COLOURS[i % COLOURS.length]} radius={[2, 2, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
