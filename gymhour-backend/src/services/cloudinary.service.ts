import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';
import prisma, { systemPrisma } from '../models/Prisma.js';
import { getTenantContext } from './tenantContext.service.js';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_SECRET_KEY,
    secure: true,
});

// Ahora acepta un folder opcional (por defecto 'users')
export const uploadImageBuffer = (
    buffer: Buffer,
    publicId: string,
    folder: string = 'users',
    tenantIdOverride?: number,
): Promise<UploadApiResponse> => {
    const tenantId = tenantIdOverride ?? getTenantContext().tenantId;
    const tenantFolder = `tenants/${tenantId}/${folder.replace(/^\/+|\/+$/g, '')}`;
    return new Promise((resolve, reject) => {
        const readable = new Readable();
        readable._read = () => { };
        readable.push(buffer);
        readable.push(null);

        const stream = cloudinary.uploader.upload_stream(
            {
                public_id: publicId,
                folder: tenantFolder,
                type: 'authenticated',
                use_filename: true,
                unique_filename: false,
                overwrite: true
            },
            async (error, result) => {
                if (error) return reject(error);
                try {
                    const kind = folder === 'users' ? 'USER_AVATAR'
                        : folder === 'classes' ? 'CLASS_IMAGE'
                            : folder === 'branding' ? 'TENANT_LOGO'
                            : 'EXERCISE_MEDIA';
                    const mediaClient = tenantIdOverride ? systemPrisma : prisma;
                    await mediaClient.mediaAsset.upsert({
                        where: { cloudinaryPublicId: result!.public_id },
                        update: {
                            ...(tenantIdOverride ? { tenantId } : {}),
                            kind,
                            resourceType: result!.resource_type,
                            format: result!.format,
                            bytes: result!.bytes,
                        },
                        create: {
                            ...(tenantIdOverride ? { tenantId } : {}),
                            kind,
                            cloudinaryPublicId: result!.public_id,
                            resourceType: result!.resource_type,
                            format: result!.format,
                            bytes: result!.bytes,
                        },
                    });
                    resolve(result!);
                } catch (registryError) {
                    await cloudinary.uploader.destroy(result!.public_id, { type: 'authenticated' });
                    reject(registryError);
                }
            }
        );

        readable.pipe(stream);
    });
};

export const getImageUrl = (publicId: string, options?: Record<string, any>): string => {
    const tokenKey = process.env.CLOUDINARY_AUTH_TOKEN_KEY;
    const isTenantPrivateAsset = publicId.startsWith('tenants/');
    if (isTenantPrivateAsset && !tokenKey) {
        throw new Error('CLOUDINARY_AUTH_TOKEN_KEY_REQUIRED');
    }
    return cloudinary.url(publicId, {
        secure: true,
        type: isTenantPrivateAsset ? 'authenticated' : 'upload',
        sign_url: isTenantPrivateAsset,
        ...(isTenantPrivateAsset ? { auth_token: { key: tokenKey, duration: 15 * 60 } } : {}),
        ...options,
    });
};

// El logo identifica públicamente al gimnasio. Si el ambiente no tiene una
// auth-token key, usamos la firma estándar de Cloudinary para poder mostrarlo
// sin relajar la entrega privada del resto de los archivos del tenant.
export const getTenantLogoUrl = (publicId: string): string => {
    const tokenKey = process.env.CLOUDINARY_AUTH_TOKEN_KEY;
    return cloudinary.url(publicId, {
        secure: true,
        type: 'authenticated',
        sign_url: true,
        transformation: [{ width: 360, height: 180, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
        ...(tokenKey ? { auth_token: { key: tokenKey, duration: 15 * 60 } } : {}),
    });
};

export const getMedicalRecordUrl = (value: string): string => {
    if (/^https?:\/\//i.test(value)) return value;
    return getImageUrl(value, { resource_type: 'raw' });
};

export const deleteImage = async (publicId: string, tenantIdOverride?: number): Promise<void> => {
    const mediaClient = tenantIdOverride ? systemPrisma : prisma;
    const asset = await mediaClient.mediaAsset.findUnique({ where: { cloudinaryPublicId: publicId } });
    if (asset && tenantIdOverride && asset.tenantId !== tenantIdOverride) throw new Error('CROSS_TENANT_ASSET_DELETE_REJECTED');
    if (asset) {
        await cloudinary.uploader.destroy(publicId, { type: 'authenticated', resource_type: asset.resourceType });
        await mediaClient.mediaAsset.delete({ where: { id: asset.id } });
        return;
    }
    // Compatibilidad temporal con assets legacy durante la migración copy-verify.
    await cloudinary.uploader.destroy(publicId);
};
