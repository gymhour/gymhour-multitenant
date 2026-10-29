import 'dotenv/config';
import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL || 'mysql://invalid@invalid/invalid');
if (process.env.NODE_ENV !== 'development' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
  throw new Error('Este script solo puede ejecutarse contra MySQL local en development.');
}

const accounts = [
  { plan: 'Prueba gratuita', slug: 'planes-demo-trial', email: 'admin.trial@planes-demo.test' },
  { plan: 'Esencial', slug: 'planes-demo-esencial', email: 'admin.esencial@planes-demo.test' },
  { plan: 'Pro', slug: 'planes-demo-pro', email: 'admin.pro@planes-demo.test' },
];
const db = new PrismaClient();
try {
  const prepared = await Promise.all(accounts.map(async account => {
    const password = crypto.randomBytes(18).toString('base64url');
    return { ...account, password, hash: await bcrypt.hash(password, 12) };
  }));
  const filename = resolve(`plan-test-credentials-${Date.now()}.txt`);
  const contents = prepared.map(a => `${a.plan}\nGimnasio: ${a.slug}\nCorreo: ${a.email}\nContraseña: ${a.password}\n`).join('\n');
  await writeFile(filename, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await db.$transaction(async tx => {
    for (const account of prepared) {
      const result = await tx.user.updateMany({ where: { email: account.email, role: 'ADMIN', tenant: { slug: account.slug } },
        data: { password: account.hash } });
      if (result.count !== 1) throw new Error(`No se encontró exactamente un administrador para ${account.slug}.`);
    }
  });
  console.log(`Contraseñas restablecidas. Credenciales guardadas en: ${filename}`);
} catch (error) {
  console.error('No se completó el restablecimiento. Si se creó un archivo, no uses sus contraseñas hasta repetir el proceso correctamente.');
  throw error;
} finally {
  await db.$disconnect();
}
