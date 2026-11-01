CREATE TABLE `TenantBillingOrder` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` INTEGER NOT NULL,
  `planCode` VARCHAR(64) NOT NULL,
  `amountArs` INTEGER NOT NULL,
  `months` INTEGER NOT NULL,
  `method` ENUM('TRANSFER', 'CARD') NOT NULL,
  `status` ENUM('PENDING', 'PAID', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `rebillPaymentId` VARCHAR(100) NULL,
  `rebillSubscriptionId` VARCHAR(100) NULL,
  `rebillSubscriptionStatus` VARCHAR(40) NULL,
  `paidAt` DATETIME(3) NULL,
  `paidUntil` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TenantBillingOrder_rebillPaymentId_key`(`rebillPaymentId`),
  UNIQUE INDEX `TenantBillingOrder_rebillSubscriptionId_key`(`rebillSubscriptionId`),
  INDEX `TenantBillingOrder_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TenantBillingOrder_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RebillWebhookEvent` (
  `logId` VARCHAR(100) NOT NULL,
  `event` VARCHAR(80) NOT NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`logId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RebillProcessedPayment` (
  `paymentId` VARCHAR(100) NOT NULL,
  `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`paymentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
