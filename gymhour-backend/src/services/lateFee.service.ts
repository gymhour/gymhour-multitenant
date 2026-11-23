import prisma from '../models/Prisma.js';

// Recargo por pago fuera de término. Lo configura cada gimnasio en Ajustes y se calcula siempre
// en el servidor: el monto que paga el socio nunca sale del navegador.
export const LATE_FEE_TYPES = ['NINGUNO', 'FIJO', 'PORCENTAJE', 'PORCENTAJE_DIARIO'] as const;
export type LateFeeType = typeof LATE_FEE_TYPES[number];

export type LateFeeSettings = {
  recargoTipo: string;
  recargoValor: number;
  recargoTope: number | null;
  recargoDiasGracia: number;
};

export type LateFee = {
  tipo: LateFeeType;
  // Días entre el vencimiento y el pago, y los que quedan después de los días de gracia.
  dias: number;
  diasCobrables: number;
  monto: number;
};

const DAY_MS = 86_400_000;
const MAX_FIXED_ARS = 10_000_000;
const MAX_DAILY_PERCENT = 10;
const MAX_GRACE_DAYS = 60;

const isLateFeeType = (value: unknown): value is LateFeeType => LATE_FEE_TYPES.includes(value as LateFeeType);

// Las fechas de cuotas son "wall clock" en UTC: el vencimiento es el fin del día local guardado
// como UTC y la fecha de pago es la medianoche UTC del día local. Así, pagar el mismo día del
// vencimiento da 0 días de atraso, sin importar la hora.
export function lateFeeDays(vence: Date, paidOn: Date): number {
  const dueDay = Date.UTC(vence.getUTCFullYear(), vence.getUTCMonth(), vence.getUTCDate());
  const paidDay = Date.UTC(paidOn.getUTCFullYear(), paidOn.getUTCMonth(), paidOn.getUTCDate());
  return Math.max(0, Math.round((paidDay - dueDay) / DAY_MS));
}

export function calculateLateFee(
  cuota: { importe: number; vence: Date },
  settings: LateFeeSettings | null | undefined,
  paidOn: Date,
): LateFee {
  const tipo: LateFeeType = isLateFeeType(settings?.recargoTipo) ? settings!.recargoTipo as LateFeeType : 'NINGUNO';
  const dias = lateFeeDays(cuota.vence, paidOn);
  const diasCobrables = Math.max(0, dias - Math.max(0, Math.trunc(settings?.recargoDiasGracia ?? 0)));
  const valor = Number(settings?.recargoValor ?? 0);
  const importe = Number(cuota.importe ?? 0);
  const result: LateFee = { tipo, dias, diasCobrables, monto: 0 };
  if (tipo === 'NINGUNO' || diasCobrables === 0 || !(valor > 0) || !(importe > 0)) return result;

  let amount = 0;
  if (tipo === 'FIJO') amount = valor;
  else if (tipo === 'PORCENTAJE') amount = importe * valor / 100;
  else {
    amount = importe * valor / 100 * diasCobrables;
    const tope = Number(settings?.recargoTope ?? 0);
    if (tope > 0) amount = Math.min(amount, importe * tope / 100);
  }
  // Se cobra en pesos enteros.
  return { ...result, monto: Math.max(0, Math.round(amount)) };
}

// Valida lo que manda Ajustes. Devuelve los campos a guardar o un mensaje para el admin.
export function parseLateFeeSettings(body: Record<string, unknown>):
  { data: Partial<LateFeeSettings> | null; error?: string } {
  const touched = ['recargoTipo', 'recargoValor', 'recargoTope', 'recargoDiasGracia'].some(key => body[key] !== undefined);
  if (!touched) return { data: null };

  const tipo = String(body.recargoTipo ?? 'NINGUNO').trim().toUpperCase();
  if (!isLateFeeType(tipo)) return { data: null, error: 'Elegí un tipo de recargo válido.' };
  const gracia = body.recargoDiasGracia === undefined || body.recargoDiasGracia === '' ? 0 : Number(body.recargoDiasGracia);
  if (!Number.isInteger(gracia) || gracia < 0 || gracia > MAX_GRACE_DAYS) {
    return { data: null, error: `Los días de gracia van de 0 a ${MAX_GRACE_DAYS}.` };
  }
  if (tipo === 'NINGUNO') {
    return { data: { recargoTipo: tipo, recargoValor: 0, recargoTope: null, recargoDiasGracia: gracia } };
  }

  const valor = Number(body.recargoValor);
  if (!Number.isFinite(valor) || valor <= 0) return { data: null, error: 'Ingresá un valor de recargo mayor a 0.' };
  if (tipo === 'FIJO' && valor > MAX_FIXED_ARS) return { data: null, error: 'El recargo fijo es demasiado alto.' };
  if (tipo === 'PORCENTAJE' && valor > 100) return { data: null, error: 'El porcentaje no puede superar el 100%.' };
  if (tipo === 'PORCENTAJE_DIARIO') {
    if (valor > MAX_DAILY_PERCENT) {
      return { data: null, error: `El porcentaje diario no puede superar el ${MAX_DAILY_PERCENT}%.` };
    }
    const tope = Number(body.recargoTope);
    if (!Number.isFinite(tope) || tope <= 0 || tope > 100) {
      return { data: null, error: 'El recargo diario necesita un tope entre 1% y 100% de la cuota.' };
    }
    return { data: { recargoTipo: tipo, recargoValor: valor, recargoTope: tope, recargoDiasGracia: gracia } };
  }
  return { data: { recargoTipo: tipo, recargoValor: valor, recargoTope: null, recargoDiasGracia: gracia } };
}

// Configuración del gimnasio del contexto actual.
export async function currentLateFeeSettings(): Promise<LateFeeSettings | null> {
  return prisma.tenantSettings.findFirst({
    select: { recargoTipo: true, recargoValor: true, recargoTope: true, recargoDiasGracia: true },
  });
}
