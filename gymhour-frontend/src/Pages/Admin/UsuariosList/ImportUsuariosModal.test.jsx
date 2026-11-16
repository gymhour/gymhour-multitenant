import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as XLSX from 'xlsx';
import ImportUsuariosModal, { fechaLegible } from './ImportUsuariosModal';

jest.mock('../../../axiosConfig', () => ({ post: jest.fn() }));

afterEach(() => { jest.restoreAllMocks(); });

it('muestra las fechas con el mes en letras para detectar día y mes invertidos', () => {
  expect(fechaLegible('05/10/2026')).toBe('5 oct 2026');
  expect(fechaLegible('10/05/2026')).toBe('10 may 2026');
  expect(fechaLegible('31/02/2026')).toBe('31/02/2026');
  expect(fechaLegible('2026-10-05')).toBe('2026-10-05');
  expect(fechaLegible('')).toBe('-');
});

it('la plantilla trae las fechas con formato texto y la importación ignora las filas vacías', async () => {
  const writeFile = jest.spyOn(XLSX, 'writeFile').mockImplementation(() => {});
  render(<MemoryRouter><ImportUsuariosModal onClose={jest.fn()} onSuccess={jest.fn()} planes={[{ ID_Plan: 3, nombre: 'Mensual' }]} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /Descargar plantilla/i }));
  const [template] = writeFile.mock.calls[0];
  const sheet = template.Sheets.Usuarios;
  expect(sheet['!ref']).toBe('A1:K501');
  expect(sheet.H2.z).toBe('@');
  expect(sheet.J501.z).toBe('@');

  // El formato texto sobrevive al guardar el archivo.
  const saved = XLSX.read(XLSX.write(template, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
  expect(saved.Sheets.Usuarios.J2.z).toBe('@');

  // Simula lo que carga el admin: una fecha escrita como texto y otra que Excel convirtió (mes/día).
  Object.assign(sheet, {
    A2: { t: 's', v: 'socio1@example.com' }, B2: { t: 'n', v: 30111222 }, I2: { t: 'n', v: 3 },
    J2: { t: 's', v: '05/10/2026', z: '@' },
    A3: { t: 's', v: 'socio2@example.com' }, B3: { t: 'n', v: 30111333 }, I3: { t: 'n', v: 3 },
    J3: { t: 'n', v: 46152, z: 'm/d/yy' },
  });
  const file = new File([XLSX.write(template, { type: 'array', bookType: 'xlsx' })], 'socios.xlsx');
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

  expect(await screen.findByText('2 registros detectados')).toBeTruthy();
  expect(screen.getByText('5 oct 2026')).toBeTruthy();
  expect(screen.getByText('10 may 2026')).toBeTruthy();
});
