// Recargo por pago fuera de término. El monto real lo calcula siempre el backend
// (services/lateFee.service.ts); acá solo se arma el ejemplo de Ajustes y los textos.
export const LATE_FEE_OPTIONS = [
  { value: 'NINGUNO', label: 'Sin recargo' },
  { value: 'FIJO', label: 'Monto fijo' },
  { value: 'PORCENTAJE', label: 'Porcentaje de la cuota' },
  { value: 'PORCENTAJE_DIARIO', label: 'Porcentaje por día de atraso' },
];

export const lateFeeExample = ({ recargoTipo, recargoValor, recargoTope, recargoDiasGracia }, importe = 25000, dias = 6) => {
  const valor = Number(recargoValor);
  const cobrables = Math.max(0, dias - Math.max(0, Math.trunc(Number(recargoDiasGracia) || 0)));
  if (recargoTipo === 'NINGUNO' || !(valor > 0) || cobrables === 0) return 0;
  if (recargoTipo === 'FIJO') return Math.round(valor);
  if (recargoTipo === 'PORCENTAJE') return Math.round(importe * valor / 100);
  const tope = Number(recargoTope);
  const amount = importe * valor / 100 * cobrables;
  return Math.round(tope > 0 ? Math.min(amount, importe * tope / 100) : amount);
};

export const lateFeeDaysLabel = dias => `${dias} ${dias === 1 ? 'día' : 'días'} de atraso`;
