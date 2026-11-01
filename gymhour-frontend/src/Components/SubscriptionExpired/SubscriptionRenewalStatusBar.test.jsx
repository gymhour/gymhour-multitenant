import React from 'react';
import { render, screen } from '@testing-library/react';
import SubscriptionRenewalStatusBar, { renewalDaysRemaining } from './SubscriptionRenewalStatusBar';

const serverNow = '2026-10-17T12:00:00.000Z';
const billing = paidUntil => ({ state: 'PAID', paidUntil, serverNow });

it('muestra la barra solamente durante los últimos tres días del período pago', () => {
  expect(renewalDaysRemaining(billing('2026-10-20T12:00:00.000Z'))).toBe(3);
  expect(renewalDaysRemaining(billing('2026-10-19T12:00:00.000Z'))).toBe(2);
  expect(renewalDaysRemaining(billing('2026-10-21T12:00:00.000Z'))).toBeNull();
  expect(renewalDaysRemaining(billing('2026-10-17T12:00:00.000Z'))).toBeNull();
  expect(renewalDaysRemaining({ ...billing('2026-10-20T12:00:00.000Z'), state: 'TRIAL' })).toBeNull();
  expect(renewalDaysRemaining({ ...billing('2026-10-20T12:00:00.000Z'), paymentMethod: 'CARD' })).toBeNull();
});

it('muestra los días restantes con la barra de suscripción', () => {
  const { rerender } = render(<SubscriptionRenewalStatusBar days={3} />);
  expect(screen.getByRole('status', { name: /3 días restantes/i }).textContent).toContain('Suscripción');
  expect(screen.getByRole('button', { name: /Información sobre la suscripción/i }).textContent).toBe('?');
  expect(screen.getByRole('tooltip').textContent).toMatch(/débito automático.*ignorar este aviso/i);
  rerender(<SubscriptionRenewalStatusBar days={1} />);
  expect(screen.getByRole('status', { name: /1 día restante/i })).toBeTruthy();
});
