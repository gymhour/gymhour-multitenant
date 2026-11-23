import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-toastify';
import apiService from '../../../services/apiService';
import Cuotas from './Cuotas';

jest.mock('../../../Components/SidebarMenu/SidebarMenu', () => () => null);
jest.mock('../../../authSession', () => ({ getCurrentUserId: () => 1 }));
jest.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'socio@gym.test' },
    tenant: { name: 'Gym', settings: { currency: 'ARS', paymentAlias: 'MI.GYM' }, billing: { features: { MEMBER_PAYMENTS: true } } },
  }),
}));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../../services/apiService', () => ({
  __esModule: true,
  default: {
    getCuotasUsuario: jest.fn(), getMyPaymentState: jest.fn(), startCuotaCheckout: jest.fn(), verifyPaymentAttempt: jest.fn(),
    adhereAutomaticDebit: jest.fn(), verifyMyAutomaticDebit: jest.fn(), cancelMyAutomaticDebit: jest.fn(),
  },
}));

const plan = { nombre: 'Mensual', precio: 25000, duracion: 'MONTHS:1' };
const cuota = (overrides = {}) => ({
  ID_Cuota: 10, mes: '2026-11', importe: 25000, vence: '2026-11-18T23:59:59.999Z', fechaInicio: '2026-11-18T00:00:00.000Z',
  fechaFin: '2026-12-17T00:00:00.000Z', pagada: false, vencida: true, formaPago: null, fechaPago: null,
  recargo: 0, recargoSugerido: { monto: 1500, dias: 6 }, User: { plan }, pagoEnLinea: null, cubiertaPorDebito: false, ...overrides,
});
const renderCuotas = (path = '/alumno/cuotas') => render(<MemoryRouter initialEntries={[path]}><Cuotas /></MemoryRouter>);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: jest.fn() } });
  apiService.getCuotasUsuario.mockResolvedValue([cuota(), cuota({ ID_Cuota: 11, vencida: false, recargoSugerido: null })]);
  apiService.getMyPaymentState.mockResolvedValue({ disponible: true, intentoActivo: null, debito: null });
});

it('el socio paga con Mercado Pago el total con el recargo del día', async () => {
  apiService.startCuotaCheckout.mockResolvedValue({ initPoint: 'https://www.mercadopago.com.ar/checkout/x' });
  renderCuotas();
  fireEvent.click(await screen.findByRole('button', { name: /Pagar \$\s?26\.500/ }));
  await waitFor(() => expect(apiService.startCuotaCheckout).toHaveBeenCalledWith(10));
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://www.mercadopago.com.ar/checkout/x'));
  expect(screen.getByText(/de recargo por atraso al día de hoy/)).toBeTruthy();
});

it('con un pago en curso muestra el aviso y bloquea las demás cuotas', async () => {
  apiService.getMyPaymentState.mockResolvedValue({ disponible: true, debito: null, intentoActivo: {
    ref: 'ref-1', cuotaId: 10, status: 'INICIADO', amount: 26500, expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
    initPoint: 'https://www.mercadopago.com.ar/checkout/x',
  } });
  apiService.verifyPaymentAttempt.mockResolvedValue({ status: 'APROBADO', mpPaymentId: '1001' });
  renderCuotas();
  expect(await screen.findByText(/Tenés un pago en curso/)).toBeTruthy();
  expect(screen.getByText('Tenés otro pago en curso')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Continuar el pago' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Ya pagué, verificar/ }));
  await waitFor(() => expect(apiService.verifyPaymentAttempt).toHaveBeenCalledWith('ref-1'));
});

it('una cuota cubierta por el débito automático no se paga con el botón', async () => {
  apiService.getCuotasUsuario.mockResolvedValue([cuota({ cubiertaPorDebito: true })]);
  renderCuotas();
  expect(await screen.findByText('Se cobra con débito automático')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Pagar/ })).toBeNull();
});

it('al volver de Mercado Pago verifica el pago y avisa el resultado', async () => {
  apiService.verifyPaymentAttempt.mockResolvedValue({ status: 'APROBADO', mpPaymentId: '1001' });
  renderCuotas('/alumno/cuotas?pago=ref-1&collection_status=approved');
  await waitFor(() => expect(apiService.verifyPaymentAttempt).toHaveBeenCalledWith('ref-1'));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Pago acreditado. Op. N° 1001'));
});

it('el socio se adhiere al débito automático con su email de Mercado Pago', async () => {
  apiService.adhereAutomaticDebit.mockResolvedValue({ initPoint: 'https://www.mercadopago.com.ar/subscriptions/x' });
  renderCuotas();
  const email = await screen.findByLabelText(/Email de tu cuenta de Mercado Pago/);
  expect(email.value).toBe('socio@gym.test');
  fireEvent.change(email, { target: { value: 'otro@mp.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adherirme al débito automático' }));
  await waitFor(() => expect(apiService.adhereAutomaticDebit).toHaveBeenCalledWith('otro@mp.com'));
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://www.mercadopago.com.ar/subscriptions/x'));
});

it('con un débito rechazado ofrece actualizar la tarjeta o pagar por otro medio, cancelando el débito', async () => {
  apiService.getMyPaymentState.mockResolvedValue({ disponible: true, intentoActivo: null, debito: {
    id: 'deb_1', status: 'CON_RECHAZO', amount: 25000, initPoint: 'https://www.mercadopago.com.ar/subscriptions/x',
  } });
  apiService.cancelMyAutomaticDebit.mockResolvedValue({ status: 'CANCELADO' });
  renderCuotas();
  expect(await screen.findByText(/No pudimos cobrar tu débito automático/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Actualizar mi tarjeta/ }).getAttribute('href')).toContain('subscriptions');
  fireEvent.click(screen.getByRole('button', { name: 'Pagar por otro medio' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancelar débito y pagar' }));
  await waitFor(() => expect(apiService.cancelMyAutomaticDebit).toHaveBeenCalledWith('El socio eligió pagar por otro medio.'));
});

it('sin Mercado Pago conectado, solo muestra los datos para transferir', async () => {
  apiService.getMyPaymentState.mockResolvedValue({ disponible: false, intentoActivo: null, debito: null });
  renderCuotas();
  expect(await screen.findByText('Datos de cuenta')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Pagar/ })).toBeNull();
  expect(screen.queryByText('Débito automático')).toBeNull();
});

it('si Mercado Pago ya cobró el débito y la cuota sigue impaga, el socio lo verifica', async () => {
  apiService.getMyPaymentState.mockResolvedValue({ disponible: true, intentoActivo: null, debito: {
    id: 'deb_1', status: 'ACTIVO', amount: 25000, initPoint: 'https://www.mercadopago.com.ar/subscriptions/x',
  } });
  apiService.verifyMyAutomaticDebit.mockResolvedValue({ status: 'ACTIVO', cobrosRegistrados: 1 });
  renderCuotas();
  fireEvent.click(await screen.findByRole('button', { name: /Ya me cobraron, verificar/ }));
  await waitFor(() => expect(apiService.verifyMyAutomaticDebit).toHaveBeenCalled());
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Encontramos tu pago en Mercado Pago y ya quedó registrado.'));
});
