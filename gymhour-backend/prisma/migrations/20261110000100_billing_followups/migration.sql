ALTER TABLE `TenantBillingOrder`
  ADD COLUMN `cancelledBy` VARCHAR(191) NULL,
  ADD COLUMN `failureNotifiedUntil` DATETIME(3) NULL;

CREATE TABLE `RebillUnlinkedPayment` (
  `id` VARCHAR(191) NOT NULL,
  `paymentId` VARCHAR(100) NOT NULL,
  `subscriptionId` VARCHAR(100) NOT NULL,
  `customerEmail` VARCHAR(191) NULL,
  `amountArs` INTEGER NOT NULL,
  `currency` VARCHAR(10) NOT NULL,
  `paidAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `linkedAt` DATETIME(3) NULL,
  `linkedOrderId` VARCHAR(191) NULL,
  `linkedBy` VARCHAR(191) NULL,

  UNIQUE INDEX `RebillUnlinkedPayment_paymentId_key`(`paymentId`),
  INDEX `RebillUnlinkedPayment_linkedAt_createdAt_idx`(`linkedAt`, `createdAt`),
  INDEX `RebillUnlinkedPayment_subscriptionId_idx`(`subscriptionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
