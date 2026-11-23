import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import ReactDatePicker from 'react-datepicker';
import { es } from 'date-fns/locale';
import { CalendarDays, ChevronDown, CircleHelp, Search } from 'lucide-react';
import 'react-datepicker/dist/react-datepicker.css';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import apiClient from '../../../axiosConfig';
import apiService from '../../../services/apiService';
import ConfirmationPopup from '../../../Components/utils/ConfirmationPopUp/ConfirmationPopUp';
import { useAuth } from '../../../context/AuthContext';
import { feeDurationLabel, parseFeeDuration } from '../../../utils/feeDuration';
import '../../../App.css';
import './CuotasUsuarios.css';

const dateInput = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const formatDate = value => value ? new Date(value).toLocaleDateString('es-AR', { timeZone: 'UTC' }) : '—';
const money = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value ?? 0);
const message = (error, fallback) => error?.response?.data?.message || error?.message || fallback;
const monthDate = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')
  ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1)
  : null;
const monthValue = date => date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : '';
const localDay = value => value ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) : null;
const occupiedDates = periods => (periods || []).map(period => ({ start: localDay(period.fechaInicio), end: localDay(period.fechaFin) }));
const periodEndForStart = (startValue, preview) => {
  const start = localDay(startValue);
  if (!start || !preview?.plan) return '';
  const { unit, count } = parseFeeDuration(preview.plan.duracion);
  const anchor = startValue === preview.fechaInicio ? preview.diaAnclaCobro : start.getDate();
  const next = unit === 'WEEKS'
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + count * 7)
    : new Date(start.getFullYear(), start.getMonth() + count, Math.min(anchor, new Date(start.getFullYear(), start.getMonth() + count + 1, 0).getDate()));
  next.setDate(next.getDate() - 1);
  return dateInput(next);
};
const periodOverlaps = (start, end, periods) => (periods || []).some(period => start <= period.fechaFin && end >= period.fechaInicio);

// Avisos de Mercado Pago para el admin (ver gymhour-backend/MERCADOPAGO.md).
const ALERT_LABELS = {
  DEVUELTO: 'Pago devuelto', CONTRACARGO: 'Contracargo', DUPLICADO: 'Pago duplicado', REVISAR: 'Para revisar', APROBADO: 'Revisar importe',
};
const ONLINE_IN_PROGRESS = ['INICIADO', 'PENDIENTE'];

