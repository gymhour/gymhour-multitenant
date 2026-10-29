import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import apiClient from '../../../axiosConfig';
import apiService from '../../../services/apiService';
import ConfirmationPopup from '../../../Components/utils/ConfirmationPopUp/ConfirmationPopUp';
import '../../../App.css';
import './CuotasUsuarios.css';

const dateInput = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const formatDate = value => value ? new Date(value).toLocaleDateString('es-AR', { timeZone: 'UTC' }) : '—';
const money = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value ?? 0);
const message = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

export default function CuotasUsuarios({ fromAdmin }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({ mes: searchParams.get('mes') || '', estado: searchParams.get('estado') || '', studentName: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ totalItems: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [student, setStudent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ fechaFin: '', importe: '', pagada: false, formaPago: 'Efectivo', fechaPago: dateInput() });
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(null);
  const [payMethod, setPayMethod] = useState('Efectivo');
  const [payDate, setPayDate] = useState(dateInput());
  const [deleting, setDeleting] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/cuotas', { params: { page, ...applied } });
      setRows(data.data || []);
      setMeta(data.meta || { totalItems: 0, totalPages: 0 });
    } catch (error) { toast.error(message(error, 'No pudimos cargar las cuotas.')); }
    finally { setLoading(false); }
  }, [page, applied]);

  useEffect(() => { load(); }, [load, refresh]);

  useEffect(() => {
    if (!creating || search.trim().length < 2) { setStudents([]); return; }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await apiService.getAllUsuarios({ page: 1, take: 20, role: 'STUDENT', estado: true, search });
        if (current) setStudents(result.data || []);
      } catch (error) { if (current) toast.error(message(error, 'No pudimos buscar alumnos.')); }
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [creating, search]);

  useEffect(() => {
    if (!student) { setPreview(null); return; }
    let current = true;
    apiClient.get(`/cuotas/usuario/${student.ID_Usuario}/preview`).then(({ data }) => {
      if (!current) return;
      setPreview(data);
      setForm({ fechaFin: data.fechaFinSugerida, importe: String(data.importeSugerido), pagada: false, formaPago: 'Efectivo', fechaPago: dateInput() });
    }).catch(error => { if (current) toast.error(message(error, 'No pudimos calcular la próxima cuota.')); });
    return () => { current = false; };
  }, [student]);

  const applyFilters = event => {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
    const params = new URLSearchParams();
    if (filters.mes) params.set('mes', filters.mes);
    if (filters.estado) params.set('estado', filters.estado);
    setSearchParams(params);
  };

  const createFee = async event => {
    event.preventDefault();
    if (!student || !preview) return;
    setSaving(true);
    try {
      await apiClient.post(`/cuotas/usuario/${student.ID_Usuario}`, {
        fechaFin: form.fechaFin, importe: Number(form.importe), pagada: form.pagada,
        ...(form.pagada ? { formaPago: form.formaPago, fechaPago: form.fechaPago } : {}),
      });
      toast.success('Cuota creada. El próximo ciclo se calculará desde el día siguiente al fin del período.');
      setCreating(false); setStudent(null); setSearch(''); setRefresh(value => value + 1);
    } catch (error) { toast.error(message(error, 'No pudimos crear la cuota.')); }
    finally { setSaving(false); }
  };

  const pay = async event => {
    event.preventDefault();
    if (!paying) return;
    setSaving(true);
    try {
      await apiClient.put(`/cuotas/${paying.ID_Cuota}/pay`, { formaPago: payMethod, fechaPago: payDate });
      toast.success('Pago registrado.'); setPaying(null); setRefresh(value => value + 1);
    } catch (error) { toast.error(message(error, 'No pudimos registrar el pago.')); }
    finally { setSaving(false); }
  };

  const deleteFee = async () => {
    if (!deleting || deleteSaving) return;
    setDeleteSaving(true);
    try {
      await apiClient.delete(`/cuotas/${deleting.ID_Cuota}`);
      toast.success('Cuota eliminada.');
      setDeleting(null);
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else setRefresh(value => value + 1);
    } catch (error) { toast.error(message(error, 'No pudimos eliminar la cuota.')); }
    finally { setDeleteSaving(false); }
  };

  return <div className="page-layout">
    <SidebarMenu isAdmin={fromAdmin} />
    <main className="content-layout fee-cycle-page">
      <div className="fee-cycle-heading"><div><h1>Cuotas</h1><p>Cada socio tiene su propio período y día de cobro. Las próximas cuotas se crean automáticamente tres días antes del vencimiento.</p></div><button className="primary-button" onClick={() => setCreating(true)}>Crear próxima cuota</button></div>
      <form className="fee-cycle-filters" onSubmit={applyFilters}>
        <label>Mes de vencimiento<input type="month" value={filters.mes} onChange={e => setFilters({ ...filters, mes: e.target.value })} /></label>
        <label>Estado<select value={filters.estado} onChange={e => setFilters({ ...filters, estado: e.target.value })}><option value="">Todos</option><option value="pendiente">Pendiente</option><option value="pagada">Pagada</option><option value="vencida">Vencida</option></select></label>
        <label>Socio<input value={filters.studentName} onChange={e => setFilters({ ...filters, studentName: e.target.value })} placeholder="Nombre o apellido" /></label>
        <button className="secondary-button" type="submit">Filtrar</button>
      </form>
      {loading ? <p>Cargando cuotas…</p> : rows.length === 0 ? <p>No hay cuotas para mostrar.</p> : <div className="table-responsive"><table className="cuotas-table"><thead><tr><th>Socio</th><th>Período cubierto</th><th>Vence</th><th>Plan</th><th>Importe</th><th>Estado</th><th>Pago</th><th>Acción</th></tr></thead><tbody>{rows.map(fee => <tr key={fee.ID_Cuota}>
        <td data-label="Socio">{fee.User ? `${fee.User.nombre} ${fee.User.apellido}` : '—'}</td>
        <td data-label="Período">{fee.fechaInicio && fee.fechaFin ? `${formatDate(fee.fechaInicio)} – ${formatDate(fee.fechaFin)}` : fee.mes}</td>
        <td data-label="Vence">{formatDate(fee.vence)}</td>
        <td data-label="Plan">{fee.planNombreSnapshot || fee.User?.plan?.nombre || '—'}</td>
        <td data-label="Importe">{money(fee.importe)}</td>
        <td data-label="Estado"><span className={`badge ${fee.pagada ? 'paid' : fee.vencida ? 'expired' : 'pending'}`}>{fee.pagada ? 'Pagada' : fee.vencida ? 'Vencida' : 'Pendiente'}</span></td>
        <td data-label="Pago">{fee.pagada ? `${formatDate(fee.fechaPago)} · ${fee.formaPago || '—'}` : '—'}</td>
        <td data-label="Acción"><div className="fee-cycle-row-actions">
          {!fee.pagada && <button type="button" className="accion-button pay" onClick={() => { setPaying(fee); setPayDate(dateInput()); }}>Registrar pago</button>}
          <button type="button" className="accion-button delete" onClick={() => setDeleting(fee)} aria-label={`Eliminar cuota de ${fee.User?.nombre || 'socio'} ${fee.User?.apellido || ''}`}>Eliminar</button>
        </div></td>
      </tr>)}</tbody></table></div>}
      <div className="fee-cycle-pagination"><span>{meta.totalItems} cuotas</span><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>{page} / {Math.max(1, meta.totalPages)}</span><button type="button" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
    </main>

    {creating && <div className="fee-cycle-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) { setCreating(false); setStudent(null); } }}><div className="fee-cycle-dialog" role="dialog" aria-modal="true" aria-label="Crear próxima cuota"><div className="fee-cycle-dialog-head"><h2>Crear próxima cuota</h2><button type="button" onClick={() => { setCreating(false); setStudent(null); }} aria-label="Cerrar">×</button></div><p>Elegí un socio. El período propuesto empieza donde terminó su última cuota, o en su próximo aniversario de cobro.</p>
      <label>Buscar socio<input autoFocus value={search} onChange={e => { setSearch(e.target.value); setStudent(null); }} placeholder="Nombre, apellido o DNI" /></label>
      {!student && students.length > 0 && <div className="fee-cycle-students">{students.map(item => <button key={item.ID_Usuario} type="button" onClick={() => { setStudent(item); setSearch(`${item.nombre} ${item.apellido}`); setStudents([]); }}>{item.nombre} {item.apellido} {item.dni ? `· ${item.dni}` : ''}{item.plan && !item.cobroAutomaticoActivo ? ' · Primera cuota pendiente' : ''}</button>)}</div>}
      {student && preview && <form onSubmit={createFee}><div className="fee-cycle-preview"><strong>{student.nombre} {student.apellido}</strong><span>Inicio y vencimiento: {formatDate(`${preview.fechaInicio}T00:00:00Z`)}</span><span>Plan: {preview.plan.nombre}</span></div>
        <label>Fin del período<input type="date" min={preview.fechaInicio} required value={form.fechaFin} onChange={e => setForm({ ...form, fechaFin: e.target.value })} /></label>
        <label>Importe<input type="number" min="0" step="0.01" required value={form.importe} onChange={e => setForm({ ...form, importe: e.target.value })} /></label>
        <label>Estado<select value={form.pagada ? 'pagada' : 'pendiente'} onChange={e => setForm({ ...form, pagada: e.target.value === 'pagada' })}><option value="pendiente">Pendiente</option><option value="pagada">Pagada</option></select></label>
        {form.pagada && <><label>Medio de pago<input required value={form.formaPago} onChange={e => setForm({ ...form, formaPago: e.target.value })} /></label><label>Fecha de pago<input type="date" max={dateInput()} required value={form.fechaPago} onChange={e => setForm({ ...form, fechaPago: e.target.value })} /></label></>}
        <div className="fee-cycle-actions"><button type="button" onClick={() => setCreating(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Crear cuota'}</button></div>
      </form>}
    </div></div>}

    {paying && <div className="fee-cycle-overlay"><form className="fee-cycle-dialog" role="dialog" aria-modal="true" aria-label="Registrar pago" onSubmit={pay}><div className="fee-cycle-dialog-head"><h2>Registrar pago</h2><button type="button" onClick={() => setPaying(null)} aria-label="Cerrar">×</button></div><p>{paying.User?.nombre} {paying.User?.apellido} · {money(paying.importe)}</p><label>Medio de pago<input required value={payMethod} onChange={e => setPayMethod(e.target.value)} /></label><label>Fecha de pago<input type="date" required max={dateInput()} value={payDate} onChange={e => setPayDate(e.target.value)} /></label><div className="fee-cycle-actions"><button type="button" onClick={() => setPaying(null)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Registrar pago'}</button></div></form></div>}
    <ConfirmationPopup
      isOpen={Boolean(deleting)}
      message={`¿Eliminar la cuota de ${deleting?.User?.nombre || 'este socio'} ${deleting?.User?.apellido || ''} por ${money(deleting?.importe)}? Esta acción no se puede deshacer.`}
      confirmText="Eliminar cuota"
      isLoading={deleteSaving}
      onClose={() => setDeleting(null)}
      onConfirm={deleteFee}
    />
  </div>;
}
