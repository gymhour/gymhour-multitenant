import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tables = [
  'User', 'Plan', 'Cuota', 'Gasto', 'ContactoAlumno', 'MovimientoSocio', 'Turno',
  'TurnoFijo', 'HorarioClase', 'Clase', 'Rutina', 'GrupoUsuario', 'GrupoUsuarioMiembro',
  'RutinaAsignacionUsuario', 'RutinaAsignacionGrupo', 'RutinaDia', 'Semana', 'Bloque',
  'Ejercicio', 'BloqueEjercicio', 'EjercicioMedicion', 'HistoricoEjercicio', 'Asistencia',
];

async function main() {
  if (!process.argv.includes('--confirm-readonly-legacy')) {
    throw new Error('Uso: node prisma/auditLegacyTenantMigration.js --confirm-readonly-legacy');
  }
  const counts = {};
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM \`${table}\``);
    counts[table] = Number(rows[0].total);
  }
  const roles = await prisma.$queryRawUnsafe(
    'SELECT COALESCE(LOWER(`tipo`), "<NULL>") AS legacyRole, COUNT(*) AS total FROM `User` GROUP BY COALESCE(LOWER(`tipo`), "<NULL>")',
  );
  const known = new Set(['admin', 'entrenador', 'cliente']);
  const roleReport = roles.map(row => ({ legacyRole: row.legacyRole, total: Number(row.total) }));
  const unknownRolesMappedToStudent = roleReport.filter(row => !known.has(row.legacyRole));
  console.log(JSON.stringify({ counts, roleReport, unknownRolesMappedToStudent }, null, 2));
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