export default function CuotasUsuarios({ fromAdmin }) {
  const { tenant } = useAuth();
  const onlinePayments = Boolean(tenant?.billing?.features?.MEMBER_PAYMENTS);
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
  const [form, setForm] = useState({ fechaInicio: '', fechaFin: '', vence: '', importe: '', pagada: false, formaPago: 'Efectivo', fechaPago: dateInput() });
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(null);
  const [payMethod, setPayMethod] = useState('Efectivo');
  const [payDate, setPayDate] = useState(dateInput());
  const [payReference, setPayReference] = useState('');
  const [payLateFee, setPayLateFee] = useState(null);
  const [applyLateFee, setApplyLateFee] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [debits, setDebits] = useState([]);
  const [cancelDebitFee, setCancelDebitFee] = useState(null);
  const [cancelDebitSaving, setCancelDebitSaving] = useState(false);

  useEffect(() => {
    if (!onlinePayments) return;
    let current = true;
    Promise.all([apiService.getPaymentAlerts(), apiService.getAutomaticDebits()])
      .then(([alertList, debitList]) => { if (current) { setAlerts(alertList || []); setDebits(debitList || []); } })
      .catch(error => { if (current) toast.error(error.message); });
    return () => { current = false; };
  }, [onlinePayments, refresh]);

  const reviewAlert = async alert => {
    try {
      await apiService.reviewPaymentAlert(alert.id);
      setAlerts(list => list.filter(item => item.id !== alert.id));
    } catch (error) { toast.error(error.message); }
  };

  // Para registrar a mano una cuota cubierta por el débito, primero se cancela el débito en Mercado Pago.
  const cancelDebitAndPay = async () => {
    const fee = cancelDebitFee;
    const debit = debits.find(item => item.ID_Usuario === fee?.ID_Usuario);
    if (!fee || !debit) { setCancelDebitFee(null); return; }
    setCancelDebitSaving(true);
    try {
      await apiService.cancelAutomaticDebit(debit.id, 'El gimnasio registró el pago por otro medio.');
      toast.success('Débito automático cancelado. Ya podés registrar el pago.');
      setCancelDebitFee(null);
      setRefresh(value => value + 1);
      openPayment({ ...fee, cubiertaPorDebito: false });
    } catch (error) { toast.error(error.message); }
    finally { setCancelDebitSaving(false); }
  };

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
    if (searchParams.get('action') !== 'create') return;
    setCreating(true);
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
    // El parámetro es una orden de navegación que debe consumirse una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setForm({ fechaInicio: data.fechaInicio, fechaFin: data.fechaFinSugerida, vence: data.vence, importe: String(data.importeSugerido), pagada: false, formaPago: 'Efectivo', fechaPago: dateInput() });
    }).catch(error => { if (current) toast.error(message(error, 'No pudimos calcular la próxima cuota.')); });
    return () => { current = false; };
  }, [student]);

  // El recargo lo calcula el backend para la fecha de pago elegida.
  useEffect(() => {
    if (!paying || !payDate) { setPayLateFee(null); return; }
    let current = true;
    apiClient.get(`/cuotas/${paying.ID_Cuota}/recargo`, { params: { fechaPago: payDate } })
      .then(({ data }) => { if (current) setPayLateFee(data); })
      .catch(() => { if (current) setPayLateFee(null); });
    return () => { current = false; };
  }, [paying, payDate]);

  const openPayment = fee => {
    setPaying(fee); setPayDate(dateInput()); setPayReference(''); setApplyLateFee(true); setPayLateFee(null);
  };

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
        fechaInicio: form.fechaInicio, fechaFin: form.fechaFin, vence: form.vence,
        importe: Number(form.importe), pagada: form.pagada,
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
      await apiClient.put(`/cuotas/${paying.ID_Cuota}/pay`, {
        formaPago: payMethod, fechaPago: payDate, referenciaPago: payReference.trim() || undefined,
        aplicarRecargo: Boolean(applyLateFee && payLateFee?.monto > 0),
      });
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

  const blocked = occupiedDates(preview?.periodosOcupados);
  const canStartOn = date => {
    if (!preview) return false;
    const start = dateInput(date);
    const end = periodEndForStart(start, preview);
    return start >= preview.fechaInicio && !periodOverlaps(start, end, preview.periodosOcupados);
  };

  return <div className="page-layout">
    <SidebarMenu isAdmin={fromAdmin} />
    <main className="content-layout fee-cycle-page">
      <div className="fee-cycle-heading"><div><h1>Cuotas</h1><p>Cada socio tiene su propio período y día de cobro. Las próximas cuotas se crean automáticamente tres días antes de que comience el siguiente período.</p></div><button className="primary-button" onClick={() => setCreating(true)}>Crear próxima cuota</button></div>
      <form className="fee-cycle-filters" onSubmit={applyFilters}>
        <div className="fee-cycle-filter-field">
          <label htmlFor="fee-cycle-month">Mes de vencimiento del pago</label>
          <div className="fee-cycle-filter-control fee-cycle-filter-month">
            <CalendarDays size={17} aria-hidden="true" />
            <ReactDatePicker
              id="fee-cycle-month"
              selected={monthDate(filters.mes)}
              onChange={date => setFilters(current => ({ ...current, mes: monthValue(date) }))}
              dateFormat="MMMM yyyy"
              showMonthYearPicker
              locale={es}
              placeholderText="Todos los meses"
              isClearable
              autoComplete="off"
              calendarClassName="fee-cycle-month-calendar"
              popperClassName="fee-cycle-month-popper"
            />
          </div>
        </div>
        <div className="fee-cycle-filter-field">
          <label htmlFor="fee-cycle-status">Estado</label>
          <div className="fee-cycle-filter-control fee-cycle-filter-select">
            <select id="fee-cycle-status" value={filters.estado} onChange={e => setFilters(current => ({ ...current, estado: e.target.value }))}><option value="">Todos los estados</option><option value="pendiente">Pendiente</option><option value="pagada">Pagada</option><option value="vencida">Vencida</option></select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </div>
        <div className="fee-cycle-filter-field fee-cycle-filter-student">
          <label htmlFor="fee-cycle-student">Socio</label>
          <div className="fee-cycle-filter-control">
            <Search size={17} aria-hidden="true" />
            <input id="fee-cycle-student" value={filters.studentName} onChange={e => setFilters(current => ({ ...current, studentName: e.target.value }))} placeholder="Nombre o apellido" />
          </div>
        </div>
        <button className="primary-button fee-cycle-filter-submit" type="submit">Aplicar filtros</button>
      </form>
      {alerts.length > 0 && <section className="fee-cycle-alerts" aria-label="Avisos de Mercado Pago">
        <h2>Avisos de Mercado Pago</h2>
        <p>Revisalos en tu cuenta de Mercado Pago. Las devoluciones se hacen desde Mercado Pago, no desde Gymhour.</p>
        <ul>{alerts.map(alert => <li key={alert.id}>
          <div>
            <strong>{ALERT_LABELS[alert.status] || 'Para revisar'}</strong>
            <span>{alert.socio ? `${alert.socio.nombre} ${alert.socio.apellido}` : 'Socio'}{alert.cuota?.fechaInicio ? ` · cuota del ${formatDate(alert.cuota.fechaInicio)}` : ''}{alert.mpPaymentId ? ` · Op. N° ${alert.mpPaymentId}` : ''} · {money(alert.amount)}</span>
            {alert.reviewNote && <small>{alert.reviewNote}</small>}
          </div>
          <button type="button" onClick={() => reviewAlert(alert)}>Marcar como revisado</button>
        </li>)}</ul>
      </section>}
      {loading ? <p>Cargando cuotas…</p> : rows.length === 0 ? <p>No hay cuotas para mostrar.</p> : <div className="table-responsive"><table className="cuotas-table"><thead><tr><th>Socio</th><th>Período cubierto</th><th>Vencimiento del pago</th><th>Plan</th><th>Importe</th><th>Estado</th><th>Pago</th><th>Acción</th></tr></thead><tbody>{rows.map(fee => <tr key={fee.ID_Cuota}>
        <td data-label="Socio">{fee.User ? `${fee.User.nombre} ${fee.User.apellido}` : '—'}</td>
        <td data-label="Período">{fee.fechaInicio && fee.fechaFin ? `${formatDate(fee.fechaInicio)} – ${formatDate(fee.fechaFin)}` : fee.mes}</td>
        <td data-label="Vencimiento del pago">{formatDate(fee.vence)}</td>
        <td data-label="Plan">{fee.planNombreSnapshot || fee.User?.plan?.nombre || '—'}</td>
        <td data-label="Importe">{money(fee.importe)}{fee.pagada && fee.recargo > 0 && <small className="fee-cycle-late-fee"> + {money(fee.recargo)} de recargo</small>}{!fee.pagada && fee.recargoSugerido?.monto > 0 && <small className="fee-cycle-late-fee"> + {money(fee.recargoSugerido.monto)} de recargo hoy</small>}</td>
        <td data-label="Estado"><span className={`badge ${fee.pagada ? 'paid' : fee.vencida ? 'expired' : 'pending'}`}>{fee.pagada ? 'Pagada' : fee.vencida ? 'Vencida' : 'Pendiente'}</span></td>
        <td data-label="Pago">
          {fee.pagada ? `${formatDate(fee.fechaPago)} · ${fee.formaPago || '—'}${fee.referenciaPago ? ` · ${fee.formaPago?.startsWith('Mercado Pago') ? 'Op. ' : ''}N° ${fee.referenciaPago}` : ''}` : '—'}
          {fee.pagada && fee.pagoEnLinea?.status === 'APROBADO' && fee.pagoEnLinea.paymentMethod && <small className="fee-cycle-late-fee">{fee.pagoEnLinea.paymentMethod}{fee.pagoEnLinea.netAmount != null ? ` · neto ${money(fee.pagoEnLinea.netAmount)}` : ''}</small>}
          {!fee.pagada && ONLINE_IN_PROGRESS.includes(fee.pagoEnLinea?.status) && <span className="fee-cycle-chip">{fee.pagoEnLinea.status === 'PENDIENTE' ? 'Pago en revisión (Mercado Pago)' : `Pago en curso (Mercado Pago)${fee.pagoEnLinea.expiresAt ? `, vence ${new Date(fee.pagoEnLinea.expiresAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : ''}`}</span>}
          {!fee.pagada && fee.cubiertaPorDebito && <span className="fee-cycle-chip">Débito automático</span>}
        </td>
        <td data-label="Acción"><div className="fee-cycle-row-actions">
          {!fee.pagada && !fee.cubiertaPorDebito && <button type="button" className="accion-button pay" disabled={ONLINE_IN_PROGRESS.includes(fee.pagoEnLinea?.status)} title={ONLINE_IN_PROGRESS.includes(fee.pagoEnLinea?.status) ? 'El socio está pagando esta cuota con Mercado Pago' : undefined} onClick={() => openPayment(fee)}>Registrar pago</button>}
          {!fee.pagada && fee.cubiertaPorDebito && <button type="button" className="accion-button pay" onClick={() => setCancelDebitFee(fee)}>Cancelar débito y registrar pago</button>}
          <button type="button" className="accion-button delete" disabled={ONLINE_IN_PROGRESS.includes(fee.pagoEnLinea?.status) || (!fee.pagada && fee.cubiertaPorDebito)} onClick={() => setDeleting(fee)} aria-label={`Eliminar cuota de ${fee.User?.nombre || 'socio'} ${fee.User?.apellido || ''}`}>Eliminar</button>
        </div></td>
      </tr>)}</tbody></table></div>}
      <div className="fee-cycle-pagination"><span>{meta.totalItems} cuotas</span><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>{page} / {Math.max(1, meta.totalPages)}</span><button type="button" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
    </main>

    {creating && <div className="fee-cycle-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) { setCreating(false); setStudent(null); } }}><div className="fee-cycle-dialog fee-cycle-create-dialog" role="dialog" aria-modal="true" aria-label="Crear próxima cuota"><div className="fee-cycle-dialog-head"><div><h2>Crear próxima cuota</h2><p>Elegí un socio y revisá los datos del nuevo período.</p></div><button type="button" onClick={() => { setCreating(false); setStudent(null); }} aria-label="Cerrar">×</button></div>
      <label className="fee-cycle-student-search">Socio<input autoFocus value={search} onChange={e => { setSearch(e.target.value); setStudent(null); }} placeholder="Buscar por nombre, apellido o DNI" /></label>
      {!student && students.length > 0 && <div className="fee-cycle-students">{students.map(item => <button key={item.ID_Usuario} type="button" onClick={() => { setStudent(item); setSearch(`${item.nombre} ${item.apellido}`); setStudents([]); }}>{item.nombre} {item.apellido} {item.dni ? `· ${item.dni}` : ''}{item.plan && !item.cobroAutomaticoActivo ? ' · Primera cuota pendiente' : ''}</button>)}</div>}
      {student && preview && <form className="fee-cycle-create-form" onSubmit={createFee}>
        <p className="fee-cycle-plan-line">Plan de {student.nombre} {student.apellido}: <strong>{preview.plan.nombre}</strong></p>
        <div className="fee-cycle-form-section"><h3>Período de la cuota</h3><div className="fee-cycle-field-grid">
          <label>Inicio del período<ReactDatePicker selected={localDay(form.fechaInicio)} onChange={date => { const fechaInicio = dateInput(date); setForm(current => ({ ...current, fechaInicio, fechaFin: periodEndForStart(fechaInicio, preview), vence: fechaInicio })); }} minDate={localDay(preview.fechaInicio)} excludeDateIntervals={blocked} filterDate={canStartOn} dateFormat="dd/MM/yyyy" locale={es} required autoComplete="off" portalId="fee-cycle-date-portal" /></label>
          <label>Fin del período<input type="date" value={form.fechaFin} disabled aria-describedby="fee-cycle-end-explanation" /><small id="fee-cycle-end-explanation">El plan cubre {feeDurationLabel(preview.plan.duracion)}. Para cambiar el fin, modificá el plan.</small></label>
        </div></div>
        <div className="fee-cycle-form-section"><h3>Pago</h3><div className="fee-cycle-field-grid">
          <div className="fee-cycle-field"><div className="fee-cycle-field-title"><label htmlFor="fee-payment-due">Vencimiento del pago</label><span className="fee-cycle-help"><button type="button" aria-label="¿Para qué sirve el vencimiento del pago?" aria-describedby="fee-payment-due-tooltip"><CircleHelp size={16} aria-hidden="true" /></button><span id="fee-payment-due-tooltip" role="tooltip">Es el último día para pagar esta cuota. Si pasa sin registrar el pago, la cuota queda vencida y puede bloquear reservas e ingresos.</span></span></div><ReactDatePicker id="fee-payment-due" selected={localDay(form.vence)} onChange={date => setForm(current => ({ ...current, vence: dateInput(date) }))} minDate={localDay(form.fechaInicio)} maxDate={localDay(form.fechaFin)} dateFormat="dd/MM/yyyy" locale={es} required autoComplete="off" portalId="fee-cycle-date-portal" /></div>
          <label>Importe<input type="number" min="0" step="0.01" required value={form.importe} onChange={e => setForm({ ...form, importe: e.target.value })} /></label>
          <label>Estado<select value={form.pagada ? 'pagada' : 'pendiente'} onChange={e => setForm({ ...form, pagada: e.target.value === 'pagada' })}><option value="pendiente">Pendiente</option><option value="pagada">Pagada</option></select></label>
          {form.pagada && <><label>Medio de pago<input required value={form.formaPago} onChange={e => setForm({ ...form, formaPago: e.target.value })} /></label><label>Fecha de pago<input type="date" max={dateInput()} required value={form.fechaPago} onChange={e => setForm({ ...form, fechaPago: e.target.value })} /></label></>}
        </div></div>
        <div className="fee-cycle-actions"><button type="button" onClick={() => setCreating(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Crear cuota'}</button></div>
      </form>}
    </div></div>}

    {paying && <div className="fee-cycle-overlay"><form className="fee-cycle-dialog" role="dialog" aria-modal="true" aria-label="Registrar pago" onSubmit={pay}><div className="fee-cycle-dialog-head"><h2>Registrar pago</h2><button type="button" onClick={() => setPaying(null)} aria-label="Cerrar">×</button></div><p>{paying.User?.nombre} {paying.User?.apellido} · {money(paying.importe)}</p><label>Medio de pago<input required value={payMethod} onChange={e => setPayMethod(e.target.value)} /></label><label>Fecha de pago<input type="date" required max={dateInput()} value={payDate} onChange={e => setPayDate(e.target.value)} /></label><label>N° de comprobante <small>Opcional</small><input value={payReference} maxLength={100} placeholder="Por ejemplo, el número de la transferencia" onChange={e => setPayReference(e.target.value)} /></label>
      {payLateFee?.monto > 0 && <label className="fee-cycle-late-fee-option"><input type="checkbox" checked={applyLateFee} onChange={e => setApplyLateFee(e.target.checked)} /><span>Cobrar recargo por atraso: {money(payLateFee.monto)} ({payLateFee.dias} {payLateFee.dias === 1 ? 'día' : 'días'} después del vencimiento)</span></label>}
      {payLateFee?.monto > 0 && <p className="fee-cycle-pay-total">Total a registrar: <strong>{money(paying.importe + (applyLateFee ? payLateFee.monto : 0))}</strong></p>}
      <div className="fee-cycle-actions"><button type="button" onClick={() => setPaying(null)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Registrar pago'}</button></div></form></div>}
    <ConfirmationPopup
      isOpen={Boolean(cancelDebitFee)}
      message={`${cancelDebitFee?.User?.nombre || 'El socio'} ${cancelDebitFee?.User?.apellido || ''} tiene débito automático. Para registrar el pago de otra forma hay que cancelar el débito en Mercado Pago: no se le va a cobrar más y tendrá que volver a adherirse. ¿Seguimos?`}
      confirmText="Cancelar débito"
      isLoading={cancelDebitSaving}
      onClose={() => setCancelDebitFee(null)}
      onConfirm={cancelDebitAndPay}
    />
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
