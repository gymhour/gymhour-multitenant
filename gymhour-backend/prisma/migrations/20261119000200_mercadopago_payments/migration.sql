-- Etapa 2 de cobros a socios: conexión con Mercado Pago y botón de pago.
-- Solo crea tablas nuevas: no cambia datos existentes.

CREATE TABLE `MercadoPagoAccount` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` INTEGER NOT NULL,
  `mpUserId` VARCHAR(40) NOT NULL,
  `nickname` VARCHAR(191) NULL,
  `accessTokenEnc` TEXT NOT NULL,
  `refreshTokenEnc` TEXT NULL,
  `tokenExpiresAt` DATETIME(3) NULL,
  `lastRefreshAt` DATETIME(3) NULL,
  `liveMode` BOOLEAN NOT NULL DEFAULT false,
  `status` VARCHAR(20) NOT NULL DEFAULT 'CONNECTED',
  `lastError` VARCHAR(255) NULL,
  `connectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `connectedByUserId` INTEGER NULL,
  `reconnectNotifiedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `MercadoPagoAccount_tenantId_key`(`tenantId`),
  INDEX `MercadoPagoAccount_mpUserId_idx`(`mpUserId`),
  INDEX `MercadoPagoAccount_status_tokenExpiresAt_idx`(`status`, `tokenExpiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MercadoPagoAccount_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MercadoPagoOAuthState` (
  `id` VARCHAR(191) NOT NULL,
  `stateHash` VARCHAR(64) NOT NULL,
  `tenantId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `codeVerifierEnc` TEXT NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `MercadoPagoOAuthState_stateHash_key`(`stateHash`),
  INDEX `MercadoPagoOAuthState_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CuotaPago` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` INTEGER NOT NULL,
  `ID_Cuota` INTEGER NOT NULL,
  `ID_Usuario` INTEGER NOT NULL,
  `origen` VARCHAR(20) NOT NULL DEFAULT 'CHECKOUT',
  `debitoId` VARCHAR(191) NULL,
  `status` VARCHAR(20) NOT NULL,
  `externalReference` VARCHAR(64) NOT NULL,
  `preferenceId` VARCHAR(191) NULL,
  `initPoint` VARCHAR(1000) NULL,
  `expiresAt` DATETIME(3) NULL,
  `lockKey` VARCHAR(64) NULL,
  `amount` DOUBLE NOT NULL,
  `recargo` DOUBLE NOT NULL DEFAULT 0,
  `mpPaymentId` VARCHAR(40) NULL,
  `mpMerchantOrderId` VARCHAR(40) NULL,
  `mpStatus` VARCHAR(40) NULL,
  `mpStatusDetail` VARCHAR(80) NULL,
  `paymentMethod` VARCHAR(80) NULL,
  `netAmount` DOUBLE NULL,
  `payerEmail` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `checkedAt` DATETIME(3) NULL,
  `reviewNote` VARCHAR(255) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewedByUserId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CuotaPago_externalReference_key`(`externalReference`),
  UNIQUE INDEX `CuotaPago_lockKey_key`(`lockKey`),
  UNIQUE INDEX `CuotaPago_mpPaymentId_key`(`mpPaymentId`),
  INDEX `CuotaPago_tenantId_ID_Cuota_idx`(`tenantId`, `ID_Cuota`),
  INDEX `CuotaPago_tenantId_ID_Usuario_status_idx`(`tenantId`, `ID_Usuario`, `status`),
  INDEX `CuotaPago_tenantId_status_reviewedAt_idx`(`tenantId`, `status`, `reviewedAt`),
  INDEX `CuotaPago_status_expiresAt_idx`(`status`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `CuotaPago_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MercadoPagoPendingNotification` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` INTEGER NOT NULL,
  `topic` VARCHAR(60) NOT NULL,
  `resourceId` VARCHAR(64) NOT NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processedAt` DATETIME(3) NULL,
  INDEX `MercadoPagoPendingNotification_tenantId_processedAt_idx`(`tenantId`, `processedAt`),
  UNIQUE INDEX `MercadoPagoPendingNotification_topic_resourceId_key`(`topic`, `resourceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
