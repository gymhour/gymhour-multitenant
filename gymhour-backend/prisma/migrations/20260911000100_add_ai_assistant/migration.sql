ALTER TABLE `TenantSettings`
    ADD COLUMN `aiEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `aiMonthlyTokenLimit` INTEGER NOT NULL DEFAULT 2000000;

CREATE TABLE `AiConversation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` INTEGER NOT NULL DEFAULT 0,
    `userId` INTEGER NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT 'Nueva conversación',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AiConversation_tenantId_id_key`(`tenantId`, `id`),
    INDEX `AiConversation_tenantId_userId_updatedAt_idx`(`tenantId`, `userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AiMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` INTEGER NOT NULL DEFAULT 0,
    `conversationId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `role` ENUM('USER', 'ASSISTANT') NOT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'COMPLETED',
    `kind` ENUM('TEXT', 'ROUTINE_DRAFT') NOT NULL DEFAULT 'TEXT',
    `content` TEXT NOT NULL,
    `metadata` JSON NULL,
    `model` VARCHAR(100) NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AiMessage_tenantId_id_key`(`tenantId`, `id`),
    INDEX `AiMessage_tenantId_conversationId_createdAt_idx`(`tenantId`, `conversationId`, `createdAt`),
    INDEX `AiMessage_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AiConversation`
    ADD CONSTRAINT `AiConversation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `AiConversation_tenantId_userId_fkey` FOREIGN KEY (`tenantId`, `userId`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AiMessage`
    ADD CONSTRAINT `AiMessage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `AiMessage_tenantId_conversationId_fkey` FOREIGN KEY (`tenantId`, `conversationId`) REFERENCES `AiConversation`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `AiMessage_tenantId_userId_fkey` FOREIGN KEY (`tenantId`, `userId`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;
