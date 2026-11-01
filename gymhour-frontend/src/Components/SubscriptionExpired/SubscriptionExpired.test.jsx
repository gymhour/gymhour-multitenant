import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SubscriptionExpired from './SubscriptionExpired';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../axiosConfig';

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../axiosConfig', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('rebill/loader', () => ({ defineCustomElements: jest.fn() }));

beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

const renderExpired = role => {
  useAuth.mockReturnValue({
    user: { role, email: 'admin@example.com' }, tenant: { name: 'Gimnasio Norte', slug: 'gimnasio-norte' },
    refresh: jest.fn(),
  });
  render(<SubscriptionExpired />);
};

it('muestra planes, precios y medios de pago al administrador', async () => {
  apiClient.get.mockResolvedValue({ data: { activeStudents: 42,
    offer: { kind: 'SELF_SERVICE', tier: { label: 'Hasta 100 alumnos activos' } },
    plans: [
      { code: 'ESSENTIAL_MONTHLY', tierCode: 'ESSENTIAL', tierLabel: 'Esencial', maxUsers: 100,
        periodLabel: 'Mensual', amountArs: 49999, months: 1, discountPercent: 0 },
      { code: 'PRO_MONTHLY', tierCode: 'PRO', tierLabel: 'Pro', maxUsers: 200,
        periodLabel: 'Mensual', amountArs: 99999, months: 1, discountPercent: 0 },
    ],
    transfer: {},
  } });
  renderExpired('ADMIN');
  await waitFor(() => expect(screen.getByText(/42 socios activos/)).toBeTruthy());
  expect(screen.getByRole('button', { name: /Esencial.*49.999/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Pro.*99.999/i })).toBeTruthy();
  expect(screen.getByRole('link', { name: /A medida.*A consultar/i })).toBeTruthy();
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
    plans: [{ code: 'PRO_MONTHLY', tierCode: 'PRO', tierLabel: 'Pro', maxUsers: 200, periodLabel: 'Mensual',
      amountArs: 99999, months: 1, discountPercent: 0, cardAvailable: true, transferAvailable: true }],
  } });
  apiClient.post.mockResolvedValue({ data: { planId: 'test_pln_123', order: { id: 'order_123', planCode: 'PRO_MONTHLY',
    method: 'CARD', amountArs: 99999, months: 1 } } });
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

it('muestra el proporcional y prepara un único cobro al subir de Esencial a Pro', async () => {
  sessionStorage.clear();
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('quote')
    ? { amountArs: 25000, adjustment: 'CHARGE', method: 'CARD', nextAmountArs: 99999, periodEnd: '2026-11-30T00:00:00Z' }
    : { activeStudents: 42, rebillPublicKey: 'pk_test', offer: { kind: 'SELF_SERVICE' },
      billing: { state: 'PAID', planCode: 'ESSENTIAL_MONTHLY', paymentMethod: 'CARD' },
      plans: [
        { code: 'ESSENTIAL_MONTHLY', tierCode: 'ESSENTIAL', tierLabel: 'Esencial', maxUsers: 100,
          amountArs: 49999, months: 1, cardAvailable: true },
        { code: 'PRO_MONTHLY', tierCode: 'PRO', tierLabel: 'Pro', maxUsers: 200,
          amountArs: 99999, months: 1, cardAvailable: true },
      ] } }));
  apiClient.post.mockResolvedValue({ status: 201, data: { change: {
    id: 'change_123', toPlanCode: 'PRO_MONTHLY', amountArs: 25000, status: 'PENDING',
  } } });
  renderExpired('ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: /Pro.*99.999/i }));
  expect(await screen.findByText(/Tu pago de Esencial ya cubre parte.*25.000/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Mejorar a Pro/i }));
  await waitFor(() => expect(document.querySelector('rebill-checkout')).toBeTruthy());
  expect(apiClient.post).toHaveBeenCalledWith('/billing/plan-change', {
    planCode: 'PRO_MONTHLY', expectedAmountArs: 25000,
  });
  const instant = JSON.parse(document.querySelector('rebill-checkout').getAttribute('instant-product'));
  expect(instant.amount).toBe(25000);
  expect(instant.metadata.gymhourPlanChangeId).toBe('change_123');
  fireEvent.click(screen.getByRole('button', { name: /Volver a los planes/i }));
  expect(screen.getByText('Este es tu plan actual.')).toBeTruthy();
  expect(document.querySelector('rebill-checkout')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Pro.*99.999/i }));
  fireEvent.click(screen.getByRole('button', { name: /Continuar cambio/i }));
  expect(document.querySelector('rebill-checkout')).toBeTruthy();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

