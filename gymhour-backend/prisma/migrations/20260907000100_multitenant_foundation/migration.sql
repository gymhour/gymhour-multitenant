-- Gymhour multi-tenant: expand -> backfill -> constrain.
-- This migration assumes the legacy database contains one gym, as documented.
SET FOREIGN_KEY_CHECKS=1;

-- DropForeignKey
ALTER TABLE `User` DROP FOREIGN KEY `User_ID_Plan_fkey`;

-- DropForeignKey
ALTER TABLE `Cuota` DROP FOREIGN KEY `Cuota_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `Cuota` DROP FOREIGN KEY `Cuota_ID_Plan_fkey`;

-- DropForeignKey
ALTER TABLE `ContactoAlumno` DROP FOREIGN KEY `ContactoAlumno_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `MovimientoSocio` DROP FOREIGN KEY `MovimientoSocio_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `Turno` DROP FOREIGN KEY `Turno_ID_HorarioClase_fkey`;

-- DropForeignKey
ALTER TABLE `Turno` DROP FOREIGN KEY `Turno_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `Turno` DROP FOREIGN KEY `Turno_ID_Cuota_fkey`;

-- DropForeignKey
ALTER TABLE `TurnoFijo` DROP FOREIGN KEY `TurnoFijo_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `TurnoFijo` DROP FOREIGN KEY `TurnoFijo_ID_HorarioClase_fkey`;

-- DropForeignKey
ALTER TABLE `HorarioClase` DROP FOREIGN KEY `HorarioClase_ID_Clase_fkey`;

-- DropForeignKey
ALTER TABLE `Rutina` DROP FOREIGN KEY `Rutina_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `Rutina` DROP FOREIGN KEY `Rutina_ID_Entrenador_fkey`;

-- DropForeignKey
ALTER TABLE `GrupoUsuarioMiembro` DROP FOREIGN KEY `GrupoUsuarioMiembro_ID_GrupoUsuario_fkey`;

-- DropForeignKey
ALTER TABLE `GrupoUsuarioMiembro` DROP FOREIGN KEY `GrupoUsuarioMiembro_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `RutinaAsignacionUsuario` DROP FOREIGN KEY `RutinaAsignacionUsuario_ID_Rutina_fkey`;

-- DropForeignKey
ALTER TABLE `RutinaAsignacionUsuario` DROP FOREIGN KEY `RutinaAsignacionUsuario_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `RutinaAsignacionGrupo` DROP FOREIGN KEY `RutinaAsignacionGrupo_ID_Rutina_fkey`;

-- DropForeignKey
ALTER TABLE `RutinaAsignacionGrupo` DROP FOREIGN KEY `RutinaAsignacionGrupo_ID_GrupoUsuario_fkey`;

-- DropForeignKey
ALTER TABLE `RutinaDia` DROP FOREIGN KEY `RutinaDia_rutinaId_fkey`;

-- DropForeignKey
ALTER TABLE `RutinaDia` DROP FOREIGN KEY `RutinaDia_rutinaSemanaId_fkey`;

-- DropForeignKey
ALTER TABLE `Semana` DROP FOREIGN KEY `Semana_rutinaId_fkey`;

-- DropForeignKey
ALTER TABLE `Bloque` DROP FOREIGN KEY `Bloque_ID_Rutina_fkey`;

-- DropForeignKey
ALTER TABLE `Bloque` DROP FOREIGN KEY `Bloque_rutinaDiaId_fkey`;

-- DropForeignKey
ALTER TABLE `BloqueEjercicio` DROP FOREIGN KEY `BloqueEjercicio_ID_Bloque_fkey`;

-- DropForeignKey
ALTER TABLE `BloqueEjercicio` DROP FOREIGN KEY `BloqueEjercicio_ID_Ejercicio_fkey`;

-- DropForeignKey
ALTER TABLE `EjercicioMedicion` DROP FOREIGN KEY `EjercicioMedicion_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `HistoricoEjercicio` DROP FOREIGN KEY `HistoricoEjercicio_ID_EjercicioMedicion_fkey`;

-- DropForeignKey
ALTER TABLE `Asistencia` DROP FOREIGN KEY `Asistencia_ID_Usuario_fkey`;

-- DropForeignKey
ALTER TABLE `Asistencia` DROP FOREIGN KEY `Asistencia_ID_Turno_fkey`;

-- DropForeignKey
ALTER TABLE `Asistencia` DROP FOREIGN KEY `Asistencia_ID_Cuota_fkey`;

-- DropForeignKey
ALTER TABLE `_EntrenadoresClases` DROP FOREIGN KEY `_EntrenadoresClases_A_fkey`;

-- DropForeignKey
ALTER TABLE `_EntrenadoresClases` DROP FOREIGN KEY `_EntrenadoresClases_B_fkey`;

-- CreateTable
CREATE TABLE `Tenant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `Tenant_slug_key` (`slug`),
    KEY `Tenant_status_createdAt_idx` (`status`, `createdAt`)
);

