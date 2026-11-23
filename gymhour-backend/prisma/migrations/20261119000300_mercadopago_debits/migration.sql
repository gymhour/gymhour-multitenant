-- Etapa 3 de cobros a socios: débito automático con suscripciones de Mercado Pago.
-- Solo crea una tabla nueva: no cambia datos existentes.

CREATE TABLE `DebitoAutomatico` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` INTEGER NOT NULL,
  `ID_Usuario` INTEGER NOT NULL,
  `ID_Plan` INTEGER NULL,
  `preapprovalId` VARCHAR(64) NULL,
  `externalReference` VARCHAR(64) NOT NULL,
  `activeKey` VARCHAR(64) NULL,
  `status` VARCHAR(20) NOT NULL,
  `payerEmail` VARCHAR(191) NOT NULL,
  `amount` DOUBLE NOT NULL,
  `frequency` INTEGER NOT NULL,
  `frequencyType` VARCHAR(10) NOT NULL,
  `startDate` DATETIME(3) NOT NULL,
  `nextChargeDate` DATETIME(3) NULL,
  `initPoint` VARCHAR(1000) NULL,
  `lastChargeStatus` VARCHAR(40) NULL,
  `lastChargeAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelledBy` VARCHAR(191) NULL,
  `cancelReason` VARCHAR(255) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `DebitoAutomatico_preapprovalId_key`(`preapprovalId`),
  UNIQUE INDEX `DebitoAutomatico_externalReference_key`(`externalReference`),
  UNIQUE INDEX `DebitoAutomatico_activeKey_key`(`activeKey`),
  INDEX `DebitoAutomatico_tenantId_ID_Usuario_idx`(`tenantId`, `ID_Usuario`),
  INDEX `DebitoAutomatico_tenantId_status_idx`(`tenantId`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DebitoAutomatico_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
