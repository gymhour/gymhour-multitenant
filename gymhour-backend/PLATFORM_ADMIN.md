# Panel de plataforma

## Configuración

El backend necesita estas variables adicionales:

```env
PLATFORM_FRONTEND_URL="https://platform.example.com"
PLATFORM_MFA_ENCRYPTION_KEY="<32 bytes en base64>"
```

Generar la clave una sola vez y guardarla en el gestor de secretos:

```bash
openssl rand -base64 32
```

No rotar esa clave sin descifrar y volver a cifrar primero el secreto MFA almacenado.

El frontend del subdominio de plataforma se compila con:

```bash
REACT_APP_APP_MODE=platform REACT_APP_API_URL=https://api.example.com npm run build:platform
```

La API y el panel deben usar HTTPS y compartir el mismo dominio registrable para que la cookie `SameSite=Strict` funcione entre subdominios.

## Puesta en marcha

1. Hacer un backup de la base.
2. Ejecutar `npm run migrate:deploy` en el backend.
3. Crear la cuenta única desde una terminal privada:

   ```bash
   npm run platform-admin -- create --email operador@example.com
   ```

4. Escanear el QR, confirmar el TOTP y guardar los códigos de recuperación fuera del equipo.
5. Programar `POST /cron/platform-maintenance` con `Authorization: Bearer <CRON_SECRET>` para reintentar limpiezas externas pendientes.

Si una instalación ya contenía un `PlatformUser`, ejecutar primero `reset-password` y luego `reset-mfa` en lugar de `create`.

## Recuperación

Los siguientes comandos revocan todas las sesiones existentes:

```bash
npm run platform-admin -- reset-password --email operador@example.com
npm run platform-admin -- reset-mfa --email operador@example.com
```

No existen registro ni recuperación pública por email para esta cuenta.
