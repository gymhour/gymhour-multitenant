import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { systemPrisma } from '../src/models/Prisma.js';
import { purgeTenantDatabase } from '../src/services/tenantDeletion.service.js';

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);
const backendDir = fileURLToPath(new URL('../', import.meta.url));
const slugs = ['vitest-gym-a', 'vitest-gym-b', 'vitest-gym-a-2'];

async function cleanTenants() {
  const tenants = await systemPrisma.tenant.findMany({
    where: { OR: [{ slug: { in: slugs } }, { users: { some: { email: { endsWith: '@gymhour.test' } } } }] },
    select: { id: true },
  });
  const ids = tenants.map(tenant => tenant.id);
  if (ids.length) {
    await systemPrisma.tenantKioskCredential.deleteMany({ where: { tenantId: { in: ids } } });
    await systemPrisma.tenantSettings.deleteMany({ where: { tenantId: { in: ids } } });
    await systemPrisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await systemPrisma.plan.deleteMany({ where: { tenantId: { in: ids } } });
    await systemPrisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
  await systemPrisma.platformAuditLog.deleteMany({ where: { targetTenantSlug: { in: slugs } } });
  await systemPrisma.tenantDeletionJob.deleteMany({ where: { tenantSlugSnapshot: { in: slugs } } });
  await systemPrisma.platformUser.deleteMany({ where: { email: 'platform-admin@gymhour.test' } });
}

async function register(slug: string) {
  const response = await request(app).post('/auth/tenants').send({
    email: 'same-admin@gymhour.test',
    password: 'TestPassword123!',
  });
  if (response.status === 201) {
    const name = slug === slugs[0] ? 'Vitest Gym A' : 'Vitest Gym B';
    await systemPrisma.tenant.update({ where: { id: response.body.tenant.id }, data: { name, slug } });
    await systemPrisma.tenantSettings.update({
      where: { tenantId: response.body.tenant.id }, data: { onboardingCompleted: true },
    });
    response.body.tenant = { ...response.body.tenant, name, slug };
  }
  return response;
}

describe.runIf(hasTestDatabase)('API multi-tenant (MySQL aislada)', () => {
  beforeAll(async () => {
    const databaseName = new URL(process.env.TEST_DATABASE_URL!).pathname.toLowerCase();
    if (!databaseName.includes('test')) throw new Error('TEST_DATABASE_URL no parece una base de tests');
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      stdio: 'pipe',
    });
    await cleanTenants();
  }, 60_000);

  afterAll(async () => {
    await cleanTenants();
    await systemPrisma.$disconnect();
  });

  it('ingresa por email y pide elegir cuando las credenciales existen en dos gimnasios', async () => {
    const a = await register(slugs[0]);
    const b = await register(slugs[1]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.user.role).toBe('ADMIN');
    expect(b.body.user.role).toBe('ADMIN');
    expect(a.body.tenant.slug).toBe(slugs[0]);
    expect(b.body.tenant.slug).toBe(slugs[1]);

    await systemPrisma.tenantSettings.update({
      where: { tenantId: a.body.tenant.id },
      data: { primaryColor: '#123456', logoPublicId: `tenants/${a.body.tenant.id}/branding/logo-test` },
    });
    const branding = await request(app).get(`/auth/tenants/${slugs[0]}/branding`);
    expect(branding.status).toBe(200);
    expect(branding.body).toMatchObject({ name: 'Vitest Gym A', slug: slugs[0], primaryColor: '#123456' });
    expect(branding.body.logoUrl).toContain('logo-test');
    expect(branding.body).not.toHaveProperty('id');
    expect((await request(app).get('/auth/tenants/no-existe/branding')).status).toBe(404);

    const duplicatedName = await request(app).post('/auth/tenants').send({
      email: 'other-admin@gymhour.test',
      password: 'TestPassword123!',
    });
    expect(duplicatedName.status).toBe(201);
    expect(duplicatedName.body.tenant.onboardingCompleted).toBe(false);
    await systemPrisma.tenant.update({
      where: { id: duplicatedName.body.tenant.id }, data: { name: 'Vitest Gym A', slug: slugs[2] },
    });

    const login = await request(app).post('/auth/login')
      .send({ email: 'same-admin@gymhour.test', password: 'TestPassword123!' });
    expect(login.status).toBe(200);
    expect(login.body.requiresTenantSelection).toBe(true);
    expect(login.body.tenants).toHaveLength(2);
    expect(login.body).not.toHaveProperty('token');

    const selectedTenant = login.body.tenants.find((tenant: { slug: string }) => tenant.slug === slugs[0]);
    const selected = await request(app).post('/auth/login/select-tenant').send({
      selectionToken: login.body.selectionToken,
      tenantId: selectedTenant.id,
    });
    expect(selected.status).toBe(200);
    expect(selected.body.requiresTenantSelection).toBe(false);
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${selected.body.token}`);
    expect(me.body.tenant.slug).toBe(slugs[0]);

    const emptyDashboard = await request(app).get('/admin/dashboard')
      .set('Authorization', `Bearer ${selected.body.token}`);
    expect(emptyDashboard.status).toBe(200);
    expect(emptyDashboard.body.setupGuide).toMatchObject({
      totalSteps: 5,
      completedSteps: 0,
      isComplete: false,
      isOperationallyEmpty: true,
      steps: { plan: false, members: false, routine: false, quotas: false, payment: false },
    });
    expect((await request(app).post('/admin/setup-guide/complete')
      .set('Authorization', `Bearer ${selected.body.token}`)).status).toBe(409);

    const dismissed = await request(app).patch('/admin/setup-guide/preference')
      .set('Authorization', `Bearer ${selected.body.token}`).send({ dismissed: true });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.setupGuideDismissedAt).toBeTruthy();
    const dismissedMe = await request(app).get('/auth/me').set('Authorization', `Bearer ${selected.body.token}`);
    expect(dismissedMe.body.user.setupGuideDismissedAt).toBeTruthy();
    const restored = await request(app).patch('/admin/setup-guide/preference')
      .set('Authorization', `Bearer ${selected.body.token}`).send({ dismissed: false });
    expect(restored.status).toBe(200);
    expect(restored.body.setupGuideDismissedAt).toBeNull();

    const tampered = await request(app).post('/auth/login/select-tenant').send({
      selectionToken: login.body.selectionToken,
      tenantId: 99999999,
    });
    expect(tampered.status).toBe(401);

    const wrongPassword = await request(app).post('/auth/login')
      .send({ email: 'same-admin@gymhour.test', password: 'incorrecta' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.message).toBe('Email o contraseña incorrectos.');
  });

  it('devuelve 404 para CRUD cross-tenant y permite el CRUD same-tenant', async () => {
    const loginA = await request(app).post(`/auth/tenants/${slugs[0]}/login`)
      .send({ email: 'same-admin@gymhour.test', password: 'TestPassword123!' });
    const loginB = await request(app).post(`/auth/tenants/${slugs[1]}/login`)
      .send({ email: 'same-admin@gymhour.test', password: 'TestPassword123!' });
    const tokenA = loginA.body.token;
    const tokenB = loginB.body.token;

    const created = await request(app).post('/planes').set('Authorization', `Bearer ${tokenA}`)
      .send({ nombre: 'Solo Gym A', precio: 1000, sesionesTotales: 8 });
    expect(created.status).toBe(201);
    const id = created.body.plan.ID_Plan;

    expect((await request(app).get(`/planes/${id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
    expect((await request(app).get(`/planes/${id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
    expect((await request(app).put(`/planes/${id}`).set('Authorization', `Bearer ${tokenB}`).send({ precio: 5 })).status).toBe(404);
    expect((await request(app).delete(`/planes/${id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
    expect((await request(app).put(`/planes/${id}`).set('Authorization', `Bearer ${tokenA}`).send({ precio: 1200 })).status).toBe(200);
    expect((await request(app).delete(`/planes/${id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
  });

  it('permite DNI repetido entre tenants y rechaza relaciones cruzadas por FK compuesta', async () => {
    const tenants = await systemPrisma.tenant.findMany({ where: { slug: { in: slugs } }, orderBy: { slug: 'asc' } });
    const [tenantA, tenantB] = tenants;
    const password = '$2b$12$HpoGvy8p2WqYEdZJPGFrDOUewueh8obCMyAadAhDMQevH19TcMRcO';
    const studentA = await systemPrisma.user.create({ data: {
      tenantId: tenantA.id, email: 'same-student@gymhour.test', dni: '44999999', password, role: 'STUDENT', estado: true,
    } });
    const studentB = await systemPrisma.user.create({ data: {
      tenantId: tenantB.id, email: 'same-student@gymhour.test', dni: '44999999', password, role: 'STUDENT', estado: true,
    } });
    const publicCheckInA = await request(app).post(`/usuarios/asistencias/public/${tenantA.slug}/registrar`)
      .send({ dni: '44999999', metodo: 'QR' });
    const publicCheckInB = await request(app).post(`/usuarios/asistencias/public/${tenantB.slug}/registrar`)
      .send({ dni: '44999999', metodo: 'QR' });
    expect(publicCheckInA.status).toBe(403);
    expect(publicCheckInA.body.alumno.id).toBe(studentA.ID_Usuario);
    expect(publicCheckInB.status).toBe(403);
    expect(publicCheckInB.body.alumno.id).toBe(studentB.ID_Usuario);
    expect((await request(app).post('/usuarios/asistencias/public/no-existe/registrar')
      .send({ dni: '44999999', metodo: 'QR' })).status).toBe(404);
    await expect(systemPrisma.cuota.create({ data: {
      tenantId: tenantB.id,
      ID_Usuario: studentA.ID_Usuario,
      mes: '2026-09', importe: 1000, vence: new Date('2026-09-30T00:00:00.000Z'),
    } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('deriva el tenant del token de kiosco y rechaza credenciales revocadas', async () => {
    const login = await request(app).post(`/auth/tenants/${slugs[1]}/login`)
      .send({ email: 'same-admin@gymhour.test', password: 'TestPassword123!' });
    const created = await request(app).post('/tenant/kiosks').set('Authorization', `Bearer ${login.body.token}`)
      .send({ label: 'Test kiosk' });
    expect(created.status).toBe(201);
    const token = created.body.activationToken;
    const firstCheckIn = await request(app).post('/usuarios/asistencias/kiosk/registrar')
      .set('X-Kiosk-Token', token).send({ dni: '00000000', metodo: 'DNI' });
    expect(firstCheckIn.status).toBe(404);
    expect((await request(app).delete(`/tenant/kiosks/${created.body.kiosk.id}`)
      .set('Authorization', `Bearer ${login.body.token}`)).status).toBe(204);
    expect((await request(app).post('/usuarios/asistencias/kiosk/registrar')
      .set('X-Kiosk-Token', token).send({ dni: '00000000', metodo: 'DNI' })).status).toBe(401);
  });

  it('invalida tokens al cambiar password y bloquea tenant suspendido', async () => {
    const login = await request(app).post(`/auth/tenants/${slugs[0]}/login`)
      .send({ email: 'same-admin@gymhour.test', password: 'TestPassword123!' });
    const oldToken = login.body.token;
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(200);
    expect((await request(app).put('/auth/change-password').set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: 'TestPassword123!', newPassword: 'ChangedPassword123!' })).status).toBe(200);
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);

    const tenant = await systemPrisma.tenant.findUniqueOrThrow({ where: { slug: slugs[0] } });
    const newLogin = await request(app).post(`/auth/tenants/${slugs[0]}/login`)
      .send({ email: 'same-admin@gymhour.test', password: 'ChangedPassword123!' });
    const globalLogin = await request(app).post('/auth/login')
      .send({ email: 'same-admin@gymhour.test', password: 'ChangedPassword123!' });
    expect(globalLogin.status).toBe(200);
    expect(globalLogin.body.requiresTenantSelection).toBe(false);
    expect(globalLogin.body.token).toBeTruthy();
    await systemPrisma.tenant.update({ where: { id: tenant.id }, data: { status: 'SUSPENDED' } });
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${newLogin.body.token}`)).status).toBe(403);
    await systemPrisma.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } });
  });

  it('purga un tenant completo sin modificar los demás y conserva la auditoría', async () => {
    const target = await systemPrisma.tenant.findUniqueOrThrow({ where: { slug: slugs[2] } });
    const untouched = await systemPrisma.tenant.findUniqueOrThrow({ where: { slug: slugs[1] } });
    const actor = await systemPrisma.platformUser.create({ data: {
      email: 'platform-admin@gymhour.test', password: 'test-only-hash', active: true,
    } });
    await systemPrisma.plan.create({ data: { tenantId: target.id, nombre: 'Plan a purgar', precio: 1 } });
    const jobId = await purgeTenantDatabase({
      tenant: { id: target.id, slug: target.slug, name: target.name },
      actor: { id: actor.id, email: actor.email }, assets: [], reason: 'Prueba de purga segura',
      ipAddress: '127.0.0.1', userAgent: 'vitest',
    });
    expect(await systemPrisma.tenant.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await systemPrisma.user.count({ where: { tenantId: target.id } })).toBe(0);
    expect(await systemPrisma.plan.count({ where: { tenantId: target.id } })).toBe(0);
    expect(await systemPrisma.tenant.findUnique({ where: { id: untouched.id } })).not.toBeNull();
    expect(await systemPrisma.tenantDeletionJob.findUnique({ where: { id: jobId } })).toMatchObject({ status: 'COMPLETED' });
    expect(await systemPrisma.platformAuditLog.findFirst({ where: { targetTenantId: target.id, action: 'TENANT_DELETE' } })).not.toBeNull();
  });
});
