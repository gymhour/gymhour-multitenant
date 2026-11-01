ALTER TABLE `User`
  ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `emailVerificationHash` VARCHAR(191) NULL,
  ADD COLUMN `emailVerificationExpiry` DATETIME(3) NULL;

CREATE UNIQUE INDEX `User_emailVerificationHash_key` ON `User`(`emailVerificationHash`);
