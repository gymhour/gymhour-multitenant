import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash("Gymhour123!", 12);

const tenantSeeds = [
  { name: "Gym A", slug: "gym-a", currency: "ARS", suffix: "A" },
  { name: "Gym B", slug: "gym-b", currency: "ARS", suffix: "B" },
];

async function upsertClass(tenantId, trainerId, suffix) {
  let gymClass = await prisma.clase.findFirst({
    where: { tenantId, nombre: "Funcional" },
  });
  if (!gymClass) {
    gymClass = await prisma.clase.create({
      data: {
        tenantId,
        nombre: "Funcional",
        descripcion: `Clase funcional de Gym ${suffix}`,
      },
    });
  }

  await prisma.claseEntrenador.upsert({
    where: {
      tenantId_ID_Clase_ID_Entrenador: {
        tenantId,
        ID_Clase: gymClass.ID_Clase,
        ID_Entrenador: trainerId,
      },
    },
    update: {},
    create: { tenantId, ID_Clase: gymClass.ID_Clase, ID_Entrenador: trainerId },
  });

  const schedule = await prisma.horarioClase.findFirst({
    where: { tenantId, ID_Clase: gymClass.ID_Clase, diaSemana: "Lunes" },
  });
  if (!schedule) {
    await prisma.horarioClase.create({
      data: {
        tenantId,
        ID_Clase: gymClass.ID_Clase,
        diaSemana: "Lunes",
        horaIni: new Date("1970-01-01T18:00:00.000Z"),
        horaFin: new Date("1970-01-01T19:00:00.000Z"),
        cupos: 12,
      },
    });
  }
}

async function upsertExercise(tenantId, suffix) {
  const existing = await prisma.ejercicio.findFirst({
    where: { tenantId, nombre: "Sentadilla" },
  });
  if (!existing) {
    await prisma.ejercicio.create({
      data: {
        tenantId,
        nombre: "Sentadilla",
        descripcion: `Ejercicio privado del Gym ${suffix}`,
        instrucciones: "Mantener la espalda neutra y controlar el descenso.",
      },
    });
  }
}

async function seedTenant(seed) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: seed.slug },
    update: { name: seed.name, status: "ACTIVE" },
    create: { name: seed.name, slug: seed.slug, status: "ACTIVE" },
  });

  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: { currency: seed.currency },
    create: {
      tenantId: tenant.id,
      timezone: "America/Argentina/Cordoba",
      currency: seed.currency,
    },
  });

  const kioskSecret = `${seed.slug}-kiosk-development-token`;
  const kioskHash = createHash("sha256").update(kioskSecret).digest("hex");
  await prisma.tenantKioskCredential.upsert({
    where: { tokenHash: kioskHash },
    update: { tenantId: tenant.id, active: true },
    create: { tenantId: tenant.id, label: "Kiosco seed", tokenHash: kioskHash },
  });

  const plan = await prisma.plan.upsert({
    where: { tenantId_nombre: { tenantId: tenant.id, nombre: "Plan Mensual" } },
    update: { precio: 25000, sesionesTotales: 12 },
    create: {
      tenantId: tenant.id,
      nombre: "Plan Mensual",
      desc: `Plan de prueba de ${seed.name}`,
      precio: 25000,
      sesionesTotales: 12,
    },
  });

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "admin@gymhour.test" } },
    update: { role: "ADMIN", estado: true },
    create: {
      tenantId: tenant.id,
      dni: "30000001",
      email: "admin@gymhour.test",
      nombre: "Admin",
      apellido: seed.name,
      password: passwordHash,
      role: "ADMIN",
      estado: true,
    },
  });

  const trainer = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "trainer@gymhour.test" } },
    update: { role: "TRAINER", estado: true },
    create: {
      tenantId: tenant.id,
      dni: "30000002",
      email: "trainer@gymhour.test",
      nombre: "Trainer",
      apellido: seed.name,
      password: passwordHash,
      role: "TRAINER",
      profesion: "Entrenamiento funcional",
      estado: true,
    },
  });

  const student = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "student@gymhour.test" } },
    update: { role: "STUDENT", estado: true, ID_Plan: plan.ID_Plan },
    create: {
      tenantId: tenant.id,
      dni: "40000001",
      email: "student@gymhour.test",
      nombre: "Student",
      apellido: seed.name,
      password: passwordHash,
      role: "STUDENT",
      estado: true,
      ID_Plan: plan.ID_Plan,
    },
  });

  await upsertClass(tenant.id, trainer.ID_Usuario, seed.suffix);
  await upsertExercise(tenant.id, seed.suffix);
  return { tenant, admin, trainer, student, kioskSecret };
}

async function main() {
  const results = [];
  for (const seed of tenantSeeds) results.push(await seedTenant(seed));

  console.log("Seed multi-tenant listo. Password de desarrollo: Gymhour123!");
  for (const { tenant, kioskSecret } of results) {
    console.log(`${tenant.name}: /g/${tenant.slug}/login | kiosk: ${kioskSecret}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
