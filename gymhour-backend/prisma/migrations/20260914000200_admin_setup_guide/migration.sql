ALTER TABLE `TenantSettings`
  ADD COLUMN `setupGuideCompletedAt` DATETIME(3) NULL;

ALTER TABLE `User`
  ADD COLUMN `setupGuideDismissedAt` DATETIME(3) NULL;
