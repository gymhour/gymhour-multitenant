import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-toastify';
import apiService from '../../services/apiService';
import MercadoPagoConnection from './MercadoPagoConnection';

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../services/apiService', () => ({
  __esModule: true,
  default: { getMercadoPagoConnection: jest.fn(), connectMercadoPago: jest.fn(), disconnectMercadoPago: jest.fn() },
}));

const base = { featureEnabled: true, configured: true, connected: false, status: 'DISCONNECTED', activeDebits: 0, activeAttempts: 0 };
const renderConnection = (path = '/admin/configuracion') => render(
  <MemoryRouter initialEntries={[path]}><MercadoPagoConnection /></MemoryRouter>,
);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: jest.fn() } });
});

it('conecta la cuenta yendo a la autorización de Mercado Pago', async () => {
  apiService.getMercadoPagoConnection.mockResolvedValue(base);
  apiService.connectMercadoPago.mockResolvedValue({ url: 'https://auth.mercadopago.com/authorization?x=1' });
  renderConnection();
  expect(await screen.findByText(/nunca vemos tu contraseña/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Conectar Mercado Pago/ }));
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://auth.mercadopago.com/authorization?x=1'));
});

it('sin el plan Pro ofrece ver los planes', async () => {
  apiService.getMercadoPagoConnection.mockResolvedValue({ ...base, featureEnabled: false });
  renderConnection();
  expect(await screen.findByText('Disponible en el plan Pro')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Conectar/ })).toBeNull();
});

it('muestra la cuenta conectada y el pedido de reconexión', async () => {
  apiService.getMercadoPagoConnection.mockResolvedValue({ ...base, connected: true, status: 'CONNECTED', nickname: 'GIMNASIO', connectedAt: '2026-11-19T12:00:00Z' });
  const { unmount } = renderConnection();
  expect(await screen.findByText(/Conectado como GIMNASIO/)).toBeTruthy();
  unmount();
  apiService.getMercadoPagoConnection.mockResolvedValue({ ...base, connected: true, status: 'ERROR', lastError: 'Mercado Pago rechazó el acceso.' });
  renderConnection();
  expect(await screen.findByText('Hay que reconectar Mercado Pago')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Reconectar/ })).toBeTruthy();
});

it('avisa el resultado al volver de Mercado Pago', async () => {
  apiService.getMercadoPagoConnection.mockResolvedValue(base);
  renderConnection('/admin/configuracion?mp=error&motivo=STATE_INVALID');
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('La conexión venció o ya se había usado. Probá de nuevo.'));
});

it('para desconectar con débitos activos pide confirmar que se cancelan', async () => {
  apiService.getMercadoPagoConnection.mockResolvedValue({ ...base, connected: true, status: 'CONNECTED', activeDebits: 3 });
  const conflict = Object.assign(new Error('Se van a cancelar 3 débitos.'), { code: 'DEBITOS_ACTIVOS', details: { debitos: 3 } });
  apiService.disconnectMercadoPago.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ ok: true, debitosCancelados: 3 });
  renderConnection();
  fireEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
  // Se abre la confirmación: el último botón "Desconectar" es el del popup.
  const buttons = await screen.findAllByRole('button', { name: 'Desconectar' });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(apiService.disconnectMercadoPago).toHaveBeenCalledWith(false));
  const confirm = await screen.findByRole('button', { name: 'Cancelar 3 débitos y desconectar' });
  fireEvent.click(confirm);
  await waitFor(() => expect(apiService.disconnectMercadoPago).toHaveBeenLastCalledWith(true));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('se cancelaron 3 débitos')));
});
