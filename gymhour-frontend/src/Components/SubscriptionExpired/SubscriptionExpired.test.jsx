import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const recoveryCatalog = billing => ({ data: { activeStudents: 42, rebillPublicKey: 'pk_test', offer: { kind: 'SELF_SERVICE' }, billing,
  plans: [{ code: 'ESSENTIAL_MONTHLY', tierCode: 'ESSENTIAL', tierLabel: 'Esencial', maxUsers: 100, amountArs: 49999, months: 1,
    cardAvailable: true, transferAvailable: true }] } });

it('con la tarjeta rechazada ofrece cambiarla antes que una compra nueva', async () => {
  apiClient.get.mockResolvedValue(recoveryCatalog({ state: 'EXPIRED', inGrace: false, liveSubscriptionStatus: 'paused' }));
  apiClient.post.mockResolvedValue({ data: { url: 'https://pay.rebill.com/gymhour/card-renewal/test_sub_1' } });
  renderExpired('ADMIN');
  expect(await screen.findByText('No pudimos confirmar el cobro de tu tarjeta')).toBeTruthy();
  expect(screen.getByText(/Actualizá la tarjeta o pagá de otra forma para volver a usar Gymhour/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Continuar con la compra segura/i })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar tarjeta' }));
  const link = await screen.findByRole('link', { name: /Abrir la página segura de Rebill/i });
  expect(apiClient.post).toHaveBeenCalledWith('/billing/subscription/card-update-link');
  expect(link.href).toBe('https://pay.rebill.com/gymhour/card-renewal/test_sub_1');
  expect(link.target).toBe('_blank');
});

it('durante la tolerancia avisa hasta cuándo conserva el acceso', async () => {
  apiClient.get.mockResolvedValue(recoveryCatalog({ state: 'PAID', inGrace: true, graceUntil: '2099-11-12T12:00:00Z', paidUntil: '2099-11-10T12:00:00Z',
    planCode: 'ESSENTIAL_MONTHLY', liveSubscriptionStatus: 'retrying' }));
  renderExpired('ADMIN');
  expect(await screen.findByText(/Conservás el acceso hasta el 12\/11\/2099/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Cancelar suscripción/i })).toBeNull();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

it('al pagar de otra forma avisa y cancela la suscripción anterior', async () => {
  apiClient.get.mockResolvedValue(recoveryCatalog({ state: 'EXPIRED', inGrace: false, liveSubscriptionStatus: 'paused' }));
  apiClient.post.mockResolvedValue({ data: { order: { id: 'order_1', planCode: 'ESSENTIAL_MONTHLY', method: 'CARD', amountArs: 49999, months: 1 }, planId: 'test_pln_1' } });
  renderExpired('ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: 'Pagar de otra forma' }));
  expect(screen.getByText(/cancelamos la suscripción anterior para que no haya dos débitos/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Continuar con la compra segura/i }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/billing/orders', {
    planCode: 'ESSENTIAL_MONTHLY', method: 'CARD', replaceSubscription: true,
  }));
  await waitFor(() => expect(document.querySelector('rebill-checkout')).toBeTruthy());
});

it('una compra común no pide reemplazar ninguna suscripción', async () => {
  apiClient.get.mockResolvedValue(recoveryCatalog({ state: 'EXPIRED', inGrace: false, liveSubscriptionStatus: null }));
  apiClient.post.mockResolvedValue({ data: { order: { id: 'order_1', planCode: 'ESSENTIAL_MONTHLY', method: 'CARD', amountArs: 49999, months: 1 }, planId: 'test_pln_1' } });
  renderExpired('ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: /Continuar con la compra segura/i }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/billing/orders', { planCode: 'ESSENTIAL_MONTHLY', method: 'CARD' }));
});

