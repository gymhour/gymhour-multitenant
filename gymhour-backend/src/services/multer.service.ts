import multer from 'multer';
import type { RequestHandler } from 'express';
import { getTenantContext, runWithTenantContext } from './tenantContext.service.js';

const storage = multer.memoryStorage();
const multerUpload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Los eventos del stream multipart pueden ejecutarse fuera del AsyncLocalStorage
 * abierto por authenticateToken. Capturamos el contexto antes de que Multer lea
 * el body y lo restauramos cuando entrega el control al siguiente middleware.
 */
export const preserveTenantContext = (middleware: RequestHandler): RequestHandler => (
    req,
    res,
    next,
) => {
    const tenantContext = getTenantContext();
    middleware(req, res, error => {
        runWithTenantContext(tenantContext, () => next(error));
    });
};

const upload = {
    single: (fieldName: string): RequestHandler => preserveTenantContext(multerUpload.single(fieldName)),
};

export default upload;
