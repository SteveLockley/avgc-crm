// Opening hours helper functions

export interface OpeningHours {
  id: number;
  location: string;
  period_name: string | null;
  period_start: string | null;
  period_end: string | null;
  day_of_week: number | null;
  open_time: string;
  close_time: string;
  is_closed: boolean;
  notes: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Get opening hours for a location, optionally for a specific date
 */
export async function getOpeningHours(
  db: D1Database,
  location: string = 'Clubhouse',
  date?: Date
): Promise<OpeningHours[]> {
  const targetDate = date || new Date();
  const dayOfWeek = targetDate.getDay();
  const dateStr = targetDate.toISOString().split('T')[0];

  // Get hours that match the date/period and day
  const hours = await db.prepare(`
    SELECT * FROM opening_hours
    WHERE location = ?
    AND (period_start IS NULL OR period_start <= ?)
    AND (period_end IS NULL OR period_end >= ?)
    AND (day_of_week IS NULL OR day_of_week = ?)
    ORDER BY sort_order, day_of_week
  `).bind(location, dateStr, dateStr, dayOfWeek).all<OpeningHours>();

  return hours.results || [];
}

/**
 * Get all opening hours for a location (all days)
 */
export async function getAllOpeningHours(
  db: D1Database,
  location: string = 'Clubhouse'
): Promise<OpeningHours[]> {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];

  // Get hours for the current period
  const hours = await db.prepare(`
    SELECT * FROM opening_hours
    WHERE location = ?
    AND (period_start IS NULL OR period_start <= ?)
    AND (period_end IS NULL OR period_end >= ?)
    ORDER BY sort_order, day_of_week
  `).bind(location, dateStr, dateStr).all<OpeningHours>();

  return hours.results || [];
}

/**
 * Get today's opening hours for a location
 */
export async function getTodayOpeningHours(
  db: D1Database,
  location: string = 'Clubhouse'
): Promise<OpeningHours | null> {
  const hours = await getOpeningHours(db, location);
  return hours[0] || null;
}

/**
 * Format opening hours for display
 */
export function formatOpeningHours(hours: OpeningHours): string {
  if (hours.is_closed) {
    return 'Closed';
  }
  return `${formatTime(hours.open_time)} - ${hours.close_time}`;
}

/**
 * Format time from 24h to 12h format
 */
export function formatTime(time: string): string {
  // Handle special values like 'Dusk', 'Late'
  if (!time.includes(':')) {
    return time;
  }

  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;

  if (minutes === 0) {
    return `${displayHours}:00 ${period}`;
  }
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Get day name from day of week number
 */
export function getDayName(dayOfWeek: number, short: boolean = false): string {
  return short ? DAY_NAMES_SHORT[dayOfWeek] : DAY_NAMES[dayOfWeek];
}

/**
 * Group opening hours by time (for compact display)
 */
export function groupHoursByTime(hours: OpeningHours[]): { days: string; time: string }[] {
  const groups: Map<string, number[]> = new Map();

  for (const h of hours) {
    if (h.day_of_week === null) continue;
    const timeKey = h.is_closed ? 'Closed' : `${formatTime(h.open_time)} - ${h.close_time}`;

    if (!groups.has(timeKey)) {
      groups.set(timeKey, []);
    }
    groups.get(timeKey)!.push(h.day_of_week);
  }

  const result: { days: string; time: string }[] = [];

  for (const [time, days] of groups) {
    days.sort((a, b) => a - b);
    result.push({
      days: formatDayRange(days),
      time
    });
  }

  return result;
}

/**
 * Format a range of days (e.g., "Mon - Fri" or "Sat, Sun")
 */
function formatDayRange(days: number[]): string {
  if (days.length === 0) return '';
  if (days.length === 1) return DAY_NAMES_SHORT[days[0]];
  if (days.length === 7) return 'Every day';

  // Check if consecutive
  const isConsecutive = days.every((day, i) =>
    i === 0 || day === days[i - 1] + 1 || (days[i - 1] === 6 && day === 0)
  );

  if (isConsecutive && days.length > 2) {
    return `${DAY_NAMES_SHORT[days[0]]} - ${DAY_NAMES_SHORT[days[days.length - 1]]}`;
  }

  return days.map(d => DAY_NAMES_SHORT[d]).join(', ');
}

/**
 * Get opening hours formatted as a weekly table
 */
export function formatWeeklyHours(hours: OpeningHours[]): { day: string; dayShort: string; time: string; isClosed: boolean }[] {
  const result: { day: string; dayShort: string; time: string; isClosed: boolean }[] = [];

  // Create a map of day_of_week to hours
  const hoursByDay = new Map<number, OpeningHours>();
  for (const h of hours) {
    if (h.day_of_week !== null) {
      hoursByDay.set(h.day_of_week, h);
    }
  }

  // Start from Monday (1) and wrap around
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon, Tue, Wed, Thu, Fri, Sat, Sun

  for (const day of dayOrder) {
    const h = hoursByDay.get(day);
    if (h) {
      result.push({
        day: DAY_NAMES[day],
        dayShort: DAY_NAMES_SHORT[day],
        time: h.is_closed ? 'Closed' : `${formatTime(h.open_time)} - ${h.close_time}`,
        isClosed: !!h.is_closed
      });
    } else {
      result.push({
        day: DAY_NAMES[day],
        dayShort: DAY_NAMES_SHORT[day],
        time: 'Not set',
        isClosed: false
      });
    }
  }

  return result;
}
