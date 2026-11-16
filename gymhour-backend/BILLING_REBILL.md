# Suscripción de Gymhour

## Recorrido

1. El gimnasio se registra y recibe 14 días de prueba.
2. Al vencer, el administrador ve el catálogo calculado según sus alumnos activos y elige plan y medio de pago.
3. Tarjeta: el checkout de Rebill crea una suscripción recurrente. Gymhour confirma el primer pago contra la API de Rebill y guarda el vencimiento. Los pagos automáticos posteriores llegan por webhook firmado y extienden el acceso una sola vez por pago.
4. Transferencia: Rebill muestra un QR para un pago único y avisa al navegador antes de que exista el pago. Gymhour busca el pago en la API de Rebill por la orden (`metadata.gymhourOrderId`), cada 15 segundos durante 10 minutos o cuando el administrador lo pide, y el webhook también lo acredita. Al vencer, reaparece el modal para iniciar otro pago.

## Tarjeta rechazada

Rebill reintenta el cobro 4 veces en 10 días (`retrying`) y después pausa la suscripción (`paused`). Gymhour mantiene el acceso 48 horas desde el vencimiento (`Tenant.billingGraceUntil`) y luego lo bloquea, aunque Rebill siga reintentando. Si un reintento se aprueba, el acceso se extiende por webhook.

Durante la tolerancia y después del bloqueo, Mi suscripción ofrece dos salidas:

- **Cambiar tarjeta:** abre la página segura de Rebill. Cuando llega `subscription.updated` con `cardUpdated` y el acceso está vencido, Gymhour reactiva el cobro con `nextChargeDate` = hoy.
- **Pagar de otra forma:** cancela la suscripción anterior y sigue el checkout normal, para que no queden dos débitos.

## Cancelación y suspensión

- El administrador cancela desde Mi suscripción y el backoffice desde el detalle del gimnasio, con motivo. El acceso sigue hasta el vencimiento y no hay más débitos. La cancelación en Rebill es definitiva.
- Eliminar un gimnasio cancela la suscripción. Si Rebill falla, no se elimina nada.
- Suspender un gimnasio pausa el débito, y reactivarlo retoma solo lo que pausó la suspensión. Si Rebill falla, el estado no cambia.
- La orden guarda quién canceló (`cancelledBy`), y el backoffice lo muestra.

## Mails

Gymhour avisa a los administradores del gimnasio cuando se confirma una compra, se cobra una renovación, falla el cobro de la tarjeta (una vez por período), Rebill pausa la suscripción por falta de pago y se cancela la suscripción. Rebill manda además su propio recibo de cada pago.

## Configuración requerida

- Aplicar las migraciones de Prisma antes de desplegar el backend.
- Definir `REBILL_PUBLIC_KEY` y `REBILL_SECRET_KEY` en el backend. La clave secreta nunca debe ir al frontend. No hay que cargar planes ni configurar IDs manualmente: Gymhour busca el plan correspondiente en Rebill y lo crea automáticamente si falta. El checkout con tarjeta usa `plan-id` para crear una suscripción recurrente.
- Para renovaciones automáticas y acreditaciones de transferencias sin la página abierta, crear un webhook HTTPS en Rebill para `payment.created`, `payment.updated` y `subscription.updated`, apuntando a `/billing/webhooks/rebill`. Guardar el secreto de firma completo en `REBILL_SIGNING_SECRET`.
- Si se usa un dominio de API distinto, configurar `REBILL_API_BASE_URL`; el valor por defecto es `https://api.rebill.com`.

El checkout con tarjeta está disponible para los planes mensuales del catálogo cuando las claves de Rebill están configuradas. Cada plan se prepara al seleccionarlo por primera vez; los que ya existen con el nombre, precio y frecuencia esperados se reutilizan. La transferencia usa un producto instantáneo de Rebill y no necesita datos bancarios en Gymhour. Los gimnasios con más de 200 alumnos ven la opción de contacto comercial.

## Primera prueba local

Iniciá backend y frontend en `localhost:3000` y `localhost:3001`, entrá como administrador de un gimnasio cuya prueba haya vencido y tenga hasta 100 alumnos activos, elegí **Mensual → Tarjeta** y completá el checkout con una [tarjeta de prueba argentina de Rebill](https://docs.rebill.com/sdk/test-payment-methods). Usá el mismo email de la cuenta Gymhour. Tras un pago aprobado, el modal debe desaparecer y el acceso figurar como pago.

Para probar transferencia, elegí **Mensual → Transferencia**. Rebill debe mostrar el QR. El acceso debe permanecer bloqueado hasta que el pago figure como aprobado. La confirmación manual en el modal consulta el estado en Rebill. Para acreditar el pago aunque el navegador esté cerrado, hace falta configurar el webhook firmado.

## Verificación antes de producción

- Ejecutar un pago sandbox con tarjeta y comprobar el primer desbloqueo, la renovación por webhook, la repetición del mismo webhook y el bloqueo al vencer un período no renovado.
- Registrar una transferencia sandbox y comprobar que Rebill la acredite antes de habilitar acceso, y que el vencimiento vuelva a mostrar el modal.
- Verificar que el importe y la frecuencia de la suscripción creada por el plan de Rebill coinciden con la orden del backend. Gymhour rechaza pagos cuyo importe, frecuencia, suscripción o email de comprador no correspondan.
- Rechazar un cobro con tarjeta y comprobar las 48 horas de acceso, el bloqueo, el cambio de tarjeta con cobro inmediato y la compra de reemplazo sin doble suscripción.
- Cancelar como administrador y desde el backoffice, suspender y reactivar, y eliminar un gimnasio con suscripción activa.
- Pagar con tarjeta sin dejar que el navegador confirme, y vincular el pago desde "Pagos sin vincular" en el backoffice.

## Pagos sin vincular

Un primer pago con tarjeta se vincula solo si el navegador completa `confirm-card`. Si se cierra antes, el webhook guarda el pago en `RebillUnlinkedPayment` y el backoffice lo muestra en "Pagos sin vincular", con la orden sugerida. Un operador lo vincula con motivo y MFA, y Rebill vuelve a validar el pago contra esa orden. Mientras tanto, el gimnasio sigue bloqueado y el administrador ve un aviso para no pagar de nuevo. Ver `DOCUMENTACION_BASE.md`, sección 7.

Documentación: [planes](https://docs.rebill.com/api/reference/plans), [checkout](https://docs.rebill.com/sdk/checkout), [webhooks](https://docs.rebill.com/guides/webhooks).
