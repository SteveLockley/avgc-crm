// Financial data processing for clubhouse reports

export interface MonthlyData {
  month: string;
  sales2024: number;
  sales2025: number;
  expenses2024: number;
  expenses2025: number;
  margin2024: number;
  margin2025: number;
  marginPct2024: number;
  marginPct2025: number;
  salesYoY: number | null;
  expensesYoY: number | null;
  marginYoY: number | null;
}

export interface FinancialSummary {
  totalSales2024: number;
  totalSales2025: number;
  totalExpenses2024: number;
  totalExpenses2025: number;
  totalMargin2024: number;
  totalMargin2025: number;
  avgMarginPct2024: number;
  avgMarginPct2025: number;
  salesYoY: number | null;
  expensesYoY: number | null;
  marginYoY: number | null;
  monthlyData: MonthlyData[];
}

export interface AccountBreakdown {
  code: string;
  name: string;
  monthly2024: number[];
  monthly2025: number[];
  total2024: number;
  total2025: number;
}

// Account codes for clubhouse trading
export const SALES_CODES = ['4000', '4010', '4020', '4070', '4999'];
export const EXPENSE_CODES = ['5000', '5020', '5065'];

export const SALES_NAMES: Record<string, string> = {
  '4000': 'Bar Sales',
  '4010': 'Food Sales',
  '4020': 'Coffee Machine Sales',
  '4070': 'Merchandise Sales',
  '4999': 'Sundry Income'
};

export const EXPENSE_NAMES: Record<string, string> = {
  '5000': 'Bar Purchases',
  '5020': 'Food Purchases',
  '5065': 'Merchandise Purchases'
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse CSV line handling quoted fields
function parseCSVLine(line: string, separator: string = ','): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === separator && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

// Find column indices for monthly data
function findMonthColumns(header: string[]): {
  month: string;
  debit2024: number;
  credit2024: number;
  debit2025: number;
  credit2025: number;
}[] {
  const monthColumns: {
    month: string;
    debit2024: number;
    credit2024: number;
    debit2025: number;
    credit2025: number;
  }[] = [];

  for (const month of MONTHS) {
    // Find columns matching patterns like "1 - 31 Jan 25.Debit" or "1 - 28 Feb 24.Credit"
    const debit2025 = header.findIndex(h =>
      h.toLowerCase().includes(month.toLowerCase()) &&
      h.includes('25') &&
      h.toLowerCase().includes('debit')
    );
    const credit2025 = header.findIndex(h =>
      h.toLowerCase().includes(month.toLowerCase()) &&
      h.includes('25') &&
      h.toLowerCase().includes('credit')
    );
    const debit2024 = header.findIndex(h =>
      h.toLowerCase().includes(month.toLowerCase()) &&
      h.includes('24') &&
      h.toLowerCase().includes('debit')
    );
    const credit2024 = header.findIndex(h =>
      h.toLowerCase().includes(month.toLowerCase()) &&
      h.includes('24') &&
      h.toLowerCase().includes('credit')
    );

    monthColumns.push({
      month,
      debit2024,
      credit2024,
      debit2025,
      credit2025
    });
  }

  return monthColumns;
}

// Parse a numeric value from CSV cell
function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[£,]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Calculate YoY percentage change
function calcYoY(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// Process the nominal activity CSV
export function processNominalActivityCSV(csvText: string): FinancialSummary {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  // Detect separator
  let separator = ',';
  if (lines[0].toLowerCase().startsWith('sep=')) {
    separator = lines[0].substring(4).trim();
    lines.shift();
  } else if (lines[0].includes(';') && !lines[0].includes(',')) {
    separator = ';';
  }

  const header = parseCSVLine(lines[0], separator);

  // Find key column indices
  const codeIdx = header.findIndex(h => h.toLowerCase().includes('nominal code'));
  const nameIdx = header.findIndex(h => h.toLowerCase() === 'name');

  if (codeIdx === -1) {
    throw new Error('Could not find "Nominal Code" column in CSV');
  }

  const monthColumns = findMonthColumns(header);

  // Initialize monthly totals
  const monthlySales2024: number[] = new Array(12).fill(0);
  const monthlySales2025: number[] = new Array(12).fill(0);
  const monthlyExpenses2024: number[] = new Array(12).fill(0);
  const monthlyExpenses2025: number[] = new Array(12).fill(0);

  // Process each row
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], separator);
    const code = values[codeIdx]?.trim();

    if (!code) continue;

    const isSales = SALES_CODES.includes(code);
    const isExpense = EXPENSE_CODES.includes(code);

    if (!isSales && !isExpense) continue;

    // Process each month
    for (let m = 0; m < 12; m++) {
      const cols = monthColumns[m];

      if (isSales) {
        // For sales accounts, credit represents income
        if (cols.credit2024 >= 0) {
          monthlySales2024[m] += parseNumber(values[cols.credit2024]);
        }
        if (cols.credit2025 >= 0) {
          monthlySales2025[m] += parseNumber(values[cols.credit2025]);
        }
      } else if (isExpense) {
        // For expense accounts, debit represents cost
        if (cols.debit2024 >= 0) {
          monthlyExpenses2024[m] += parseNumber(values[cols.debit2024]);
        }
        if (cols.debit2025 >= 0) {
          monthlyExpenses2025[m] += parseNumber(values[cols.debit2025]);
        }
      }
    }
  }

  // Build monthly data array
  const monthlyData: MonthlyData[] = MONTHS.map((month, idx) => {
    const sales2024 = monthlySales2024[idx];
    const sales2025 = monthlySales2025[idx];
    const expenses2024 = monthlyExpenses2024[idx];
    const expenses2025 = monthlyExpenses2025[idx];
    const margin2024 = sales2024 - expenses2024;
    const margin2025 = sales2025 - expenses2025;
    const marginPct2024 = sales2024 > 0 ? (margin2024 / sales2024) * 100 : 0;
    const marginPct2025 = sales2025 > 0 ? (margin2025 / sales2025) * 100 : 0;

    return {
      month,
      sales2024,
      sales2025,
      expenses2024,
      expenses2025,
      margin2024,
      margin2025,
      marginPct2024,
      marginPct2025,
      salesYoY: calcYoY(sales2025, sales2024),
      expensesYoY: calcYoY(expenses2025, expenses2024),
      marginYoY: calcYoY(margin2025, margin2024)
    };
  });

  // Calculate totals
  const totalSales2024 = monthlySales2024.reduce((a, b) => a + b, 0);
  const totalSales2025 = monthlySales2025.reduce((a, b) => a + b, 0);
  const totalExpenses2024 = monthlyExpenses2024.reduce((a, b) => a + b, 0);
  const totalExpenses2025 = monthlyExpenses2025.reduce((a, b) => a + b, 0);
  const totalMargin2024 = totalSales2024 - totalExpenses2024;
  const totalMargin2025 = totalSales2025 - totalExpenses2025;
  const avgMarginPct2024 = totalSales2024 > 0 ? (totalMargin2024 / totalSales2024) * 100 : 0;
  const avgMarginPct2025 = totalSales2025 > 0 ? (totalMargin2025 / totalSales2025) * 100 : 0;

  return {
    totalSales2024,
    totalSales2025,
    totalExpenses2024,
    totalExpenses2025,
    totalMargin2024,
    totalMargin2025,
    avgMarginPct2024,
    avgMarginPct2025,
    salesYoY: calcYoY(totalSales2025, totalSales2024),
    expensesYoY: calcYoY(totalExpenses2025, totalExpenses2024),
    marginYoY: calcYoY(totalMargin2025, totalMargin2024),
    monthlyData
  };
}

