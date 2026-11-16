ALTER TABLE `Tenant` ADD COLUMN `billingGraceUntil` DATETIME(3) NULL;

ALTER TABLE `TenantBillingOrder`
  ADD COLUMN `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN `cancelReason` VARCHAR(255) NULL,
  ADD COLUMN `pausedBySuspensionAt` DATETIME(3) NULL;
