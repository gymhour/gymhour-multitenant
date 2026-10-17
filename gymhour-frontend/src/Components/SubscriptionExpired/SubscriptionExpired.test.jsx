import React from 'react';
import { render, screen } from '@testing-library/react';
import SubscriptionExpired from './SubscriptionExpired';
import { useAuth } from '../../context/AuthContext';

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const renderExpired = role => {
  useAuth.mockReturnValue({
    user: { role }, tenant: { name: 'Gimnasio Norte', slug: 'gimnasio-norte' },
    refresh: jest.fn(),
  });
  render(<SubscriptionExpired />);
};

it('permite al administrador pedir el link de suscripción del gimnasio', () => {
  renderExpired('ADMIN');
  const link = screen.getByRole('link', { name: /Pedir link de suscripción/i });
  expect(link.href).toContain('wa.me/5493415936396');
  expect(decodeURIComponent(link.href)).toContain('Gimnasio Norte (gimnasio-norte)');
  expect(screen.queryByRole('button', { name: /Cerrar sesión/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /Ya pagué/i })).toBeNull();
});

it('indica a los alumnos que contacten a su administrador sin ofrecerles el link', () => {
  renderExpired('STUDENT');
  expect(screen.getByText(/Contactá al administrador/i)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Pedir link de suscripción/i })).toBeNull();
});
