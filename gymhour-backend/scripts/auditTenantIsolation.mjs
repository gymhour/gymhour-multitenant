import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const allowedSystemClient = new Set([
  'controllers/auth.Controller.ts',
  'models/Prisma.ts',
  'services/auth.service.ts',
  'services/kioskAuth.service.ts',
  'services/tenantJobs.service.ts',
  'scripts/migrateMediaAssets.ts',
]);

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }));
  return nested.flat();
}

const violations = [];
for (const file of await files(root)) {
  if (!file.endsWith('.ts')) continue;
  const rel = relative(root, file);
  const source = await readFile(file, 'utf8');
  if (source.includes('systemPrisma') && !allowedSystemClient.has(rel)) {
    violations.push(`${rel}: importa o usa systemPrisma`);
  }
  if (/\$(?:queryRaw|executeRaw)(?:Unsafe)?\b/.test(source)) {
    violations.push(`${rel}: ejecuta SQL raw`);
  }
  if (/new\s+PrismaClient\s*\(/.test(source) && rel !== 'models/Prisma.ts') {
    violations.push(`${rel}: instancia PrismaClient fuera del módulo autorizado`);
  }
}

if (violations.length) {
  console.error(`Auditoría tenant fallida:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('Auditoría tenant OK: sin cliente system ni SQL raw en código tenant.');
