# Suscripción de Gymhour

## Recorrido

1. El gimnasio se registra y recibe 14 días de prueba.
2. Al vencer, el administrador ve el catálogo calculado según sus alumnos activos y elige duración y medio de pago.
3. Tarjeta: el checkout de Rebill crea una suscripción recurrente. Gymhour confirma el primer pago contra la API de Rebill y guarda el vencimiento. Los pagos automáticos posteriores llegan por webhook firmado y extienden el acceso una sola vez por pago.
4. Transferencia: Rebill muestra un QR para un pago único. Gymhour verifica la acreditación con la API de Rebill y el webhook. Al vencer, reaparece el modal para iniciar otro pago.

## Configuración requerida

- Aplicar las migraciones de Prisma antes de desplegar el backend.
- Definir `REBILL_PUBLIC_KEY` y `REBILL_SECRET_KEY` en el backend. La clave secreta nunca debe ir al frontend. No hay que cargar planes ni configurar IDs manualmente: Gymhour busca el plan correspondiente en Rebill y lo crea automáticamente si falta. El checkout con tarjeta usa `plan-id` para crear una suscripción recurrente.
- Para renovaciones automáticas y acreditaciones de transferencias sin la página abierta, crear un webhook HTTPS en Rebill para `payment.created`, `payment.updated` y `subscription.updated`, apuntando a `/billing/webhooks/rebill`. Guardar el secreto de firma completo en `REBILL_SIGNING_SECRET`.
- Si se usa un dominio de API distinto, configurar `REBILL_API_BASE_URL`; el valor por defecto es `https://api.rebill.com`.

El checkout con tarjeta está disponible para todas las duraciones del catálogo cuando las claves de Rebill están configuradas. Cada plan se prepara al seleccionarlo por primera vez; los que ya existen con el nombre, precio y frecuencia esperados se reutilizan. La transferencia usa un producto instantáneo de Rebill y no necesita datos bancarios en Gymhour. Los gimnasios con más de 1000 alumnos ven la opción de contacto comercial.

## Primera prueba local

Iniciá backend y frontend en `localhost:3000` y `localhost:3001`, entrá como administrador de un gimnasio cuya prueba haya vencido y tenga hasta 100 alumnos activos, elegí **Mensual → Tarjeta** y completá el checkout con una [tarjeta de prueba argentina de Rebill](https://docs.rebill.com/sdk/test-payment-methods). Usá el mismo email de la cuenta Gymhour. Tras un pago aprobado, el modal debe desaparecer y el acceso figurar como pago.

Para probar transferencia, elegí **Mensual → Transferencia**. Rebill debe mostrar el QR. El acceso debe permanecer bloqueado hasta que el pago figure como aprobado. La confirmación manual en el modal consulta el estado en Rebill. Para acreditar el pago aunque el navegador esté cerrado, hace falta configurar el webhook firmado.

## Verificación antes de producción

- Ejecutar un pago sandbox con tarjeta y comprobar el primer desbloqueo, la renovación por webhook, la repetición del mismo webhook y el bloqueo al vencer un período no renovado.
- Registrar una transferencia sandbox y comprobar que Rebill la acredite antes de habilitar acceso, y que el vencimiento vuelva a mostrar el modal.
- Verificar que el importe y la frecuencia de la suscripción creada por el plan de Rebill coinciden con la orden del backend. Gymhour rechaza pagos cuyo importe, frecuencia, suscripción o email de comprador no correspondan.

Documentación: [planes](https://docs.rebill.com/api/reference/plans), [checkout](https://docs.rebill.com/sdk/checkout), [webhooks](https://docs.rebill.com/guides/webhooks).
