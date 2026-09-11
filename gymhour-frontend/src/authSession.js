let snapshot = null;

export const setAuthSnapshot = value => { snapshot = value; };
export const getCurrentUserId = () => snapshot?.user?.id ?? null;
export const getCurrentTenant = () => snapshot?.tenant ?? null;

