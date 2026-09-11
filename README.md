# Gymhour

Proyecto base de Gymhour para la gestión integral de gimnasios. El monorepo reúne una API Node.js/Express con Prisma y una aplicación web React.

```text
gymhour/
├── gymhour-backend/   API Node.js, Express, TypeScript y Prisma/MySQL
├── gymhour-frontend/  Aplicación React
└── package.json       Workspaces y comandos del monorepo
```

## Requisitos

- Node.js 20 o superior.
- npm 10 o superior.
- Una base de datos MySQL accesible para Prisma.

## Instalación y configuración

Desde la raíz del repositorio:

```bash
npm install
cp gymhour-backend/.env.example gymhour-backend/.env
```

Completá las variables del backend antes de iniciarlo. El frontend puede usar `gymhour-frontend/.env` con `REACT_APP_API_URL` para apuntar a otra API; si no se define, usa `http://localhost:3000`.

Los archivos `.env` no se versionan. La plantilla `.env.example` sí forma parte del repositorio.

## Desarrollo

Ejecutá cada proceso en una terminal diferente:

```bash
npm run dev:backend
npm run dev:frontend
```

## Comandos

```bash
npm run build             # Compila backend y frontend
npm run build:backend     # Genera Prisma y compila TypeScript
npm run build:frontend    # Genera el build de React
npm run migrate:deploy    # Aplica migraciones existentes
npm run seed              # Carga datos de prueba intencionalmente
npm start                 # Inicia el backend compilado
```

## Arquitectura multi-tenant

Cada usuario operativo pertenece a un único `Tenant`. El JWT contiene `tenantId`, `role`,
`authVersion` y `scope: "tenant"`, pero la API vuelve a cargar usuario y tenant en cada request.
El aislamiento se aplica nuevamente en el cliente Prisma request-scoped y en foreign keys
compuestas. `PlatformUser/SUPER_ADMIN` es una identidad global separada y no puede usar rutas
operativas de gimnasios.

El alta pública se realiza en `POST /auth/tenants`. El login principal usa
`POST /auth/login` con email y contraseña, sin pedir el slug. Si las credenciales
coinciden en varios gimnasios devuelve un token temporal y la lista de membresías;
`POST /auth/login/select-tenant` completa la selección y emite el JWT operativo.
La ruta anterior por slug se conserva temporalmente por compatibilidad.

## Migración desde la base legacy

Antes de desplegar, hacer un backup verificable. La migración crea `legacy-gym`, ejecuta el
backfill, valida que no queden filas sin tenant y recién entonces instala los constraints.
Los roles desconocidos o nulos se convierten a `STUDENT`, nunca a un rol privilegiado.

```bash
cd gymhour-backend
node prisma/auditLegacyTenantMigration.js --confirm-readonly-legacy > migration-preflight.json
npx prisma validate
npx prisma migrate deploy
npx prisma generate
node dist/scripts/migrateMediaAssets.js --tenant=legacy-gym       # preview
node dist/scripts/migrateMediaAssets.js --tenant=legacy-gym --apply
npm run seed
```

La migración de Cloudinary hace copy-verify hacia `tenants/{tenantId}/...`, registra cada copia
en `MediaAsset` y no elimina los originales. Los assets nuevos usan entrega autenticada y URLs
firmadas por 15 minutos; `CLOUDINARY_AUTH_TOKEN_KEY` es obligatoria para servirlos.

Los scripts manuales de `prisma/` exigen siempre `--tenant=<slug>` y fallan si se omite.

## Pruebas de aislamiento

La integración sólo acepta `TEST_DATABASE_URL` si el nombre de la base contiene `test`; nunca
reutiliza `DATABASE_URL` de forma implícita.

```bash
cd gymhour-backend
npm run audit:tenant
npm test
```

Sin `TEST_DATABASE_URL`, las pruebas puras del scoper se ejecutan y la integración MySQL se
marca como omitida. Con la variable configurada, Vitest aplica las migraciones y ejecuta los
casos same-tenant/cross-tenant.

No hay WebSockets ni caches actualmente. Cualquier incorporación futura debe incluir
`tenantId` en canales, claves, tags de invalidación y payloads de jobs.

## Identidad visual y configuración

La configuración visual y comercial está centralizada en `gymhour-frontend/src/setup.js`. Allí se controlan:

- URL de la API.
- Nombre, título y descripción de la aplicación.
- Logos, favicon y fondo de autenticación.
- Colores de interfaz y reportes PDF.
- Fallback visual de datos de cobro y WhatsApp.

Los componentes deben consumir `CLIENT_SETUP` para branding. Los datos operativos y de cobro
provienen de `TenantSettings` a través de `/auth/me` y se editan en Configuración del gimnasio.

## Despliegue en Railway

Cada servicio usa el mismo repositorio con una carpeta raíz distinta.

### API

- Root Directory: `/gymhour-backend`
- Build Command: `npm ci && npm run build`
- Pre-deploy Command: `npm run migrate:deploy`
- Start Command: `npm start`
- Watch Path: `/gymhour-backend/**`

### Frontend

- Root Directory: `/gymhour-frontend`
- Build Command: `npm ci && npm run build`
- Watch Path: `/gymhour-frontend/**`

La base MySQL se despliega como otro servicio del mismo proyecto. `DATABASE_URL` pertenece exclusivamente a la API y las variables se configuran por servicio.
