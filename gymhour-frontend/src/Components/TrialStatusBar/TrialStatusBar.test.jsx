import React from 'react';
import { render, screen } from '@testing-library/react';
import TrialStatusBar, { daysRemaining } from './TrialStatusBar';

const serverNow = '2026-10-17T12:00:00.000Z';

it('redondea hacia arriba los días restantes del trial', () => {
  expect(daysRemaining({ serverNow, trialEndsAt: '2026-10-31T12:00:00.000Z' })).toBe(14);
  expect(daysRemaining({ serverNow, trialEndsAt: '2026-10-18T11:59:59.000Z' })).toBe(1);
});

it('avisa al admin que con más de 200 socios va a necesitar el plan A medida', () => {
  const billing = { state: 'TRIAL', serverNow, trialEndsAt: '2026-10-25T12:00:00.000Z', activeStudents: 230 };
  const tenant = { name: 'Gimnasio Norte', slug: 'gimnasio-norte' };
  const { rerender } = render(<TrialStatusBar billing={billing} admin tenant={tenant} />);
  expect(screen.getByText(/más de 200 socios activos/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Pedir propuesta' }).href).toContain('wa.me/');
  rerender(<TrialStatusBar billing={billing} tenant={tenant} />);
  expect(screen.queryByText(/más de 200 socios activos/)).toBeNull();
  rerender(<TrialStatusBar billing={{ ...billing, activeStudents: 200 }} admin tenant={tenant} />);
  expect(screen.queryByText(/más de 200 socios activos/)).toBeNull();
});

it('muestra la etiqueta solamente durante la prueba', () => {
  const billing = { state: 'TRIAL', serverNow, trialEndsAt: '2026-10-18T11:59:59.000Z' };
  const { rerender } = render(<TrialStatusBar billing={billing} />);
  expect(screen.getByText(/En prueba/).textContent).toContain('1 día restante');
  rerender(<TrialStatusBar billing={{ ...billing, state: 'PAID' }} />);
  expect(screen.queryByText(/En prueba/)).toBeNull();
});
