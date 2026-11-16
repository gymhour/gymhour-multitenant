import { describe, expect, it } from 'vitest';
import { feeDateString, feePeriod, nextFeeStart, nextUnbilledAnniversary, parseFeeDate, parseFeeDuration, skipEndedPeriods } from '../src/services/feeDates.service.js';

describe('ciclos de cuotas', () => {
  it('cubre el período completo y vence al empezar', () => {
    const period = feePeriod(parseFeeDate('2026-10-17')!, 'MONTHS:1', 17);
    expect(feeDateString(period.end)).toBe('2026-11-16');
    expect(feeDateString(period.nextStart)).toBe('2026-11-17');
    expect(feeDateString(period.due)).toBe('2026-10-17');
  });

  it('mantiene el día ancla después de febrero', () => {
    const february = nextFeeStart(parseFeeDate('2027-01-31')!, 'MONTHS:1', 31);
    expect(feeDateString(february)).toBe('2027-02-28');
    expect(feeDateString(nextFeeStart(february, 'MONTHS:1', 31))).toBe('2027-03-31');
  });

  it('permite semanas y varios meses', () => {
    expect(feeDateString(nextFeeStart(parseFeeDate('2026-10-17')!, 'WEEKS:2'))).toBe('2026-10-31');
    expect(feeDateString(nextFeeStart(parseFeeDate('2026-10-17')!, 'MONTHS:2'))).toBe('2026-12-17');
    expect(parseFeeDuration('MONTHS:25')).toBeNull();
  });

  it('saltea los períodos terminados y conserva el que cubre hoy', () => {
    const today = parseFeeDate('2026-11-02')!;
    expect(feeDateString(skipEndedPeriods(parseFeeDate('2026-08-10')!, 'MONTHS:1', 10, today))).toBe('2026-10-10');
    expect(feeDateString(skipEndedPeriods(parseFeeDate('2026-10-10')!, 'MONTHS:1', 10, today))).toBe('2026-10-10');
    expect(feeDateString(skipEndedPeriods(parseFeeDate('2026-11-05')!, 'MONTHS:1', 5, today))).toBe('2026-11-05');
    expect(feeDateString(skipEndedPeriods(parseFeeDate('2026-10-02')!, 'MONTHS:1', 2, today))).toBe('2026-11-02');
  });

  it('omite aniversarios pasados de un alta retroactiva', () => {
    expect(feeDateString(nextUnbilledAnniversary(parseFeeDate('2026-07-17')!, 'MENSUAL', 17, parseFeeDate('2026-10-16')!))).toBe('2026-10-17');
  });
});
