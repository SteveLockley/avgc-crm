# Clubhouse Financials Feature Plan

## Overview
Create a new page to display clubhouse income and expenditure, showing Direct Expenses and Sales on a month-by-month basis to calculate gross margin. Include year-on-year comparison charts for 2024 and 2025.

## Data Source
CSV file: `NominalActivity_*.csv` (exported from accounting system)

### CSV Structure
- Semicolon or comma separated
- Columns: Category, Nominal Code, Name, Opening Balance, then monthly Debit/Credit pairs for 2024 and 2025
- Monthly columns format: `"1 - 31 Jan 25.Debit"`, `"1 - 31 Jan 25.Credit"`, etc.

### Relevant Account Categories

**Sales (Income) - Credit values represent income:**
| Code | Name | Type |
|------|------|------|
| 4000 | Bar Sales | Clubhouse |
| 4010 | Food Sales | Clubhouse |
| 4020 | Coffee Machine Sales | Clubhouse |
| 4070 | Merchandise Sales | Clubhouse |
| 4999 | Sundry income | Clubhouse |

**Direct Expenses (Cost of Sales) - Debit values represent costs:**
| Code | Name | Type |
|------|------|------|
| 5000 | Bar Purchases | Clubhouse |
| 5020 | Food Purchases | Clubhouse |
| 5065 | Merchandise Purchases | Clubhouse |

**Other accounts (for reference, not in gross margin):**
- 4030: Members Subscription (separate from clubhouse trading)
- 4040: Visiting Green Fees (separate from clubhouse trading)
- 7000: Clubhouse Wages (overhead, not direct expense)

---

## Feature Requirements

### 1. File Upload & Processing
- Upload CSV file via form
- Parse CSV handling quoted fields
- Extract monthly data for 2024 and 2025
- Store in session or process on-the-fly

### 2. Monthly Data Display

**Table showing:**
| Month | Sales 2024 | Sales 2025 | YoY % | Expenses 2024 | Expenses 2025 | YoY % | Margin 2024 | Margin 2025 | YoY % |
|-------|------------|------------|-------|---------------|---------------|-------|-------------|-------------|-------|

**Calculations:**
- Sales = Sum of Credits for codes 4000, 4010, 4020, 4070, 4999
- Direct Expenses = Sum of Debits for codes 5000, 5020, 5065
- Gross Margin = Sales - Direct Expenses
- Gross Margin % = (Gross Margin / Sales) × 100
- YoY % = ((2025 - 2024) / 2024) × 100

### 3. Charts (Year-on-Year Comparison)

**Chart 1: Monthly Sales Comparison**
- Line chart with two lines (2024 vs 2025)
- X-axis: Months (Jan-Dec)
- Y-axis: Sales (£)

**Chart 2: Monthly Gross Margin Comparison**
- Line chart with two lines (2024 vs 2025)
- X-axis: Months (Jan-Dec)
- Y-axis: Gross Margin (£)

**Chart 3: Gross Margin % Comparison**
- Line chart with two lines (2024 vs 2025)
- X-axis: Months (Jan-Dec)
- Y-axis: Margin %

### 4. Summary Statistics

**Totals Panel:**
- Total Sales YTD (2024 vs 2025)
- Total Direct Expenses YTD
- Total Gross Margin YTD
- Average Margin %
- Best/Worst performing months

---

## Technical Implementation

### New Files

| File | Purpose |
|------|---------|
| `src/pages/reports/clubhouse.astro` | Main page with upload form, tables, and charts |
| `src/lib/financials.ts` | CSV parsing and financial calculations |

### Chart Library
Use **Chart.js** via CDN - lightweight and works without build step:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

### Data Flow
1. User uploads CSV file
2. Server parses CSV and extracts relevant accounts
3. Calculate monthly totals for Sales, Expenses, Margin
4. Return data as JSON embedded in page
5. Client-side Chart.js renders graphs

---

## CSV Parsing Logic

