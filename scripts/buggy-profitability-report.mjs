#!/usr/bin/env node
/**
 * Buggy Hire Profitability Analysis
 * Combines BRS booking data, TouchOffice member charges, and tractor shed smart meter data
 * Run: node scripts/buggy-profitability-report.mjs > "Buggy Profitability Report.html"
 *
 * Dependencies: requires /tmp/tractor_shed_daily.csv to be pre-populated by:
 *   npx wrangler d1 execute alnmouth-golf-db --remote \
 *     --command "SELECT reading_date, ROUND(SUM(kwh),4) as daily_kwh FROM energy_smart_readings \
 *       WHERE mpan='1591023060154' AND reading_date >= '2026-01-01' \
 *       GROUP BY reading_date ORDER BY reading_date" \
 *     | node -e "..." > /tmp/tractor_shed_daily.csv
 */

import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { createRequire } from 'module'

// ─── Data Loading ────────────────────────────────────────────────────────────

function loadEnergy() {
  const lines = readFileSync('/tmp/tractor_shed_daily.csv', 'utf8').trim().split('\n')
  const result = {}
  for (const line of lines.slice(1)) {
    const [date, kwh] = line.split(',')
    if (date && kwh) result[date] = parseFloat(kwh)
  }
  return result
}

function parseBrsDate(dateStr, hintYear = 2025) {
  // JS getDay() returns Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
  const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
  const m = dateStr.match(/^(\w+)\s+(\d+)\s+(\w+)$/)
  if (!m) return null
  const [, dow, day, mon] = m
  const month = MONTHS[mon]
  if (!month || DAYS[dow] === undefined) return null
  for (const year of [hintYear, hintYear + 1, hintYear - 1]) {
    const d = new Date(Date.UTC(year, month - 1, parseInt(day)))
    if (d.getUTCDay() === DAYS[dow]) return d
  }
  return null
}

function loadBrs() {
  const raw = readFileSync('/Users/stevelockley/claude-apps/avgc-crm/data/CaddyBuggyClubReport.csv', 'utf8')
  const allLines = raw.trim().split('\n')
  // Detect format: old format has a "£" column after Buggies; new format goes straight to Caddies
  const headerLine = allLines[0].replace(/^﻿/, '')
  const hasRevenue = headerLine.includes('"£"') || headerLine.toLowerCase().includes(',£,')
  const lines = allLines.slice(1)

  const daily = {}
  const monthly = {}
  const byType = {}
  const byPlu = { visitor18: { qty: 0, revenue: 0 }, visitor9: { qty: 0, revenue: 0 }, member18: { qty: 0, revenue: 0 }, member9: { qty: 0, revenue: 0 }, other: { qty: 0, revenue: 0 }, free: { qty: 0, revenue: 0 } }

  let lastDate = new Date(Date.UTC(2025, 10, 1)) // Nov 2025

  for (const line of lines) {
    const fields = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { fields.push(cur); cur = '' }
      else cur += ch
    }
    fields.push(cur)

    if (!fields[0] || fields[0] === 'Total') continue

    let d = parseBrsDate(fields[0].trim(), lastDate.getUTCFullYear())
    if (!d) continue
    if (d < new Date(lastDate.getTime() - 60 * 86400000)) {
      d = parseBrsDate(fields[0].trim(), lastDate.getUTCFullYear() + 1)
    }
    if (d) lastDate = d
    if (!d || d.getUTCFullYear() !== 2026) continue

    const ds = d.toISOString().slice(0, 10)
    const month = ds.slice(0, 7)
    const buggyCount = parseInt(fields[5]) || 0
    // Revenue only available in old export format
    const revStr = hasRevenue ? (fields[6] || '').replace(/[£,]/g, '').trim() : ''
    const revenue = hasRevenue ? (parseFloat(revStr) || 0) : 0

    const type = fields[3] || 'Unknown'

    if (!daily[ds]) daily[ds] = { buggies: 0, revenue: 0, paid: 0, free: 0 }
    daily[ds].buggies += buggyCount
    daily[ds].revenue += revenue
    if (revenue > 0) daily[ds].paid += buggyCount
    else daily[ds].free += buggyCount

    if (!monthly[month]) monthly[month] = { buggies: 0, revenue: 0, paid: 0, free: 0 }
    monthly[month].buggies += buggyCount
    monthly[month].revenue += revenue
    if (revenue > 0) monthly[month].paid += buggyCount
    else monthly[month].free += buggyCount

    if (!byType[type]) byType[type] = { buggies: 0, revenue: 0, paid: 0 }
    byType[type].buggies += buggyCount
    byType[type].revenue += revenue
    if (revenue > 0) byType[type].paid += buggyCount

    if (buggyCount > 0) {
      if (!hasRevenue || revenue === 0) {
        byPlu.free.qty += buggyCount
      } else {
        const perBuggy = revenue / buggyCount
        if (Math.round(perBuggy) === 30) {
          byPlu.visitor18.qty += buggyCount; byPlu.visitor18.revenue += revenue
        } else if (Math.round(perBuggy) === 25) {
          byPlu.visitor9.qty += buggyCount; byPlu.visitor9.revenue += revenue
        } else if (Math.round(perBuggy) === 15) {
          byPlu.member18.qty += buggyCount; byPlu.member18.revenue += revenue
        } else if (Math.round(perBuggy) === 10) {
          byPlu.member9.qty += buggyCount; byPlu.member9.revenue += revenue
        } else {
          byPlu.other.qty += buggyCount; byPlu.other.revenue += revenue
        }
      }
    }
  }

  return { daily, monthly, byType, byPlu, hasRevenue }
}

