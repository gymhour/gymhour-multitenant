import { getCurrentUserId } from '../../../authSession';
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import './Cuotas.css';
import { Copy, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';
import apiService from '../../../services/apiService';
import CLIENT_SETUP from '../../../setup';
import { useAuth } from '../../../context/AuthContext';
import AutomaticDebitCard from './AutomaticDebitCard';

// Resultado de un pago al volver de Mercado Pago (ver gymhour-backend/MERCADOPAGO.md).
const PAYMENT_RESULT = {
  APROBADO: ['success', 'Pago acreditado'],
  PENDIENTE: ['info', 'Tu pago está en revisión en Mercado Pago. Lo vas a ver acá cuando se acredite.'],
  INICIADO: ['info', 'El pago no se completó. Podés volver a intentarlo.'],
  RECHAZADO: ['error', 'Mercado Pago rechazó el pago. Podés intentar con otro medio.'],
  EXPIRADO: ['info', 'El pago venció sin completarse. Podés volver a intentarlo.'],
};

const timeOf = value => value
  ? new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  : '';

const Cuotas = () => {
  const { tenant, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cuotas, setCuotas] = useState([]);   // siempre array
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [payState, setPayState] = useState({ disponible: false, intentoActivo: null, debito: null });
  const [busyCuota, setBusyCuota] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const settings = tenant?.settings || {};
  const accountHolder = settings.paymentAccountHolder || CLIENT_SETUP.payment.accountHolder;
  const alias = settings.paymentAlias || CLIENT_SETUP.payment.alias;
  const cbu = settings.paymentCbu || CLIENT_SETUP.payment.cbu;
  const cuil = settings.paymentTaxId || CLIENT_SETUP.payment.cuil;
  const whatsapp = {
    phoneNumber: settings.paymentWhatsapp || CLIENT_SETUP.payment.whatsapp.phoneNumber,
    message: `¡Hola, ${tenant?.name || 'Gymhour'}! Les comparto el comprobante de pago de mi cuota:`,
  };
  const whatsappHref = `https://wa.me/${whatsapp.phoneNumber}?text=${encodeURIComponent(whatsapp.message)}`;
  const isConfigured = value => value && !String(value).startsWith('COMPLETAR_');
  // Mientras el cliente no tenga cargados sus datos de cobro, todos los campos
  // vienen con el prefijo COMPLETAR_ y la sección quedaría como un título vacío.
  const hasPaymentData = [accountHolder, alias, cbu, cuil, whatsapp.phoneNumber].some(isConfigured);
  const onlinePayments = Boolean(tenant?.billing?.features?.MEMBER_PAYMENTS);

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copiado al portapapeles');
    } catch (err) {
      console.error('Error copiando al portapapeles', err);
      toast.error('No se pudo copiar');
    }
  };

  // "2025-05" -> "mayo de 2025"
  const formatMonth = (yyyyMM) => {
    if (!yyyyMM) return '–';
    const [y, m] = String(yyyyMM).split('-').map(Number);
    if (!y || !m) return '–';
    // Evitamos problemas de timezone creando la fecha en UTC
    const d = new Date(Date.UTC(y, m - 1, 1));
    return d.toLocaleString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  };

  // Las fechas de la cuota (inicio, fin, vencimiento y pago) son días del gimnasio guardados en UTC.
  // Sin timeZone 'UTC', en Argentina se mostraban un día antes, a diferencia de la vista del admin.
  const formatDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('es-AR', { timeZone: 'UTC' }) : '–';

  const formatCurrency = (val) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: settings.currency || 'ARS' }).format(val ?? 0);

  const fetchCuotas = useCallback(async () => {
    setLoading(true);
    try {
      const userId = getCurrentUserId();

      // Esperamos la promesa y normalizamos la respuesta a array
      const res = await apiService.getCuotasUsuario(userId);

      const lista =
        Array.isArray(res) ? res
          : Array.isArray(res?.data) ? res.data
            : Array.isArray(res?.data?.data) ? res.data.data
              : [];

      setCuotas(lista);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Error al cargar las cuotas.');
      setCuotas([]); // mantené array para no romper el render
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPayState = useCallback(async () => {
    if (!onlinePayments) return;
    try {
      setPayState(await apiService.getMyPaymentState());
    } catch (err) {
      console.error(err);
    }
  }, [onlinePayments]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchCuotas(), fetchPayState()]);
  }, [fetchCuotas, fetchPayState]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Vuelta desde Mercado Pago: ?pago=<referencia> (botón de pago) o ?debito=<referencia> (débito).
  useEffect(() => {
    const ref = searchParams.get('pago');
    const debit = searchParams.get('debito');
    if (!ref && !debit) return;
    const next = new URLSearchParams(searchParams);
    next.delete('pago');
    next.delete('debito');
    next.delete('collection_id'); next.delete('collection_status'); next.delete('payment_id'); next.delete('status');
    next.delete('external_reference'); next.delete('payment_type'); next.delete('merchant_order_id');
    next.delete('preference_id'); next.delete('site_id'); next.delete('processing_mode'); next.delete('merchant_account_id');
    next.delete('preapproval_id');
    setSearchParams(next, { replace: true });
    (async () => {
      try {
        if (ref) {
          const result = await apiService.verifyPaymentAttempt(ref);
          const [kind, text] = PAYMENT_RESULT[result.status] || ['info', 'Estamos revisando tu pago.'];
          toast[kind](result.status === 'APROBADO' && result.mpPaymentId ? `${text}. Op. N° ${result.mpPaymentId}` : text);
        } else {
          const result = await apiService.verifyMyAutomaticDebit();
          if (result?.status === 'ACTIVO') toast.success('Tu débito automático quedó activo.');
          else if (result?.status === 'PENDIENTE') toast.info('Todavía no vemos la autorización en Mercado Pago. Probá verificar en unos minutos.');
        }
      } catch (err) {
        toast.error(err.message);
      } finally {
        refreshAll();
      }
    })();
    // Se procesa una sola vez por vuelta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPayment = async (cuota) => {
    setBusyCuota(cuota.ID_Cuota);
    try {
      const result = await apiService.startCuotaCheckout(cuota.ID_Cuota);
      window.location.assign(result.initPoint);
    } catch (err) {
      toast.error(err.message);
      setBusyCuota(null);
      fetchPayState();
    }
  };

  const verifyActive = async () => {
    if (!payState.intentoActivo) return;
    setVerifying(true);
    try {
      const result = await apiService.verifyPaymentAttempt(payState.intentoActivo.ref);
      const [kind, text] = PAYMENT_RESULT[result.status] || ['info', 'Estamos revisando tu pago.'];
      toast[kind](text);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setVerifying(false);
      refreshAll();
    }
  };

  const active = payState.intentoActivo;
  const canPayOnline = onlinePayments && payState.disponible;
  const plan = cuotas.find(c => c.User?.plan)?.User?.plan || null;

  const paymentAction = (c) => {
    if (c.pagada) return null;
    if (c.cubiertaPorDebito) return <span className="cuotas-debito-chip">Se cobra con débito automático</span>;
    if (c.pagoEnLinea?.status === 'PENDIENTE') return <span className="cuotas-debito-chip">Pago en revisión</span>;
    if (!canPayOnline) return null;
    const total = c.importe + (c.recargoSugerido?.monto || 0);
    if (active && active.cuotaId !== c.ID_Cuota) return <span className="cuotas-debito-chip">Tenés otro pago en curso</span>;
    return (
      <button type="button" className="cuotas-pay-btn" disabled={busyCuota !== null} onClick={() => startPayment(c)}>
        {busyCuota === c.ID_Cuota ? 'Abriendo Mercado Pago…' : active ? 'Continuar el pago' : `Pagar ${formatCurrency(total)}`}
      </button>
    );
  };

  return (
    <div className="page-layout">
      <SidebarMenu isAdmin={false} />

      <div className="content-layout">
        <h1>Cuotas</h1>

        {active && (
          <div className="cuotas-pago-en-curso" role="status">
            {active.status === 'PENDIENTE' ? (
              <span>Tu pago de {formatCurrency(active.amount)} está en revisión en Mercado Pago{active.mpPaymentId ? ` (Op. N° ${active.mpPaymentId})` : ''}. Mientras tanto no podés iniciar otro pago.</span>
            ) : (
              <span>Tenés un pago en curso de {formatCurrency(active.amount)}. Terminalo antes de las {timeOf(active.expiresAt)} o esperá a que venza para iniciar otro.</span>
            )}
            <div className="cuotas-debito-actions">
              {active.status === 'INICIADO' && active.initPoint && <a className="cuotas-pay-btn" href={active.initPoint}>Continuar el pago</a>}
              <button type="button" className="cuotas-secondary-btn" disabled={verifying} onClick={verifyActive}>
                <RefreshCw size={14} /> {verifying ? 'Verificando…' : 'Ya pagué, verificar'}
              </button>
            </div>
          </div>
        )}

        {(canPayOnline || (payState.debito && payState.debito.status !== 'CANCELADO')) && (
          <AutomaticDebitCard
            debit={payState.debito}
            plan={plan}
            defaultEmail={user?.email}
            formatCurrency={formatCurrency}
            onChange={refreshAll}
          />
        )}

        <div className="cuotas-datos-pagos">
          <h2>{canPayOnline ? 'También podés pagar por transferencia' : 'Datos de cuenta'}</h2>
          <div className="cuotas-datos-pagos-info">
            {isConfigured(accountHolder) && (
              <span style={{ fontWeight: '600' }} className="alias-and-bank">
                {accountHolder}
              </span>
            )}
            {isConfigured(alias) && (
              <span>
                <b>ALIAS:</b> {alias}{' '}
                <button className="copy-button" onClick={() => handleCopy(alias)}>
                  <Copy size={16} />
                </button>
              </span>
            )}
            {isConfigured(cbu) && (
              <span>
                <b>CBU:</b> {cbu}{' '}
                <button className="copy-button" onClick={() => handleCopy(cbu)}>
                  <Copy width={16} height={16} />
                </button>
              </span>
            )}
            {isConfigured(cuil) && <span><b>CUIL:</b> {cuil}</span>}
          </div>
          {isConfigured(whatsapp.phoneNumber) && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <button className="cuotas-wsp-btn">Enviar comprobante por WhatsApp</button>
            </a>
          )}
          {!hasPaymentData && (
            <p className="cuotas-datos-pagos-vacio">
              Todavía no hay datos de pago cargados. Consultá con el gimnasio.
            </p>
          )}

        </div>

        <h2>Historial de pagos</h2>
        {loading ? (
          <p style={{ marginTop: '20px' }}>Cargando cuotas...</p>
        ) : error ? (
          <p className="text-error">{error}</p>
        ) : (cuotas?.length ?? 0) === 0 ? (
          <p>No hay cuotas para mostrar.</p>
        ) : (
          <div className="table-responsive">
            <table className="cuotas-table cuotas-table-usuario">
              <thead>
                <tr>
                  <th>Período cubierto</th>
                  <th>Importe</th>
                  <th>Vencimiento del pago</th>
                  <th>Plan</th>
                  <th>Estado</th>
                  <th>Forma de Pago</th>
                  <th>Fecha Pago</th>
                  {canPayOnline && <th>Pagar</th>}
                </tr>
              </thead>
              <tbody>
                {cuotas.map((c) => (
                  <tr key={c.ID_Cuota}>
                    <td data-label="Período">
                      {c.fechaInicio && c.fechaFin ? `${formatDate(c.fechaInicio)} – ${formatDate(c.fechaFin)}` : formatMonth(c.mes)}
                    </td>
                    <td data-label="Importe" className="col-importe">
                      {formatCurrency(c.importe)}
                      {c.pagada && c.recargo > 0 && <small className="cuotas-recargo">+ {formatCurrency(c.recargo)} de recargo</small>}
                      {!c.pagada && c.recargoSugerido?.monto > 0 && <small className="cuotas-recargo">+ {formatCurrency(c.recargoSugerido.monto)} de recargo por atraso al día de hoy</small>}
                    </td>
                    <td data-label="Vencimiento del pago" className="col-vence">
                      {formatDate(c.vence)}
                    </td>
                    <td data-label="Plan" className="col-plan">
                      {c.User?.plan?.nombre ?? '–'}
                    </td>
                    <td data-label="Estado" className="col-estado">
                      <span className={`badge ${c.pagada ? 'paid' : c.vencida ? 'expired' : 'pending'}`}>
                        {c.pagada ? 'Pagada' : c.vencida ? 'Vencida' : 'Pendiente'}
                      </span>
                    </td>
                    <td data-label="Forma de Pago" className="col-forma">
                      {c.formaPago || '–'}
                      {c.referenciaPago && <small className="cuotas-referencia">{c.formaPago?.startsWith('Mercado Pago') ? 'Op. ' : ''}N° {c.referenciaPago}</small>}
                    </td>
                    <td data-label="Fecha Pago" className="col-fecha">
                      {formatDate(c.fechaPago)}
                    </td>
                    {canPayOnline && <td data-label="Pagar" className="col-pagar">{paymentAction(c)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Cuotas;
