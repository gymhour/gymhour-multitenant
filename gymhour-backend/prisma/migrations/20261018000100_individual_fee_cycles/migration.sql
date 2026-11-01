ALTER TABLE `User`
  ADD COLUMN `fechaInicioCobro` DATETIME(3) NULL,
  ADD COLUMN `proximoInicioCuota` DATETIME(3) NULL,
  ADD COLUMN `diaAnclaCobro` INTEGER NULL,
  ADD COLUMN `cobroAutomaticoActivo` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX `User_fee_cycle_due_idx`
  ON `User`(`tenantId`, `role`, `estado`, `cobroAutomaticoActivo`, `proximoInicioCuota`);

CREATE UNIQUE INDEX `Cuota_tenantId_ID_Usuario_fechaInicio_key`
  ON `Cuota`(`tenantId`, `ID_Usuario`, `fechaInicio`);

ALTER TABLE `Cuota` ADD COLUMN `recordatorioVenceEnviado` DATETIME(3) NULL;