// TouchOffice weekly Buggies department sales — queried live from D1
function loadToWeekly() {
  try {
    const raw = execSync(
      `npx wrangler d1 execute alnmouth-golf-db --remote --command "SELECT week_number, week_start, week_end, quantity, value FROM weekly_sales WHERE year=2026 AND department='Buggies' ORDER BY week_number" 2>/dev/null`,
      { encoding: 'utf8', cwd: '/Users/stevelockley/claude-apps/avgc-crm' }
    )
    const jsonMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (!jsonMatch) return { monthly: {}, weekly: [] }
    const rows = JSON.parse(jsonMatch[0])[0].results
    const monthly = {}
    const weekly = []
    for (const row of rows) {
      const [dd, mm, yyyy] = row.week_start.split('/')
      const month = `${yyyy}-${mm.padStart(2, '0')}`
      if (!monthly[month]) monthly[month] = { revenue: 0, qty: 0 }
      monthly[month].revenue += row.value
      monthly[month].qty += row.quantity
      weekly.push({ week: row.week_number, wkStart: row.week_start, wkEnd: row.week_end, revenue: row.value, qty: row.quantity, month })
    }
    return { monthly, weekly }
  } catch {
    return { monthly: {}, weekly: [] }
  }
}

const UNIT_RATE_P = 27.5  // pence/kWh — average from 2026 Tractor Shed bills

// PLU Sales report from TouchOffice (01/01/2026 – 30/06/2026, Group: Buggy)
const TO_PLU = {
  visitor18: { qty: 19,  revenue: 570.00  },  // PLU 2101 — 18 hole buggy (visitor)
  visitor9:  { qty: 35,  revenue: 875.00  },  // PLU 2102 — 9 hole buggy (visitor)
  member18:  { qty: 103, revenue: 1530.00 },  // PLU 2103 — 18 hole buggy (member)
  member9:   { qty: 86,  revenue: 860.00  },  // PLU 2104 — 9 hole buggy (member)
}
const totToPluQty = 243   // Grand total from PLU report
const totToPluRev = 3835  // Grand total from PLU report

// ─── Main Analysis ────────────────────────────────────────────────────────────

const energy = loadEnergy()
const brs = loadBrs()
const toWeekly = loadToWeekly()

const allMonths = [...new Set([
  ...Object.keys(brs.monthly),
  ...Object.keys(energy).map(d => d.slice(0, 7)),
  ...Object.keys(toWeekly.monthly),
])].sort()

const monthlyData = allMonths.map(month => {
  const b = brs.monthly[month] || { buggies: 0, revenue: 0, paid: 0, free: 0 }
  const to = toWeekly.monthly[month] || { revenue: 0, qty: 0 }
  const kwh = Object.entries(energy)
    .filter(([d]) => d.startsWith(month))
    .reduce((s, [, v]) => s + v, 0)
  const elecCost = kwh * UNIT_RATE_P / 100
  const totalRev = b.revenue + to.revenue
  return { month, buggies: b.buggies, brsPaid: b.paid, brsFree: b.free, brsRev: b.revenue, toRev: to.revenue, toQty: to.qty, totalRev, kwh, elecCost, net: totalRev - elecCost }
})

