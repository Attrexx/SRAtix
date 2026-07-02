/**
 * Event date formatting.
 *
 * SRAtix stores event start/end as timezone-aware instants, but they represent a
 * calendar date in the event's LOCAL timezone. All SRA events are in Switzerland,
 * so we render in Europe/Zurich. Formatting with Date#toISOString() (UTC) or the
 * server's local time renders the WRONG day for a local-midnight start — e.g.
 * 2026-11-13 00:00 CET is stored as 2026-11-12T23:00:00Z and prints as "2026-11-12"
 * in UTC. Always format event dates through these helpers so emails/invoices match
 * the dashboard (which formats in the viewer's local zone).
 *
 * If multi-timezone events are ever introduced, pass the event's stored `timezone`
 * instead of relying on the Europe/Zurich default.
 */
export const EVENT_TIME_ZONE = 'Europe/Zurich';

/** Calendar date (YYYY-MM-DD) of an event instant, rendered in the event timezone. */
export function formatEventDateIso(
  date: Date,
  timeZone: string = EVENT_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
