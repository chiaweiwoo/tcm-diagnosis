/**
 * Analytics utilities.
 *
 * buildWindow — shared by evaluateDoctor and the evaluate-doctors cron.
 */

export function buildWindow(days: number): { windowStart: Date; windowEnd: Date } {
  // windowEnd = start of tomorrow so today's records are always included in the window
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + 1);
  windowEnd.setHours(0, 0, 0, 0);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - days);
  return { windowStart, windowEnd };
}