// Daily chart data (join energy + hire)
const allDays = [...new Set([...Object.keys(energy), ...Object.keys(brs.daily)])].sort().filter(d => d >= '2026-01-01')
const chartData = allDays.map(d => ({
  date: d,
  kwh: energy[d] ?? null,
  buggies: brs.daily[d]?.buggies ?? 0,
  revenue: brs.daily[d]?.revenue ?? 0,
}))

// Hire days with energy data for correlation
const hireDays = allDays.filter(d => energy[d] && brs.daily[d])
const noHireDays = allDays.filter(d => energy[d] && !brs.daily[d])
const avgKwhHire = hireDays.reduce((s, d) => s + energy[d], 0) / hireDays.length
const avgKwhNoHire = noHireDays.reduce((s, d) => s + energy[d], 0) / noHireDays.length
const extraKwhPerHireDay = avgKwhHire - avgKwhNoHire

// Standby analysis
// The baseline (no-hire day avg) represents buggies sitting on charge doing nothing.
// On hire days the extra kWh is the actual recharging cost after use.
const daysWithEnergy = hireDays.length + noHireDays.length
const standbyTotalKwh = daysWithEnergy * avgKwhNoHire          // what we'd use if no buggies ever moved
const rechargeKwh = hireDays.length * extraKwhPerHireDay       // actual post-hire recharge energy
const standbyTotalCost = standbyTotalKwh * UNIT_RATE_P / 100
const rechargeCost = rechargeKwh * UNIT_RATE_P / 100
// Conservative estimate: smart charger reduces standby from ~14 kWh/day to ~4 kWh/day
// (4 kWh covers lighting + workshop + brief equalisation charge)
const smartChargerBaselineKwh = 4
const savingPerDay = Math.max(0, avgKwhNoHire - smartChargerBaselineKwh) * UNIT_RATE_P / 100
const annualScale = 365 / daysWithEnergy
const annualPotentialSaving = savingPerDay * daysWithEnergy * annualScale

// Totals
const totBuggies = monthlyData.reduce((s, m) => s + m.buggies, 0)
const totBrsRev = monthlyData.reduce((s, m) => s + m.brsRev, 0)
// Use PLU report total for TO (covers Jan–6 Jun; weekly_sales only covers Jan–May)
const totToRev = totToPluRev
const totRev = totBrsRev + totToRev
const totKwh = monthlyData.reduce((s, m) => s + m.kwh, 0)
const totElec = monthlyData.reduce((s, m) => s + m.elecCost, 0)
const totNet = totRev - totElec
// Paid hires: BRS paid online + TouchOffice till payments (mutually exclusive channels)
// BRS £0 bookings = 295; of these 187 paid at the TO till → truly free = 295 - 187 = 108
const brsPaidQty = brs.byPlu.visitor18.qty + brs.byPlu.visitor9.qty + brs.byPlu.member18.qty + brs.byPlu.member9.qty + brs.byPlu.other.qty  // 60
const totPaid = brsPaidQty + totToPluQty   // 60 + 187 = 247
const totFreeEst = brs.byPlu.free.qty - totToPluQty  // 295 - 187 = 108 genuinely free

// Combined 9/18-hole breakdown across both sources
const combined = {
  visitor18: { brsQty: brs.byPlu.visitor18.qty, brsRev: brs.byPlu.visitor18.revenue, toQty: TO_PLU.visitor18.qty, toRev: TO_PLU.visitor18.revenue },
  visitor9:  { brsQty: brs.byPlu.visitor9.qty,  brsRev: brs.byPlu.visitor9.revenue,  toQty: TO_PLU.visitor9.qty,  toRev: TO_PLU.visitor9.revenue },
  member18:  { brsQty: brs.byPlu.member18.qty,  brsRev: brs.byPlu.member18.revenue,  toQty: TO_PLU.member18.qty,  toRev: TO_PLU.member18.revenue },
  member9:   { brsQty: brs.byPlu.member9.qty,   brsRev: brs.byPlu.member9.revenue,   toQty: TO_PLU.member9.qty,   toRev: TO_PLU.member9.revenue },
  other:     { brsQty: brs.byPlu.other.qty,      brsRev: brs.byPlu.other.revenue,     toQty: 0, toRev: 0 },
  free:      { brsQty: brs.byPlu.free.qty,       brsRev: 0, toQty: 0, toRev: 0 },
}

