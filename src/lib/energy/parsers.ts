// CSV parsers for energy data — async D1 (Cloudflare) version

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let val = ''
      i++
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { val += '"'; i += 2 }
          else { i++; break }
        } else { val += line[i++] }
      }
      result.push(val)
      if (i < line.length && line[i] === ',') i++
    } else if (line[i] === ',') {
      result.push(''); i++
    } else {
      let val = ''
      while (i < line.length && line[i] !== ',') val += line[i++]
      result.push(val)
      if (i < line.length && line[i] === ',') i++
    }
  }
  return result
}

function defaultCircuitLabel(circuit: string): string {
  if (circuit === 'main') return 'Main Circuit'
  const m = circuit.match(/^circuit(\d+)$/)
  if (m) return `Circuit ${m[1]}`
  return circuit.charAt(0).toUpperCase() + circuit.slice(1).replace(/_/g, ' ')
}

type D1Database = any

function parseDate(ddmmyyyy: string): string | null {
  if (!ddmmyyyy?.trim()) return null
  const [d, m, y] = ddmmyyyy.trim().split('/')
  if (!d || !m || !y) return null
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function parseNum(s: string): number | null {
  const n = parseFloat(s?.trim())
  return isNaN(n) ? null : n
}

const INTERVALS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

export interface SmartMeterResult {
  rows: number; readings: number; skipped: number; mpan: string
}

export async function importSmartMeterCsv(db: D1Database, csvText: string): Promise<SmartMeterResult> {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].slice(1)

  const header = lines[0].split(',')
  const siteIdx = header.findIndex(h => h.trim().toLowerCase() === 'site')
  const dayIdx  = header.findIndex(h => h.trim().toLowerCase() === 'day')

  let readings = 0; let skipped = 0; let mpan = ''
  const CHUNK = 100

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 51) { skipped++; continue }

    const rowMpan = cols[siteIdx].trim()
    const date    = parseDate(cols[dayIdx].trim())
    mpan = rowMpan

    await db.prepare(
      `INSERT INTO energy_meters (mpan, name, has_smart) VALUES (?, ?, 1)
       ON CONFLICT(mpan) DO UPDATE SET has_smart = 1`
    ).bind(rowMpan, `Meter ${rowMpan}`).run()

    const batch: ReturnType<typeof db.prepare>[] = []
    for (let slot = 0; slot < 48; slot++) {
      const val = parseFloat(cols[3 + slot])
      if (!isNaN(val)) {
        batch.push(
          db.prepare(
            `INSERT OR IGNORE INTO energy_smart_readings (mpan, reading_date, interval_time, kwh)
             VALUES (?, ?, ?, ?)`
          ).bind(rowMpan, date, INTERVALS[slot], val)
        )
      }
      if (batch.length === CHUNK) {
        const results = await db.batch(batch.splice(0))
        readings += results.filter((r: any) => r.meta?.changes > 0).length
      }
    }
    if (batch.length) {
      const results = await db.batch(batch)
      readings += results.filter((r: any) => r.meta?.changes > 0).length
    }
  }

  return { rows: lines.length - 1, readings, skipped, mpan }
}

const BILL_COL = {
  MPAN: 13, SERIAL: 12, INVOICE_NUMBER: 11, INVOICE_DATE: 10, DUE_DATE: 8,
  OPENING_READ: 15, OPENING_READ_DATE: 16, OPENING_READ_TYPE: 18,
  CLOSING_READ: 5, CLOSING_READ_DATE: 6, CLOSING_READ_TYPE: 19,
  REGISTER_ID: 20, ADVANCE_UNITS: 1, NET_AMOUNT: 14,
  VAT_AMOUNT: 27, INVOICE_AMOUNT: 9, VAT_RATE: 28, CCL_AMOUNT: 2,
  STATUS: 21, ADDR1: 22, ADDR2: 23, ADDR3: 24,
}

export interface BillsResult {
  rows: number; imported: number; skipped: number; meters: string[]
}

