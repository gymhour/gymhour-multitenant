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
    render(<MemoryRouter><AdminSetupGuide guide={guide} /></MemoryRouter>);

    expect(screen.getByText('2 de 5 completados')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.queryByRole('link', { name: 'Asignar rutina' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver pasos de configuración' }));

    expect(screen.queryByRole('link', { name: 'Crear plan' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Asignar rutina' })).toHaveAttribute('href', '/admin/asignar-rutinas');
    expect(screen.getByRole('link', { name: 'Generar cuotas' })).toHaveAttribute('href', '/admin/cuotas?action=generate');
    expect(screen.getByText(/creá los cargos del mes/i)).toBeInTheDocument();
  });

  it('muestra todos los pasos completados al volver a abrirla', () => {
    render(<MemoryRouter><AdminSetupGuide guide={{
      isComplete: true,
      totalSteps: 5,
      completedSteps: 5,
      steps: { plan: true, members: true, routine: true, quotas: true, payment: true },
    }} /></MemoryRouter>);

    expect(screen.getByText('5 de 5 completados')).toBeInTheDocument();
    expect(screen.getByText(/ya completaste la configuración inicial/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver pasos de configuración' }));
    expect(screen.getAllByText('Paso completado')).toHaveLength(5);
  });
});
