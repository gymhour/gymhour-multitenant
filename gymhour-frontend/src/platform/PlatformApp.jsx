import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Building2, CirclePause, LayoutDashboard, LogOut, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ToastContainer, toast } from 'react-toastify';
import platformApi from './platformApi';
import { PlatformProvider, usePlatformAuth } from './PlatformContext';
import './Platform.css';

const errorMessage = error => error.response?.data?.message || 'No pudimos completar la operación.';
const number = value => new Intl.NumberFormat('es-AR').format(value || 0);
const date = value => value ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin actividad';

function Login() {
  const { user, completeLogin } = usePlatformAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('password');
  const [form, setForm] = useState({ email: '', password: '', code: '' });
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async event => {
    event.preventDefault(); setBusy(true);
    try {
      if (step === 'password') {
        await platformApi.post('/platform/auth/login', { email: form.email, password: form.password });
        setStep('mfa');
      } else {
        const { data } = await platformApi.post('/platform/auth/mfa', { code: form.code });
        completeLogin(data); navigate('/dashboard', { replace: true });
      }
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <main className="platform-login">
    <form className="platform-login-card" onSubmit={submit}>
      <div className="platform-mark"><ShieldCheck size={28} /></div>
      <p className="platform-eyebrow">GYMHOUR PLATFORM</p>
      <h1>Administración segura</h1>
      <p className="platform-muted">{step === 'password' ? 'Ingresá con la cuenta privada de plataforma.' : 'Confirmá el segundo factor o un código de recuperación.'}</p>
      {step === 'password' ? <>
        <label>Email<input autoFocus type="email" autoComplete="username" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /></label>
      </> : <label>Código MFA<input autoFocus inputMode="numeric" autoComplete="one-time-code" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} required /></label>}
      <button disabled={busy}>{busy ? 'Verificando…' : step === 'password' ? 'Continuar' : 'Ingresar'}</button>
      {step === 'mfa' && <button type="button" className="platform-link-button" onClick={() => setStep('password')}>Volver</button>}
    </form>
  </main>;
}

function Guard({ children }) {
  const { user, loading } = usePlatformAuth();
  if (loading) return <div className="platform-loading">Validando sesión…</div>;
  return user ? children : <Navigate to="/login" replace />;
}

function Shell({ children }) {
  const { user, logout } = usePlatformAuth();
  return <div className="platform-shell">
    <aside>
      <div className="platform-brand"><ShieldCheck /><span>Gymhour<br/><small>Platform</small></span></div>
      <nav>
        <NavLink to="/dashboard"><LayoutDashboard size={19}/>Dashboard</NavLink>
        <NavLink to="/tenants"><Building2 size={19}/>Tenants</NavLink>
        <NavLink to="/audit"><Activity size={19}/>Auditoría</NavLink>
      </nav>
      <div className="platform-account"><small>{user?.email}</small><button onClick={logout}><LogOut size={17}/>Salir</button></div>
    </aside>
    <section className="platform-content">{children}</section>
  </div>;
}

function Page({ title, subtitle, children }) {
  return <><header className="platform-page-header"><div><h1>{title}</h1><p>{subtitle}</p></div></header>{children}</>;
}

function Dashboard() {
  const [data, setData] = useState(null);
  useEffect(() => { platformApi.get('/platform/dashboard').then(r => setData(r.data)).catch(e => toast.error(errorMessage(e))); }, []);
  if (!data) return <Page title="Dashboard" subtitle="Cargando información operativa…" />;
  const { summary } = data;
  const cards = [
    ['Tenants totales', summary.tenants.total, 'Gimnasios registrados', Building2],
    ['Tenants activos', summary.tenants.active, 'Con acceso a la plataforma', ShieldCheck],
    ['Tenants suspendidos', summary.tenants.suspended, 'Con acceso restringido', CirclePause],
    ['Altas en 30 días', summary.tenants.createdLast30Days, 'Nuevos registros', Activity],
  ];
  const chartData = data.trends.map(item => ({
    ...item,
    label: new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(new Date(`${item.month}-01T00:00:00Z`)).replace('.', ''),
  }));
  return <Page title="Dashboard" subtitle="Estado de los tenants y evolución de registros durante los últimos 12 meses.">
    <div className="platform-cards">{cards.map(([label, value, hint, Icon]) => <article key={label}><Icon/><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</div>
    <section className="platform-panel platform-chart-panel">
      <div className="platform-section-heading"><div><h2>Evolución mensual</h2><p>Tenants registrados por mes</p></div><span>Últimos 12 meses</span></div>
      <div className="platform-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
        <defs><linearGradient id="tenantChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c84b38" stopOpacity={0.2}/><stop offset="100%" stopColor="#c84b38" stopOpacity={0.01}/></linearGradient></defs>
        <CartesianGrid stroke="#edf0f3" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false}/><YAxis allowDecimals={false} axisLine={false} tickLine={false}/>
        <Tooltip cursor={{ stroke: '#d9dee4', strokeDasharray: '4 4' }} content={({ active, payload, label }) => active && payload?.length ? <div className="platform-chart-tooltip"><span>{label}</span><strong>{number(payload[0].value)} tenants registrados</strong></div> : null}/>
        <Area type="monotone" dataKey="tenantsCreated" stroke="#c84b38" strokeWidth={2} fill="url(#tenantChartFill)" activeDot={{ r: 4, fill: '#c84b38', stroke: '#fff', strokeWidth: 2 }}/>
      </AreaChart></ResponsiveContainer></div>
    </section>
  </Page>;
}

function StatusPill({ status }) { return <span className={`platform-status ${status.toLowerCase()}`}>{status === 'ACTIVE' ? 'Activo' : 'Suspendido'}</span>; }

function Tenants() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const search = params.get('search') || ''; const status = params.get('status') || ''; const sort = params.get('sort') || 'createdAt';
  useEffect(() => {
    const timer = setTimeout(() => platformApi.get('/platform/tenants', { params: Object.fromEntries(params) }).then(r => setData(r.data)).catch(e => toast.error(errorMessage(e))), 250);
    return () => clearTimeout(timer);
  }, [params]);
  const update = (key, value) => { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); next.set('page', '1'); setParams(next); };
  return <Page title="Tenants" subtitle="Información operativa y administración del ciclo de vida.">
    <div className="platform-toolbar"><label className="platform-search"><Search size={18}/><input placeholder="Nombre, slug o email" value={search} onChange={e => update('search', e.target.value)} /></label><select value={status} onChange={e => update('status', e.target.value)}><option value="">Todos los estados</option><option value="ACTIVE">Activos</option><option value="SUSPENDED">Suspendidos</option></select><select value={sort} onChange={e => update('sort', e.target.value)}><option value="createdAt">Más recientes</option><option value="name">Nombre</option><option value="lastActivityAt">Última actividad</option></select></div>
    <div className="platform-table-wrap"><table><thead><tr><th>Gimnasio</th><th>Estado</th><th>Administradores</th><th>Actividad</th><th></th></tr></thead><tbody>{data?.items?.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.slug}</small></td><td><StatusPill status={item.status}/></td><td>{item.users.map(admin => <small key={admin.ID_Usuario}>{admin.email}</small>)}</td><td><small>{date(item.lastActivityAt)}</small></td><td><Link className="platform-row-link" to={`/tenants/${item.id}`}>Ver detalle</Link></td></tr>)}</tbody></table></div>
    {data && <div className="platform-pagination"><button disabled={data.pagination.page <= 1} onClick={() => update('page', data.pagination.page - 1)}>Anterior</button><span>Página {data.pagination.page} de {Math.max(1, data.pagination.pages)}</span><button disabled={data.pagination.page >= data.pagination.pages} onClick={() => update('page', data.pagination.page + 1)}>Siguiente</button></div>}
  </Page>;
}

