ALTER TABLE `TenantBillingOrder`
  ADD COLUMN `rebillLatestPaymentId` VARCHAR(100) NULL,
  ADD COLUMN `currentPeriodStart` DATETIME(3) NULL,
  ADD COLUMN `creditUsedArs` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `Tenant` ADD COLUMN `billingCreditArs` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `TenantPlanChange` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` INTEGER NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `fromPlanCode` VARCHAR(64) NOT NULL,
  `toPlanCode` VARCHAR(64) NOT NULL,
  `amountArs` INTEGER NOT NULL,
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `status` ENUM('PENDING', 'PAYMENT_CONFIRMED', 'APPLIED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `rebillPaymentId` VARCHAR(100) NULL,
  `rebillRefundId` VARCHAR(100) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `appliedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `TenantPlanChange_rebillPaymentId_key` (`rebillPaymentId`),
  UNIQUE INDEX `TenantPlanChange_tenantId_orderId_periodStart_periodEnd_key` (`tenantId`, `orderId`, `periodStart`, `periodEnd`),
  INDEX `TenantPlanChange_tenantId_createdAt_idx` (`tenantId`, `createdAt`),
  CONSTRAINT `TenantPlanChange_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