// Get breakdown by individual account
export function getAccountBreakdown(csvText: string): {
  sales: AccountBreakdown[];
  expenses: AccountBreakdown[];
} {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) {
    return { sales: [], expenses: [] };
  }

  // Detect separator
  let separator = ',';
  if (lines[0].toLowerCase().startsWith('sep=')) {
    separator = lines[0].substring(4).trim();
    lines.shift();
  } else if (lines[0].includes(';') && !lines[0].includes(',')) {
    separator = ';';
  }

  const header = parseCSVLine(lines[0], separator);
  const codeIdx = header.findIndex(h => h.toLowerCase().includes('nominal code'));
  const nameIdx = header.findIndex(h => h.toLowerCase() === 'name');
  const monthColumns = findMonthColumns(header);

  const sales: AccountBreakdown[] = [];
  const expenses: AccountBreakdown[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], separator);
    const code = values[codeIdx]?.trim();
    const name = values[nameIdx]?.trim() || '';

    if (!code) continue;

    const isSales = SALES_CODES.includes(code);
    const isExpense = EXPENSE_CODES.includes(code);

    if (!isSales && !isExpense) continue;

    const monthly2024: number[] = [];
    const monthly2025: number[] = [];

    for (let m = 0; m < 12; m++) {
      const cols = monthColumns[m];

      if (isSales) {
        monthly2024.push(cols.credit2024 >= 0 ? parseNumber(values[cols.credit2024]) : 0);
        monthly2025.push(cols.credit2025 >= 0 ? parseNumber(values[cols.credit2025]) : 0);
      } else {
        monthly2024.push(cols.debit2024 >= 0 ? parseNumber(values[cols.debit2024]) : 0);
        monthly2025.push(cols.debit2025 >= 0 ? parseNumber(values[cols.debit2025]) : 0);
      }
    }

    const breakdown: AccountBreakdown = {
      code,
      name,
      monthly2024,
      monthly2025,
      total2024: monthly2024.reduce((a, b) => a + b, 0),
      total2025: monthly2025.reduce((a, b) => a + b, 0)
    };

    if (isSales) {
      sales.push(breakdown);
    } else {
      expenses.push(breakdown);
    }
  }

  return { sales, expenses };
}

// Format currency
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

// Format percentage
export function formatPercent(value: number | null): string {
  if (value === null) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}
