'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

const COLOURS = ['#166534', '#16a34a', '#4ade80', '#bbf7d0']
type Row = Record<string, string | number>

interface Props {
  data: { month: string; mpan: string; kwh: number; cost: number }[]
  nameMap: Record<string, string>
}

function makeTooltip(nameMap: Record<string, string>, unit: 'kwh' | 'cost') {
  return function CustomTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 13 }}>
        <p style={{ fontWeight: 600, marginBottom: 6, color: '#1a1a1a' }}>{label}</p>
        {payload.map((entry: any) => {
          const mpan = String(entry.dataKey).replace(/^(kwh|cost)_/, '')
          const name = nameMap[mpan] ?? mpan
          const val = unit === 'kwh'
            ? `${Number(entry.value).toLocaleString()} kWh`
            : `£${Number(entry.value).toFixed(2)}`
          return (
            <div key={entry.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: entry.fill, flexShrink: 0 }} />
              <span style={{ color: '#555' }}>{name}</span>
              <span style={{ fontWeight: 600, color: '#1a1a1a', marginLeft: 'auto', paddingLeft: 16 }}>{val}</span>
            </div>
          )
        })}
      </div>
    )
  }
}

export default function BillsCharts({ data, nameMap }: Props) {
  const mpans = [...new Set(data.map(d => d.mpan))]
  const byMonth: Record<string, Row> = {}
  for (const row of data) {
    if (!byMonth[row.month]) byMonth[row.month] = { month: row.month }
    byMonth[row.month][`kwh_${row.mpan}`]  = row.kwh
    byMonth[row.month][`cost_${row.mpan}`] = row.cost
  }
  const chartData = Object.values(byMonth).sort((a, b) => String(a.month).localeCompare(String(b.month)))
  const label = (k: string) => nameMap[k.replace(/^(kwh|cost)_/, '')] ?? k

  const KwhTooltip  = makeTooltip(nameMap, 'kwh')
  const CostTooltip = makeTooltip(nameMap, 'cost')

  return (
    <div>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12, marginTop: 0 }}>kWh consumed per meter per month</p>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis unit=" kWh" tick={{ fontSize: 12 }} width={70} />
          <Tooltip content={<KwhTooltip />} />
          <Legend formatter={k => label(String(k))} />
          {mpans.map((mpan, i) => (
            <Bar key={mpan} dataKey={`kwh_${mpan}`} name={`kwh_${mpan}`} fill={COLOURS[i % COLOURS.length]} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <p style={{ fontSize: 13, color: '#666', marginBottom: 12, marginTop: 28 }}>Invoice cost (£) per meter per month</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis unit="£" tick={{ fontSize: 12 }} width={64} />
          <Tooltip content={<CostTooltip />} />
          <Legend formatter={k => label(String(k))} />
          {mpans.map((mpan, i) => (
            <Bar key={mpan} dataKey={`cost_${mpan}`} name={`cost_${mpan}`} fill={COLOURS[i % COLOURS.length]} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
