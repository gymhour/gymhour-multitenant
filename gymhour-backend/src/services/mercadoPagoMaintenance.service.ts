import { systemPrisma } from '../models/Prisma.js';
import { expireStaleDebits, reconcileActiveDebits, syncDebitAmounts } from './automaticDebit.service.js';
import { isMercadoPagoConfigured } from './mercadoPago.service.js';
import { TOKEN_REFRESH_WINDOW_MS, markAccountError, refreshAccount, withTenantToken } from './mercadoPagoAccount.service.js';
import { processQueuedNotifications } from './mercadoPagoWebhook.service.js';
import { settleExpiredAttempt, verifyAttempt } from './memberPayments.service.js';

// Tarea diaria de cobros con Mercado Pago. Corre para TODOS los gimnasios conectados, incluso los
// bloqueados: la plata de un pago ya cobrado tiene que quedar registrada, y el token se mantiene vivo
// para cuando el gimnasio vuelva. Ver MERCADOPAGO.md, "Tareas diarias".

const HOUR_MS = 60 * 60 * 1000;

export async function runMercadoPagoMaintenance() {
  const result = {
    tokensRenovados: 0, conexionesConError: 0, intentosResueltos: 0,
    debitosVencidos: 0, cobrosDeDebitoRecuperados: 0, montosDeDebitoActualizados: 0, avisosProcesados: 0, errores: [] as string[],
  };
  if (!isMercadoPagoConfigured()) return result;
  const now = Date.now();
  const fail = (scope: string, error: unknown) => {
    result.errores.push(`${scope}: ${(error as Error).message}`);
    console.error('[mercadopago:cron]', scope, error);
  };

  // 1) Tokens: se renuevan los que vencen en menos de 30 días.
  const accounts = await systemPrisma.mercadoPagoAccount.findMany({ where: { status: 'CONNECTED' } });
  for (const account of accounts) {
    if (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() > now + TOKEN_REFRESH_WINDOW_MS) continue;
    try {
      if (account.refreshTokenEnc) {
        await refreshAccount(account);
        result.tokensRenovados += 1;
      } else if (account.tokenExpiresAt.getTime() < now) {
        await markAccountError(account.tenantId, 'La conexión con Mercado Pago venció. Volvé a conectarla.');
        result.conexionesConError += 1;
      }
    } catch (error) {
      result.conexionesConError += 1;
      fail(`token gimnasio ${account.tenantId}`, error);
    }
  }

  // 2) Pagos sin resolver: checkouts vencidos y pagos en revisión que no se consultan hace una hora.
  const attempts = await systemPrisma.cuotaPago.findMany({ where: { lockKey: { not: null }, OR: [
    { status: 'INICIADO', expiresAt: { lt: new Date(now - 60_000) } },
    { status: 'PENDIENTE', OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now - HOUR_MS) } }] },
  ] }, take: 500 });
  for (const attempt of attempts) {
    try {
      if (attempt.status === 'INICIADO') {
        await withTenantToken(attempt.tenantId, ({ account, accessToken }) => settleExpiredAttempt(attempt, account, accessToken));
      } else {
        await verifyAttempt(attempt.tenantId, attempt.externalReference);
      }
      result.intentosResueltos += 1;
    } catch (error) {
      fail(`intento ${attempt.id}`, error);
    }
  }

  const tenantIds = Array.from(new Set(accounts.map(account => account.tenantId)));
  for (const tenantId of tenantIds) {
    // 3) Débitos que nadie autorizó en 48 horas.
    try { result.debitosVencidos += await expireStaleDebits(tenantId); } catch (error) { fail(`débitos gimnasio ${tenantId}`, error); }
    // 4) Avisos que llegaron mientras el token no servía.
    try { result.avisosProcesados += await processQueuedNotifications(tenantId); } catch (error) { fail(`avisos gimnasio ${tenantId}`, error); }
    // 5) Cobros de débitos cuyo aviso se perdió: Mercado Pago cobró y Gymhour no se enteró.
    try { result.cobrosDeDebitoRecuperados += await reconcileActiveDebits(tenantId); } catch (error) { fail(`cobros de débitos gimnasio ${tenantId}`, error); }
    // 6) Montos: cada débito pasa a cobrar el importe de la cuota que le toca, que el cron generó antes.
    try { result.montosDeDebitoActualizados += await syncDebitAmounts(tenantId); } catch (error) { fail(`montos de débitos gimnasio ${tenantId}`, error); }
  }

  // 7) Conexiones OAuth que nunca se completaron.
  await systemPrisma.mercadoPagoOAuthState.deleteMany({ where: { expiresAt: { lt: new Date(now - 24 * HOUR_MS) } } });
  return result;
}
