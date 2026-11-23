// Base en memoria para tests de servicios. Soporta el subconjunto de Prisma que usan los servicios de
// cobros con Mercado Pago: filtros de igualdad, in, not, gte/gt/lte/lt, OR/AND, órdenes simples y
// únicos (lanza P2002 como Prisma). No reemplaza a los tests de integración.

type Row = Record<string, any>;
const OPERATORS = ['in', 'not', 'gte', 'gt', 'lte', 'lt', 'contains', 'startsWith', 'increment', 'decrement'];

const isPlainObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value);

const clone = (row: Row | undefined | null) => (row ? { ...row } : null);

function flatten(where: Row = {}): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(where)) {
    if (key.includes('_') && isPlainObject(value) && !Object.keys(value).some(k => OPERATORS.includes(k))) {
      Object.assign(result, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(flatten(where)).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some(item => matches(row, item));
    if (key === 'AND') return (condition as Row[]).every(item => matches(row, item));
    const value = row[key];
    if (condition === undefined) return true;
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (isPlainObject(condition)) {
      if ('in' in condition) return condition.in.includes(value);
      if ('not' in condition) {
        return condition.not === null ? value !== null && value !== undefined : value !== condition.not;
      }
      let ok = true;
      if ('gte' in condition) ok = ok && value != null && value >= condition.gte;
      if ('gt' in condition) ok = ok && value != null && value > condition.gt;
      if ('lte' in condition) ok = ok && value != null && value <= condition.lte;
      if ('lt' in condition) ok = ok && value != null && value < condition.lt;
      if ('startsWith' in condition) ok = ok && typeof value === 'string' && value.startsWith(condition.startsWith);
      return ok;
    }
    return value === condition;
  });
}

function sortRows(rows: Row[], orderBy?: Row | Row[]): Row[] {
  if (!orderBy) return rows;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const [key, direction] = Object.entries(order)[0] as [string, 'asc' | 'desc'];
      const left = a[key] instanceof Date ? a[key].getTime() : a[key];
      const right = b[key] instanceof Date ? b[key].getTime() : b[key];
      if (left === right) continue;
      const result = left > right ? 1 : -1;
      return direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

function applyData(row: Row, data: Row): Row {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (isPlainObject(value) && 'increment' in value) next[key] = (next[key] ?? 0) + value.increment;
    else if (isPlainObject(value) && 'decrement' in value) next[key] = (next[key] ?? 0) - value.decrement;
    else if (value !== undefined) next[key] = value;
  }
  return next;
}

let sequence = 0;
export function fakeModel(options: { unique?: string[]; defaults?: () => Row; idField?: string } = {}) {
  const rows: Row[] = [];
  const unique = options.unique ?? [];
  const idField = options.idField ?? 'id';
  const assertUnique = (candidate: Row, self?: Row) => {
    for (const field of unique) {
      const value = candidate[field];
      if (value === null || value === undefined) continue;
      if (rows.some(row => row !== self && row[field] === value)) {
        throw Object.assign(new Error(`Unique constraint failed on ${field}`), { code: 'P2002' });
      }
    }
  };
  const model = {
    rows,
    findUnique: async ({ where }: Row) => clone(rows.find(row => matches(row, where))),
    findUniqueOrThrow: async ({ where }: Row) => {
      const row = rows.find(item => matches(item, where));
      if (!row) throw Object.assign(new Error('Not found'), { code: 'P2025' });
      return clone(row);
    },
    findFirst: async ({ where, orderBy }: Row = {}) => clone(sortRows(rows.filter(row => matches(row, where)), orderBy)[0]),
    findMany: async ({ where, orderBy, take }: Row = {}) => sortRows(rows.filter(row => matches(row, where)), orderBy)
      .slice(0, take ?? undefined).map(row => ({ ...row })),
    count: async ({ where }: Row = {}) => rows.filter(row => matches(row, where)).length,
    create: async ({ data }: Row) => {
      sequence += 1;
      const row = { ...(options.defaults?.() ?? {}), [idField]: `${idField}_${sequence}`, createdAt: new Date(), ...data };
      assertUnique(row);
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: Row) => {
      const row = rows.find(item => matches(item, where));
      if (!row) throw Object.assign(new Error('Not found'), { code: 'P2025' });
      const next = applyData(row, data);
      assertUnique(next, row);
      Object.assign(row, next, { updatedAt: new Date() });
      return { ...row };
    },
    updateMany: async ({ where, data }: Row) => {
      const targets = rows.filter(row => matches(row, where));
      for (const row of targets) Object.assign(row, applyData(row, data));
      return { count: targets.length };
    },
    upsert: async ({ where, create, update }: Row) => {
      const row = rows.find(item => matches(item, where));
      if (row) return model.update({ where, data: update });
      return model.create({ data: create });
    },
    delete: async ({ where }: Row) => {
      const index = rows.findIndex(row => matches(row, where));
      if (index < 0) throw Object.assign(new Error('Not found'), { code: 'P2025' });
      return rows.splice(index, 1)[0];
    },
    deleteMany: async ({ where }: Row = {}) => {
      let count = 0;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], where)) { rows.splice(index, 1); count += 1; }
      }
      return { count };
    },
  };
  return model;
}

export function fakePrisma() {
  const client: Record<string, any> = {
    tenant: fakeModel(),
    tenantSettings: fakeModel({ unique: ['tenantId'] }),
    user: fakeModel({ idField: 'ID_Usuario' }),
    cuota: fakeModel({ idField: 'ID_Cuota' }),
    cuotaPago: fakeModel({ unique: ['externalReference', 'lockKey', 'mpPaymentId'] }),
    debitoAutomatico: fakeModel({ unique: ['externalReference', 'activeKey', 'preapprovalId'] }),
    mercadoPagoAccount: fakeModel({ unique: ['tenantId'] }),
    mercadoPagoOAuthState: fakeModel({ unique: ['stateHash'] }),
    mercadoPagoPendingNotification: fakeModel(),
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return client;
}

// Instancia compartida para los vi.mock de '../src/models/Prisma.js'.
export const sharedFakePrisma = fakePrisma();

export function resetFakePrisma(client: Record<string, any> = sharedFakePrisma): void {
  for (const value of Object.values(client)) {
    if (value && Array.isArray(value.rows)) value.rows.length = 0;
  }
}