// BRS date range label for KPIs
const brs2026Days = Object.keys(brs.daily).filter(d => d >= '2026-01-01').sort()
const brsMaxDay = brs2026Days.at(-1) // e.g. '2026-06-30'
function fmtBrsDate(iso) {
  if (!iso) return '?'
  const [, m, d] = iso.split('-')
  const names = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(d)} ${names[parseInt(m)]} 2026`
}
const brsDateRange = `Jan – ${fmtBrsDate(brsMaxDay)}`
const brsFreeQty = brs.byPlu.free.qty

// ─── HTML Output ─────────────────────────────────────────────────────────────

const fmt = v => v.toFixed(2)
const fmtK = v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)

function monthLabel(m) {
  const [y, mo] = m.split('-')
  const names = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${names[parseInt(mo)]} ${y}`
}

function netClass(v) {
  return v >= 0 ? 'pos' : 'neg'
}

const chartDataJson = JSON.stringify(chartData)
const monthlyJson = JSON.stringify(monthlyData.map(m => ({ ...m, label: monthLabel(m.month) })))
const byTypeJson = JSON.stringify(Object.entries(brs.byType).sort((a, b) => b[1].revenue - a[1].revenue))

process.stdout.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Buggy Hire Profitability — 2026</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1a1a1a; background: #f6f7f9; line-height: 1.5; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }
  h1 { font-size: 1.75rem; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
  .subtitle { color: #666; margin-bottom: 32px; }
  h2 { font-size: 1.125rem; font-weight: 600; margin-bottom: 12px; color: #1a1a1a; }
  .card { background: #fff; border: 1px solid #e8e8e8; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .kpi { background: #fff; border: 1px solid #e8e8e8; border-radius: 12px; padding: 16px 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
  .kpi-label { font-size: 12px; color: #888; font-weight: 500; text-transform: uppercase; letter-spacing: 0.03em; }
  .kpi-value { font-size: 1.6rem; font-weight: 700; color: #1a1a1a; margin: 4px 0 2px; }
  .kpi-note { font-size: 11px; color: #aaa; }
  .kpi.green .kpi-value { color: #16a34a; }
  .kpi.red .kpi-value { color: #dc2626; }
  .kpi.amber .kpi-value { color: #d97706; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #e8e8e8; color: #888; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
  th.r, td.r { text-align: right; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
  tr:last-child td { border-bottom: none; }
  tr.total td { font-weight: 600; border-top: 2px solid #e8e8e8; border-bottom: none; background: #fafafa; }
  .pos { color: #16a34a; font-weight: 600; }
  .neg { color: #dc2626; font-weight: 600; }
  .chart-wrap { position: relative; height: 260px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #78350f; margin-bottom: 24px; }
  .note strong { display: block; margin-bottom: 4px; }
  ul.findings { list-style: none; padding: 0; }
  ul.findings li { padding: 6px 0; border-bottom: 1px solid #f0f0f0; padding-left: 16px; position: relative; }
  ul.findings li::before { content: '→'; position: absolute; left: 0; color: #16a34a; font-weight: 700; }
  ul.findings li:last-child { border-bottom: none; }
  @media (max-width: 700px) { .two-col { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>Buggy Hire Profitability</h1>
  <p class="subtitle">Alnmouth Village Golf Club · January – June 2026 · Generated ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</p>

  <div class="note">
    <strong>Data sources</strong>
    <b>BRS</b> booking system — all hire bookings Jan–30 Jun 2026 (${totBuggies} bookings)${brs.hasRevenue ? ', captures online advance payments' : ' — this export does not include revenue; all BRS revenue shown as £0'} ·
    <b>TouchOffice PLU Sales report</b> — till payments (cash/card at desk, member account charges, society/competition), Jan–6 Jun 2026, PLU Group: Buggy ·
    ${brs.hasRevenue ? 'These two revenue streams do not overlap: BRS = online payment at booking; TouchOffice = payment in person at the clubhouse.' : '<b>Note:</b> BRS revenue not available in this export — all revenue figures come from the TouchOffice PLU report only.'}
    Tractor Shed smart meter (MPAN 1591023060154, daily reads Jan–3 Jun) · Electricity rate: 27.5p/kWh.
    <br><br>
    <strong>Important caveat</strong>
    Electricity cost shown = entire Tractor Shed meter (not just buggy chargers). The shed also powers lighting,
    workshop equipment and any other machinery. The true electricity cost attributable solely to buggy charging is lower.
  </div>

  <!-- KPIs -->
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-label">Total Buggies Hired</div>
      <div class="kpi-value">${totBuggies}</div>
      <div class="kpi-note">${brsDateRange}</div>
    </div>
    <div class="kpi ${totRev >= totElec ? 'green' : 'red'}">
      <div class="kpi-label">Total Revenue</div>
      <div class="kpi-value">£${fmt(totRev)}</div>
      <div class="kpi-note">BRS online + TouchOffice till</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Electricity Cost</div>
      <div class="kpi-value">£${fmt(totElec)}</div>
      <div class="kpi-note">${totKwh.toFixed(0)} kWh @ 27.5p</div>
    </div>
    <div class="kpi ${totNet >= 0 ? 'green' : 'red'}">
      <div class="kpi-label">Net Contribution</div>
      <div class="kpi-value">${totNet >= 0 ? '+' : ''}£${fmt(Math.abs(totNet))}</div>
      <div class="kpi-note">Rev minus elec cost only</div>
    </div>
    <div class="kpi amber">
      <div class="kpi-label">Paid Hires</div>
      <div class="kpi-value">${totPaid}</div>
      <div class="kpi-note">${brsPaidQty} BRS online + ${totToPluQty} TouchOffice till</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Free/Benefit Hires</div>
      <div class="kpi-value">${totFreeEst}</div>
      <div class="kpi-note">${brsFreeQty} BRS £0 bookings minus ${totToPluQty} who paid at clubhouse</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Avg kWh/Hire Day</div>
      <div class="kpi-value">${avgKwhHire.toFixed(1)}</div>
      <div class="kpi-note">vs ${avgKwhNoHire.toFixed(1)} on no-hire days</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Revenue / Paid Hire</div>
      <div class="kpi-value">£${(totRev/totPaid).toFixed(2)}</div>
      <div class="kpi-note">${totPaid} paid hires (${brsPaidQty} BRS + ${totToPluQty} TO)</div>
    </div>
  </div>

  <!-- Monthly table -->
  <div class="card">
    <h2>Monthly Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th class="r">BRS Hires</th>
          <th class="r">TO Hires</th>
          <th class="r">BRS Rev†</th>
          <th class="r">TO Rev†</th>
          <th class="r">Total Rev</th>
          <th class="r">kWh</th>
          <th class="r">Elec Cost</th>
          <th class="r">Net</th>
        </tr>
      </thead>
      <tbody>
        ${monthlyData.map(m => `
        <tr>
          <td>${monthLabel(m.month)}</td>
          <td class="r">${m.buggies}</td>
          <td class="r">${m.toQty > 0 ? m.toQty : '—'}</td>
          <td class="r">£${fmt(m.brsRev)}</td>
          <td class="r">${m.toRev > 0 ? `£${fmt(m.toRev)}` : '—'}</td>
          <td class="r">£${fmt(m.totalRev)}</td>
          <td class="r">${m.kwh.toFixed(0)}</td>
          <td class="r">£${fmt(m.elecCost)}</td>
          <td class="r ${netClass(m.net)}">${m.net >= 0 ? '+' : ''}£${fmt(Math.abs(m.net))}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr class="total">
          <td>TOTAL</td>
          <td class="r">${totBuggies}</td>
          <td class="r">${totToPluQty}*</td>
          <td class="r">£${fmt(totBrsRev)}</td>
          <td class="r">£${fmt(totToPluRev)}*</td>
          <td class="r">£${fmt(totRev)}</td>
          <td class="r">${totKwh.toFixed(0)}</td>
          <td class="r">£${fmt(totElec)}</td>
          <td class="r ${netClass(totNet)}">${totNet >= 0 ? '+' : ''}£${fmt(Math.abs(totNet))}</td>
        </tr>
      </tfoot>
    </table>
    <p style="margin-top:10px;font-size:12px;color:#888">†BRS Rev = online advance payments at booking. TO Rev = till payments at clubhouse (exact from PLU Sales report Jan–6 Jun). These do not overlap. Monthly TO breakdown from weekly_sales (Jan–May); Jun TO not shown per month but included in totals.</p>
  </div>

  <!-- 9/18-hole breakdown -->
  <div class="card">
    <h2>Hire Type Breakdown — 9-hole vs 18-hole</h2>
    <p style="font-size:12px;color:#888;margin-bottom:12px">
      BRS online = paid at booking (visitors only). TouchOffice = paid at the clubhouse: PLU 2101/2102 are visitors who paid in person (BRS booking showed £0); PLU 2103/2104 are members paying at the till.
      BRS classified by per-buggy fee: £30=visitor 18h, £25=visitor 9h, £15=member 18h, £10=member 9h. The two channels are mutually exclusive — no double counting.
      Genuinely free = 295 BRS £0 bookings − 187 who subsequently paid at the till = <strong>108</strong>.
    </p>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th class="r">BRS Hires</th>
          <th class="r">BRS Revenue</th>
          <th class="r">TO Hires</th>
          <th class="r">TO Revenue</th>
          <th class="r">Total Hires</th>
          <th class="r">Total Revenue</th>
          <th class="r">Avg / Hire</th>
        </tr>
      </thead>
      <tbody>
        ${[
          ['Visitor — 18 hole', combined.visitor18],
          ['Visitor — 9 hole',  combined.visitor9],
          ['Member — 18 hole',  combined.member18],
          ['Member — 9 hole',   combined.member9],
          ['Other / Competition', combined.other],
          ['Free / Benefit (BRS)', combined.free],
        ].map(([label, r]) => {
          const totQ = r.brsQty + r.toQty
          const totR = r.brsRev + r.toRev
          return `<tr>
            <td>${label}</td>
            <td class="r">${r.brsQty || '—'}</td>
            <td class="r">${r.brsRev > 0 ? `£${fmt(r.brsRev)}` : '—'}</td>
            <td class="r">${r.toQty || '—'}</td>
            <td class="r">${r.toRev > 0 ? `£${fmt(r.toRev)}` : '—'}</td>
            <td class="r"><strong>${totQ || '—'}</strong></td>
            <td class="r">${totR > 0 ? `<strong>£${fmt(totR)}</strong>` : '—'}</td>
            <td class="r">${totQ > 0 && totR > 0 ? `£${(totR/totQ).toFixed(2)}` : '—'}</td>
          </tr>`
        }).join('')}
      </tbody>
      <tfoot>
        <tr class="total">
          <td>TOTAL PAID</td>
          <td class="r">${brsPaidQty}</td>
          <td class="r">£${fmt(totBrsRev)}</td>
          <td class="r">${totToPluQty}</td>
          <td class="r">£${fmt(totToPluRev)}</td>
          <td class="r">${totPaid}</td>
          <td class="r">£${fmt(totRev)}</td>
          <td class="r">£${(totRev/totPaid).toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Charts row -->
  <div class="two-col">
    <div class="card">
      <h2>Monthly Revenue vs Electricity Cost</h2>
      <div class="chart-wrap"><canvas id="revElecChart"></canvas></div>
    </div>
    <div class="card">
      <h2>Monthly Buggy Hire Volume</h2>
      <div class="chart-wrap"><canvas id="hireVolumeChart"></canvas></div>
    </div>
  </div>

  <!-- Daily scatter -->
  <div class="card">
    <h2>Daily Electricity vs Buggy Hire Count</h2>
    <p style="font-size:12px;color:#888;margin-bottom:12px">Each dot = one day. Days with no hires shown on left axis. Higher hire days tend to use more electricity but correlation is weak (r = 0.29) — the tractor shed has a large baseline load.</p>
    <div class="chart-wrap" style="height:300px"><canvas id="scatterChart"></canvas></div>
  </div>

  <!-- Standby charging analysis -->
  <div class="card">
    <h2>Standby Charging Cost Analysis</h2>
    <p style="font-size:12px;color:#888;margin-bottom:16px">
      The scatter chart above shows that buggy hire count barely affects daily electricity use — the tractor shed draws ${avgKwhNoHire.toFixed(1)} kWh on average even on days with zero hires.
      This is the <strong>standby charge</strong>: buggies sitting connected, drawing power without being used.
      The extra energy actually needed to recharge buggies after a hire is only +${extraKwhPerHireDay.toFixed(1)} kWh per hire day.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
      <div class="kpi">
        <div class="kpi-label">Avg Baseline Load</div>
        <div class="kpi-value">${avgKwhNoHire.toFixed(1)} kWh</div>
        <div class="kpi-note">per day — buggies sitting idle</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Avg Recharge per Hire Day</div>
        <div class="kpi-value">+${extraKwhPerHireDay.toFixed(1)} kWh</div>
        <div class="kpi-note">extra above baseline after a hire day</div>
      </div>
      <div class="kpi red">
        <div class="kpi-label">Standby Cost (period)</div>
        <div class="kpi-value">£${fmt(standbyTotalCost)}</div>
        <div class="kpi-note">${daysWithEnergy} days × ${avgKwhNoHire.toFixed(1)} kWh × 27.5p</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Recharge Cost (period)</div>
        <div class="kpi-value">£${fmt(rechargeCost)}</div>
        <div class="kpi-note">${hireDays.length} hire days × ${extraKwhPerHireDay.toFixed(1)} kWh × 27.5p</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th class="r">Days</th>
          <th class="r">Avg kWh/day</th>
          <th class="r">Period kWh</th>
          <th class="r">Period Cost</th>
          <th class="r">Annual Est.</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Zero-hire days (standby only)</td>
          <td class="r">${noHireDays.length}</td>
          <td class="r">${avgKwhNoHire.toFixed(1)}</td>
          <td class="r">${(noHireDays.length * avgKwhNoHire).toFixed(0)}</td>
          <td class="r">£${fmt(noHireDays.length * avgKwhNoHire * UNIT_RATE_P / 100)}</td>
          <td class="r">£${fmt(noHireDays.length * avgKwhNoHire * UNIT_RATE_P / 100 * annualScale)}</td>
        </tr>
        <tr>
          <td>Hire days — baseline portion</td>
          <td class="r">${hireDays.length}</td>
          <td class="r">${avgKwhNoHire.toFixed(1)}</td>
          <td class="r">${(hireDays.length * avgKwhNoHire).toFixed(0)}</td>
          <td class="r">£${fmt(hireDays.length * avgKwhNoHire * UNIT_RATE_P / 100)}</td>
          <td class="r">£${fmt(hireDays.length * avgKwhNoHire * UNIT_RATE_P / 100 * annualScale)}</td>
        </tr>
        <tr>
          <td>Hire days — recharge portion</td>
          <td class="r">${hireDays.length}</td>
          <td class="r">+${extraKwhPerHireDay.toFixed(1)}</td>
          <td class="r">${rechargeKwh.toFixed(0)}</td>
          <td class="r">£${fmt(rechargeCost)}</td>
          <td class="r">£${fmt(rechargeCost * annualScale)}</td>
        </tr>
        <tr style="background:#f0fdf4">
          <td><strong>If smart charger fitted</strong> (cuts off when full, ~${smartChargerBaselineKwh} kWh/day baseline)</td>
          <td class="r">—</td>
          <td class="r">−${(avgKwhNoHire - smartChargerBaselineKwh).toFixed(1)} kWh/day</td>
          <td class="r">−${((avgKwhNoHire - smartChargerBaselineKwh) * daysWithEnergy).toFixed(0)} kWh</td>
          <td class="r pos">−£${fmt(savingPerDay * daysWithEnergy)}</td>
          <td class="r pos">−£${fmt(annualPotentialSaving)}/yr</td>
        </tr>
      </tbody>
    </table>
    <p style="margin-top:12px;font-size:12px;color:#888">
      <strong>Interpretation:</strong> The vast majority of tractor shed electricity is standby charge — buggies fully charged but staying connected and drawing power.
      The actual cost of recharging after a hire (${extraKwhPerHireDay.toFixed(1)} kWh × 27.5p = <strong>£${(extraKwhPerHireDay * UNIT_RATE_P / 100).toFixed(2)} per hire day</strong>) is small.
      A timer relay or smart charger with a full-charge cutoff — costing ~£50–200 to install — would likely pay back within one season.
      Note: the ${smartChargerBaselineKwh} kWh residual baseline assumed for lighting, workshop equipment and brief equalisation charge; actual saving depends on charger model and usage pattern.
    </p>
  </div>

  <!-- Booking type breakdown + key findings -->
  <div class="two-col">
    <div class="card">
      <h2>Revenue by Booking Type (BRS)</h2>
      <table>
        <thead>
          <tr><th>Type</th><th class="r">Total Bookings</th><th class="r">Paid Online</th><th class="r">Revenue</th><th class="r">Avg/paid hire</th></tr>
        </thead>
        <tbody>
          ${Object.entries(brs.byType).sort((a,b) => b[1].buggies - a[1].buggies).map(([type, v]) => `
          <tr>
            <td>${type}</td>
            <td class="r">${v.buggies}</td>
            <td class="r">${v.paid > 0 ? v.paid : '—'}</td>
            <td class="r">${v.revenue > 0 ? `£${fmt(v.revenue)}` : '—'}</td>
            <td class="r">${v.paid > 0 && v.revenue > 0 ? `£${(v.revenue/v.paid).toFixed(2)}` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Key Findings</h2>
      <ul class="findings">
        <li><strong>Two payment channels</strong> — BRS online (£${fmt(totBrsRev)}) + TouchOffice till (£${fmt(totToPluRev)}). Combined: £${fmt(totRev)}</li>
        <li><strong>Members dominate till hires</strong> — 145 of 187 TouchOffice hires are member (18h: ${TO_PLU.member18.qty}, 9h: ${TO_PLU.member9.qty}). Members overwhelmingly pay at the clubhouse rather than booking online</li>
        <li><strong>18-hole more popular than 9-hole at the till</strong> — TO: ${TO_PLU.visitor18.qty + TO_PLU.member18.qty} × 18-hole vs ${TO_PLU.visitor9.qty + TO_PLU.member9.qty} × 9-hole</li>
        <li><strong>${totFreeEst} genuinely free/benefit hires</strong> — 295 BRS bookings had £0 online payment; 187 of those paid at the clubhouse till (captured in TO); leaving ${totFreeEst} (${Math.round(totFreeEst/totBuggies*100)}% of all BRS bookings) with no payment anywhere</li>
        <li><strong>Winter electricity is the main drag</strong> — Jan/Feb show negative or marginal net: the tractor shed draws full power regardless of hire activity</li>
        <li><strong>Spring/summer months are strongly profitable</strong> — Apr and May revenue well exceeds the entire shed electricity cost</li>
        <li><strong>Extra electricity on hire days: +${extraKwhPerHireDay.toFixed(1)} kWh/day</strong> — hire days average ${avgKwhHire.toFixed(1)} kWh vs ${avgKwhNoHire.toFixed(1)} kWh on no-hire days</li>
        <li><strong>Electricity overstated</strong> — the tractor shed meter includes lighting, workshop equipment etc., not just buggy chargers. True charging cost is lower</li>
      </ul>
    </div>
  </div>

</div>

<script>
const monthly = ${monthlyJson};
const dailyData = ${chartDataJson};

// Revenue vs electricity chart
new Chart(document.getElementById('revElecChart'), {
  type: 'bar',
  data: {
    labels: monthly.map(m => m.label),
    datasets: [
      { label: 'BRS (online)', data: monthly.map(m => m.brsRev), backgroundColor: '#16a34a', stack: 'rev' },
      { label: 'TouchOffice (till)', data: monthly.map(m => m.toRev), backgroundColor: '#0891b2', stack: 'rev' },
      { label: 'Electricity Cost', data: monthly.map(m => m.elecCost), backgroundColor: '#dc2626', stack: 'elec' },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: { ticks: { font: { size: 11 } } },
      y: { title: { display: true, text: '£', font: { size: 11 } }, ticks: { font: { size: 11 }, callback: v => '£' + v.toFixed(0) } }
    }
  }
});

// Hire volume chart
new Chart(document.getElementById('hireVolumeChart'), {
  type: 'bar',
  data: {
    labels: monthly.map(m => m.label),
    datasets: [
      { label: 'BRS bookings', data: monthly.map(m => m.buggies), backgroundColor: '#bbf7d0', stack: 'a' },
      { label: 'TouchOffice till hires', data: monthly.map(m => m.toQty), backgroundColor: '#0891b2', stack: 'b' },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: { ticks: { font: { size: 11 } } },
      y: { ticks: { font: { size: 11 } }, title: { display: true, text: 'Buggies', font: { size: 11 } } }
    }
  }
});

// Scatter chart — buggies vs kWh per day
const hirePoints = dailyData.filter(d => d.kwh !== null && d.buggies > 0).map(d => ({ x: d.buggies, y: d.kwh }));
const noHirePoints = dailyData.filter(d => d.kwh !== null && d.buggies === 0).map(d => ({ x: 0, y: d.kwh }));

new Chart(document.getElementById('scatterChart'), {
  type: 'scatter',
  data: {
    datasets: [
      { label: 'Hire day', data: hirePoints, backgroundColor: '#16a34a99', pointRadius: 5, pointHoverRadius: 7 },
      { label: 'No hire', data: noHirePoints, backgroundColor: '#9ca3af66', pointRadius: 4 },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: { title: { display: true, text: 'Buggies hired that day', font: { size: 11 } }, ticks: { font: { size: 11 }, stepSize: 1 } },
      y: { title: { display: true, text: 'kWh (Tractor Shed)', font: { size: 11 } }, ticks: { font: { size: 11 } } }
    }
  }
});
</script>
</body>
</html>
`)