it('programa la baja a Esencial sin ofrecer un cobro ni una devolución', async () => {
  sessionStorage.clear();
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('quote')
    ? { amountArs: 0, adjustment: 'SCHEDULED', periodEnd: '2026-11-30T00:00:00Z', nextAmountArs: 49999 }
    : { activeStudents: 42, rebillPublicKey: 'pk_test', offer: { kind: 'SELF_SERVICE' },
      billing: { state: 'PAID', planCode: 'PRO_MONTHLY', paymentMethod: 'CARD' },
      plans: [
        { code: 'ESSENTIAL_MONTHLY', tierCode: 'ESSENTIAL', tierLabel: 'Esencial', maxUsers: 100,
          amountArs: 49999, months: 1, cardAvailable: true },
        { code: 'PRO_MONTHLY', tierCode: 'PRO', tierLabel: 'Pro', maxUsers: 200,
          amountArs: 99999, months: 1, cardAvailable: true },
      ] } }));
  apiClient.post.mockImplementation(() => new Promise(() => {}));
  renderExpired('ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: /Esencial.*49.999/i }));
  expect(await screen.findByText('El cambio a Esencial se hará al vencer el período pagado')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Programar cambio a Esencial/i }));
  expect(apiClient.post).toHaveBeenCalledWith('/billing/plan-change', {
    planCode: 'ESSENTIAL_MONTHLY', expectedAmountArs: 0,
  });
  expect(document.querySelector('rebill-checkout')).toBeNull();
});

it('muestra Pro activo y Esencial como próximo plan cuando la baja ya está programada', async () => {
  sessionStorage.clear();
  apiClient.get.mockResolvedValue({ data: { activeStudents: 42, offer: { kind: 'SELF_SERVICE' },
    billing: { state: 'PAID', planCode: 'PRO_MONTHLY', scheduledPlanCode: 'ESSENTIAL_MONTHLY',
      scheduledEffectiveAt: '2026-11-30T00:00:00Z' },
    plans: [
      { code: 'ESSENTIAL_MONTHLY', tierCode: 'ESSENTIAL', tierLabel: 'Esencial', maxUsers: 100, amountArs: 49999 },
      { code: 'PRO_MONTHLY', tierCode: 'PRO', tierLabel: 'Pro', maxUsers: 200, amountArs: 99999 },
    ] } });
  renderExpired('ADMIN');
  expect(await screen.findByText(/Tu cambio a Esencial está programado/)).toBeTruthy();
  expect(screen.getByText(/Conservás Pro hasta el/)).toBeTruthy();
  expect(apiClient.get).toHaveBeenCalledWith('/billing/catalog');
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(document.querySelector('rebill-checkout')).toBeNull();
});

it('permite cancelar la baja programada y muestra la próxima cuota Pro', async () => {
  const plans = [
    { code: 'ESSENTIAL_MONTHLY', tierCode: 'ESSENTIAL', tierLabel: 'Esencial', maxUsers: 100, amountArs: 49999 },
    { code: 'PRO_MONTHLY', tierCode: 'PRO', tierLabel: 'Pro', maxUsers: 200, amountArs: 99999 },
  ];
  apiClient.get.mockResolvedValueOnce({ data: { activeStudents: 42, offer: { kind: 'SELF_SERVICE' }, plans,
    billing: { state: 'PAID', planCode: 'PRO_MONTHLY', scheduledPlanCode: 'ESSENTIAL_MONTHLY', scheduledEffectiveAt: '2099-11-30T00:00:00Z' } } })
    .mockResolvedValueOnce({ data: { activeStudents: 42, offer: { kind: 'SELF_SERVICE' }, plans,
      billing: { state: 'PAID', planCode: 'PRO_MONTHLY' } } });
  apiClient.post.mockResolvedValueOnce({ status: 200, data: { status: 'CANCELLED' } });
  renderExpired('ADMIN');
  expect(await screen.findByText(/Si cancelás el cambio.*99.999/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Cancelar cambio y mantener Pro/i }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/billing/plan-change/cancel-scheduled'));
  expect(await screen.findByText('Este es tu plan actual.')).toBeTruthy();
});
