import crypto from 'node:crypto';

// Cifrado simétrico AES-256-GCM para secretos guardados en la base (MFA del backoffice, tokens de
// Mercado Pago). La clave vive en una variable de entorno y nunca en la base: una copia de la base
// sola no alcanza para leer los secretos.

// Acepta la clave en hexadecimal (64 caracteres) o en base64. Debe tener exactamente 32 bytes.
export function parseEncryptionKey(raw: string | undefined, envName: string): Buffer {
  const value = raw ?? '';
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error(`${envName} debe contener exactamente 32 bytes.`);
  return key;
}

// Resultado: iv.tag.cifrado, cada parte en base64url.
export function sealSecret(secret: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.');
}

export function openSecret(payload: string, key: Buffer, invalidError = 'SECRET_INVALID'): string {
  const [ivRaw, tagRaw, encryptedRaw] = String(payload ?? '').split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error(invalidError);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8');
}
