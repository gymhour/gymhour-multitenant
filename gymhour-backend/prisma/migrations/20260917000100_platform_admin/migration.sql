ALTER TABLE `Tenant`
    ADD COLUMN `lastActivityAt` DATETIME(3) NULL,
    ADD COLUMN `suspendedAt` DATETIME(3) NULL,
    ADD COLUMN `suspensionReason` VARCHAR(500) NULL;

ALTER TABLE `PlatformUser`
    ADD COLUMN `mfaSecretEncrypted` TEXT NULL,
    ADD COLUMN `mfaEnabledAt` DATETIME(3) NULL,
    ADD COLUMN `mfaLastUsedStep` BIGINT NULL,
    ADD COLUMN `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lockedUntil` DATETIME(3) NULL,
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
    ADD COLUMN `passwordChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE TABLE `PlatformSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `platformUserId` INTEGER NOT NULL,
    `authVersion` INTEGER NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `csrfHash` CHAR(64) NOT NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(500) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PlatformSession_tokenHash_key`(`tokenHash`),
    INDEX `PlatformSession_platformUserId_expiresAt_idx`(`platformUserId`, `expiresAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PlatformSession_platformUserId_fkey` FOREIGN KEY (`platformUserId`) REFERENCES `PlatformUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformAuthChallenge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `platformUserId` INTEGER NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PlatformAuthChallenge_tokenHash_key`(`tokenHash`),
    INDEX `PlatformAuthChallenge_platformUserId_expiresAt_idx`(`platformUserId`, `expiresAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PlatformAuthChallenge_platformUserId_fkey` FOREIGN KEY (`platformUserId`) REFERENCES `PlatformUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformRecoveryCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `platformUserId` INTEGER NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PlatformRecoveryCode_codeHash_key`(`codeHash`),
    INDEX `PlatformRecoveryCode_platformUserId_usedAt_idx`(`platformUserId`, `usedAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PlatformRecoveryCode_platformUserId_fkey` FOREIGN KEY (`platformUserId`) REFERENCES `PlatformUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformAuditLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `platformUserId` INTEGER NULL,
    `platformUserEmail` VARCHAR(191) NULL,
    `action` VARCHAR(80) NOT NULL,
    `targetTenantId` INTEGER NULL,
    `targetTenantSlug` VARCHAR(50) NULL,
    `outcome` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(500) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `PlatformAuditLog_createdAt_idx`(`createdAt`),
    INDEX `PlatformAuditLog_targetTenantId_createdAt_idx`(`targetTenantId`, `createdAt`),
    INDEX `PlatformAuditLog_action_outcome_createdAt_idx`(`action`, `outcome`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantDeletionJob` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantIdSnapshot` INTEGER NOT NULL,
    `tenantSlugSnapshot` VARCHAR(50) NOT NULL,
    `tenantNameSnapshot` VARCHAR(191) NOT NULL,
    `initiatedByUserId` INTEGER NOT NULL,
    `initiatedByEmail` VARCHAR(191) NOT NULL,
    `assetManifest` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `databaseDeletedAt` DATETIME(3) NULL,
    `mediaDeletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `TenantDeletionJob_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `TenantDeletionJob_tenantIdSnapshot_idx`(`tenantIdSnapshot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