function ConfirmDialog({ tenant, action, onClose, onDone }) {
  const destructive = action === 'delete';
  const deletionReasons = [
    'Falta de pago',
    'No continuó después de la prueba gratuita',
    'Solicitud del cliente',
    'Cierre del gimnasio',
    'Cuenta duplicada',
    'Otro motivo',
  ];
  const [form, setForm] = useState({ reason: '', mfaCode: '', slug: '', password: '' });
  const [armed, setArmed] = useState(!destructive);
  const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault(); setBusy(true);
    try {
      if (destructive) {
        const response = await platformApi.post(`/platform/tenants/${tenant.id}/purge`, form);
        toast.success(response.status === 202 ? 'Tenant eliminado; la limpieza de archivos seguirá automáticamente.' : 'Tenant eliminado definitivamente.');
      } else {
        await platformApi.patch(`/platform/tenants/${tenant.id}/status`, { status: action === 'suspend' ? 'SUSPENDED' : 'ACTIVE', reason: form.reason, mfaCode: form.mfaCode });
        toast.success(action === 'suspend' ? 'Tenant suspendido.' : 'Tenant reactivado.');
      }
      onDone(destructive);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };
  if (destructive && !armed) return <div className="platform-modal-backdrop"><section className="platform-modal danger"><Trash2/><h2>Eliminación irreversible</h2><p>Se eliminarán todos los usuarios, cuotas, turnos, rutinas, archivos y configuraciones de <strong>{tenant.name}</strong>.</p><div className="platform-modal-actions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="danger-button" onClick={() => setArmed(true)}>Entiendo, continuar</button></div></section></div>;
  return <div className="platform-modal-backdrop"><form className={`platform-modal ${destructive ? 'danger' : ''}`} onSubmit={submit}><h2>{destructive ? 'Confirmación final' : action === 'suspend' ? 'Suspender tenant' : 'Reactivar tenant'}</h2><label>Motivo{destructive ? <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required><option value="" disabled>Seleccioná un motivo de baja</option>{deletionReasons.map(reason => <option key={reason} value={reason}>{reason}</option>)}</select> : <input value={form.reason} minLength={5} onChange={e => setForm({ ...form, reason: e.target.value })} required />}</label>{destructive && <><label>Escribí el slug <strong>{tenant.slug}</strong><input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} required /></label><label>Contraseña<input type="password" autoComplete="current-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /></label></>}<label>Código MFA<input inputMode="numeric" autoComplete="one-time-code" value={form.mfaCode} onChange={e => setForm({ ...form, mfaCode: e.target.value })} required /></label><div className="platform-modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button disabled={busy || (destructive && form.slug !== tenant.slug)} className={destructive ? 'danger-button' : ''}>{busy ? 'Procesando…' : 'Confirmar'}</button></div></form></div>;
}

