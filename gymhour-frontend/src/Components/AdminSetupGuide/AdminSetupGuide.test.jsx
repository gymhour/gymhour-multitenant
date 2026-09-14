import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminSetupGuide from './AdminSetupGuide';

const guide = {
  totalSteps: 5,
  completedSteps: 2,
  steps: { plan: true, members: true, routine: false, quotas: false, payment: false },
};

describe('AdminSetupGuide', () => {
  it('muestra el progreso, los pendientes y sus accesos directos', () => {
    render(<MemoryRouter><AdminSetupGuide guide={guide} onDismiss={() => {}} /></MemoryRouter>);

    expect(screen.getByText('2 de 5 completados')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.queryByRole('link', { name: 'Asignar rutina' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver pasos de configuración' }));

    expect(screen.queryByRole('link', { name: 'Crear plan' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Asignar rutina' })).toHaveAttribute('href', '/admin/asignar-rutinas');
    expect(screen.getByRole('link', { name: 'Generar cuotas' })).toHaveAttribute('href', '/admin/cuotas?action=generate');
    expect(screen.getByText(/creá los cargos del mes/i)).toBeInTheDocument();
  });

  it('permite ocultar la guía', () => {
    const onDismiss = jest.fn();
    render(<MemoryRouter><AdminSetupGuide guide={guide} onDismiss={onDismiss} /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /ocultar guía/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
