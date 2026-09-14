-- AI-generated descriptions and block notes are free-form content and can
-- legitimately exceed Prisma's default VARCHAR(191).
ALTER TABLE `Rutina`
    MODIFY `desc` TEXT NULL;

ALTER TABLE `RutinaDia`
    MODIFY `descripcion` TEXT NULL;

ALTER TABLE `Bloque`
    MODIFY `descTabata` TEXT NULL;
