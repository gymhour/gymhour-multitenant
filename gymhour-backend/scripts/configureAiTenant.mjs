import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = Object.fromEntries(process.argv.slice(2).map(item => {
  const [key, ...rest] = item.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));

const slug = String(args.tenant || '').trim();
if (!slug || (!args.enable && !args.disable)) {
  console.error('Uso: npm run ai:tenant -- --tenant=<slug> --enable|--disable [--monthly-token-limit=2000000]');
  process.exitCode = 1;
} else {
  const tenant = await prisma.tenant.findUnique({ where: { slug }, include: { settings: true } });
  if (!tenant?.settings) {
    console.error(`No se encontró el gimnasio ${slug}.`);
    process.exitCode = 1;
  } else {
    const limit = Number(args['monthly-token-limit'] || tenant.settings.aiMonthlyTokenLimit);
    if (!Number.isInteger(limit) || limit < 1000) throw new Error('monthly-token-limit debe ser un entero mayor o igual a 1000.');
    const settings = await prisma.tenantSettings.update({
      where: { tenantId: tenant.id },
      data: { aiEnabled: Boolean(args.enable), aiMonthlyTokenLimit: limit },
      select: { tenantId: true, aiEnabled: true, aiMonthlyTokenLimit: true },
    });
    console.log(JSON.stringify({ tenant: slug, ...settings }, null, 2));
  }
}

await prisma.$disconnect();
