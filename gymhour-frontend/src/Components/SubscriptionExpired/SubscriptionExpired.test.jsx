import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SubscriptionExpired from './SubscriptionExpired';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../axiosConfig';

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../axiosConfig', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('rebill/loader', () => ({ defineCustomElements: jest.fn() }));

const renderExpired = role => {
  useAuth.mockReturnValue({
    user: { role, email: 'admin@example.com' }, tenant: { name: 'Gimnasio Norte', slug: 'gimnasio-norte' },
    refresh: jest.fn(),
  });
  render(<SubscriptionExpired />);
};

it('muestra duración, precio y medios de pago al administrador', async () => {
  apiClient.get.mockResolvedValue({ data: { activeStudents: 42,
    offer: { kind: 'SELF_SERVICE', tier: { label: 'Hasta 100 alumnos activos' } },
    plans: [{ code: 'UP_TO_100_MONTHLY', periodLabel: 'Mensual', amountArs: 50000, months: 1, discountPercent: 0 }],
    transfer: {},
  } });
  renderExpired('ADMIN');
  await waitFor(() => expect(screen.getByText(/42 alumnos activos/)).toBeTruthy());
  expect(screen.getByRole('button', { name: /Mensual.*50.000/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Tarjeta Renovación automática cada mes/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Transferencia Renovación manual al vencer/i })).toBeTruthy();
  const link = screen.getByRole('link', { name: /Necesito ayuda/i });
  expect(link.href).toContain('wa.me/5493415936396');
  expect(decodeURIComponent(link.href)).toContain('Gimnasio Norte (gimnasio-norte)');
  expect(decodeURIComponent(link.href)).toContain('Necesito ayuda con el pago de Gymhour o tengo una consulta sobre mi suscripción.');
  expect(screen.queryByRole('button', { name: /Cerrar sesión/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /Ya pagué/i })).toBeNull();
});

it('usa el ID del plan recurrente preparado por el backend', async () => {
  apiClient.get.mockResolvedValue({ data: { activeStudents: 42, rebillPublicKey: 'pk_test',
    offer: { kind: 'SELF_SERVICE', tier: { label: 'Hasta 100 alumnos activos' } },
    plans: [{ code: 'UP_TO_100_QUARTERLY', tierLabel: 'Hasta 100 alumnos activos', periodLabel: 'Trimestral',
      amountArs: 135000, months: 3, discountPercent: 10, cardAvailable: true, transferAvailable: true }],
  } });
  apiClient.post.mockResolvedValue({ data: { planId: 'test_pln_123', order: { id: 'order_123', planCode: 'UP_TO_100_QUARTERLY',
    method: 'CARD', amountArs: 135000, months: 3 } } });
  renderExpired('ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: /Continuar con la compra segura/i }));
  await waitFor(() => expect(document.querySelector('rebill-checkout')).toBeTruthy());
  const checkout = document.querySelector('rebill-checkout');
  expect(checkout.getAttribute('plan-id')).toBe('test_pln_123');
  expect(checkout.getAttribute('instant-plan')).toBeNull();
  expect(checkout.getAttribute('one-click-checkout')).toBe('false');
  expect(JSON.parse(checkout.getAttribute('customer-information')).email).toBe('admin@example.com');
});

it('indica a los alumnos que contacten a su administrador sin ofrecerles el pago', () => {
  renderExpired('STUDENT');
  expect(screen.getByText(/Contactá al administrador/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Continuar al pago/i })).toBeNull();
});
