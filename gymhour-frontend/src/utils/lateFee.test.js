import { lateFeeExample } from './lateFee';

it('el ejemplo de Ajustes usa el mismo cálculo que el backend', () => {
  expect(lateFeeExample({ recargoTipo: 'NINGUNO', recargoValor: 10 })).toBe(0);
  expect(lateFeeExample({ recargoTipo: 'FIJO', recargoValor: '2000' })).toBe(2000);
  expect(lateFeeExample({ recargoTipo: 'PORCENTAJE', recargoValor: '10' })).toBe(2500);
  expect(lateFeeExample({ recargoTipo: 'PORCENTAJE_DIARIO', recargoValor: '0.3', recargoTope: '15' })).toBe(450);
  expect(lateFeeExample({ recargoTipo: 'PORCENTAJE_DIARIO', recargoValor: '0.3', recargoTope: '1' })).toBe(250);
  // 6 días de atraso con 6 de gracia: sin recargo.
  expect(lateFeeExample({ recargoTipo: 'FIJO', recargoValor: '2000', recargoDiasGracia: '6' })).toBe(0);
});
