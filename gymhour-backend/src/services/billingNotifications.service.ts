import { systemPrisma } from '../models/Prisma.js';
import { ALL_BILLING_PLANS } from './billingCatalog.service.js';
import {
  sendPaymentConfirmedEmail, sendPaymentFailedEmail, sendRenewalEmail,
  sendSubscriptionCancelledEmail, sendSubscriptionPausedEmail,
} from './email.service.js';

// Los avisos no bloquean la respuesta: un mail que falla nunca hace fallar el cobro ni el webhook.
export function notifyTenantAdmins(tenantId: number, send: (email: string) => Promise<void>): void {
  void (async () => {
    const admins = await systemPrisma.user.findMany({
      where: { tenantId, role: 'ADMIN', estado: true }, select: { email: true },
    });
    await Promise.all(admins.map(admin => send(admin.email).catch(error => {
      console.error('[billing-mail]', error);
    })));
  })().catch(error => console.error('[billing-mail]', error));
}

const planLabel = (planCode: string) => ALL_BILLING_PLANS.find(item => item.code === planCode)?.tierLabel ?? 'Gymhour';

export const notifyPurchaseConfirmed = (tenantId: number, planCode: string, paidUntil: Date) => notifyTenantAdmins(
  tenantId, email => sendPaymentConfirmedEmail(email, { planLabel: planLabel(planCode), paidUntil }),
);

export const notifyRenewal = (tenantId: number, paidUntil: Date) => notifyTenantAdmins(
  tenantId, email => sendRenewalEmail(email, { paidUntil }),
);

export const notifyPaymentFailed = (tenantId: number, graceUntil: Date | null) => notifyTenantAdmins(
  tenantId, email => sendPaymentFailedEmail(email, { graceUntil }),
);

export const notifySubscriptionPaused = (tenantId: number) => notifyTenantAdmins(
  tenantId, email => sendSubscriptionPausedEmail(email),
);

export const notifySubscriptionCancelled = (tenantId: number, accessUntil: Date | null) => notifyTenantAdmins(
  tenantId, email => sendSubscriptionCancelledEmail(email, { accessUntil }),
);
