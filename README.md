# Trainer

Monorepo de la plataforma Trainer.

```text
trainer/
├── trainer-backend/   API Node.js, Express, TypeScript y Prisma/MySQL
├── trainer-frontend/  Aplicación React
└── package.json       Workspaces y comandos del monorepo
```

## Instalación

Desde la raíz:

```bash
npm install
```

También se puede trabajar de manera independiente dentro de cada workspace.

## Desarrollo

```bash
npm run dev:backend
npm run dev:frontend
```

El backend utiliza `trainer-backend/.env`. Partir de la plantilla versionada:

```bash
cp trainer-backend/.env.example trainer-backend/.env
```

El frontend puede utilizar `trainer-frontend/.env` para variables locales.
Ninguno de los `.env` se versiona; sí se versiona el `.env.example`.

## Builds

```bash
npm run build
npm run build:backend
npm run build:frontend
```

## Configuración del frontend por cliente

La configuración visual y comercial está centralizada en
`trainer-frontend/src/setup.js`. Desde ese archivo se controlan:

- URL de la API (`REACT_APP_API_URL` puede sobrescribirla por ambiente).
- Nombre, título y descripción del cliente.
- Logo para tema oscuro y claro.
- Favicon, apple-touch icon y fondo de autenticación.
- Colores principales de la interfaz y de los reportes PDF.
- Titular de cuenta, alias, CBU/CUIL y WhatsApp para comprobantes.

Los componentes no deben importar logos del cliente directamente; deben tomar
los recursos desde `CLIENT_SETUP`.

## Base de datos

Para aplicar en producción las migraciones existentes de Prisma:

```bash
npm run migrate:deploy
```

El seed carga datos de prueba y solamente debe ejecutarse de forma intencional:

```bash
npm run seed
```

## Railway

El repositorio se despliega como un monorepo aislado. Cada servicio debe usar
el mismo repositorio de GitHub con una carpeta raíz diferente:

### API

- Root Directory: `/trainer-backend`
- Build Command: `npm ci && npm run build`
- Pre-deploy Command: `npm run migrate:deploy`
- Start Command: `npm start`
- Watch Path: `/trainer-backend/**`

### Frontend

- Root Directory: `/trainer-frontend`
- Build Command: `npm ci && npm run build`
- Watch Path: `/trainer-frontend/**`

La base MySQL es un servicio separado del mismo proyecto Railway. Las variables
de entorno se configuran por servicio; `DATABASE_URL` pertenece únicamente a la
API.
