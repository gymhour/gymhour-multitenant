# Cobro de cuotas a socios con Mercado Pago

Cada gimnasio conecta **su propia** cuenta de Mercado Pago y sus socios pagan las cuotas desde Gymhour. La plata llega directo a la cuenta del gimnasio: Gymhour nunca la recibe ni la mueve.

La integración tiene tres partes:

| Parte | Qué hace | Plan |
|---|---|---|
| Recargo por atraso | Cada gimnasio configura un recargo para las cuotas pagadas después del vencimiento. | Todos |
| Botón de pago | El socio paga una cuota con Mercado Pago desde su cuenta. La cuota pasa sola a pagada, con el número de operación. | Pro, prueba y exentos |
| Débito automático | El socio se adhiere una vez y Mercado Pago le cobra cada período. | Pro, prueba y exentos |

**Estado:** el código está en la rama `feature-mercadopago`, sin migraciones aplicadas. Para usarlo hace falta la cuenta de Mercado Pago de Gymhour, la app en Mercado Pago Developers, las variables y las migraciones. Ver [Puesta en marcha](#puesta-en-marcha).

## Decisiones

| Tema | Decisión |
|---|---|
| Vinculación | El admin conecta su cuenta solo, con OAuth. Gymhour no pide contraseñas ni credenciales. |
| Permisos | Mercado Pago no ofrece un permiso de "solo cobrar": el token tiene `read`, `write` y `offline_access`. Gymhour lo usa solo para la [lista cerrada](#permisos-usados). |
| Renovación del token | Automática, antes de los 180 días, para que nunca queden cobros del débito sin registrar. El gimnasio puede revocar el acceso cuando quiera. |
| Medios del botón de pago | Dinero en cuenta, débito y crédito, en un solo pago. Sin efectivo. |
| Devoluciones y contracargos | Se hacen desde Mercado Pago, nunca desde Gymhour. Gymhour los detecta: la cuota vuelve a impaga y el admin ve el aviso. |
| Duplicados | Se previenen. Si igual ocurre uno, el admin lo valida y lo devuelve desde Mercado Pago. |
| Débito rechazado | El socio actualiza su tarjeta, o paga por otro medio cancelando el débito. |
| Comisión de Gymhour | Fuera de esta etapa. |

## Recargo por atraso

**Configuración:** Ajustes → "Recargo por pago fuera de término" (`TenantSettings.recargoTipo`, `recargoValor`, `recargoTope`, `recargoDiasGracia`).

| Tipo | Cálculo |
|---|---|
| `NINGUNO` | Sin recargo (predeterminado). |
| `FIJO` | El monto configurado, en pesos. |
| `PORCENTAJE` | `importe × valor %`, una sola vez. |
| `PORCENTAJE_DIARIO` | `importe × valor % × días cobrables`, con tope en % de la cuota (obligatorio). |

- **Días de atraso:** desde el día del vencimiento hasta el día de pago, en días locales. Pagar el mismo día del vencimiento son 0 días.
- **Días de gracia:** se descuentan del atraso. Si el atraso no supera la gracia, no hay recargo.
- **Redondeo:** a pesos enteros.
- **Dónde se aplica:**
  - En el botón de pago se suma siempre, calculado por el servidor al crear el checkout.
  - En el pago manual, el admin ve el recargo sugerido y elige cobrarlo o perdonarlo (`aplicarRecargo`).
  - En el débito automático no se aplica, porque el cobro es en fecha.
- **Al pagar** se guarda `Cuota.recargo`. Cambiar la configuración no modifica cuotas ya pagadas.
- **Reportes:** los ingresos suman `importe + recargo` (dashboard, insights y asistente).
- El gimnasio debe informar el recargo a sus socios de antemano. Conviene que lo valide con su contador o abogado.

Código: `services/lateFee.service.ts` (`calculateLateFee`, `parseLateFeeSettings`).

## Conexión con Mercado Pago (OAuth)

El admin toca **Conectar Mercado Pago** en Ajustes → "Cobros con Mercado Pago".

1. `POST /pagos/mercadopago/conectar` genera un `state` aleatorio y un verificador PKCE. Los guarda 10 minutos en `MercadoPagoOAuthState`: el `state` solo como hash y el verificador cifrado, atados al gimnasio y al admin.
2. El admin va a la página de autorización **de Mercado Pago**, inicia sesión allí y acepta. Gymhour nunca ve su contraseña.
3. Mercado Pago vuelve a `GET /pagos/mercadopago/oauth/callback?code&state`, una URL fija registrada en la app.
4. El backend valida el `state`: que exista, que no se haya usado, que no haya vencido y que el admin siga siendo admin de un gimnasio con plan Pro. Lo marca usado.
5. Canjea el `code` de servidor a servidor, con las credenciales de la app y el verificador PKCE.
6. Guarda cifrados el token y el refresh token en `MercadoPagoAccount`, junto con el `user_id` de la cuenta (el collector), el vencimiento y si es de prueba o real.
7. Vuelve a `FRONTEND_URL/admin/configuracion?mp=conectado`, o `?mp=error&motivo=...`.

**Para qué sirve cada control:**

- **`state`:** impide que alguien conecte **su** cuenta de Mercado Pago a un gimnasio ajeno (mandándole al admin un link con su propio `code`) para quedarse con los pagos de los socios. También identifica al gimnasio sin confiar en el navegador: el callback no tiene sesión de Gymhour.
- **PKCE (S256):** un `code` filtrado (por el historial o una extensión del navegador) no sirve sin el verificador, que nunca sale del servidor.
- **`redirect_uri` fija:** Mercado Pago solo devuelve el `code` a la URL exacta registrada en la app.
- **Modo de prueba o real:** lo separa la app, no la variable.
  - Una app de una cuenta real no conecta cuentas de prueba (confirmado), y Gymhour Sandbox, que es de una cuenta de prueba, es para cuentas de prueba.
  - Con Gymhour Sandbox, `MP_TEST_MODE` va en `false`. Mercado Pago entrega tokens productivos de cuentas de prueba, sin `test_token` (confirmado el 23 de noviembre de 2026).
  - `MP_TEST_MODE=true` queda para el flujo viejo de credenciales `TEST-`: manda `test_token=true` y exige que el token no sea productivo (`MODE_MISMATCH`).

**Renovación:** el cron renueva los tokens que vencen en menos de 30 días, también en gimnasios bloqueados. Cada renovación trae un refresh token nuevo, que se vuelve a guardar. Si Mercado Pago rechaza la renovación, o responde 401 en cualquier operación:

- La conexión queda en `ERROR`.
- Los admins reciben una vez el mail "Reconectá Mercado Pago".
- Los avisos que lleguen se guardan en una cola y se procesan al reconectar.

**Reconexión:** es el mismo flujo de conexión. Con pagos en curso o débitos activos no se puede cambiar a **otra** cuenta de Mercado Pago (`ACCOUNT_CHANGE_BLOCKED`), pero sí reconectar la misma.

**Desconexión:** `DELETE /pagos/mercadopago` borra los tokens guardados en Gymhour.

- No se puede desconectar con un pago en curso.
- Con débitos activos, pide confirmación (`DEBITOS_ACTIVOS`) y, con `?cancelarDebitos=true`, los cancela en Mercado Pago antes de desconectar.
- La revocación definitiva la hace el gimnasio desde su cuenta de Mercado Pago, en la sección de seguridad, aplicaciones conectadas. Eso solo quita el acceso de Gymhour a **esa** cuenta. La app de Gymhour en Mercado Pago Developers es una sola para todos los gimnasios y no se toca.

Código: `services/mercadoPagoAccount.service.ts`.

## Permisos usados

El token de cada gimnasio solo se usa desde `services/mercadoPago.service.ts`, que solo puede llamar a estas rutas (`MERCADOPAGO_ROUTES`):

| Operación | Para qué |
|---|---|
| `POST /oauth/token` | Canjear el `code` y renovar el token |
| `GET /users/me` | Mostrar "Conectado como …" |
| `POST /checkout/preferences` | Crear el checkout de una cuota |
| `GET /v1/payments/{id}` | Consultar un pago |
| `GET /v1/payments/search?external_reference=…` | Buscar los pagos de un checkout de Gymhour, por su referencia |
| `POST /preapproval` | Crear el débito automático de un socio |
| `GET /preapproval/{id}` | Consultar un débito |
| `PUT /preapproval/{id}` | Solo cancelarlo (`status: cancelled`) o cambiar su monto |
| `GET /authorized_payments/{id}` | Consultar cada cobro de un débito |

No hay devoluciones, cancelaciones de pagos ni lecturas del resto de la cuenta. Los identificadores se validan antes de armar cualquier URL. `test/mercadoPagoClient.test.ts` verifica que:

- Cada función llame solo a esas rutas.
- `PUT /preapproval` solo cancele o cambie el monto.
- Ningún otro archivo del backend llame a la API de Mercado Pago.

## Botón de pago

`POST /pagos/cuotas/:id/checkout` (socio, Pro), en este orden:

1. Verifica que la cuota sea del socio, que esté impaga y que no esté cubierta por un débito activo.
2. Si el socio ya tiene un pago en curso:
   - En la misma cuota, devuelve el mismo checkout.
   - En otra cuota, responde `409 PAGO_EN_CURSO` con la hora de vencimiento.
   - Si el pago en curso venció, antes de liberarlo consulta a Mercado Pago si hubo un pago.
3. Calcula el monto: importe + recargo del día.
4. Crea el intento en `CuotaPago` con `lockKey = "<tenantId>:<socio>"`, que es único: un solo pago en curso por socio, garantizado por la base.
5. Crea la preferencia de Checkout Pro **con el token del gimnasio**:

| Campo | Valor |
|---|---|
| `items[0]` | Gimnasio y período, 1 unidad, monto calculado por el servidor, ARS |
| `external_reference` | UUID aleatorio del intento |
| `metadata` | Gimnasio, cuota y socio |
| `payment_methods` | Sin `ticket` ni `atm`, `installments: 1` |
| `expires`, `expiration_date_to` | 10 minutos |
| `back_urls` | `FRONTEND_URL/alumno/cuotas?pago=<ref>`. Con `auto_return: approved` solo si es https. |
| `notification_url` | `API_PUBLIC_URL/pagos/webhooks/mercadopago?ref=<ref>`, solo si es https |

El frontend redirige al `init_point`, o al `sandbox_init_point` en modo de prueba. No hay SDK ni cambios de CSP: el socio carga la tarjeta en Mercado Pago, nunca en Gymhour.

Si Mercado Pago no crea el checkout, el intento queda `EXPIRADO` y se libera el bloqueo.

## Confirmación de pagos

Llega por tres caminos, y cualquiera se puede repetir sin efecto doble:

1. **Webhook** `POST /pagos/webhooks/mercadopago`. Ver [Webhooks](#webhooks).
2. **Vuelta del socio:** `POST /pagos/intentos/:ref/verificar`. También lo usan el botón "Ya pagué, verificar" y el admin.
3. **Consulta automática:** al abrir Cuotas, `GET /pagos/mi-estado` verifica el intento en curso como mucho cada 2 minutos. El cron, una vez por día.

Los tres consultan el pago **en la API, con el token del gimnasio**, y lo aplican con `applyPaymentUpdate` (`services/memberPayments.service.ts`):

| Estado en Mercado Pago | Qué pasa |
|---|---|
| `approved` | Si coinciden la cuenta (collector), la moneda ARS y el monto del intento, la cuota queda `pagada`, `vencida = false`, `fechaPago` (día local de aprobación), `formaPago = 'Mercado Pago'`, `referenciaPago` = número de operación y `recargo`. El intento queda `APROBADO`. Si no coinciden, `REVISAR` sin tocar la cuota. |
| `pending` / `in_process` | La tarjeta está en revisión por prevención de fraude. El intento queda `PENDIENTE` y el bloqueo sigue hasta que Mercado Pago apruebe o rechace (minutos, o como mucho un par de días hábiles). La cuota sigue impaga. |
| `rejected` | Con el checkout vigente, el socio puede reintentar. Si estaba `PENDIENTE`, pasa a `RECHAZADO` y se libera. |
| `refunded` / `charged_back` | La cuota vuelve a impaga (si su `referenciaPago` es ese pago) y el intento queda `DEVUELTO` o `CONTRACARGO`, con aviso al admin. |
| Devolución parcial | `REVISAR` y aviso. La cuota no se toca. |

**Qué se guarda de cada pago:** número de operación (`mpPaymentId`, el `id` del pago, que figura en el comprobante del socio y en la Actividad del gimnasio), orden, medio ("Visa débito", "Dinero en cuenta"), fecha de aprobación, neto recibido y email del pagador. Nunca datos de tarjeta.

Los avisos se procesan aunque el gimnasio haya bajado de plan o esté bloqueado: la plata ya se cobró.

## Prevención de pagos duplicados

1. Un solo pago en curso por socio (`CuotaPago.lockKey` único).
2. Con un pago en curso, la cuota no se puede pagar a mano, editar ni eliminar: `PUT /cuotas/:id/pay`, `PUT /cuotas/:id` y `DELETE /cuotas/:id` responden `409` (`onlinePaymentLock`).
3. Las cuotas cubiertas por un débito activo (desde su primer período) tampoco: para pagarlas de otra forma, primero se cancela el débito.
4. Antes de liberar un checkout vencido se consulta a Mercado Pago. Si no se puede consultar, el bloqueo sigue.
5. Idempotencia por número de operación: `mpPaymentId` es único, y la cuota se marca con `updateMany where pagada = false`.
6. **Si igual ocurre:** Mercado Pago no permite que un checkout se pague una sola vez, y el mismo checkout abierto en dos pestañas se puede pagar dos veces. El segundo pago queda `DUPLICADO` sin marcar nada dos veces. El admin lo valida y lo devuelve desde su cuenta de Mercado Pago.

## Débito automático

### Adhesión

`POST /pagos/debito` (socio, Pro), con el email de su cuenta de Mercado Pago. Mercado Pago exige que coincida con la cuenta con la que autoriza.

**Requisitos:**

- Plan con costo y duración por meses o semanas.
- Ciclo de cuotas activo (`cobroAutomaticoActivo`).
- Sin otro débito activo (`DebitoAutomatico.activeKey` único) y sin un pago en curso.

**Primer cobro:** el primer período futuro sin pagar (`firstDebitDate`). Así nunca se superpone con una cuota pagada ni con la del período actual, que se paga aparte.

**Frecuencia:** `MONTHS:n` se cobra cada n meses; `WEEKS:n`, cada 7·n días.

Se crea la suscripción (`POST /preapproval`, `status: pending`) con el token del gimnasio, y el socio la autoriza en su `init_point`. Al volver (`?debito=<ref>`) o con el aviso de Mercado Pago, queda `ACTIVO`. Si nadie la autoriza en 48 horas, el cron la cancela.

### Cada cobro

1. Mercado Pago cobra en la fecha y avisa (`authorized_payment` o `payment`).
2. Gymhour verifica que la suscripción sea un débito de ese gimnasio y consulta el pago.
3. Busca la cuota impaga del período, desde el inicio del débito y hasta 3 días después de la fecha del cobro. Si no existe, la crea con la lógica del cron (`generateDueFeesForUser`).
4. La marca pagada con `formaPago = 'Mercado Pago (débito automático)'` y el número de operación, sin recargo.
5. Si el monto cobrado no coincide con la cuota, igual la marca pagada y avisa al admin.
6. Si el período ya estaba pagado, el cobro queda `DUPLICADO`. Si no hay ninguna cuota para ese período, queda `REVISAR`.

**Si se pierde el aviso de un cobro.** Puede pasar que Mercado Pago cobre, la plata llegue a la cuenta del gimnasio y Gymhour nunca reciba el aviso, por ejemplo porque el servidor estuvo caído mientras Mercado Pago reintentaba. Sin una red de seguridad, la cuota quedaría impaga y el socio bloqueado aunque haya pagado. Por eso `reconcileDebitCharges` busca los pagos del débito por su referencia (`GET /v1/payments/search?external_reference=`, de la lista cerrada) y registra los aprobados que falten, con la misma lógica de cada cobro. También refleja las devoluciones de cobros ya registrados. Es idempotente y corre en tres momentos:

- **Todos los días,** en el cron: todos los débitos `ACTIVO` o `CON_RECHAZO`. Los que tuvieron un rechazo o ya pasaron su fecha de cobro además se sincronizan con Mercado Pago.
- **A pedido del socio:** "Ya me cobraron, verificar" (`POST /pagos/debito/verificar`).
- **A pedido del admin:** "Verificar cobros" en la ficha del socio (`POST /pagos/debitos/:id/verificar`).

En los dos últimos casos la respuesta incluye `cobrosRegistrados`.

### Estados

| Estado | Significado |
|---|---|
| `PENDIENTE` | Falta autorizar en Mercado Pago. |
| `ACTIVO` | Cobra en cada período. |
| `CON_RECHAZO` | Falló un cobro. Mercado Pago reintenta hasta 4 veces en 10 días. |
| `PAUSADO` | Pausado desde la cuenta de Mercado Pago del socio. |
| `CANCELADO` | Dado de baja. Se guarda quién, cuándo y por qué. |

`PENDIENTE`, `ACTIVO`, `CON_RECHAZO` y `PAUSADO` cubren las cuotas desde el primer período: no se pagan por otro medio sin cancelar antes el débito.

### Rechazos

El socio ve el aviso y tiene dos salidas:

- **Actualizar mi tarjeta:** abre el `init_point` de la suscripción. El débito sigue.
- **Pagar por otro medio:** cancela el débito. Recién cuando Mercado Pago confirma la cancelación se habilita el pago de la cuota.

Según la documentación de Mercado Pago, después de 3 cuotas rechazadas la suscripción se da de baja sola; a confirmar para Argentina. En ese caso el aviso lo marca `CANCELADO` por "Mercado Pago".

### Baja y cambios

- **Socio:** "Dar de baja el débito automático" (`POST /pagos/debito/cancelar`), visible, como exige la normativa de consumo para servicios contratados online.
- **Admin:** desde la ficha del socio o desde Cuotas ("Cancelar débito y registrar pago").
- **Automáticas:** al dar de baja o eliminar al socio en Gymhour (si Mercado Pago no confirma, la baja no avanza), al desconectar Mercado Pago y al eliminar el gimnasio (si falla, no se elimina).
- **Cambio de precio del plan:** actualiza el monto de los débitos de ese plan.
- **Cambio de duración del plan, o del plan del socio a otra frecuencia:** cancela el débito para que el socio se vuelva a adherir. Con la misma frecuencia, ajusta el monto.

Código: `services/automaticDebit.service.ts`.

## Avisos al admin

En Cuotas, "Avisos de Mercado Pago" (`GET /pagos/avisos`) lista los pagos que el admin tiene que mirar:

| Aviso | Qué hacer |
|---|---|
| Pago devuelto / Contracargo | La cuota volvió a impaga. Revisar con el socio. |
| Pago duplicado | Validarlo y devolverlo desde Mercado Pago. Si se devuelve, Gymhour lo marca resuelto solo. |
| Para revisar | El pago no coincide con la cuota (monto, moneda o cuenta), o hubo una devolución parcial. |
| Revisar importe | El débito cobró un monto distinto de la cuota. |

"Marcar como revisado" (`POST /pagos/avisos/:id/revisado`) guarda quién y cuándo. Gymhour no tiene botón de devolución: las devoluciones se hacen desde Mercado Pago.

## Webhooks

`POST /pagos/webhooks/mercadopago` es pública: la llama Mercado Pago.

- **Dos formatos:** a la `notification_url` de cada checkout llegan avisos con formato Webhooks (`?data.id=…&type=payment`) y con formato IPN (`?id=…&topic=payment` o `topic=merchant_order`).
- **Firma:** si llega `x-signature` y está `MP_WEBHOOK_SECRET`, se valida con HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
  - El `data.id` es solo el de la URL. En los IPN no viene, y la parte `id:` se omite, como indica Mercado Pago. Hasta el 23 de noviembre de 2026 se usaba el `id` del IPN, y esos avisos daban `401`.
  - Se compara en tiempo constante y con 24 horas de tolerancia. Si es inválida, responde `401`.
- **Nunca se confía en el cuerpo:** solo se usa el ID del recurso, que se vuelve a consultar con el token del gimnasio.
- **A qué gimnasio corresponde:**
  - Primero, por la referencia de Gymhour (`?ref=` de la `notification_url`, o la referencia del débito).
  - Si no, por la cuenta de Mercado Pago del aviso (`user_id`). Si varios gimnasios comparten esa cuenta, se prueba con cada uno.
  - Solo se aplica lo que es un checkout o un débito creado por Gymhour en ese gimnasio. Lo demás se ignora.
- **Tópicos:**
  - `payment`: botón de pago y cobros del débito.
  - `subscription_preapproval` / `preapproval`: estado del débito.
  - `subscription_authorized_payment` / `authorized_payment`: cobros del débito.
- **Respuestas:**
  - `200` si se procesó o se ignoró.
  - `200` sin verificar la firma para los tópicos que Gymhour no usa, como `merchant_order`. Así Mercado Pago no los reintenta.
  - `500` si falló el procesamiento, para que Mercado Pago reintente.
- **Sin un token utilizable**, el aviso se guarda en `MercadoPagoPendingNotification` y se procesa al reconectar o en el cron.

Código: `services/mercadoPagoWebhook.service.ts`, `controllers/mercadoPago.Controller.ts`.

## Tareas diarias

`runMercadoPagoMaintenance` (`services/mercadoPagoMaintenance.service.ts`) corre en `scripts/dailyCron.ts` y en `GET /cron/nightly`, para **todos** los gimnasios conectados, también los bloqueados:

1. Renueva los tokens que vencen en menos de 30 días.
2. Resuelve los checkouts vencidos y los pagos en revisión que no se consultaron en una hora.
3. Cancela los débitos sin autorizar después de 48 horas.
4. Procesa la cola de avisos.
5. Registra los cobros de débitos cuyo aviso se perdió (`reconcileActiveDebits`).
6. Borra las conexiones OAuth que nunca se completaron.

## Seguridad

- Sin contraseñas: solo OAuth, con `state` de un solo uso, PKCE y `redirect_uri` fija.
- Tokens cifrados con AES-256-GCM (`services/secretBox.service.ts`) y una clave propia, `MP_TOKEN_ENCRYPTION_KEY`, que vive en las variables del servidor y no en la base. Nunca van al frontend ni a los logs.
- Lista cerrada de operaciones (ver [Permisos usados](#permisos-usados)).
- Webhook con firma y, sobre todo, sin confiar nunca en el cuerpo.
- Aislamiento entre gimnasios:
  - `MercadoPagoAccount`, `CuotaPago` y `DebitoAutomatico` están en `TENANT_MODELS`.
  - Los servicios usan `systemPrisma` con `tenantId` explícito, porque los avisos llegan sin sesión.
  - Un pago se aplica solo si el collector es la cuenta de ese gimnasio y la referencia es de ese gimnasio.
- Roles:
  - Conectar, desconectar, ver avisos y cancelar débitos de otros: `ADMIN`.
  - Pagar, adherirse y darse de baja: `STUDENT`, solo sobre lo suyo.
- Límites de pedidos por IP en checkout, adhesión, verificación y conexión.
- PCI: el socio carga la tarjeta en Mercado Pago, nunca en Gymhour.
- Borrar un gimnasio borra solo los datos guardados en Gymhour (conexión, intentos y débitos), después de cancelar los débitos. La cuenta de Mercado Pago del gimnasio no se toca.

## Modelo de datos

| Tabla | Alcance | Para qué |
|---|---|---|
| `TenantSettings.recargo*` | Gimnasio | Configuración del recargo |
| `Cuota.recargo`, `Cuota.referenciaPago` | Gimnasio | Recargo cobrado y número de operación o de comprobante |
| `MercadoPagoAccount` | Gimnasio | Conexión: cuenta, tokens cifrados, vencimiento, estado |
| `MercadoPagoOAuthState` | Global | Conexiones OAuth en curso |
| `CuotaPago` | Gimnasio | Cada intento o cobro, con su estado, datos del pago y aviso |
| `MercadoPagoPendingNotification` | Global | Avisos en cola sin token utilizable |
| `DebitoAutomatico` | Gimnasio | Débito de cada socio |

Migraciones: `20261119000100_late_fee`, `20261119000200_mercadopago_payments` y `20261119000300_mercadopago_debits`. Son aditivas, así que se pueden aplicar antes del merge sin romper el código actual. El cliente Prisma de la rama espera las tres.

## Endpoints

| Método y ruta | Quién | Para qué |
|---|---|---|
| `GET /cuotas/:id/recargo?fechaPago=` | Admin | Recargo sugerido para el pago manual |
| `PUT /cuotas/:id/pay` | Admin | Ahora acepta `aplicarRecargo` y `referenciaPago`. `409` con un pago en curso o un débito. |
| `PATCH /tenant/settings` | Admin | Ahora acepta `recargoTipo`, `recargoValor`, `recargoTope` y `recargoDiasGracia` |
| `GET /pagos/mercadopago` | Admin | Estado de la conexión |
| `POST /pagos/mercadopago/conectar` | Admin, Pro | URL de autorización de Mercado Pago |
| `GET /pagos/mercadopago/oauth/callback` | Pública | Vuelta de Mercado Pago |
| `DELETE /pagos/mercadopago[?cancelarDebitos=true]` | Admin | Desconectar |
| `GET /pagos/avisos` · `POST /pagos/avisos/:id/revisado` | Admin | Avisos |
| `GET /pagos/debitos` · `POST /pagos/debitos/:id/cancelar` | Admin | Débitos de los socios |
| `POST /pagos/debitos/:id/verificar` | Admin | Actualiza el débito y registra los cobros que falten |
| `GET /pagos/mi-estado` | Socio | Si puede pagar online, su pago en curso y su débito |
| `POST /pagos/cuotas/:id/checkout` | Socio, Pro | Iniciar o retomar el pago de una cuota |
| `POST /pagos/intentos/:ref/verificar` | Socio (lo suyo) o admin | Verificar un pago |
| `POST /pagos/debito` · `/debito/verificar` · `/debito/cancelar` | Socio | Adherirse, verificar (autorización y cobros que falten) y darse de baja |
| `POST /pagos/webhooks/mercadopago` | Pública | Avisos de Mercado Pago |
| `GET /usuarios?debito=` | Admin | Filtro por débito (`ACTIVO`, `CON_RECHAZO`, `PENDIENTE`, `PAUSADO`, `NINGUNO`). Cada socio trae `debitoAutomatico`. |
| `GET /usuarios/stats` | Admin | Suma `debitosAutomaticos` (activos, con rechazo, pendientes) |

## Código

| Archivo | Qué tiene |
|---|---|
| `services/mercadoPago.service.ts` | Cliente con la lista cerrada, OAuth, normalización de pagos y firma de webhooks |
| `services/mercadoPagoAccount.service.ts` | Conexión, tokens cifrados, renovación, `ERROR` y cola |
| `services/memberPayments.service.ts` | Botón de pago, aplicación de pagos, bloqueos y avisos |
| `services/automaticDebit.service.ts` | Débito automático |
| `services/mercadoPagoWebhook.service.ts` | Avisos de Mercado Pago |
| `services/mercadoPagoMaintenance.service.ts` | Tarea diaria |
| `services/lateFee.service.ts` | Recargo por atraso |
| `services/secretBox.service.ts` | Cifrado AES-256-GCM, compartido con el MFA del backoffice |
| `controllers/mercadoPago.Controller.ts`, `routes/mercadoPago.Routes.ts` | Endpoints `/pagos` |
| Frontend `Components/MercadoPagoConnection` | Sección de Ajustes |
| Frontend `Pages/Alumno/Cuotas` (`Cuotas.jsx`, `AutomaticDebitCard.jsx`) | Botón de pago y débito del socio |
| Frontend `Pages/Admin/CuotasUsuarios` | Avisos, chips y bloqueos del admin |
| Frontend `Components/MemberDebitPanel`, `UsuariosList`, `AdminInicio` | Débito en la ficha, la lista y el inicio |

## Puesta en marcha

### 0. Cuenta de Mercado Pago de Gymhour

Es la dueña de las apps a las que se conectan los gimnasios. No recibe la plata de los gimnasios.

**Por ahora es la cuenta personal de Pedro,** con la verificación en dos pasos activada. El otro socio entra como colaborador, con su propio usuario y sin compartir la contraseña:

1. Mercado Pago Developers → Tu cuenta → Gestionar colaboradores → Crear rol.
2. El rol lleva solo los permisos de integraciones: Ver, Editar y Gestionar integraciones. No se usa el perfil "Administrador de la cuenta", que da acceso total. Tampoco se marca ninguno de los otros permisos del editor (cobros, dinero, ventas, colaboradores): la integración no los necesita.
3. Invitar colaborador, con su email y ese rol.

En noviembre de 2026, el editor de roles de la cuenta no mostraba los permisos de integraciones. Según la documentación, se definen en "Gestión y configuración" una vez configurados los permisos del rol. Si no aparecen, Pedro configura la app y comparte por el gestor de contraseñas el Client ID, el Client Secret, la clave de webhooks y las cuentas de prueba.

Según Mercado Pago, la función es para cuentas con una sola app o ninguna, así que el colaborador se invita antes de crear la app. Si la app de producción también va en esta cuenta, serían dos: hay que confirmar que el colaborador siga teniendo acceso.

**Antes de crear la app de producción** hay que decidir en qué cuenta va:

- Mercado Pago no documenta cómo pasar una app a otra cuenta. Cambiarla después sería una app nueva, y todos los gimnasios tendrían que reconectar.
- La comisión de Gymhour (`marketplace_fee`), cuando se sume, se acredita en la cuenta dueña de la app.
- Si esa cuenta se bloquea o se pierde su acceso, se cae la conexión de todos los gimnasios.
- Mercado Pago no tiene subcuentas. Una cuenta propia de Gymhour necesita una empresa con su CUIT.

### 1. Apps en Mercado Pago Developers

Tres apps (Tus integraciones → Crear aplicación, con Checkout Pro). Así el entorno test nunca tiene el Client Secret de producción.

| App | Cuenta dueña | Para qué | URL de webhooks, modo pruebas y modo producción |
|---|---|---|---|
| Gymhour Test | La cuenta real | Solo para crear las cuentas de prueba. No se conecta. | — |
| Gymhour Sandbox | Una cuenta de prueba tipo Integrador | Entorno test, con las cuentas de prueba | Las dos a la API de test |
| Gymhour | La cuenta real | Producción | Las dos a la API de producción |

Mercado Pago no deja conectar cuentas de prueba a una app de una cuenta real. Lo confirmamos el 23 de noviembre de 2026: con el Vendedor de prueba, la autorización respondió "Lo sentimos, la aplicación no puede conectarse a tu cuenta". Por eso la app del entorno test se crea dentro de la cuenta de prueba Integrador, entrando a Mercado Pago Developers con ella en una ventana privada. Odoo y otras integraciones lo resuelven igual.

En cada app que se conecta:

- **Al crearla:** solución Checkout Pro y, en "Tipo de API", **API de Preferences**. Gymhour crea los cobros con `/checkout/preferences` y no usa la API de Orders. Mercado Pago marca esa API como "será descontinuada pronto": ver "Pendiente antes de producción".
- **URL de redireccionamiento:** `https://<api>/pagos/mercadopago/oauth/callback`. Tiene que coincidir exactamente con `API_PUBLIC_URL`.
- **PKCE:** Detalles de aplicación → Editar → flujo de código de autorización con PKCE.
- **Permisos:** `read`, `write` y `offline_access`, si la pantalla los ofrece.
- **Webhooks:** Webhooks → Configurar notificaciones, a `https://<api>/pagos/webhooks/mercadopago`.
  - Eventos: Pagos, y Planes y suscripciones. Los demás tópicos se ignoran.
  - Al guardar se genera la clave secreta, que va en `MP_WEBHOOK_SECRET`.
  - Con "Simular notificación", la API tiene que responder 200. Un 401 indica que la clave no coincide.
- **Client ID y Client Secret:** están en la pestaña Producción de las credenciales, que hay que activar (rubro y sitio web) aunque la app sea de test. La pestaña Prueba solo tiene la Public Key y el Access Token de la cuenta de prueba automática. En las dos pestañas, la Public Key y el Access Token no se usan. El Access Token de Producción da acceso a la cuenta real dueña de la app: no se copia en ningún lado.
- **Cuentas de prueba,** creadas desde Gymhour Test:
  - Un Integrador, dueño de Gymhour Sandbox. Un Vendedor para el gimnasio y un Comprador para el socio. Todas de Argentina. La cuenta de prueba que Mercado Pago crea sola con la app no se usa.
  - Se entra con ellas en una ventana privada. Si piden un código por email, es el de 6 dígitos que muestra Mercado Pago Developers para esa cuenta.
  - El máximo es de 15 cuentas.

### 2. Variables de la API

| Variable | Qué es |
|---|---|
| `MP_CLIENT_ID` | Client ID de la app (de prueba o de producción) |
| `MP_CLIENT_SECRET` | Client secret de la app |
| `MP_TOKEN_ENCRYPTION_KEY` | 32 bytes en hex o base64 para cifrar los tokens. Generarla con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Si se pierde o cambia, todos los gimnasios tienen que reconectar. |
| `MP_WEBHOOK_SECRET` | Secreto de firma de los webhooks de la app |
| `API_PUBLIC_URL` | URL pública https de la API, sin barra final |
| `MP_TEST_MODE` | `false` o sin definir, también en el entorno test con Gymhour Sandbox. `true` solo para el flujo viejo de credenciales `TEST-`. Ver "Modo de prueba o real". |
| `MP_API_BASE_URL`, `MP_AUTH_BASE_URL` | Opcionales. Por defecto `https://api.mercadopago.com` y `https://auth.mercadopago.com`. |

Sin `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_TOKEN_ENCRYPTION_KEY` y `API_PUBLIC_URL`, la sección de Ajustes muestra "Todavía no disponible" y el cron no hace nada de Mercado Pago. El recargo funciona igual.

### 3. Migraciones

Aplicar las tres migraciones con `npx prisma migrate deploy`, primero en la base local y después en producción. En producción se aplican a mano, justo antes de mergear. Antes, confirmar a qué base apunta `DATABASE_URL`.

### 4. Entorno test en Railway

El entorno `test` es una copia de `production`. Railway copia los servicios, las variables y la configuración, pero no los datos: la base nueva arranca vacía. Las variables selladas no se copian.

1. **Base:** el `DATABASE_URL` de la API y del cron tiene que ser una referencia al MySQL del entorno test, como `${{MySQL.MYSQL_URL}}`. Nunca la URL pública de la base de producción.
2. **Rama:** Settings → Source → Branch = `feature-mercadopago`, en la API y en el cron.
3. **Variables distintas de producción:**
   - `JWT_SECRET`, `CRON_SECRET`, `PLATFORM_MFA_ENCRYPTION_KEY` y `MP_TOKEN_ENCRYPTION_KEY`: nuevas. Como los IDs se repiten, con el mismo `JWT_SECRET` una sesión de producción serviría en test.
   - Rebill: las claves de sandbox, o ninguna. La prueba gratuita ya incluye Mercado Pago.
   - Cloudinary: sin las tres variables, o con una cuenta aparte. Los IDs de gimnasio vuelven a empezar en 1 y las carpetas son `tenants/<id>/`. Subir archivos mezclaría las carpetas con las de producción, y borrar un gimnasio de test borraría la carpeta del gimnasio de producción con el mismo ID.
   - `FRONTEND_URL`: la URL de la rama en Vercel, sin barra final, porque CORS compara el origen exacto.
   - Las de Mercado Pago, de la app Gymhour Sandbox, con `MP_TEST_MODE=false`. El cron también las necesita.
   - SMTP queda igual: la base arranca vacía y solo se usan emails propios.
4. **Migraciones:** la base vacía necesita todas. Se aplican con `migrate deploy` desde la PC, con la URL pública del MySQL de test. Antes de aplicarlas, `migrate status` muestra el host.
5. **Frontend:** la vista previa de Vercel de la rama, con `REACT_APP_API_URL` apuntando a la API de test. Esa variable se configura para Preview y la rama `feature-mercadopago`. Se fija al compilar, así que después de cargarla hay que volver a desplegar la vista previa.

### 5. Prueba en sandbox

En el entorno test (o en local con un túnel), con la app Gymhour Sandbox, `MP_TEST_MODE=false` y las cuentas de prueba:

1. Conectar con el Vendedor de prueba, en una ventana privada. Funcionó el 23 de noviembre de 2026.
2. Configurar un recargo y verlo en una cuota vencida, en el pago manual y en el botón de pago.
3. Pagar una cuota con el comprador de prueba: queda pagada con su número de operación.
4. Probar un pago rechazado y un reintento.
5. Abandonar un checkout: a los 10 minutos se libera.
6. Intentar pagar otra cuota con un pago en curso: `409`.
7. Pagar el mismo checkout en dos pestañas: el segundo queda duplicado.
8. Devolver un pago desde Mercado Pago: la cuota vuelve a impaga.
9. Adherirse al débito y forzar un cobro: la cuota del período queda pagada.
10. Rechazar un cobro del débito: probar "Actualizar mi tarjeta" y "Pagar por otro medio".
11. Dar de baja el débito, y desconectar con débitos activos.

## Pendiente antes de producción

- [ ] **Botón de pago con la API de Orders.**
  - El 23 de noviembre de 2026, al crear la app, Mercado Pago marcaba la API de Preferences como "será descontinuada pronto".
  - La documentación dice que sigue con soporte, pero las novedades van solo a la API de Orders, que es la que recomienda para integraciones nuevas. No publicó una fecha de baja.
  - Migrar cambia la creación del checkout (`POST /v1/orders` en vez de `/checkout/preferences`), la consulta del pago (`GET /v1/orders/{id}`) y el tópico de los webhooks (`order`).
  - Suma rutas a la lista cerrada de permisos, así que hay que decidirlo antes de programarlo.
  - Confirmar si la API de Suscripciones, que usa el débito automático, también tiene fecha de retiro.

## A confirmar en sandbox

Puntos de la documentación de Mercado Pago que hay que verificar con la primera prueba. Si alguno da distinto, se ajusta el código y esta sección.

- [x] Dominio de autorización y PKCE. `https://auth.mercadopago.com` redirige a `auth.mercadopago.com.ar`, y la conexión con PKCE (S256) funcionó el 23 de noviembre de 2026. `MP_AUTH_BASE_URL` no hace falta.
- [x] Con la app de prueba dentro de la cuenta Integrador, la conexión funciona con `MP_TEST_MODE=false`: sin `test_token` y con un token productivo de la cuenta de prueba (23 de noviembre de 2026). Así lo hacen también Odoo y la guía de marketplace de next-mercadopago.
- [ ] A qué URL de webhooks llegan los avisos de las cuentas de prueba vinculadas: la de modo pruebas o la de producción. La documentación dice que el modo pruebas es para las credenciales de prueba del dueño de la app. Por eso la app de test apunta las dos a la API de test.
- [ ] Que la renovación devuelva un refresh token nuevo.
- [ ] Firma de los avisos de la `notification_url`.
  - El 23 de noviembre de 2026 llegaron con `x-signature`.
  - En el segundo pago, todos los avisos `payment` dieron `401`, tanto los de formato Webhooks como los IPN. Lo más probable es que `MP_WEBHOOK_SECRET` no sea la clave de Gymhour Sandbox.
  - Falta confirmarlo con "Simular notificación" y verificar que los avisos de un pago nuevo respondan `200`.
  - Mientras el webhook falle, la cuota se confirma por la verificación del socio al volver o con "Ya pagué, verificar".
- [x] Checkout con `init_point` y pago del Comprador de prueba con dinero en cuenta: la cuota quedó pagada para el socio y para el admin (23 de noviembre de 2026).
- [ ] Si los webhooks de la app llegan para las cuentas vinculadas, con `user_id`, y el formato de los tópicos de suscripciones.
- [ ] Que el checkout no acepte pagos después de `expiration_date_to`.
- [ ] Que `auto_return` y `back_url` acepten la URL del frontend.
- [ ] Que los pagos de una suscripción lleven la referencia del débito (`external_reference`). De eso depende la conciliación de cobros perdidos. Si no la llevan, la alternativa es `GET /authorized_payments/search?preapproval_id=`, una lectura más que habría que sumar a la lista cerrada (decisión de permisos).
- [ ] Suscripciones:
  - La regla del email del pagador.
  - Cómo forzar cobros en sandbox.
  - La baja automática después de 3 cuotas rechazadas en Argentina.
  - Que cancelar frene los reintentos.
  - Cómo se le notifica al socio un cambio de monto.
- [ ] La ruta exacta en la cuenta de Mercado Pago para revocar la autorización, para la pantalla de Ajustes.

## Tests

Con Prisma y Mercado Pago simulados, archivo por archivo:

| Archivo | Cubre |
|---|---|
| `test/lateFee.test.ts` | Cálculo del recargo, validación de Ajustes, pago manual con y sin recargo, bloqueo por pago online |
| `test/mercadoPagoClient.test.ts` | Lista cerrada de rutas, errores sin tokens, URL de autorización, PKCE, normalización de pagos y firma de webhooks |
| `test/mercadoPagoAccount.test.ts` | `state` de un solo uso y con vencimiento, PKCE, tokens cifrados, modo de prueba, cambio de cuenta, renovación y `ERROR` |
| `test/memberPayments.test.ts` | Checkout, bloqueos, aplicación idempotente, `REVISAR`, `DUPLICADO`, devoluciones, contracargos, vencimiento y avisos |
| `test/automaticDebit.test.ts` | Frecuencia, primer cobro, adhesión, cobros, rechazos, baja con confirmación de Mercado Pago, cambios de plan y conciliación de cobros perdidos |
| `test/mercadoPagoWebhook.test.ts` | A qué gimnasio va cada aviso, tópicos, cola, firma en los formatos Webhooks e IPN y respuestas del endpoint |

`test/helpers/fakePrisma.ts` es una base en memoria para estos tests. En el frontend:

- `Pages/Alumno/Cuotas/Cuotas.test.jsx`.
- `Components/MercadoPagoConnection/MercadoPagoConnection.test.jsx`.
- `utils/lateFee.test.js`.
