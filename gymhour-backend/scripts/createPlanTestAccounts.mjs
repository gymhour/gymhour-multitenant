import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL || 'mysql://invalid@invalid/invalid');
if (process.env.NODE_ENV !== 'development' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
  throw new Error('Este script solo puede ejecutarse contra MySQL local en development.');
}

const db = new PrismaClient();
const definitions = [
  { kind: 'TRIAL', slug: 'planes-demo-trial', name: 'Gymhour Demo · Prueba gratuita', email: 'admin.trial@planes-demo.test' },
  { kind: 'ESSENTIAL', slug: 'planes-demo-esencial', name: 'Gymhour Demo · Esencial', email: 'admin.esencial@planes-demo.test', planCode: 'ESSENTIAL_MONTHLY', amountArs: 49_999 },
  { kind: 'PRO', slug: 'planes-demo-pro', name: 'Gymhour Demo · Pro', email: 'admin.pro@planes-demo.test', planCode: 'PRO_MONTHLY', amountArs: 99_999 },
];

const addMonths = (date, months) => {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
};

try {
  const existing = await db.tenant.findMany({ where: { slug: { in: definitions.map(item => item.slug) } }, select: { slug: true } });
  if (existing.length) throw new Error(`Ya existen cuentas de prueba: ${existing.map(item => item.slug).join(', ')}`);

  const prepared = await Promise.all(definitions.map(async item => {
    const password = crypto.randomBytes(18).toString('base64url');
    return { ...item, password, hash: await bcrypt.hash(password, 12) };
  }));
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const paidUntil = addMonths(now, 1);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  await db.$transaction(async tx => {
    for (const item of prepared) {
      const tenant = await tx.tenant.create({ data: {
        name: item.name, slug: item.slug, status: 'ACTIVE', billingExempt: false,
        trialEndsAt: item.kind === 'TRIAL' ? trialEndsAt : yesterday,
        paidUntil: item.kind === 'TRIAL' ? null : paidUntil,
        settings: { create: { timezone: 'America/Argentina/Cordoba', currency: 'ARS', onboardingCompleted: true, aiEnabled: item.kind !== 'ESSENTIAL' } },
      } });
      await tx.user.create({ data: { tenantId: tenant.id, email: item.email, password: item.hash,
        nombre: 'Admin', apellido: item.kind === 'TRIAL' ? 'Prueba' : item.kind === 'PRO' ? 'Pro' : 'Esencial',
        role: 'ADMIN', estado: true } });
      if (item.planCode) await tx.tenantBillingOrder.create({ data: {
        tenantId: tenant.id, planCode: item.planCode, amountArs: item.amountArs, months: 1,
        method: 'TRANSFER', status: 'PAID', paidAt: now, paidUntil,
      } });
    }
  });

  console.log(JSON.stringify({ environment: 'local development',
    trialEndsAt: trialEndsAt.toISOString(), paidUntil: paidUntil.toISOString(),
    accounts: prepared.map(({ kind, slug, email, password }) => ({ kind, slug, email, password })) }, null, 2));
} finally {
  await db.$disconnect();
}
