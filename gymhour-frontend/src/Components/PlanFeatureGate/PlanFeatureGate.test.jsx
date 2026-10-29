import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import PlanFeatureGate, { featureForPath } from './PlanFeatureGate';

jest.mock('../SidebarMenu/SidebarMenu', () => () => <nav>Menú</nav>);

it('identifica las páginas exclusivas de Pro', () => {
  expect(featureForPath('/admin/asistente-ia')).toBe('AI');
  expect(featureForPath('/admin/predictor-bajas')).toBe('CHURN');
  expect(featureForPath('/admin/ingreso')).toBe('CHECK_IN');
  expect(featureForPath('/admin/asistencias')).toBe('ATTENDANCE');
  expect(featureForPath('/admin/cuotas')).toBeNull();
});

it('muestra la página difuminada y el acceso a planes sin montar contenido restringido', () => {
  render(<MemoryRouter><PlanFeatureGate feature="AI" billing={{ features: { AI: false } }} role="ADMIN">
    <div>Contenido privado</div>
  </PlanFeatureGate></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Asistente con IA' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Ver planes/i }).getAttribute('href')).toBe('/admin/suscripcion');
  expect(screen.queryByText('Contenido privado')).toBeNull();
});

it('muestra el contenido durante la prueba gratuita', () => {
  render(<MemoryRouter><PlanFeatureGate feature="AI" billing={{ features: { AI: true } }} role="ADMIN">
    <div>Contenido privado</div>
  </PlanFeatureGate></MemoryRouter>);
  expect(screen.getByText('Contenido privado')).toBeTruthy();
});

it.each([
  ['CHURN', /Identificá socios que podrían dejar de asistir/],
  ['CHECK_IN', /Agilizá el ingreso de tus socios con un código QR o su DNI/],
  ['ATTENDANCE', /Consultá las visitas de tus socios/],
  ['AI', /Consultá información de tu gimnasio/],
])('explica el beneficio de %s en la página bloqueada', (feature, description) => {
  render(<MemoryRouter><PlanFeatureGate feature={feature} billing={{ features: { [feature]: false } }} role="ADMIN" /></MemoryRouter>);
  expect(screen.getByText(description)).toBeTruthy();
  expect(screen.getByText(/Disponible en Pro/)).toBeTruthy();
});

it('adapta la descripción de asistencias para el alumno', () => {
  render(<MemoryRouter><PlanFeatureGate feature="ATTENDANCE" billing={{ features: { ATTENDANCE: false } }} role="STUDENT" /></MemoryRouter>);
  expect(screen.getByText(/Consultá tu historial de visitas/)).toBeTruthy();
  expect(screen.getByText(/Pedile al administrador/)).toBeTruthy();
});
