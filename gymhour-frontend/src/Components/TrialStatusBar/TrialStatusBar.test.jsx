import React from 'react';
import { render, screen } from '@testing-library/react';
import TrialStatusBar, { daysRemaining } from './TrialStatusBar';

const serverNow = '2026-10-17T12:00:00.000Z';

it('redondea hacia arriba los días restantes del trial', () => {
  expect(daysRemaining({ serverNow, trialEndsAt: '2026-10-31T12:00:00.000Z' })).toBe(14);
  expect(daysRemaining({ serverNow, trialEndsAt: '2026-10-18T11:59:59.000Z' })).toBe(1);
});

it('muestra la etiqueta solamente durante la prueba', () => {
  const billing = { state: 'TRIAL', serverNow, trialEndsAt: '2026-10-18T11:59:59.000Z' };
  const { rerender } = render(<TrialStatusBar billing={billing} />);
  expect(screen.getByText(/En prueba/).textContent).toContain('1 día restante');
  rerender(<TrialStatusBar billing={{ ...billing, state: 'PAID' }} />);
  expect(screen.queryByText(/En prueba/)).toBeNull();
});
