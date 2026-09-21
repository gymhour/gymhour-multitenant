import 'dotenv/config';
import crypto from 'node:crypto';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { generateSecret, generateURI, verify } from 'otplib';
import qrcode from 'qrcode-terminal';

const prisma = new PrismaClient();
const command = process.argv[2];
const emailIndex = process.argv.indexOf('--email');
const email = emailIndex >= 0 ? String(process.argv[emailIndex + 1] || '').trim().toLowerCase() : '';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

const encryptionKey = () => {
  const raw = process.env.PLATFORM_MFA_ENCRYPTION_KEY || '';
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('PLATFORM_MFA_ENCRYPTION_KEY debe contener exactamente 32 bytes.');
  return key;
};
const encrypt = secret => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.');
};
const hiddenPrompt = question => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY) { reject(new Error('Este comando requiere una terminal interactiva.')); return; }
  process.stdout.write(question);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  let value = '';
  const onData = char => {
    if (char === '\u0003') { cleanup(); reject(new Error('Cancelado.')); return; }
    if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
    if (char === '\u007f') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } return; }
    if (char >= ' ') { value += char; process.stdout.write('*'); }
  };
  const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); };
  process.stdin.on('data', onData);
});
const visiblePrompt = question => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY) { reject(new Error('Este comando requiere una terminal interactiva.')); return; }
  process.stdout.write(question); process.stdin.resume(); process.stdin.setEncoding('utf8');
  const onData = data => { process.stdin.off('data', onData); process.stdin.pause(); resolve(String(data).trim()); };
  process.stdin.on('data', onData);
});
const passwordHash = async password => {
  if (password.length < 16 || password.length > 128) throw new Error('La contraseña debe tener entre 16 y 128 caracteres.');
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
};
const recoveryCodes = () => Array.from({ length: 10 }, () => {
  const value = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`;
});

async function provisionMfa(user) {
  const secret = generateSecret({ length: 20 });
  const uri = generateURI({ issuer: 'Gymhour Platform', label: user.email, secret });
  console.log('\nEscaneá este QR con tu aplicación autenticadora:');
  qrcode.generate(uri, { small: true });
  console.log(`Si no podés escanearlo, usá esta clave: ${secret}`);
  const code = await visiblePrompt('Código TOTP para confirmar: ');
  const result = await verify({ secret, token: code, epochTolerance: 30 });
  if (!result.valid) throw new Error('El código TOTP no es válido. No se realizaron cambios.');
  const codes = recoveryCodes();
  await prisma.$transaction([
    prisma.platformRecoveryCode.deleteMany({ where: { platformUserId: user.id } }),
    prisma.platformRecoveryCode.createMany({ data: codes.map(value => ({ platformUserId: user.id, codeHash: sha256(value) })) }),
    prisma.platformSession.deleteMany({ where: { platformUserId: user.id } }),
    prisma.platformUser.update({ where: { id: user.id }, data: {
      mfaSecretEncrypted: encrypt(secret), mfaEnabledAt: new Date(), mfaLastUsedStep: null, authVersion: { increment: 1 },
    } }),
  ]);
  console.log('\nCódigos de recuperación (guardalos ahora; no vuelven a mostrarse):');
  codes.forEach(value => console.log(`  ${value}`));
}

async function create() {
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usá --email con un email válido.');
  if (await prisma.platformUser.count()) throw new Error('Ya existe la cuenta única de plataforma.');
  const password = await hiddenPrompt('Contraseña (mínimo 16 caracteres): ');
  const confirmation = await hiddenPrompt('Repetí la contraseña: ');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
  const user = await prisma.platformUser.create({ data: { email, password: await passwordHash(password), active: false } });
  try {
    await provisionMfa(user);
    await prisma.platformUser.update({ where: { id: user.id }, data: { active: true } });
  } catch (error) {
    await prisma.platformUser.delete({ where: { id: user.id } });
    throw error;
  }
  console.log(`\nCuenta ${email} creada y protegida con MFA.`);
}

async function findAccount() {
  const user = email ? await prisma.platformUser.findUnique({ where: { email } }) : await prisma.platformUser.findFirst();
  if (!user) throw new Error('No existe una cuenta de plataforma.');
  return user;
}

async function resetPassword() {
  const user = await findAccount();
  const password = await hiddenPrompt('Nueva contraseña (mínimo 16 caracteres): ');
  const confirmation = await hiddenPrompt('Repetí la contraseña: ');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
  await prisma.$transaction([
    prisma.platformSession.deleteMany({ where: { platformUserId: user.id } }),
    prisma.platformUser.update({ where: { id: user.id }, data: {
      password: await passwordHash(password), passwordChangedAt: new Date(), authVersion: { increment: 1 },
      failedLoginCount: 0, lockedUntil: null,
    } }),
  ]);
  console.log('Contraseña actualizada y sesiones revocadas.');
}

async function resetMfa() { await provisionMfa(await findAccount()); console.log('\nMFA renovado y sesiones revocadas.'); }

try {
  if (command === 'create') await create();
  else if (command === 'reset-password') await resetPassword();
  else if (command === 'reset-mfa') await resetMfa();
  else throw new Error('Uso: npm run platform-admin -- <create|reset-password|reset-mfa> [--email correo]');
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
