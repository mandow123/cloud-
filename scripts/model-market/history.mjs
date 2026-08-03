const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function parseCalendarDate(value) {
  if (typeof value !== "string") return null;
  const match = ISO_CALENDAR_DATE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

/**
 * Calculates a change only when the history contains the exact calendar-day
 * boundary. A six-day-old point cannot stand in for a seven-day change, and an
 * older point cannot silently turn a missing daily observation into a different
 * interval.
 *
 * @param {readonly { date: string, value: number }[]} history
 * @param {string} currentDate
 * @param {number} currentValue
 * @param {number} days
 * @returns {number | null}
 */
export function calendarIndexChange(history, currentDate, currentValue, days) {
  if (!Array.isArray(history) || !Number.isFinite(currentValue) || currentValue <= 0) return null;
  if (!Number.isInteger(days) || days <= 0) return null;
  const current = parseCalendarDate(currentDate);
  if (!current) return null;

  current.setUTCDate(current.getUTCDate() - days);
  const boundaryDate = current.toISOString().slice(0, 10);
  const reference = [...history]
    .reverse()
    .find((point) => point?.date === boundaryDate && Number.isFinite(point?.value) && point.value > 0);
  if (!reference) return null;

  return Number((((currentValue / reference.value) - 1) * 100).toFixed(4));
}
