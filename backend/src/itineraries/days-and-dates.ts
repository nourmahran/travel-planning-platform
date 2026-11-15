
import { DateTime } from 'luxon';

export type DatedDay = {
  dayNumber: number;
  date: string;
};

/** Calendar date of `dayNumber` (1-based) counted from `startDate`, both UTC. */
export function nextDate(startDate: string, dayNumber: number): string {
  return DateTime.fromISO(startDate, { zone: 'utc' })
    .plus({ days: dayNumber - 1 })
    .toFormat('yyyy-MM-dd');
}

/** Rewrites dayNumber (1..N) and date on every day, in array order. */
export function renumberDays<T extends DatedDay>(
  startDate: string,
  days: T[],
): T[] {
  days.forEach((day, index) => {
    day.dayNumber = index + 1;
    day.date = nextDate(startDate, index + 1);
  });

  return days;
}

/** True when the value is a real calendar date written as YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const date = DateTime.fromISO(value, { zone: 'utc' });

  return date.isValid && date.toFormat('yyyy-MM-dd') === value;
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' })
    .plus({ days })
    .toFormat('yyyy-MM-dd');
}
