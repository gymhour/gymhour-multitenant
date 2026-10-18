export type FeeDuration = { unit: 'WEEKS' | 'MONTHS'; count: number };

const LEGACY_DURATIONS: Record<string, FeeDuration> = {
  SEMANAL: { unit: 'WEEKS', count: 1 },
  MENSUAL: { unit: 'MONTHS', count: 1 },
  BIMESTRAL: { unit: 'MONTHS', count: 2 },
  TRIMESTRAL: { unit: 'MONTHS', count: 3 },
  SEMESTRAL: { unit: 'MONTHS', count: 6 },
  ANUAL: { unit: 'MONTHS', count: 12 },
};

export function parseFeeDuration(value: unknown): FeeDuration | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (LEGACY_DURATIONS[raw]) return LEGACY_DURATIONS[raw];
  const match = /^(WEEKS|MONTHS):(\d+)$/.exec(raw);
  if (!match) return null;
  const count = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || count > (match[1] === 'WEEKS' ? 52 : 24)) return null;
  return { unit: match[1] as FeeDuration['unit'], count };
}

export function serializeFeeDuration(unit: unknown, count: unknown): string | null {
  const duration = parseFeeDuration(`${String(unit).toUpperCase()}:${Number(count)}`);
  return duration ? `${duration.unit}:${duration.count}` : null;
}

export function parseFeeDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export const feeDateString = (date: Date): string => date.toISOString().slice(0, 10);
export const feeMonth = (date: Date): string => feeDateString(date).slice(0, 7);
export const feeDayEnd = (date: Date): Date => new Date(date.getTime() + 86_400_000 - 1);
export const feeNextDay = (date: Date): Date => new Date(date.getTime() + 86_400_000);

export function feeToday(timeZone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return parseFeeDate(`${get('year')}-${get('month')}-${get('day')}`)!;
}

export function nextFeeStart(start: Date, durationValue: unknown, anchorDay = start.getUTCDate()): Date {
  const duration = parseFeeDuration(durationValue) ?? LEGACY_DURATIONS.MENSUAL;
  if (duration.unit === 'WEEKS') return new Date(start.getTime() + duration.count * 7 * 86_400_000);
  const targetMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + duration.count, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(anchorDay, lastDay)));
}

export function feePeriod(start: Date, duration: unknown, anchorDay = start.getUTCDate()) {
  const nextStart = nextFeeStart(start, duration, anchorDay);
  return { start, end: new Date(nextStart.getTime() - 1), nextStart, due: feeDayEnd(start) };
}

export function nextUnbilledAnniversary(firstStart: Date, duration: unknown, anchorDay: number, today: Date): Date {
  let start = firstStart;
  for (let i = 0; i < 5_200 && start < today; i += 1) start = nextFeeStart(start, duration, anchorDay);
  if (start < today) throw new Error('La fecha inicial de cobro es demasiado antigua.');
  return start;
}