-- CreateTable
CREATE TABLE `TenantSettings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` INTEGER NOT NULL DEFAULT 0,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'America/Argentina/Cordoba',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'ARS',
    `paymentAccountHolder` VARCHAR(191) NULL,
    `paymentAlias` VARCHAR(191) NULL,
    `paymentCbu` VARCHAR(191) NULL,
    `paymentTaxId` VARCHAR(191) NULL,
    `paymentWhatsapp` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `TenantSettings_tenantId_key` (`tenantId`)
);

-- CreateTable
CREATE TABLE `TenantKioskCredential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` INTEGER NOT NULL DEFAULT 0,
    `label` VARCHAR(191) NOT NULL DEFAULT 'Kiosco principal',
    `tokenHash` CHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `TenantKioskCredential_tokenHash_key` (`tokenHash`),
    KEY `TenantKioskCredential_tenantId_active_idx` (`tenantId`, `active`)
);

-- CreateTable
CREATE TABLE `MediaAsset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` INTEGER NOT NULL DEFAULT 0,
    `kind` ENUM('USER_AVATAR', 'CLASS_IMAGE', 'EXERCISE_MEDIA', 'MEDICAL_RECORD', 'TENANT_LOGO') NOT NULL,
    `cloudinaryPublicId` VARCHAR(191) NOT NULL,
    `resourceType` VARCHAR(191) NOT NULL DEFAULT 'image',
    `format` VARCHAR(191) NULL,
    `bytes` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `MediaAsset_cloudinaryPublicId_key` (`cloudinaryPublicId`),
    UNIQUE KEY `MediaAsset_tenantId_id_key` (`tenantId`, `id`),
    KEY `MediaAsset_tenantId_kind_idx` (`tenantId`, `kind`)
);

-- CreateTable
CREATE TABLE `PlatformUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN') NOT NULL DEFAULT 'SUPER_ADMIN',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `authVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `PlatformUser_email_key` (`email`)
);

-- CreateTable
CREATE TABLE `ClaseEntrenador` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` INTEGER NOT NULL DEFAULT 0,
    `ID_Clase` INTEGER NOT NULL,
    `ID_Entrenador` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `ClaseEntrenador_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE KEY `ClaseEntrenador_tenantId_ID_Clase_ID_Entrenador_key` (`tenantId`, `ID_Clase`, `ID_Entrenador`),
    KEY `ClaseEntrenador_tenantId_ID_Entrenador_idx` (`tenantId`, `ID_Entrenador`)
);