export async function importBillsCsv(db: D1Database, csvText: string): Promise<BillsResult> {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].slice(1)

  let imported = 0; let skipped = 0
  const metersSeen = new Set<string>()
  const batch: ReturnType<typeof db.prepare>[] = []
  const CHUNK = 100

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    if (c.length < 25) { skipped++; continue }

    const mpan   = c[BILL_COL.MPAN]?.trim()
    const serial = c[BILL_COL.SERIAL]?.trim()
    if (!mpan) { skipped++; continue }

    metersSeen.add(mpan)
    const address = [c[BILL_COL.ADDR1], c[BILL_COL.ADDR2], c[BILL_COL.ADDR3]].filter(Boolean).join(', ').trim()

    await db.prepare(
      `INSERT INTO energy_meters (mpan, serial, name, address, has_smart) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(mpan) DO UPDATE SET
         serial  = COALESCE(excluded.serial, serial),
         address = COALESCE(excluded.address, address)`
    ).bind(mpan, serial || null, `Meter ${mpan}`, address || null).run()

    batch.push(
      db.prepare(
        `INSERT OR IGNORE INTO energy_bill_lines (
           mpan, invoice_number, invoice_date, due_date,
           opening_read, opening_read_date, opening_read_type,
           closing_read, closing_read_date, closing_read_type,
           register_id, advance_units_kwh, net_amount, vat_amount,
           invoice_amount, vat_rate, ccl_amount, status
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        mpan, c[BILL_COL.INVOICE_NUMBER]?.trim(), parseDate(c[BILL_COL.INVOICE_DATE]),
        parseDate(c[BILL_COL.DUE_DATE]), parseNum(c[BILL_COL.OPENING_READ]),
        parseDate(c[BILL_COL.OPENING_READ_DATE]), c[BILL_COL.OPENING_READ_TYPE]?.trim() || null,
        parseNum(c[BILL_COL.CLOSING_READ]), parseDate(c[BILL_COL.CLOSING_READ_DATE]),
        c[BILL_COL.CLOSING_READ_TYPE]?.trim() || null, c[BILL_COL.REGISTER_ID]?.trim() || null,
        parseNum(c[BILL_COL.ADVANCE_UNITS]), parseNum(c[BILL_COL.NET_AMOUNT]),
        parseNum(c[BILL_COL.VAT_AMOUNT]), parseNum(c[BILL_COL.INVOICE_AMOUNT]),
        parseNum(c[BILL_COL.VAT_RATE]), parseNum(c[BILL_COL.CCL_AMOUNT]),
        c[BILL_COL.STATUS]?.trim() || null,
      )
    )

    if (batch.length === CHUNK) {
      const results = await db.batch(batch.splice(0))
      imported += results.filter((r: any) => r.meta?.changes > 0).length
    }
  }

  if (batch.length) {
    const results = await db.batch(batch)
    imported += results.filter((r: any) => r.meta?.changes > 0).length
  }

  return { rows: lines.length - 1, imported, skipped, meters: [...metersSeen] }
}

export interface KitchenLoggerResult {
  rows: number; readings: number; skipped: number; meterName: string; circuits: string[]
}

export async function importKitchenLoggerCsv(
  db: D1Database, csvText: string, meterName: string
): Promise<KitchenLoggerResult> {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return { rows: 0, readings: 0, skipped: 0, meterName, circuits: [] }
  if (lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].slice(1)

  const headerCols = parseCsvLine(lines[0])

  // Map column index → circuit key, skipping the time bucket column (index 0)
  const circuitCols: { idx: number; key: string }[] = []
  for (let i = 1; i < headerCols.length; i++) {
    const h = headerCols[i].trim()
    const match = h.match(/^(.+?)\s*\(KWH\)$/i)
    if (!match) continue
    const rawName = match[1].trim()
    const key = rawName.toLowerCase().startsWith('main')
      ? 'main'
      : rawName.toLowerCase().replace(/\s+/g, '_')
    circuitCols.push({ idx: i, key })
  }

  let readings = 0; let skipped = 0
  const circuitsSeen = new Set<string>()
  const CHUNK = 100

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    // Time bucket format: "2026-05-29 13:00:00-13:59:59"
    const tbMatch = (cols[0] ?? '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):/)
    if (!tbMatch) { skipped++; continue }
    const date = tbMatch[1]
    const hour = parseInt(tbMatch[2], 10)

    const batch: ReturnType<typeof db.prepare>[] = []
    for (const { idx, key } of circuitCols) {
      const raw = cols[idx]?.trim()
      if (raw === '' || raw === undefined) continue  // circuit not connected
      const kwh = parseFloat(raw)
      if (isNaN(kwh)) continue

      circuitsSeen.add(key)
      batch.push(
        db.prepare(
          `INSERT OR IGNORE INTO energy_logger_readings
           (meter_name, reading_date, reading_hour, circuit, kwh)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(meterName, date, hour, key, kwh)
      )
    }

    if (batch.length === 0) { skipped++; continue }

    for (let j = 0; j < batch.length; j += CHUNK) {
      const results = await db.batch(batch.slice(j, j + CHUNK))
      readings += results.filter((r: any) => r.meta?.changes > 0).length
    }
  }

  // Upsert circuit labels (insert default, don't overwrite existing user labels)
  if (circuitsSeen.size) {
    const circuitBatch = [...circuitsSeen].map(key =>
      db.prepare(
        `INSERT INTO energy_logger_circuits (meter_name, circuit, label)
         VALUES (?, ?, ?)
         ON CONFLICT(meter_name, circuit) DO NOTHING`
      ).bind(meterName, key, defaultCircuitLabel(key))
    )
    await db.batch(circuitBatch)
  }

  return { rows: lines.length - 1, readings, skipped, meterName, circuits: [...circuitsSeen] }
}