it('cancela la suscripción con un motivo y conserva el acceso hasta el vencimiento', async () => {
  const active = { state: 'PAID', inGrace: false, planCode: 'ESSENTIAL_MONTHLY', paymentMethod: 'CARD', paidUntil: '2099-11-30T12:00:00Z' };
  apiClient.get.mockResolvedValueOnce(recoveryCatalog({ ...active, liveSubscriptionStatus: 'active' }))
    .mockResolvedValueOnce(recoveryCatalog({ ...active, liveSubscriptionStatus: null }));
  apiClient.post.mockResolvedValue({ data: { status: 'CANCELLED', accessUntil: active.paidUntil } });
  renderExpired('ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: 'Cancelar suscripción' }));
  expect(screen.getByText(/No se harán más débitos. Conservás el acceso hasta el 30\/11\/2099/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar suscripción' }));
  fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Cierro el gimnasio' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
  expect(await screen.findByText('Tu suscripción está cancelada')).toBeTruthy();
  expect(apiClient.post).toHaveBeenCalledWith('/billing/subscription/cancel', { reason: 'Cierro el gimnasio' });
  expect(screen.queryByRole('button', { name: 'Cancelar suscripción' })).toBeNull();
});

it('si no se puede cancelar lo informa y deja reintentar', async () => {
  apiClient.get.mockResolvedValue(recoveryCatalog({ state: 'PAID', inGrace: false, planCode: 'ESSENTIAL_MONTHLY', paymentMethod: 'CARD',
    paidUntil: '2099-11-30T12:00:00Z', liveSubscriptionStatus: 'active' }));
  apiClient.post.mockRejectedValue({ response: { data: { message: 'No pudimos cancelar en este momento.' } } });
  renderExpired('ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: 'Cancelar suscripción' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
  expect((await screen.findByRole('alert')).textContent).toBe('No pudimos cancelar en este momento.');
  expect(screen.getByRole('button', { name: 'Confirmar cancelación' }).disabled).toBe(false);
});

const purchase = async (method, confirmResponse) => {
  apiClient.get.mockResolvedValue(recoveryCatalog({ state: 'EXPIRED' }));
  const order = { id: `order_${method}`, planCode: 'ESSENTIAL_MONTHLY', method, amountArs: 49999, months: 1, status: 'PENDING' };
  apiClient.post.mockImplementation(url => Promise.resolve(url === '/billing/orders'
    ? { status: 201, data: { order, planId: 'test_pln_1' } } : confirmResponse));
  const callbacks = { onPaid: jest.fn(), onClose: jest.fn() };
  useAuth.mockReturnValue({ user: { role: 'ADMIN', email: 'admin@example.com' }, tenant: { id: 7, name: 'Gimnasio Norte' }, refresh: jest.fn() });
  render(<SubscriptionExpired {...callbacks} />);
  if (method === 'TRANSFER') fireEvent.click(await screen.findByRole('button', { name: /Transferencia/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Continuar con la compra segura/i }));
  await waitFor(() => expect(document.querySelector('rebill-checkout')).toBeTruthy());
  return callbacks;
};
const approve = result => act(() => {
  document.querySelector('rebill-checkout').dispatchEvent(new CustomEvent('success', { detail: { data: { result } } }));
});

it('con tarjeta muestra la confirmación del pago hasta que el admin la cierra', async () => {
  const { onPaid, onClose } = await purchase('CARD', { status: 200, data: { paidUntil: '2099-12-04T12:00:00.000Z' } });
  approve({ paymentId: 'test_pay_1', subscriptionId: 'test_sub_1', status: 'approved' });
  expect(await screen.findByText('Pago confirmado')).toBeTruthy();
  expect(apiClient.post).toHaveBeenCalledWith('/billing/orders/order_CARD/confirm-card', { paymentId: 'test_pay_1', subscriptionId: 'test_sub_1' });
  expect(screen.getByText('Acceso hasta el 4/12/2099')).toBeTruthy();
  expect(screen.getByText(/Rebill te envía el comprobante de pago a admin@example.com/)).toBeTruthy();
  expect(onPaid).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ir a Gymhour' }));
  expect(onClose).toHaveBeenCalled();
});

it('con transferencia espera la acreditación en lugar de mostrar un error', async () => {
  const { onPaid } = await purchase('TRANSFER', { status: 202, data: { message: 'Todavía no recibimos la transferencia.' } });
  approve({ checkoutRequestId: 'test_che_req_1', status: 'pending_customer_charge' });
  const verify = await screen.findByRole('button', { name: /Ya transferí, verificar ahora/i });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.querySelector('rebill-checkout')).toBeTruthy();
  fireEvent.click(verify);
  expect((await screen.findByRole('alert')).textContent).toBe('Todavía no recibimos la transferencia.');
  expect(apiClient.post).toHaveBeenLastCalledWith('/billing/orders/order_TRANSFER/confirm-transfer', {});

  apiClient.post.mockResolvedValueOnce({ status: 200, data: { paidUntil: '2099-12-04T12:00:00.000Z' } });
  fireEvent.click(screen.getByRole('button', { name: /Ya transferí, verificar ahora/i }));
  expect(await screen.findByText('Pago confirmado')).toBeTruthy();
  expect(onPaid).toHaveBeenCalled();
});

it('con tarjeta sin suscripción sigue avisando que no vuelva a pagar', async () => {
  await purchase('CARD', { status: 200, data: {} });
  approve({ paymentId: 'test_pay_1', status: 'approved' });
  expect((await screen.findByRole('alert')).textContent).toMatch(/no se creó la suscripción/);
  expect(screen.queryByText('Pago confirmado')).toBeNull();
});

it('avisa que no pague de nuevo si hay una compra con tarjeta reciente sin confirmar', async () => {
  const pendingCard = createdAt => ({ data: { ...recoveryCatalog({ state: 'EXPIRED' }).data,
    order: { id: 'order_1', method: 'CARD', status: 'PENDING', planCode: 'ESSENTIAL_MONTHLY', createdAt } } });
  apiClient.get.mockResolvedValue(pendingCard(new Date(Date.now() - 60 * 60 * 1000).toISOString()));
  renderExpired('ADMIN');
  expect(await screen.findByText('¿Ya pagaste con tarjeta?')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Continuar con la compra segura/i })).toBeTruthy();
});

it('no avisa por una compra con tarjeta de hace más de un día', async () => {
  apiClient.get.mockResolvedValue({ data: { ...recoveryCatalog({ state: 'EXPIRED' }).data,
    order: { id: 'order_1', method: 'CARD', status: 'PENDING', planCode: 'ESSENTIAL_MONTHLY', createdAt: '2020-01-01T00:00:00.000Z' } } });
  renderExpired('ADMIN');
  await screen.findByRole('button', { name: /Continuar con la compra segura/i });
  expect(screen.queryByText('¿Ya pagaste con tarjeta?')).toBeNull();
});

it('el ajuste a Pro por transferencia espera la acreditación en lugar de mostrar un error', async () => {
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('quote')
    ? { amountArs: 25000, adjustment: 'CHARGE', method: 'TRANSFER', nextAmountArs: 99999, periodEnd: '2026-11-30T00:00:00Z' }
    : { activeStudents: 42, rebillPublicKey: 'pk_test', offer: { kind: 'SELF_SERVICE' },
      billing: { state: 'PAID', planCode: 'ESSENTIAL_MONTHLY', paymentMethod: 'TRANSFER' },
      plans: [
        { code: 'ESSENTIAL_MONTHLY', tierCode: 'ESSENTIAL', tierLabel: 'Esencial', maxUsers: 100, amountArs: 49999, months: 1, transferAvailable: true },
        { code: 'PRO_MONTHLY', tierCode: 'PRO', tierLabel: 'Pro', maxUsers: 200, amountArs: 99999, months: 1, transferAvailable: true },
      ] } }));
  apiClient.post.mockImplementation(url => Promise.resolve(url === '/billing/plan-change'
    ? { status: 201, data: { change: { id: 'change_1', toPlanCode: 'PRO_MONTHLY', amountArs: 25000, status: 'PENDING' } } }
    : { status: 202, data: { message: 'Todavía no recibimos la transferencia.' } }));
  renderExpired('ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: /Pro.*99.999/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Mejorar a Pro/i }));
  await waitFor(() => expect(document.querySelector('rebill-checkout')).toBeTruthy());
  approve({ checkoutRequestId: 'test_che_req_1', status: 'pending_customer_charge' });
  const verify = await screen.findByRole('button', { name: /Ya transferí, verificar ahora/i });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(verify);
  expect((await screen.findByRole('alert')).textContent).toBe('Todavía no recibimos la transferencia.');
  expect(apiClient.post).toHaveBeenLastCalledWith('/billing/plan-change/change_1/confirm', {});
  expect(JSON.parse(sessionStorage.getItem('gymhour:rebill-plan-change:gimnasio-norte')).transferPending).toBe(true);
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
