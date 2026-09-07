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

## Identidad y configuración de Gymhour

La configuración visual y comercial está centralizada en `gymhour-frontend/src/setup.js`. Allí se controlan:

- URL de la API.
- Nombre, título y descripción de la aplicación.
- Logos, favicon y fondo de autenticación.
- Colores de interfaz y reportes PDF.
- Datos de cobro y WhatsApp para comprobantes.

Los componentes deben consumir `CLIENT_SETUP` en lugar de importar datos o logos de marca directamente. Los campos de pago cuyo valor comienza con `COMPLETAR_` permanecen ocultos hasta que se configuren.

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