function TenantDetail() {
  const { id } = useParams(); const navigate = useNavigate();
  const [tenant, setTenant] = useState(null); const [dialog, setDialog] = useState(null);
  const load = useCallback(() => {
    platformApi.get(`/platform/tenants/${id}`).then(r => setTenant(r.data)).catch(e => toast.error(errorMessage(e)));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!tenant) return <Page title="Tenant" subtitle="Cargando detalle…"/>;
  const done = deleted => { setDialog(null); if (deleted) navigate('/tenants'); else load(); };
  return <Page title={tenant.name} subtitle={tenant.slug}>
    <div className="platform-detail-head"><StatusPill status={tenant.status}/><span>Creado {date(tenant.createdAt)}</span><span>Última actividad {date(tenant.lastActivityAt)}</span></div>
    {tenant.status === 'SUSPENDED' && <div className="platform-warning"><strong>Suspendido:</strong> {tenant.suspensionReason} · {date(tenant.suspendedAt)}</div>}
    <div className="platform-grid"><section className="platform-panel"><h2>Contacto y configuración</h2><dl><dt>Email</dt><dd>{tenant.settings?.contactEmail || '—'}</dd><dt>Teléfono</dt><dd>{tenant.settings?.contactPhone || '—'}</dd><dt>Ubicación</dt><dd>{tenant.settings?.location || '—'}</dd><dt>Onboarding</dt><dd>{tenant.settings?.onboardingCompleted ? 'Completo' : 'Pendiente'}</dd></dl></section><section className="platform-panel"><h2>Administradores del gimnasio</h2>{tenant.users.map(admin => <div className="platform-event" key={admin.ID_Usuario}><strong>{[admin.nombre, admin.apellido].filter(Boolean).join(' ') || 'Sin nombre'}</strong><span>{admin.email}</span><small>{admin.estado ? 'Activo' : 'Inactivo'}</small></div>)}</section></div>
    <section className="platform-danger-zone"><div><h2>Administración del estado</h2><p>Estas acciones afectan inmediatamente el acceso del gimnasio.</p></div><div>{tenant.status === 'ACTIVE' ? <button onClick={() => setDialog('suspend')}>Suspender</button> : <button onClick={() => setDialog('activate')}>Reactivar</button>}<button className="danger-button" onClick={() => setDialog('delete')}><Trash2 size={17}/>Eliminar definitivamente</button></div></section>
    {dialog && <ConfirmDialog tenant={tenant} action={dialog} onClose={() => setDialog(null)} onDone={done}/>} 
  </Page>;
}

function Audit() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ tenantId: '', action: '', outcome: '' });
  useEffect(() => { const timer = setTimeout(() => platformApi.get('/platform/audit', { params: filters }).then(r => setData(r.data)).catch(e => toast.error(errorMessage(e))), 200); return () => clearTimeout(timer); }, [filters]);
  return <Page title="Auditoría" subtitle="Registro inmutable de accesos y acciones críticas."><div className="platform-toolbar"><input placeholder="ID del tenant" inputMode="numeric" value={filters.tenantId} onChange={e => setFilters({ ...filters, tenantId: e.target.value })}/><input placeholder="Acción exacta" value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value })}/><select value={filters.outcome} onChange={e => setFilters({ ...filters, outcome: e.target.value })}><option value="">Todos los resultados</option><option value="SUCCESS">Exitosos</option><option value="FAILURE">Fallidos</option></select></div><div className="platform-table-wrap"><table><thead><tr><th>Fecha</th><th>Acción</th><th>Resultado</th><th>Tenant</th><th>Motivo</th><th>IP</th></tr></thead><tbody>{data?.items?.map(item => <tr key={item.id}><td><small>{date(item.createdAt)}</small></td><td><strong>{item.action}</strong></td><td>{item.outcome}</td><td>{item.targetTenantSlug || '—'}</td><td>{item.reason || '—'}</td><td><small>{item.ipAddress || '—'}</small></td></tr>)}</tbody></table></div></Page>;
}

function PlatformRoutes() {
  return <Routes><Route path="/login" element={<Login/>}/><Route path="/*" element={<Guard><Shell><Routes><Route path="/dashboard" element={<Dashboard/>}/><Route path="/tenants" element={<Tenants/>}/><Route path="/tenants/:id" element={<TenantDetail/>}/><Route path="/audit" element={<Audit/>}/><Route path="*" element={<Navigate to="/dashboard" replace/>}/></Routes></Shell></Guard>}/></Routes>;
}

export default function PlatformApp() { return <PlatformProvider><ToastContainer position="top-right" theme="light"/><PlatformRoutes/></PlatformProvider>; }
