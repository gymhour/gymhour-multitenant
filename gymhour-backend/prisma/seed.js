import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const SLUG = "demo-fitness";
const PASSWORD = "Gymhour123!";
const now = new Date();

const date = (days = 0, hour = 12) => {
  const value = new Date(now);
  value.setHours(hour, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value;
};
const month = (offset = 0) => {
  const value = date();
  value.setDate(1);
  value.setMonth(value.getMonth() + offset);
  return value;
};
const monthKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
const monthDate = (value, day) => new Date(value.getFullYear(), value.getMonth(), day, 12);
const clock = (hour) => new Date(`1970-01-01T${String(hour).padStart(2, "0")}:00:00.000Z`);

async function clearTenant(tenantId) {
  const where = { tenantId };
  // Hace al seed idempotente y no toca datos de otros tenants.
  await prisma.$transaction([
    prisma.aiMessage.deleteMany({ where }), prisma.aiConversation.deleteMany({ where }),
    prisma.asistencia.deleteMany({ where }), prisma.turno.deleteMany({ where }), prisma.turnoFijo.deleteMany({ where }),
    prisma.claseEntrenador.deleteMany({ where }), prisma.horarioClase.deleteMany({ where }), prisma.clase.deleteMany({ where }),
    prisma.historicoEjercicio.deleteMany({ where }), prisma.ejercicioMedicion.deleteMany({ where }),
    prisma.bloqueEjercicio.deleteMany({ where }), prisma.bloque.deleteMany({ where }), prisma.rutinaDia.deleteMany({ where }), prisma.semana.deleteMany({ where }),
    prisma.rutinaAsignacionUsuario.deleteMany({ where }), prisma.rutinaAsignacionGrupo.deleteMany({ where }),
    prisma.grupoUsuarioMiembro.deleteMany({ where }), prisma.grupoUsuario.deleteMany({ where }), prisma.rutina.deleteMany({ where }), prisma.ejercicio.deleteMany({ where }),
    prisma.contactoAlumno.deleteMany({ where }), prisma.movimientoSocio.deleteMany({ where }),
    prisma.cuota.deleteMany({ where }), prisma.gasto.deleteMany({ where }), prisma.user.deleteMany({ where }), prisma.plan.deleteMany({ where }),
  ]);
}

async function main() {
  const password = await bcrypt.hash(PASSWORD, 12);
  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    update: { name: "Demo Fitness Club", status: "ACTIVE" },
    create: { name: "Demo Fitness Club", slug: SLUG, status: "ACTIVE" },
  });
  await clearTenant(tenant.id);

  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: { currency: "ARS", timezone: "America/Argentina/Cordoba", onboardingCompleted: true, contactEmail: "hola@demofitness.test", contactPhone: "+54 351 555-0101", location: "Av. Colón 1234, Córdoba", paymentAccountHolder: "Demo Fitness Club", paymentAlias: "DEMO.FITNESS" },
    create: { tenantId: tenant.id, currency: "ARS", timezone: "America/Argentina/Cordoba", onboardingCompleted: true, contactEmail: "hola@demofitness.test", contactPhone: "+54 351 555-0101", location: "Av. Colón 1234, Córdoba", paymentAccountHolder: "Demo Fitness Club", paymentAlias: "DEMO.FITNESS" },
  });
  const kioskSecret = "demo-fitness-kiosk";
  const tokenHash = createHash("sha256").update(kioskSecret).digest("hex");
  await prisma.tenantKioskCredential.upsert({
    where: { tokenHash }, update: { tenantId: tenant.id, active: true },
    create: { tenantId: tenant.id, label: "Recepción", tokenHash },
  });

  const plans = await Promise.all([
    ["Pase libre", 42000, 0, false], ["12 clases", 35000, 12, true], ["8 clases", 29000, 8, true],
  ].map(([nombre, precio, sesionesTotales, requiereTurno]) => prisma.plan.create({ data: {
    tenantId: tenant.id, nombre, precio, sesionesTotales, requiereTurno, desc: `${nombre} mensual`, sesionesGracia: requiereTurno ? 1 : 0,
  } })));

  const definitions = [
    ["admin@demo.test", "31000001", "Valentina", "Suárez", "ADMIN", null, "Administración"],
    ["lucas@demo.test", "32000001", "Lucas", "Pereyra", "TRAINER", null, "Profesor de Educación Física"],
    ["sofia@demo.test", "32000002", "Sofía", "Méndez", "TRAINER", null, "Entrenamiento funcional"],
    ["martina@demo.test", "40100001", "Martina", "López", "STUDENT", 0],
    ["tomas@demo.test", "40100002", "Tomás", "Gómez", "STUDENT", 1],
    ["julieta@demo.test", "40100003", "Julieta", "Romero", "STUDENT", 1],
    ["benjamin@demo.test", "40100004", "Benjamín", "Torres", "STUDENT", 2],
    ["camila@demo.test", "40100005", "Camila", "Ríos", "STUDENT", 0],
    ["mateo@demo.test", "40100006", "Mateo", "Castro", "STUDENT", 2],
    ["renata@demo.test", "40100007", "Renata", "Acosta", "STUDENT", 1],
    ["bautista@demo.test", "40100008", "Bautista", "Fernández", "STUDENT", 0],
    ["paula@demo.test", "40100009", "Paula", "Vega", "STUDENT", 2],
    ["joaquin@demo.test", "40100010", "Joaquín", "Herrera", "STUDENT", 1],
  ];
  const users = [];
  for (const [email, dni, nombre, apellido, role, planIndex, profesion] of definitions) {
    const index = users.length;
    users.push(await prisma.user.create({ data: {
      tenantId: tenant.id, email, dni, nombre, apellido, role, profesion, password,
      estado: index !== definitions.length - 1, ID_Plan: planIndex === null ? null : plans[planIndex].ID_Plan,
      tel: `351555${1000 + index}`, fechaRegistro: date(-(25 + index * 13)),
      fechaCumple: new Date(1990 + index % 10, (now.getMonth() + index) % 12, 5 + index),
      motivoAlta: index > 2 ? ["RECOMENDACION", "REDES_SOCIALES", "CERCANIA"][index % 3] : null,
      observacionesSalud: index === 3 ? "Molestia leve en rodilla derecha. Evitar impactos altos." : null,
    } }));
  }
  const [admin, lucas, sofia, ...students] = users;
  await prisma.movimientoSocio.createMany({ data: students.flatMap((student, index) => {
    const alta = { tenantId: tenant.id, ID_Usuario: student.ID_Usuario, tipo: "ALTA", fecha: student.fechaRegistro, esReactivacion: false };
    return index === students.length - 1 ? [alta, { tenantId: tenant.id, ID_Usuario: student.ID_Usuario, tipo: "BAJA", fecha: date(-8), motivoBaja: "FALTA_DE_TIEMPO", esReactivacion: false }] : [alta];
  }) });

  const fees = [];
  for (let offset = -5; offset <= 0; offset += 1) {
    const period = month(offset);
    students.forEach((student, index) => {
      const plan = plans[definitions[index + 3][5]];
      const current = offset === 0;
      const unpaid = current && [2, 4, 7, 8].includes(index);
      const overdue = current && [2, 7].includes(index);
      const paid = !unpaid && student.estado !== false;
      fees.push({
        tenantId: tenant.id, ID_Usuario: student.ID_Usuario, ID_Plan: plan.ID_Plan, mes: monthKey(period), importe: plan.precio,
        vence: monthDate(period, 10), fechaInicio: monthDate(period, 1), fechaFin: new Date(period.getFullYear(), period.getMonth() + 1, 0, 12),
        pagada: paid, vencida: overdue || (!current && !paid), formaPago: paid ? ["Efectivo", "Transferencia", "Mercado Pago"][index % 3] : null,
        fechaPago: paid ? monthDate(period, 5 + index % 5) : null, origen: "MASIVA", planNombreSnapshot: plan.nombre,
        planDuracionSnapshot: plan.duracion, planSesionesTotalesSnapshot: plan.sesionesTotales,
        planSesionesGraciaSnapshot: plan.sesionesGracia, planRequiereTurnoSnapshot: plan.requiereTurno,
      });
    });
  }
  await prisma.cuota.createMany({ data: fees });
  const currentFees = await prisma.cuota.findMany({ where: { tenantId: tenant.id, mes: monthKey(now) } });

  const expenseTypes = [["Alquiler", 280000], ["Sueldos", 420000], ["Servicios", 78000], ["Insumos", 45000], ["Marketing", 35000]];
  await prisma.gasto.createMany({ data: Array.from({ length: 6 }, (_, i) => expenseTypes.map(([categoria, monto], j) => {
    const period = month(i - 5);
    return { tenantId: tenant.id, fecha: monthDate(period, 2 + j * 3), mes: monthKey(period), categoria, monto: monto + i * 5000, descripcion: `${categoria} del mes` };
  })).flat() });

  const exerciseDefinitions = [
    ["Sentadilla goblet", "Piernas y glúteos", "Mancuerna"], ["Press de banca", "Pecho y tríceps", "Barra y banco"],
    ["Remo con mancuerna", "Espalda y bíceps", "Mancuerna"], ["Peso muerto rumano", "Isquiotibiales y glúteos", "Barra"],
    ["Plancha frontal", "Core", "Colchoneta"], ["Burpees", "Cuerpo completo", "Sin equipamiento"],
  ];
  const exercises = await Promise.all(exerciseDefinitions.map(([nombre, musculos, equipamiento]) => prisma.ejercicio.create({ data: {
    tenantId: tenant.id, nombre, musculos, equipamiento, descripcion: `Técnica controlada de ${nombre}.`, instrucciones: "Mantener una postura estable y controlar cada repetición.",
  } })));

  const classes = await Promise.all([
    ["Funcional", "Circuitos de fuerza y acondicionamiento."], ["Musculación", "Entrenamiento guiado de fuerza."], ["Movilidad", "Movilidad articular y recuperación."],
  ].map(([nombre, descripcion]) => prisma.clase.create({ data: { tenantId: tenant.id, nombre, descripcion } })));
  await prisma.claseEntrenador.createMany({ data: [
    { tenantId: tenant.id, ID_Clase: classes[0].ID_Clase, ID_Entrenador: sofia.ID_Usuario },
    { tenantId: tenant.id, ID_Clase: classes[1].ID_Clase, ID_Entrenador: lucas.ID_Usuario },
    { tenantId: tenant.id, ID_Clase: classes[2].ID_Clase, ID_Entrenador: sofia.ID_Usuario },
  ] });
  const schedules = [];
  for (const [classIndex, diaSemana, hour] of [[0, "Lunes", 8], [0, "Miércoles", 19], [0, "Viernes", 18], [1, "Martes", 9], [1, "Jueves", 18], [2, "Sábado", 10]]) {
    schedules.push(await prisma.horarioClase.create({ data: { tenantId: tenant.id, ID_Clase: classes[classIndex].ID_Clase, diaSemana, horaIni: clock(hour), horaFin: clock(hour + 1), cupos: 15 } }));
  }

  const turnos = [];
  for (let dayOffset = -18; dayOffset <= 12; dayOffset += 2) {
    const index = Math.abs(dayOffset) % 9;
    const student = students[index];
    const estado = dayOffset < 0 ? (dayOffset % 6 === 0 ? "AUSENTE" : "ASISTIDO") : "RESERVADO";
    const fee = currentFees.find((item) => item.ID_Usuario === student.ID_Usuario);
    turnos.push(await prisma.turno.create({ data: {
      tenantId: tenant.id, fecha: date(dayOffset, 18), estado, fechaCreacion: date(dayOffset - 4), origen: "MANUAL",
      asistidoEn: estado === "ASISTIDO" ? date(dayOffset, 18) : null, ID_HorarioClase: schedules[index % schedules.length].ID_HorarioClase,
      ID_Usuario: student.ID_Usuario, ID_Cuota: fee?.ID_Cuota,
    } }));
  }
  await prisma.asistencia.createMany({ data: turnos.filter(({ estado }) => estado === "ASISTIDO").map((turno, index) => ({
    tenantId: tenant.id, fechaIngreso: turno.fecha, metodo: index % 2 ? "QR" : "DNI", permitido: true, resultado: "PERMITIDO",
    motivo: "Ingreso autorizado", ID_Usuario: turno.ID_Usuario, ID_Turno: turno.id_turno, ID_Cuota: turno.ID_Cuota,
  })) });

  const group = await prisma.grupoUsuario.create({ data: { tenantId: tenant.id, nombre: "Funcional inicial", descripcion: "Grupo de nivel inicial" } });
  await prisma.grupoUsuarioMiembro.createMany({ data: students.slice(0, 5).map((student) => ({ tenantId: tenant.id, ID_GrupoUsuario: group.ID_GrupoUsuario, ID_Usuario: student.ID_Usuario })) });
  const routine = await prisma.rutina.create({ data: {
    tenantId: tenant.id, ID_Usuario: students[0].ID_Usuario, ID_Entrenador: lucas.ID_Usuario, nombre: "Fuerza inicial - 3 días",
    desc: "Rutina progresiva de cuerpo completo.", claseRutina: "Musculación", grupoMuscularRutina: "Cuerpo completo",
  } });
  const week = await prisma.semana.create({ data: { tenantId: tenant.id, rutinaId: routine.ID_Rutina, nombre: "Semana base", numero: 1 } });
  for (const [index, dayName] of ["Lunes", "Miércoles", "Viernes"].entries()) {
    const routineDay = await prisma.rutinaDia.create({ data: { tenantId: tenant.id, rutinaId: routine.ID_Rutina, rutinaSemanaId: week.id, dia: dayName, nombre: `Día ${index + 1} · Fuerza`, descripcion: "Entrada en calor, fuerza y vuelta a la calma." } });
    const block = await prisma.bloque.create({ data: { tenantId: tenant.id, ID_Rutina: routine.ID_Rutina, rutinaDiaId: routineDay.id, type: "SETS_REPS", setsReps: "3x10", descansoRonda: 75 } });
    await prisma.bloqueEjercicio.createMany({ data: exercises.slice(index * 2, index * 2 + 2).map((exercise, order) => ({ tenantId: tenant.id, ID_Bloque: block.ID_Bloque, ID_Ejercicio: exercise.ID_Ejercicio, reps: order ? "12" : "10", orden: order + 1 })) });
  }
  await prisma.rutinaAsignacionGrupo.create({ data: { tenantId: tenant.id, ID_Rutina: routine.ID_Rutina, ID_GrupoUsuario: group.ID_GrupoUsuario } });
  await prisma.rutinaAsignacionUsuario.createMany({ data: students.slice(5, 8).map((student) => ({ tenantId: tenant.id, ID_Rutina: routine.ID_Rutina, ID_Usuario: student.ID_Usuario })) });

  for (const student of students.slice(0, 4)) {
    const measurement = await prisma.ejercicioMedicion.create({ data: { tenantId: tenant.id, ID_Usuario: student.ID_Usuario, nombre: "Sentadilla", tipoMedicion: "Peso (kg)" } });
    await prisma.historicoEjercicio.createMany({ data: [-60, -30, -7].map((days, index) => ({ tenantId: tenant.id, ID_EjercicioMedicion: measurement.ID_EjercicioMedicion, Fecha: date(days), Cantidad: 35 + index * 5 })) });
  }
  await prisma.contactoAlumno.create({ data: { tenantId: tenant.id, ID_Usuario: students[7].ID_Usuario, asunto: "¡Te extrañamos en Demo Fitness!", plantilla: "TE_EXTRANAMOS", enviadoPor: admin.ID_Usuario, fecha: date(-3) } });

  console.log("\nSeed demo listo");
  console.log(`Login: /g/${SLUG}/login`);
  console.log(`Admin: admin@demo.test / ${PASSWORD}`);
  console.log(`Entrenador: lucas@demo.test / ${PASSWORD}`);
  console.log(`Alumno: martina@demo.test / ${PASSWORD}`);
  console.log(`Kiosco: ${kioskSecret}`);
  console.log(`Datos: ${students.length} alumnos, ${plans.length} planes, ${classes.length} clases, ${fees.length} cuotas y ${turnos.length} turnos.\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
