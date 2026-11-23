-- Etapa 1 de cobros a socios: recargo por pago fuera de término y referencia del pago.
-- Solo agrega columnas con valor por defecto: no cambia datos existentes.

ALTER TABLE `TenantSettings`
  ADD COLUMN `recargoTipo` VARCHAR(20) NOT NULL DEFAULT 'NINGUNO',
  ADD COLUMN `recargoValor` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `recargoTope` DOUBLE NULL,
  ADD COLUMN `recargoDiasGracia` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `Cuota`
  ADD COLUMN `recargo` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `referenciaPago` VARCHAR(100) NULL;