```typescript
interface MonthlyData {
  month: string;
  sales2024: number;
  sales2025: number;
  expenses2024: number;
  expenses2025: number;
  margin2024: number;
  margin2025: number;
  marginPct2024: number;
  marginPct2025: number;
}

const SALES_CODES = ['4000', '4010', '4020', '4070', '4999'];
const EXPENSE_CODES = ['5000', '5020', '5065'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// For each month, find columns matching pattern "1 - 31 Jan 25.Credit"
// Sales accounts: use Credit column (income is credited)
// Expense accounts: use Debit column (costs are debited)
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Clubhouse Financial Report                                   │
├─────────────────────────────────────────────────────────────┤
│ [Upload CSV File] [Process]                                  │
├─────────────────────────────────────────────────────────────┤
│ Summary Cards:                                               │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │Total Sales│ │Expenses  │ │Gross     │ │Avg Margin│        │
│ │£XXX,XXX  │ │£XX,XXX   │ │Margin    │ │XX.X%     │        │
│ │+X.X% YoY │ │+X.X% YoY │ │£XX,XXX   │ │          │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
├─────────────────────────────────────────────────────────────┤
│ Monthly Comparison Table                                     │
│ ┌─────┬────────────────┬────────────────┬─────────────────┐ │
│ │Month│    Sales       │   Expenses     │   Gross Margin  │ │
│ │     │ 2024 │ 2025│YoY│ 2024 │ 2025│YoY│ 2024 │ 2025│YoY│ │
│ ├─────┼──────┼─────┼───┼──────┼─────┼───┼──────┼─────┼───┤ │
│ │ Jan │ £X,X │ £X,X│+X%│ £X,X │ £X,X│+X%│ £X,X │ £X,X│+X%│ │
│ │ ... │      │     │   │      │     │   │      │     │   │ │
│ └─────┴──────┴─────┴───┴──────┴─────┴───┴──────┴─────┴───┘ │
├─────────────────────────────────────────────────────────────┤
│ Charts:                                                      │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Sales: 2024 vs 2025                                   │   │
│ │ [Line chart showing monthly sales comparison]         │   │
│ └───────────────────────────────────────────────────────┘   │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Gross Margin: 2024 vs 2025                            │   │
│ │ [Line chart showing monthly margin comparison]        │   │
│ └───────────────────────────────────────────────────────┘   │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Gross Margin %: 2024 vs 2025                          │   │
│ │ [Line chart showing margin percentage]                │   │
│ └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Breakdown Tables (Optional/Phase 2)

Show detailed breakdown by account:

**Bar Trading:**
| Month | Bar Sales | Bar Purchases | Bar Margin | Margin % |
|-------|-----------|---------------|------------|----------|

**Food Trading:**
| Month | Food Sales | Food Purchases | Food Margin | Margin % |
|-------|------------|----------------|-------------|----------|

**Coffee:**
| Month | Coffee Sales | (no direct cost) | - | - |
|-------|--------------|------------------|---|---|

---

## Navigation

Add to Reports section in `AdminLayout.astro`:
```html
<a href="/reports/clubhouse">Clubhouse Financials</a>
```

---

## Implementation Steps

1. **Create `src/lib/financials.ts`**
   - CSV parsing function
   - Month column detection
   - Data extraction for sales/expense codes
   - Calculation functions

2. **Create `src/pages/reports/clubhouse.astro`**
   - File upload form
   - Process CSV on POST
   - Render summary cards
   - Render monthly comparison table
   - Embed Chart.js charts

3. **Add navigation link**
   - Update AdminLayout.astro

4. **Testing**
   - Upload sample CSV
   - Verify calculations match expected values
   - Check chart rendering

---

## Sample Output

Based on the CSV data, expected January 2025 calculations:

**Sales:**
- Bar Sales: £2,949.65 (Credit)
- Food Sales: £5,999.98 (Credit)
- Coffee Sales: £1,618.42 (Credit)
- Merchandise: £394.35 (Credit)
- Sundry: £0.00
- **Total Sales: £10,962.40**

**Direct Expenses:**
- Bar Purchases: £2,954.91 (Debit)
- Food Purchases: £2,180.36 (Debit)
- Merchandise Purchases: £1,842.00 (Debit)
- **Total Expenses: £6,977.27**

**Gross Margin:**
- £10,962.40 - £6,977.27 = **£3,985.13**
- Margin %: 36.4%

---

## Notes

- The CSV format may vary slightly between exports - handle flexible column matching
- Some months may have no data (especially future months in 2025) - show as £0 or "-"
- Consider caching parsed data if file is large
- Add option to export summary as CSV/PDF in future phase
