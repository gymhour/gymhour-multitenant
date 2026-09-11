import type { TenantRole } from '@prisma/client';

export interface User {
    email: string;
    password: string;
    nombre: string | null;
    apellido: string | null;
    direc: string | null;
    tel: string | null;
    tenantId: number;
    role: TenantRole;
    authVersion: number;
    fechaRegistro: Date | null;
    fechaBaja: Date | null;
    ID_Usuario: number;
};