-- AlterTable (expand first; role is backfilled below)
ALTER TABLE `User`
    ADD COLUMN `authVersion` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `role` ENUM('ADMIN', 'TRAINER', 'STUDENT') NULL,
    ADD COLUMN `tenantId` INTEGER NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Plan` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Cuota` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Gasto` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `ContactoAlumno` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `MovimientoSocio` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Turno` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `TurnoFijo` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `HorarioClase` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Clase` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Rutina` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `GrupoUsuario` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `GrupoUsuarioMiembro` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `RutinaAsignacionUsuario` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `RutinaAsignacionGrupo` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `RutinaDia` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Semana` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Bloque` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Ejercicio` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `BloqueEjercicio` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `EjercicioMedicion` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `HistoricoEjercicio` ADD COLUMN `tenantId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Asistencia` ADD COLUMN `tenantId` INTEGER NULL;

-- Create and backfill the single legacy tenant before installing tenant constraints.
INSERT INTO `Tenant` (`name`, `slug`, `status`, `createdAt`, `updatedAt`)
VALUES ('Gymhour Legacy', 'legacy-gym', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
SET @legacyTenantId = LAST_INSERT_ID();

INSERT INTO `TenantSettings` (`tenantId`, `timezone`, `currency`, `createdAt`, `updatedAt`)
VALUES (@legacyTenantId, 'America/Argentina/Cordoba', 'ARS', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

UPDATE `User` SET `tenantId` = @legacyTenantId;
UPDATE `Plan` SET `tenantId` = @legacyTenantId;
UPDATE `Cuota` SET `tenantId` = @legacyTenantId;
UPDATE `Gasto` SET `tenantId` = @legacyTenantId;
UPDATE `ContactoAlumno` SET `tenantId` = @legacyTenantId;
UPDATE `MovimientoSocio` SET `tenantId` = @legacyTenantId;
UPDATE `Turno` SET `tenantId` = @legacyTenantId;
UPDATE `TurnoFijo` SET `tenantId` = @legacyTenantId;
UPDATE `HorarioClase` SET `tenantId` = @legacyTenantId;
UPDATE `Clase` SET `tenantId` = @legacyTenantId;
UPDATE `Rutina` SET `tenantId` = @legacyTenantId;
UPDATE `GrupoUsuario` SET `tenantId` = @legacyTenantId;
UPDATE `GrupoUsuarioMiembro` SET `tenantId` = @legacyTenantId;
UPDATE `RutinaAsignacionUsuario` SET `tenantId` = @legacyTenantId;
UPDATE `RutinaAsignacionGrupo` SET `tenantId` = @legacyTenantId;
UPDATE `RutinaDia` SET `tenantId` = @legacyTenantId;
UPDATE `Semana` SET `tenantId` = @legacyTenantId;
UPDATE `Bloque` SET `tenantId` = @legacyTenantId;
UPDATE `Ejercicio` SET `tenantId` = @legacyTenantId;
UPDATE `BloqueEjercicio` SET `tenantId` = @legacyTenantId;
UPDATE `EjercicioMedicion` SET `tenantId` = @legacyTenantId;
UPDATE `HistoricoEjercicio` SET `tenantId` = @legacyTenantId;
UPDATE `Asistencia` SET `tenantId` = @legacyTenantId;

UPDATE `User`
SET `role` = CASE LOWER(COALESCE(`tipo`, ''))
    WHEN 'admin' THEN 'ADMIN'
    WHEN 'entrenador' THEN 'TRAINER'
    ELSE 'STUDENT'
END;

INSERT INTO `ClaseEntrenador` (`tenantId`, `ID_Clase`, `ID_Entrenador`, `createdAt`)
SELECT @legacyTenantId, `A`, `B`, CURRENT_TIMESTAMP(3) FROM `_EntrenadoresClases`;

-- Validate before constraining. Each INSERT intentionally violates NOT NULL when an
-- invariant fails, aborting the migration instead of leaving partially scoped data.
CREATE TEMPORARY TABLE `_MultitenantValidation` (`failure` VARCHAR(191) NOT NULL);
INSERT INTO `_MultitenantValidation` (`failure`)
SELECT NULL FROM (
    SELECT `tenantId` FROM `User` UNION ALL SELECT `tenantId` FROM `Plan`
    UNION ALL SELECT `tenantId` FROM `Cuota` UNION ALL SELECT `tenantId` FROM `Gasto`
    UNION ALL SELECT `tenantId` FROM `ContactoAlumno` UNION ALL SELECT `tenantId` FROM `MovimientoSocio`
    UNION ALL SELECT `tenantId` FROM `Turno` UNION ALL SELECT `tenantId` FROM `TurnoFijo`
    UNION ALL SELECT `tenantId` FROM `HorarioClase` UNION ALL SELECT `tenantId` FROM `Clase`
    UNION ALL SELECT `tenantId` FROM `Rutina` UNION ALL SELECT `tenantId` FROM `GrupoUsuario`
    UNION ALL SELECT `tenantId` FROM `GrupoUsuarioMiembro` UNION ALL SELECT `tenantId` FROM `RutinaAsignacionUsuario`
    UNION ALL SELECT `tenantId` FROM `RutinaAsignacionGrupo` UNION ALL SELECT `tenantId` FROM `RutinaDia`
    UNION ALL SELECT `tenantId` FROM `Semana` UNION ALL SELECT `tenantId` FROM `Bloque`
    UNION ALL SELECT `tenantId` FROM `Ejercicio` UNION ALL SELECT `tenantId` FROM `BloqueEjercicio`
    UNION ALL SELECT `tenantId` FROM `EjercicioMedicion` UNION ALL SELECT `tenantId` FROM `HistoricoEjercicio`
    UNION ALL SELECT `tenantId` FROM `Asistencia`
) scoped WHERE scoped.`tenantId` IS NULL OR scoped.`tenantId` <> @legacyTenantId LIMIT 1;
INSERT INTO `_MultitenantValidation` (`failure`)
SELECT NULL WHERE (SELECT COUNT(*) FROM `_EntrenadoresClases`) <> (SELECT COUNT(*) FROM `ClaseEntrenador`);
INSERT INTO `_MultitenantValidation` (`failure`)
SELECT NULL FROM `User` WHERE `role` IS NULL LIMIT 1;
DROP TEMPORARY TABLE `_MultitenantValidation`;

ALTER TABLE `User` DROP COLUMN `tipo`, MODIFY `role` ENUM('ADMIN', 'TRAINER', 'STUDENT') NOT NULL DEFAULT 'STUDENT';
ALTER TABLE `User` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Plan` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Cuota` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Gasto` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `ContactoAlumno` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `MovimientoSocio` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Turno` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `TurnoFijo` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `HorarioClase` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Clase` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Rutina` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `GrupoUsuario` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `GrupoUsuarioMiembro` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `RutinaAsignacionUsuario` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `RutinaAsignacionGrupo` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `RutinaDia` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Semana` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Bloque` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Ejercicio` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `BloqueEjercicio` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `EjercicioMedicion` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `HistoricoEjercicio` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Asistencia` MODIFY `tenantId` INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE `_EntrenadoresClases`;

-- DropIndex
DROP INDEX `User_dni_key` ON `User`;

-- DropIndex
DROP INDEX `User_email_key` ON `User`;

-- DropIndex
DROP INDEX `Plan_nombre_key` ON `Plan`;

-- DropIndex
DROP INDEX `Cuota_mes_idx` ON `Cuota`;

-- DropIndex
DROP INDEX `Cuota_ID_Usuario_mes_idx` ON `Cuota`;

-- DropIndex
DROP INDEX `Gasto_mes_idx` ON `Gasto`;

-- DropIndex
DROP INDEX `Gasto_categoria_idx` ON `Gasto`;

-- DropIndex
DROP INDEX `Gasto_fecha_idx` ON `Gasto`;

-- DropIndex
DROP INDEX `ContactoAlumno_ID_Usuario_fecha_idx` ON `ContactoAlumno`;

-- DropIndex
DROP INDEX `MovimientoSocio_fecha_idx` ON `MovimientoSocio`;

-- DropIndex
DROP INDEX `MovimientoSocio_tipo_idx` ON `MovimientoSocio`;

-- DropIndex
DROP INDEX `Turno_fecha_idx` ON `Turno`;

-- DropIndex
DROP INDEX `Turno_ID_HorarioClase_fecha_idx` ON `Turno`;

-- DropIndex
DROP INDEX `Turno_ID_Usuario_ID_HorarioClase_fecha_idx` ON `Turno`;

-- DropIndex
DROP INDEX `TurnoFijo_ID_Usuario_ID_HorarioClase_key` ON `TurnoFijo`;

-- DropIndex
DROP INDEX `GrupoUsuarioMiembro_ID_GrupoUsuario_ID_Usuario_key` ON `GrupoUsuarioMiembro`;

-- DropIndex
DROP INDEX `RutinaAsignacionUsuario_ID_Rutina_ID_Usuario_key` ON `RutinaAsignacionUsuario`;

-- DropIndex
DROP INDEX `RutinaAsignacionGrupo_ID_Rutina_ID_GrupoUsuario_key` ON `RutinaAsignacionGrupo`;

-- DropIndex
DROP INDEX `Ejercicio_esGenerico_idx` ON `Ejercicio`;

-- DropIndex
DROP INDEX `Asistencia_ID_Usuario_fechaIngreso_idx` ON `Asistencia`;

-- DropIndex
DROP INDEX `Asistencia_permitido_fechaIngreso_idx` ON `Asistencia`;

-- CreateIndex
CREATE INDEX `User_tenantId_role_estado_idx` ON `User`(`tenantId`, `role`, `estado`);

-- CreateIndex
CREATE UNIQUE INDEX `User_tenantId_ID_Usuario_key` ON `User`(`tenantId`, `ID_Usuario`);

-- CreateIndex
CREATE UNIQUE INDEX `User_tenantId_email_key` ON `User`(`tenantId`, `email`);

-- CreateIndex
CREATE UNIQUE INDEX `User_tenantId_dni_key` ON `User`(`tenantId`, `dni`);

-- CreateIndex
CREATE UNIQUE INDEX `Plan_tenantId_ID_Plan_key` ON `Plan`(`tenantId`, `ID_Plan`);

-- CreateIndex
CREATE UNIQUE INDEX `Plan_tenantId_nombre_key` ON `Plan`(`tenantId`, `nombre`);

-- CreateIndex
CREATE INDEX `Cuota_tenantId_mes_idx` ON `Cuota`(`tenantId`, `mes`);

-- CreateIndex
CREATE INDEX `Cuota_tenantId_ID_Usuario_mes_idx` ON `Cuota`(`tenantId`, `ID_Usuario`, `mes`);

-- CreateIndex
CREATE INDEX `Cuota_tenantId_pagada_vence_idx` ON `Cuota`(`tenantId`, `pagada`, `vence`);

-- CreateIndex
CREATE UNIQUE INDEX `Cuota_tenantId_ID_Cuota_key` ON `Cuota`(`tenantId`, `ID_Cuota`);

-- CreateIndex
CREATE INDEX `Gasto_tenantId_mes_idx` ON `Gasto`(`tenantId`, `mes`);

-- CreateIndex
CREATE INDEX `Gasto_tenantId_categoria_idx` ON `Gasto`(`tenantId`, `categoria`);

-- CreateIndex
CREATE INDEX `Gasto_tenantId_fecha_idx` ON `Gasto`(`tenantId`, `fecha`);

-- CreateIndex
CREATE UNIQUE INDEX `Gasto_tenantId_ID_Gasto_key` ON `Gasto`(`tenantId`, `ID_Gasto`);

-- CreateIndex
CREATE INDEX `ContactoAlumno_tenantId_ID_Usuario_fecha_idx` ON `ContactoAlumno`(`tenantId`, `ID_Usuario`, `fecha`);

-- CreateIndex
CREATE UNIQUE INDEX `ContactoAlumno_tenantId_id_key` ON `ContactoAlumno`(`tenantId`, `id`);

-- CreateIndex
CREATE INDEX `MovimientoSocio_tenantId_fecha_idx` ON `MovimientoSocio`(`tenantId`, `fecha`);

-- CreateIndex
CREATE INDEX `MovimientoSocio_tenantId_tipo_fecha_idx` ON `MovimientoSocio`(`tenantId`, `tipo`, `fecha`);

-- CreateIndex
CREATE UNIQUE INDEX `MovimientoSocio_tenantId_id_key` ON `MovimientoSocio`(`tenantId`, `id`);

-- CreateIndex
CREATE INDEX `Turno_tenantId_ID_Cuota_idx` ON `Turno`(`tenantId`, `ID_Cuota`);

-- CreateIndex
CREATE INDEX `Turno_tenantId_fecha_idx` ON `Turno`(`tenantId`, `fecha`);

-- CreateIndex
CREATE INDEX `Turno_tenantId_ID_HorarioClase_fecha_idx` ON `Turno`(`tenantId`, `ID_HorarioClase`, `fecha`);

-- CreateIndex
CREATE INDEX `Turno_tenantId_ID_Usuario_ID_HorarioClase_fecha_idx` ON `Turno`(`tenantId`, `ID_Usuario`, `ID_HorarioClase`, `fecha`);

-- CreateIndex
CREATE UNIQUE INDEX `Turno_tenantId_id_turno_key` ON `Turno`(`tenantId`, `id_turno`);

-- CreateIndex
CREATE UNIQUE INDEX `TurnoFijo_tenantId_ID_TurnoFijo_key` ON `TurnoFijo`(`tenantId`, `ID_TurnoFijo`);

-- CreateIndex
CREATE UNIQUE INDEX `TurnoFijo_tenantId_ID_Usuario_ID_HorarioClase_key` ON `TurnoFijo`(`tenantId`, `ID_Usuario`, `ID_HorarioClase`);

-- CreateIndex
CREATE INDEX `HorarioClase_tenantId_ID_Clase_activo_idx` ON `HorarioClase`(`tenantId`, `ID_Clase`, `activo`);

-- CreateIndex
CREATE UNIQUE INDEX `HorarioClase_tenantId_ID_HorarioClase_key` ON `HorarioClase`(`tenantId`, `ID_HorarioClase`);

-- CreateIndex
CREATE INDEX `Clase_tenantId_nombre_idx` ON `Clase`(`tenantId`, `nombre`);

-- CreateIndex
CREATE UNIQUE INDEX `Clase_tenantId_ID_Clase_key` ON `Clase`(`tenantId`, `ID_Clase`);

-- CreateIndex
CREATE INDEX `Rutina_tenantId_ID_Usuario_createdAt_idx` ON `Rutina`(`tenantId`, `ID_Usuario`, `createdAt`);

-- CreateIndex
CREATE INDEX `Rutina_tenantId_ID_Entrenador_createdAt_idx` ON `Rutina`(`tenantId`, `ID_Entrenador`, `createdAt`);

-- CreateIndex
CREATE UNIQUE INDEX `Rutina_tenantId_ID_Rutina_key` ON `Rutina`(`tenantId`, `ID_Rutina`);

-- CreateIndex
CREATE INDEX `GrupoUsuario_tenantId_estado_createdAt_idx` ON `GrupoUsuario`(`tenantId`, `estado`, `createdAt`);

-- CreateIndex
CREATE UNIQUE INDEX `GrupoUsuario_tenantId_ID_GrupoUsuario_key` ON `GrupoUsuario`(`tenantId`, `ID_GrupoUsuario`);

-- CreateIndex
CREATE INDEX `GrupoUsuarioMiembro_tenantId_ID_Usuario_idx` ON `GrupoUsuarioMiembro`(`tenantId`, `ID_Usuario`);

-- CreateIndex
CREATE UNIQUE INDEX `GrupoUsuarioMiembro_tenantId_ID_GrupoUsuarioMiembro_key` ON `GrupoUsuarioMiembro`(`tenantId`, `ID_GrupoUsuarioMiembro`);

-- CreateIndex
CREATE UNIQUE INDEX `GrupoUsuarioMiembro_tenantId_ID_GrupoUsuario_ID_Usuario_key` ON `GrupoUsuarioMiembro`(`tenantId`, `ID_GrupoUsuario`, `ID_Usuario`);

-- CreateIndex
CREATE INDEX `RutinaAsignacionUsuario_tenantId_ID_Usuario_idx` ON `RutinaAsignacionUsuario`(`tenantId`, `ID_Usuario`);

-- CreateIndex
CREATE UNIQUE INDEX `RutinaAsignacionUsuario_tenantId_ID_RutinaAsignacionUsuario_key` ON `RutinaAsignacionUsuario`(`tenantId`, `ID_RutinaAsignacionUsuario`);

-- CreateIndex
CREATE UNIQUE INDEX `RutinaAsignacionUsuario_tenantId_ID_Rutina_ID_Usuario_key` ON `RutinaAsignacionUsuario`(`tenantId`, `ID_Rutina`, `ID_Usuario`);

-- CreateIndex
CREATE INDEX `RutinaAsignacionGrupo_tenantId_ID_GrupoUsuario_idx` ON `RutinaAsignacionGrupo`(`tenantId`, `ID_GrupoUsuario`);

-- CreateIndex
CREATE UNIQUE INDEX `RutinaAsignacionGrupo_tenantId_ID_RutinaAsignacionGrupo_key` ON `RutinaAsignacionGrupo`(`tenantId`, `ID_RutinaAsignacionGrupo`);

-- CreateIndex
CREATE UNIQUE INDEX `RutinaAsignacionGrupo_tenantId_ID_Rutina_ID_GrupoUsuario_key` ON `RutinaAsignacionGrupo`(`tenantId`, `ID_Rutina`, `ID_GrupoUsuario`);

-- CreateIndex
CREATE INDEX `RutinaDia_tenantId_rutinaId_idx` ON `RutinaDia`(`tenantId`, `rutinaId`);

-- CreateIndex
CREATE UNIQUE INDEX `RutinaDia_tenantId_id_key` ON `RutinaDia`(`tenantId`, `id`);

-- CreateIndex
CREATE INDEX `Semana_tenantId_rutinaId_idx` ON `Semana`(`tenantId`, `rutinaId`);

-- CreateIndex
CREATE UNIQUE INDEX `Semana_tenantId_id_key` ON `Semana`(`tenantId`, `id`);

-- CreateIndex
CREATE INDEX `Bloque_tenantId_ID_Rutina_idx` ON `Bloque`(`tenantId`, `ID_Rutina`);

-- CreateIndex
CREATE UNIQUE INDEX `Bloque_tenantId_ID_Bloque_key` ON `Bloque`(`tenantId`, `ID_Bloque`);

-- CreateIndex
CREATE INDEX `Ejercicio_tenantId_esGenerico_nombre_idx` ON `Ejercicio`(`tenantId`, `esGenerico`, `nombre`);

-- CreateIndex
CREATE UNIQUE INDEX `Ejercicio_tenantId_ID_Ejercicio_key` ON `Ejercicio`(`tenantId`, `ID_Ejercicio`);

-- CreateIndex
CREATE INDEX `BloqueEjercicio_tenantId_ID_Bloque_idx` ON `BloqueEjercicio`(`tenantId`, `ID_Bloque`);

-- CreateIndex
CREATE INDEX `BloqueEjercicio_tenantId_ID_Ejercicio_idx` ON `BloqueEjercicio`(`tenantId`, `ID_Ejercicio`);

-- CreateIndex
CREATE UNIQUE INDEX `BloqueEjercicio_tenantId_ID_key` ON `BloqueEjercicio`(`tenantId`, `ID`);

-- CreateIndex
CREATE INDEX `EjercicioMedicion_tenantId_ID_Usuario_idx` ON `EjercicioMedicion`(`tenantId`, `ID_Usuario`);

-- CreateIndex
CREATE UNIQUE INDEX `EjercicioMedicion_tenantId_ID_EjercicioMedicion_key` ON `EjercicioMedicion`(`tenantId`, `ID_EjercicioMedicion`);

-- CreateIndex
CREATE INDEX `HistoricoEjercicio_tenantId_ID_EjercicioMedicion_Fecha_idx` ON `HistoricoEjercicio`(`tenantId`, `ID_EjercicioMedicion`, `Fecha`);

-- CreateIndex
CREATE UNIQUE INDEX `HistoricoEjercicio_tenantId_ID_HistoricoEjercicio_key` ON `HistoricoEjercicio`(`tenantId`, `ID_HistoricoEjercicio`);

-- CreateIndex
CREATE INDEX `Asistencia_tenantId_ID_Usuario_fechaIngreso_idx` ON `Asistencia`(`tenantId`, `ID_Usuario`, `fechaIngreso`);

-- CreateIndex
CREATE INDEX `Asistencia_tenantId_permitido_fechaIngreso_idx` ON `Asistencia`(`tenantId`, `permitido`, `fechaIngreso`);

-- CreateIndex
CREATE UNIQUE INDEX `Asistencia_tenantId_ID_Asistencia_key` ON `Asistencia`(`tenantId`, `ID_Asistencia`);

-- AddForeignKey
ALTER TABLE `TenantSettings` ADD CONSTRAINT `TenantSettings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantKioskCredential` ADD CONSTRAINT `TenantKioskCredential_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MediaAsset` ADD CONSTRAINT `MediaAsset_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_tenantId_ID_Plan_fkey` FOREIGN KEY (`tenantId`, `ID_Plan`) REFERENCES `Plan`(`tenantId`, `ID_Plan`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cuota` ADD CONSTRAINT `Cuota_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cuota` ADD CONSTRAINT `Cuota_tenantId_ID_Plan_fkey` FOREIGN KEY (`tenantId`, `ID_Plan`) REFERENCES `Plan`(`tenantId`, `ID_Plan`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactoAlumno` ADD CONSTRAINT `ContactoAlumno_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimientoSocio` ADD CONSTRAINT `MovimientoSocio_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Turno` ADD CONSTRAINT `Turno_tenantId_ID_HorarioClase_fkey` FOREIGN KEY (`tenantId`, `ID_HorarioClase`) REFERENCES `HorarioClase`(`tenantId`, `ID_HorarioClase`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Turno` ADD CONSTRAINT `Turno_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Turno` ADD CONSTRAINT `Turno_tenantId_ID_Cuota_fkey` FOREIGN KEY (`tenantId`, `ID_Cuota`) REFERENCES `Cuota`(`tenantId`, `ID_Cuota`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TurnoFijo` ADD CONSTRAINT `TurnoFijo_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TurnoFijo` ADD CONSTRAINT `TurnoFijo_tenantId_ID_HorarioClase_fkey` FOREIGN KEY (`tenantId`, `ID_HorarioClase`) REFERENCES `HorarioClase`(`tenantId`, `ID_HorarioClase`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HorarioClase` ADD CONSTRAINT `HorarioClase_tenantId_ID_Clase_fkey` FOREIGN KEY (`tenantId`, `ID_Clase`) REFERENCES `Clase`(`tenantId`, `ID_Clase`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClaseEntrenador` ADD CONSTRAINT `ClaseEntrenador_tenantId_ID_Clase_fkey` FOREIGN KEY (`tenantId`, `ID_Clase`) REFERENCES `Clase`(`tenantId`, `ID_Clase`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClaseEntrenador` ADD CONSTRAINT `ClaseEntrenador_tenantId_ID_Entrenador_fkey` FOREIGN KEY (`tenantId`, `ID_Entrenador`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rutina` ADD CONSTRAINT `Rutina_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rutina` ADD CONSTRAINT `Rutina_tenantId_ID_Entrenador_fkey` FOREIGN KEY (`tenantId`, `ID_Entrenador`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GrupoUsuarioMiembro` ADD CONSTRAINT `GrupoUsuarioMiembro_tenantId_ID_GrupoUsuario_fkey` FOREIGN KEY (`tenantId`, `ID_GrupoUsuario`) REFERENCES `GrupoUsuario`(`tenantId`, `ID_GrupoUsuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GrupoUsuarioMiembro` ADD CONSTRAINT `GrupoUsuarioMiembro_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RutinaAsignacionUsuario` ADD CONSTRAINT `RutinaAsignacionUsuario_tenantId_ID_Rutina_fkey` FOREIGN KEY (`tenantId`, `ID_Rutina`) REFERENCES `Rutina`(`tenantId`, `ID_Rutina`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RutinaAsignacionUsuario` ADD CONSTRAINT `RutinaAsignacionUsuario_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RutinaAsignacionGrupo` ADD CONSTRAINT `RutinaAsignacionGrupo_tenantId_ID_Rutina_fkey` FOREIGN KEY (`tenantId`, `ID_Rutina`) REFERENCES `Rutina`(`tenantId`, `ID_Rutina`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RutinaAsignacionGrupo` ADD CONSTRAINT `RutinaAsignacionGrupo_tenantId_ID_GrupoUsuario_fkey` FOREIGN KEY (`tenantId`, `ID_GrupoUsuario`) REFERENCES `GrupoUsuario`(`tenantId`, `ID_GrupoUsuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RutinaDia` ADD CONSTRAINT `RutinaDia_tenantId_rutinaId_fkey` FOREIGN KEY (`tenantId`, `rutinaId`) REFERENCES `Rutina`(`tenantId`, `ID_Rutina`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RutinaDia` ADD CONSTRAINT `RutinaDia_tenantId_rutinaSemanaId_fkey` FOREIGN KEY (`tenantId`, `rutinaSemanaId`) REFERENCES `Semana`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Semana` ADD CONSTRAINT `Semana_tenantId_rutinaId_fkey` FOREIGN KEY (`tenantId`, `rutinaId`) REFERENCES `Rutina`(`tenantId`, `ID_Rutina`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bloque` ADD CONSTRAINT `Bloque_tenantId_ID_Rutina_fkey` FOREIGN KEY (`tenantId`, `ID_Rutina`) REFERENCES `Rutina`(`tenantId`, `ID_Rutina`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bloque` ADD CONSTRAINT `Bloque_tenantId_rutinaDiaId_fkey` FOREIGN KEY (`tenantId`, `rutinaDiaId`) REFERENCES `RutinaDia`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BloqueEjercicio` ADD CONSTRAINT `BloqueEjercicio_tenantId_ID_Bloque_fkey` FOREIGN KEY (`tenantId`, `ID_Bloque`) REFERENCES `Bloque`(`tenantId`, `ID_Bloque`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BloqueEjercicio` ADD CONSTRAINT `BloqueEjercicio_tenantId_ID_Ejercicio_fkey` FOREIGN KEY (`tenantId`, `ID_Ejercicio`) REFERENCES `Ejercicio`(`tenantId`, `ID_Ejercicio`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EjercicioMedicion` ADD CONSTRAINT `EjercicioMedicion_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HistoricoEjercicio` ADD CONSTRAINT `HistoricoEjercicio_tenantId_ID_EjercicioMedicion_fkey` FOREIGN KEY (`tenantId`, `ID_EjercicioMedicion`) REFERENCES `EjercicioMedicion`(`tenantId`, `ID_EjercicioMedicion`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asistencia` ADD CONSTRAINT `Asistencia_tenantId_ID_Usuario_fkey` FOREIGN KEY (`tenantId`, `ID_Usuario`) REFERENCES `User`(`tenantId`, `ID_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asistencia` ADD CONSTRAINT `Asistencia_tenantId_ID_Turno_fkey` FOREIGN KEY (`tenantId`, `ID_Turno`) REFERENCES `Turno`(`tenantId`, `id_turno`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asistencia` ADD CONSTRAINT `Asistencia_tenantId_ID_Cuota_fkey` FOREIGN KEY (`tenantId`, `ID_Cuota`) REFERENCES `Cuota`(`tenantId`, `ID_Cuota`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every tenant-owned row must also reference a real tenant. The default 0 is a
-- fail-closed sentinel: an unscoped create fails because tenant 0 does not exist.
ALTER TABLE `User` ADD CONSTRAINT `User_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Plan` ADD CONSTRAINT `Plan_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Cuota` ADD CONSTRAINT `Cuota_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Gasto` ADD CONSTRAINT `Gasto_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ContactoAlumno` ADD CONSTRAINT `ContactoAlumno_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MovimientoSocio` ADD CONSTRAINT `MovimientoSocio_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Turno` ADD CONSTRAINT `Turno_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TurnoFijo` ADD CONSTRAINT `TurnoFijo_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `HorarioClase` ADD CONSTRAINT `HorarioClase_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Clase` ADD CONSTRAINT `Clase_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Rutina` ADD CONSTRAINT `Rutina_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `GrupoUsuario` ADD CONSTRAINT `GrupoUsuario_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `GrupoUsuarioMiembro` ADD CONSTRAINT `GrupoUsuarioMiembro_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RutinaAsignacionUsuario` ADD CONSTRAINT `RutinaAsignacionUsuario_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RutinaAsignacionGrupo` ADD CONSTRAINT `RutinaAsignacionGrupo_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RutinaDia` ADD CONSTRAINT `RutinaDia_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Semana` ADD CONSTRAINT `Semana_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Bloque` ADD CONSTRAINT `Bloque_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Ejercicio` ADD CONSTRAINT `Ejercicio_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BloqueEjercicio` ADD CONSTRAINT `BloqueEjercicio_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EjercicioMedicion` ADD CONSTRAINT `EjercicioMedicion_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `HistoricoEjercicio` ADD CONSTRAINT `HistoricoEjercicio_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Asistencia` ADD CONSTRAINT `Asistencia_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ClaseEntrenador` ADD CONSTRAINT `ClaseEntrenador_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
