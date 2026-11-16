import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CreditCard, Landmark, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import gymhourLogo from '../../assets/gymhour/logo_gymhour_black_text_right.png';
import apiClient from '../../axiosConfig';
import { useAuth } from '../../context/AuthContext';
import { subscriptionLink } from './subscriptionLink';
import './SubscriptionExpired.css';

const money = amount => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount);
const planDetails = {
  ESSENTIAL: ['Rutinas y turnos', 'Cuotas de socios', 'Ingresos y salidas de dinero'],
  PRO: ['Todo lo de Esencial', 'Ingreso por QR y DNI', 'Asistencias y predictor de bajas', 'Asistente con IA', 'Cobros automáticos a socios con Mercado Pago'],
};
const cancelReasons = ['Es caro para mi gimnasio', 'No lo estoy usando', 'Me pasé a otro sistema', 'Cierro el gimnasio', 'Otro motivo'];
// Espera de una transferencia: consulta cada 15 segundos durante 10 minutos; después queda el botón manual.
const TRANSFER_POLL_MS = 15_000;
const TRANSFER_POLL_LIMIT_MS = 10 * 60 * 1000;
const customDetails = ['Todo lo de Pro', 'Molinete o puerta', 'Cobros de socios y ARCA', 'Cobros automáticos con bancos (Macro, Galicia y otros)', 'Multisucursal y desarrollos a medida'];

export default function SubscriptionExpired({ plansPage = false, onPaid, onClose }) {
  const { user, tenant, refresh } = useAuth();
  const cardRef = useRef(null);
  const checkoutRef = useRef(null);
  const verifyingTransfer = useRef(false);
  const admin = user?.role === 'ADMIN';
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState(null);
  const [method, setMethod] = useState('CARD');
  const [order, setOrder] = useState(null);
  const [planId, setPlanId] = useState(null);
  const [paymentIds, setPaymentIds] = useState(null);
  const [changeQuote, setChangeQuote] = useState(null);
  const [change, setChange] = useState(null);
  const [viewPlans, setViewPlans] = useState(false);
  const [changePaymentId, setChangePaymentId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replaceSubscription, setReplaceSubscription] = useState(false);
  const [cardLink, setCardLink] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState(cancelReasons[0]);
  const [transferPending, setTransferPending] = useState(false);
  const [changeTransferPending, setChangeTransferPending] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const pendingKey = `gymhour:rebill-pending:${tenant?.id || tenant?.slug}`;
  const changeKey = `gymhour:rebill-plan-change:${tenant?.id || tenant?.slug}`;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cardRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (cardRef.current) cardRef.current.scrollTop = 0;
  }, [order]);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    apiClient.get('/billing/catalog').then(({ data }) => {
      if (active) {
        setCatalog(data);
        const initialPlanCode = data.billing?.state === 'PAID' ? data.billing?.planCode
          : data.billing?.scheduledPlanCode || data.billing?.planCode;
        setSelected(data.plans?.find(item => item.code === initialPlanCode)?.code || data.plans?.[0]?.code || null);
        if (!data.plans?.[0]?.cardAvailable || data.billingCreditArs > 0) setMethod('TRANSFER');
        if (data.order?.status === 'PENDING' && data.order.method === 'TRANSFER'
          && data.order.rebillPaymentId && data.plans?.some(plan => plan.code === data.order.planCode)) {
          setOrder(data.order); setSelected(data.order.planCode); setMethod('TRANSFER');
          setPaymentIds({ paymentId: data.order.rebillPaymentId });
        }
        const saved = sessionStorage.getItem(pendingKey);
        if (saved) {
          try {
            const values = JSON.parse(saved);
            if (values.order?.status === 'PENDING' && values.paymentIds) {
              setOrder(values.order); setSelected(values.order.planCode);
              setMethod(values.order.method); setPlanId(values.planId || null); setPaymentIds(values.paymentIds);
            } else if (values.order?.status === 'PENDING' && values.order.method === 'TRANSFER' && values.transferPending) {
              setOrder(values.order); setSelected(values.order.planCode); setMethod('TRANSFER'); setTransferPending(true);
            }
          } catch { sessionStorage.removeItem(pendingKey); }
        }
        if (data.planChange && data.planChange.status !== 'FAILED') {
          setChange(data.planChange); setSelected(data.planChange.toPlanCode);
        }
        if (data.planChange?.status === 'FAILED') {
          setError('Este cambio necesita revisión. Contactanos antes de intentar otro.');
        }
        const savedChange = sessionStorage.getItem(changeKey);
        if (savedChange) {
          try {
            const value = JSON.parse(savedChange);
            if (value.change?.id && (value.change.amountArs > 0 || data.planChange?.id === value.change.id)) {
              setChange(value.change); setChangePaymentId(value.paymentId || null);
              setChangeTransferPending(Boolean(value.transferPending && !value.paymentId));
              setSelected(value.change.toPlanCode);
            } else sessionStorage.removeItem(changeKey);
          } catch { sessionStorage.removeItem(changeKey); }
        }
      }
    }).catch(() => { if (active) setError('No pudimos cargar los planes. Intentá actualizar la página.'); });
    return () => { active = false; };
  }, [admin, pendingKey, changeKey]);

  useEffect(() => {
    if (catalog?.billing?.state !== 'PAID' || catalog?.billing?.inGrace || catalog?.billing?.scheduledPlanCode
      || !selected || selected === catalog.billing.planCode || change) {
      setChangeQuote(null); return undefined;
    }
    let active = true;
    setChangeQuote(null);
    apiClient.get('/billing/plan-change/quote', { params: { planCode: selected } })
      .then(({ data }) => { if (active) setChangeQuote(data); })
      .catch(err => { if (active) setError(err.response?.data?.message || 'No pudimos preparar el cambio.'); });
    return () => { active = false; };
  }, [catalog, selected, change]);

  useEffect(() => {
    if (!order && !change) return undefined;
    let active = true;
    import('rebill/loader').then(({ defineCustomElements }) => {
      if (active) defineCustomElements(window);
    }).catch(() => { if (active) setError('No pudimos cargar el formulario de pago.'); });
    return () => { active = false; };
  }, [order, change]);

  const changeByTransfer = catalog?.billing?.paymentMethod !== 'CARD';

  useEffect(() => {
    const checkout = checkoutRef.current;
    if (!checkout || (!order && !change)) return undefined;
    const onSuccess = event => {
      const result = event.detail?.data?.result;
      if (change) {
        // Igual que en la compra: la transferencia avisa al generar el QR y el pago se busca después.
        if (!result?.paymentId && changeByTransfer) {
          sessionStorage.setItem(changeKey, JSON.stringify({ change, transferPending: true }));
          setChangeTransferPending(true); setError('');
          return;
        }
        if (!result?.paymentId) {
          setError('El cobro se inició, pero falta el identificador. Contactá a soporte antes de volver a pagar.'); return;
        }
        sessionStorage.setItem(changeKey, JSON.stringify({ change, paymentId: result.paymentId }));
        setChangePaymentId(result.paymentId);
        return;
      }
      // La transferencia avisa al generar el QR, antes de que exista el pago: se espera la acreditación.
      if (method === 'TRANSFER' && !result?.paymentId) {
        sessionStorage.setItem(pendingKey, JSON.stringify({ order, planId, transferPending: true }));
        setTransferPending(true); setError('');
        return;
      }
      if (!result?.paymentId || (method === 'CARD' && !result.subscriptionId)) {
        setError('El pago se registró, pero no se creó la suscripción. No vuelvas a pagar; contactá a soporte con el comprobante.'); return;
      }
      const ids = { paymentId: result.paymentId, ...(method === 'CARD' ? { subscriptionId: result.subscriptionId } : {}) };
      sessionStorage.setItem(pendingKey, JSON.stringify({ order, planId, paymentIds: ids }));
      setPaymentIds(ids);
    };
    checkout.addEventListener('success', onSuccess);
    return () => checkout.removeEventListener('success', onSuccess);
  }, [order, change, method, pendingKey, changeKey, planId, changeByTransfer]);

  useEffect(() => {
    if (!change?.id || !changePaymentId) return;
    let active = true;
    setBusy(true);
    apiClient.post(`/billing/plan-change/${change.id}/confirm`, { paymentId: changePaymentId })
      .then(async ({ status }) => {
        if (status === 202) { if (active) setError('El pago quedó confirmado. Reintentá completar el cambio.'); return; }
        sessionStorage.removeItem(changeKey);
        await refresh();
        window.location.reload();
      })
      .catch(err => { if (active) setError(err.response?.data?.message || 'No pudimos completar el cambio. Reintentá sin volver a pagar.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [change, changePaymentId, changeKey, refresh]);

  // La confirmación queda visible hasta que el admin la cierra, aunque el acceso ya esté habilitado.
  const finishPayment = useCallback(async paidUntil => {
    sessionStorage.removeItem(pendingKey);
    setConfirmed({ paidUntil });
    onPaid?.();
    await refresh();
  }, [pendingKey, onPaid, refresh]);

  useEffect(() => {
    if (!paymentIds || !order) return;
    let active = true;
    setBusy(true);
    apiClient.post(`/billing/orders/${order.id}/confirm-${method === 'CARD' ? 'card' : 'transfer'}`, paymentIds).then(({ status, data }) => {
      if (status === 202) { if (active) setError('La transferencia sigue pendiente. Podés verificarla nuevamente cuando se acredite.'); return; }
      return finishPayment(data?.paidUntil);
    })
      .catch(err => { if (active) setError(err.response?.data?.message || 'El pago se procesó, pero todavía no pudimos confirmar el acceso. Reintentá la confirmación.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [paymentIds, order, method, finishPayment]);

  const verifyTransfer = useCallback(async (silent = false) => {
    if (!order || verifyingTransfer.current) return;
    verifyingTransfer.current = true;
    if (!silent) { setBusy(true); setError(''); }
    try {
      const { status, data } = await apiClient.post(`/billing/orders/${order.id}/confirm-transfer`, {});
      if (status === 202) { if (!silent) setError(data?.message || 'Todavía no recibimos la transferencia.'); return; }
      await finishPayment(data?.paidUntil);
    } catch (err) {
      if (!silent) setError(err.response?.data?.message || 'No pudimos verificar la transferencia. Intentá de nuevo.');
    } finally {
      verifyingTransfer.current = false;
      if (!silent) setBusy(false);
    }
  }, [order, finishPayment]);

  useEffect(() => {
    if (!transferPending || confirmed) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > TRANSFER_POLL_LIMIT_MS) { clearInterval(timer); return; }
      verifyTransfer(true);
    }, TRANSFER_POLL_MS);
    return () => clearInterval(timer);
  }, [transferPending, confirmed, verifyTransfer]);

  const verifyChangeTransfer = useCallback(async (silent = false) => {
    if (!change?.id || verifyingTransfer.current) return;
    verifyingTransfer.current = true;
    if (!silent) { setBusy(true); setError(''); }
    try {
      const { status, data } = await apiClient.post(`/billing/plan-change/${change.id}/confirm`, {});
      if (status === 202) { if (!silent) setError(data?.message || 'Todavía no recibimos la transferencia.'); return; }
      sessionStorage.removeItem(changeKey);
      await refresh();
      window.location.reload();
    } catch (err) {
      if (!silent) setError(err.response?.data?.message || 'No pudimos verificar la transferencia. Intentá de nuevo.');
    } finally {
      verifyingTransfer.current = false;
      if (!silent) setBusy(false);
    }
  }, [change, changeKey, refresh]);

  useEffect(() => {
    if (!changeTransferPending) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > TRANSFER_POLL_LIMIT_MS) { clearInterval(timer); return; }
      verifyChangeTransfer(true);
    }, TRANSFER_POLL_MS);
    return () => clearInterval(timer);
  }, [changeTransferPending, verifyChangeTransfer]);

  const startPayment = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const { data } = await apiClient.post('/billing/orders', {
        planCode: selected, method, ...(replaceSubscription ? { replaceSubscription: true } : {}),
      });
      setOrder(data.order); setPlanId(data.planId || null);
    } catch (err) {
      setError(err.response?.data?.message || 'No pudimos iniciar el pago. Intentá de nuevo.');
    } finally { setBusy(false); }
  };

  const startChange = async () => {
    if (!changeQuote || !selected) return;
    setBusy(true); setError('');
    try {
      const { data, status } = await apiClient.post('/billing/plan-change', {
        planCode: selected, expectedAmountArs: changeQuote.amountArs,
      });
      if (status === 202) {
        setError(data.message || 'Reintentá completar el cambio.');
        if (data.changeId) setChange({ id: data.changeId, toPlanCode: selected, amountArs: changeQuote.amountArs });
        return;
      }
      if (data.status === 'APPLIED' || data.status === 'SCHEDULED') {
        sessionStorage.removeItem(changeKey);
        await refresh(); window.location.reload(); return;
      }
      setChange(data.change);
      sessionStorage.setItem(changeKey, JSON.stringify({ change: data.change }));
    } catch (err) {
      setError(err.response?.data?.message || 'No pudimos iniciar el cambio de plan.');
      if (err.response?.status === 409) {
        try {
          const { data } = await apiClient.get('/billing/plan-change/quote', { params: { planCode: selected } });
          setChangeQuote(data);
        } catch { /* The server already gave the actionable error. */ }
      }
    } finally { setBusy(false); }
  };

  const cancelScheduledChange = async () => {
    setBusy(true); setError('');
    try {
      const { data, status } = await apiClient.post('/billing/plan-change/cancel-scheduled');
      if (status === 202) { setError(data.message); return; }
      const [{ data: updated }] = await Promise.all([apiClient.get('/billing/catalog'), refresh()]);
      setCatalog(updated);
      setSelected(updated.billing?.planCode || null);
    } catch (err) {
      setError(err.response?.data?.message || 'No pudimos cancelar el cambio. Intentá nuevamente.');
    } finally { setBusy(false); }
  };

  const requestCardLink = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await apiClient.post('/billing/subscription/card-update-link');
      setCardLink(data.url);
    } catch (err) {
      setError(err.response?.data?.message || 'No pudimos preparar el cambio de tarjeta. Intentá de nuevo.');
    } finally { setBusy(false); }
  };

  const cancelSubscription = async () => {
    setBusy(true); setError('');
    try {
      await apiClient.post('/billing/subscription/cancel', { reason: cancelReason });
      const [{ data: updated }] = await Promise.all([apiClient.get('/billing/catalog'), refresh()]);
      setCatalog(updated);
      setCancelOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || 'No pudimos cancelar la suscripción. Intentá de nuevo.');
    } finally { setBusy(false); }
  };

  const plan = catalog?.plans?.find(item => item.code === selected);
  const billing = catalog?.billing;
  const activePaid = billing?.state === 'PAID' && !billing?.inGrace;
  const needsRecovery = Boolean(billing?.liveSubscriptionStatus && (billing.state === 'EXPIRED' || billing.inGrace));
  const paidUntilLabel = billing?.paidUntil ? new Date(billing.paidUntil).toLocaleDateString('es-AR') : '';
  const showingChange = change && !viewPlans;
  // Una compra con tarjeta reciente sin confirmar puede estar cobrada: se avisa antes de que pague de nuevo.
  const recentCardOrder = catalog?.order?.method === 'CARD' && catalog.order.status === 'PENDING'
    && Date.now() - Date.parse(catalog.order.createdAt) < 24 * 60 * 60 * 1000;

  return <div className="subscription-expired">
    <section ref={cardRef} tabIndex={-1} className={`subscription-expired__card${order || showingChange ? ' subscription-expired__card--payment' : ''}`} role="dialog" aria-modal="true" aria-labelledby="subscription-expired-title" aria-describedby="subscription-expired-description">
      <div className="subscription-expired__header">
        {plansPage && <Link className="subscription-expired__home" to="/admin/inicio"><ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" /> Volver al inicio</Link>}
        <img className="subscription-expired__logo" src={gymhourLogo} alt="Gymhour" />
      </div>
      <h1 id="subscription-expired-title">{confirmed ? 'Pago confirmado' : admin ? showingChange ? 'Completá el cambio' : order ? 'Completá el pago' : 'Elegí tu plan' : 'Tu acceso está en pausa'}</h1>
      <p id="subscription-expired-description">{confirmed ? `Tu plan ${plan?.tierLabel || ''} ya está activo.` : admin
        ? showingChange ? change.amountArs === 0 ? 'Programá Esencial para el próximo vencimiento.' : 'Finalizá el ajuste para activar tu nuevo plan.'
          : order ? 'Finalizá el pago para activar tu plan.' : 'Elegí las funciones que necesitás para tu gimnasio.'
        : `La suscripción de ${tenant?.name || 'tu gimnasio'} venció. Contactá al administrador para volver a usar Gymhour.`}</p>
      {admin && confirmed && <div className="subscription-checkout">
        <div className="subscription-checkout__active subscription-checkout__change" role="status">
          {confirmed.paidUntil && <strong>Acceso hasta el {new Date(confirmed.paidUntil).toLocaleDateString('es-AR')}</strong>}
          <span>Rebill te envía el comprobante de pago a {user.email}.</span>
          {onClose
            ? <button type="button" className="subscription-checkout__primary" onClick={onClose}>Ir a Gymhour</button>
            : <Link className="subscription-checkout__primary" to="/admin/inicio">Ir a Gymhour</Link>}
        </div>
      </div>}
      {admin && !confirmed && <div className="subscription-checkout">
        {catalog?.offer?.kind === 'ENTERPRISE' ? <div className="subscription-checkout__active"><strong>Plan A medida</strong><span>Tu gimnasio tiene más de 200 socios activos. Armamos una propuesta con capacidad ilimitada, cobros automáticos con bancos como Macro y Galicia, e integraciones según tus necesidades.</span><a href={subscriptionLink(tenant)} target="_blank" rel="noopener noreferrer">Solicitar propuesta →</a></div> : <>
          {!order && !showingChange && !activePaid && recentCardOrder && <div className="subscription-checkout__active" role="note">
            <strong>¿Ya pagaste con tarjeta?</strong>
            <span>Si el pago se aprobó, no vuelvas a pagar: lo estamos revisando y te habilitamos el acceso. Si no llegaste a pagar, podés continuar.</span>
            <a href={subscriptionLink(tenant)} target="_blank" rel="noopener noreferrer">Escribinos si necesitás ayuda →</a>
          </div>}
          {!order && !showingChange && needsRecovery && !replaceSubscription && <div className="subscription-checkout__active subscription-checkout__change">
            <strong>No pudimos confirmar el cobro de tu tarjeta</strong>
            <span>{billing.inGrace && billing.graceUntil
              ? `Conservás el acceso hasta el ${new Date(billing.graceUntil).toLocaleDateString('es-AR')}. Actualizá la tarjeta o pagá de otra forma para no perderlo.`
              : 'Actualizá la tarjeta o pagá de otra forma para volver a usar Gymhour.'}</span>
            {cardLink
              ? <><a href={cardLink} target="_blank" rel="noopener noreferrer">Abrir la página segura de Rebill</a>
                <span>Cuando cambies la tarjeta, intentamos el cobro de nuevo. El acceso se habilita al aprobarse.</span></>
              : <button type="button" className="subscription-checkout__primary" disabled={busy} onClick={requestCardLink}>{busy ? 'Preparando…' : 'Cambiar tarjeta'}</button>}
            <button type="button" className="subscription-checkout__back" onClick={() => { setReplaceSubscription(true); setError(''); }}>Pagar de otra forma</button>
          </div>}
          {!order && !showingChange && (!needsRecovery || replaceSubscription) && catalog?.plans?.length > 0 && <>
            <div className="subscription-checkout__tier"><span>Planes mensuales</span><span>{catalog.activeStudents} socios activos</span></div>
            <div className="subscription-checkout__plans" role="group" aria-label="Plan de Gymhour">
              {catalog.plans.map(item => <button key={item.code} type="button"
                className={`subscription-checkout__plan-card${selected === item.code ? ' selected' : ''}${item.tierCode === 'PRO' ? ' subscription-checkout__plan-card--pro' : ''}`}
                onClick={() => { setSelected(item.code); setError(''); }} aria-pressed={selected === item.code}
                disabled={Boolean(catalog.billing?.scheduledPlanCode)
                  && (activePaid || item.code !== catalog.billing.scheduledPlanCode)}>
                <span className="subscription-checkout__plan-heading"><span>{item.tierLabel}</span>{item.tierCode === 'PRO' && <span className="subscription-checkout__plan-badge">Más completo</span>}</span>
                <strong className="subscription-checkout__plan-price">{money(item.amountArs)}<small>/mes</small></strong>
                <span className="subscription-checkout__plan-limit">Hasta {item.maxUsers} socios activos</span>
                <span className="subscription-checkout__plan-divider" />
                <span className="subscription-checkout__plan-features">{(planDetails[item.tierCode] || []).map(feature =>
                  <span key={feature}><Check size={16} strokeWidth={2} aria-hidden="true" />{feature}</span>)}</span>
                <span className="subscription-checkout__plan-action">{catalog.billing?.scheduledPlanCode === item.code
                  ? 'Próximo plan' : catalog.billing?.state === 'PAID' && catalog.billing?.planCode === item.code
                    ? 'Plan actual' : selected === item.code ? 'Plan seleccionado' : 'Elegir plan'} <span aria-hidden="true">→</span></span>
              </button>)}
              <a className="subscription-checkout__plan-card subscription-checkout__plan-card--custom" href={subscriptionLink(tenant)} target="_blank" rel="noopener noreferrer">
                <span className="subscription-checkout__plan-heading"><span>A medida</span></span>
                <strong className="subscription-checkout__plan-price subscription-checkout__plan-price--custom">A consultar</strong>
                <span className="subscription-checkout__plan-limit">Socios ilimitados</span>
                <span className="subscription-checkout__plan-divider" />
                <span className="subscription-checkout__plan-features">{customDetails.map(feature =>
                  <span key={feature}><Check size={16} strokeWidth={2} aria-hidden="true" />{feature}</span>)}</span>
                <span className="subscription-checkout__plan-action">Consultar plan <span aria-hidden="true">↗</span></span>
              </a>
            </div>
            {activePaid ? <div className="subscription-checkout__active subscription-checkout__change">
              {catalog.billing.scheduledPlanCode ? <>
                <strong>Tu cambio a Esencial está programado.</strong>
                <span>Conservás Pro hasta el {new Date(catalog.billing.scheduledEffectiveAt).toLocaleDateString('es-AR')}. Desde la próxima renovación, tu cuota será de {money(catalog.plans.find(item => item.code === catalog.billing.scheduledPlanCode)?.amountArs || 49999)}/mes.</span>
                <span>Si cancelás el cambio, seguirás en Pro y la próxima cuota será de {money(catalog.plans.find(item => item.tierCode === 'PRO')?.amountArs || 99999)}/mes.</span>
                <button type="button" className="subscription-checkout__primary" disabled={busy} onClick={cancelScheduledChange}>
                  {busy ? 'Cancelando el cambio…' : 'Cancelar cambio y mantener Pro'}
                </button>
              </> : selected === catalog.billing.planCode ? <><strong>Este es tu plan actual.</strong><span>Elegí otro plan para ver el cambio.</span></> : change && selected === change.toPlanCode ? <>
                <strong>Tenés un cambio pendiente a {plan?.tierLabel || 'este plan'}.</strong>
                <button type="button" className="subscription-checkout__primary" onClick={() => setViewPlans(false)}>Continuar cambio</button>
              </> : changeQuote ? <>
                <strong>{changeQuote.adjustment === 'CHARGE' ? 'Cambio a Pro' : 'Programar Esencial'}</strong>
                <span>{changeQuote.amountArs > 0
                  ? `Tu pago de Esencial ya cubre parte de este período. Para usar Pro desde ahora hasta el ${new Date(changeQuote.periodEnd).toLocaleDateString('es-AR')}, abonás solo la diferencia: ${money(changeQuote.amountArs)}.`
                  : `El cambio a Esencial se hará al vencer el período pagado`}</span>
                <span>La próxima cuota será de {money(changeQuote.nextAmountArs)}/mes.</span>
                <button className="subscription-checkout__primary" type="button" disabled={busy}
                  onClick={startChange}>{busy ? 'Preparando el cambio…' : changeQuote.amountArs > 0 ? 'Mejorar a Pro' : 'Programar cambio a Esencial'}</button>
              </> : <span>Preparando el cambio…</span>}
            </div> : <>
            <h2 className="subscription-checkout__section-title">Elegí cómo pagar</h2>
            {replaceSubscription && <p>Al continuar, cancelamos la suscripción anterior para que no haya dos débitos.</p>}
            {catalog.billingCreditArs > 0 && <p>Tenés {money(catalog.billingCreditArs)} a favor. Se descontarán de tu próxima cuota por transferencia.</p>}
            <div className="subscription-checkout__methods" role="group" aria-label="Medio de pago">
              <button type="button" disabled={!plan?.cardAvailable || catalog.billingCreditArs > 0} aria-pressed={method === 'CARD'} className={method === 'CARD' ? 'selected' : ''} onClick={() => setMethod('CARD')}><span className="subscription-checkout__method-indicator" /><CreditCard className="subscription-checkout__method-icon" size={21} strokeWidth={1.7} aria-hidden="true" /><span>Tarjeta <small>Renovación automática cada {plan?.months === 1 ? 'mes' : `${plan?.months || ''} meses`}</small></span></button>
              <button type="button" disabled={!plan?.transferAvailable} aria-pressed={method === 'TRANSFER'} className={method === 'TRANSFER' ? 'selected' : ''} onClick={() => setMethod('TRANSFER')}><span className="subscription-checkout__method-indicator" /><Landmark className="subscription-checkout__method-icon" size={21} strokeWidth={1.7} aria-hidden="true" /><span>Transferencia <small>Renovación manual al vencer</small></span></button>
            </div>
            <button className="subscription-checkout__primary" type="button" disabled={busy || !plan || (method === 'CARD' ? !plan.cardAvailable : !plan.transferAvailable)} onClick={startPayment}><LockKeyhole size={17} strokeWidth={1.8} aria-hidden="true" />{busy ? 'Preparando el pago…' : 'Continuar con la compra segura'}</button>
            </>}
          </>}
          {!order && !showingChange && activePaid && billing.liveSubscriptionStatus && !cancelOpen && <button type="button" className="subscription-checkout__back" onClick={() => { setCancelOpen(true); setError(''); }}>Cancelar suscripción</button>}
          {!order && !showingChange && activePaid && billing.liveSubscriptionStatus && cancelOpen && <div className="subscription-checkout__active subscription-checkout__change">
            <strong>¿Cancelar la suscripción?</strong>
            <span>No se harán más débitos. Conservás el acceso hasta el {paidUntilLabel}.</span>
            <label htmlFor="subscription-cancel-reason">Motivo</label>
            <select id="subscription-cancel-reason" value={cancelReason} onChange={event => setCancelReason(event.target.value)}>
              {cancelReasons.map(reason => <option key={reason} value={reason}>{reason}</option>)}
            </select>
            <button type="button" className="subscription-checkout__primary" disabled={busy} onClick={cancelSubscription}>{busy ? 'Cancelando…' : 'Confirmar cancelación'}</button>
            <button type="button" className="subscription-checkout__back" disabled={busy} onClick={() => setCancelOpen(false)}>Volver</button>
          </div>}
          {!order && !showingChange && activePaid && billing.paymentMethod === 'CARD' && !billing.liveSubscriptionStatus
            && <div className="subscription-checkout__active"><strong>Tu suscripción está cancelada</strong><span>No se harán más débitos. Conservás el acceso hasta el {paidUntilLabel}.</span></div>}
          {showingChange && <button className="subscription-checkout__back" type="button" disabled={busy} onClick={() => { setViewPlans(true); setSelected(catalog?.billing?.planCode || change.toPlanCode); setError(''); }}>← Volver a los planes</button>}
          {showingChange && <div className="subscription-checkout__summary">
            <div><span>{change.amountArs > 0 ? 'Ajuste proporcional' : 'Próximo plan'}</span><strong>{catalog?.plans?.find(item => item.code === change.toPlanCode)?.tierLabel || 'Nuevo plan'}</strong></div>
            <strong>{change.amountArs > 0 ? money(change.amountArs) : 'Sin cargo hoy'}</strong>
          </div>}
          {showingChange && catalog && change.amountArs > 0 && change.status !== 'PAYMENT_CONFIRMED' && !changePaymentId && <div className="subscription-checkout__rebill">
            <p>Se cobra una sola vez el proporcional. La próxima cuota mensual será de {money(catalog?.plans?.find(item => item.code === change.toPlanCode)?.amountArs || 0)}.</p>
            <rebill-checkout ref={checkoutRef} public-key={catalog.rebillPublicKey}
              instant-product={JSON.stringify({ name: [{ language: 'es', text: 'Gymhour · ajuste proporcional de plan' }],
                amount: change.amountArs, currency: 'ARS', metadata: { gymhourPlanChangeId: change.id } })}
              customer-information={JSON.stringify({ email: user.email })} one-click-checkout={catalog.billing.paymentMethod === 'CARD' ? 'true' : 'false'} language="es"
              display={JSON.stringify({ checkoutSummary: false, excludePaymentMethods: catalog.billing.paymentMethod === 'CARD' ? ['cash', 'bank_transfer'] : ['card', 'cash'] })} />
            {changeTransferPending && <>
              <p>Cuando se acredite la transferencia, el nuevo plan se aplica solo. Puede demorar unos minutos.</p>
              <button type="button" className="subscription-checkout__primary" disabled={busy} onClick={() => verifyChangeTransfer()}>
                {busy ? 'Verificando…' : 'Ya transferí, verificar ahora'}
              </button>
            </>}
          </div>}
          {showingChange && (changePaymentId || change.amountArs <= 0 || change.status === 'PAYMENT_CONFIRMED') && <button className="subscription-checkout__primary" type="button" disabled={busy}
            onClick={async () => {
              setBusy(true); setError('');
              try {
                const { data, status } = await apiClient.post(`/billing/plan-change/${change.id}/confirm`, { paymentId: changePaymentId });
                if (status === 202) setError(data.message || 'Reintentá completar el cambio.');
                else { sessionStorage.removeItem(changeKey); await refresh(); window.location.reload(); }
              } catch (err) { setError(err.response?.data?.message || 'No pudimos completar el cambio.'); }
              finally { setBusy(false); }
            }}>{busy ? 'Verificando…' : change.amountArs > 0 ? 'Completar cambio de plan' : 'Completar programación'}</button>}
          {order && !paymentIds && <button className="subscription-checkout__back" type="button" onClick={() => {
            setOrder(null); setPlanId(null); setTransferPending(false); setError(''); sessionStorage.removeItem(pendingKey);
          }}>← Elegir otro medio o plan</button>}
          {order && <div className="subscription-checkout__summary">
            <div><span>Plan seleccionado</span><strong>{plan?.tierLabel || order.planCode} · Mensual</strong></div>
            <strong>{money(order.amountArs)}</strong>
          </div>}
          {order && method === 'TRANSFER' && <div className="subscription-checkout__rebill">
            <p>Seguí las instrucciones para transferir {money(order.amountArs)}. Usá el email <strong>{user.email}</strong>.</p>
            {!paymentIds && <rebill-checkout ref={checkoutRef} public-key={catalog.rebillPublicKey}
              instant-product={JSON.stringify({ name: [{ language: 'es', text: `Gymhour ${plan?.tierLabel || ''} ${plan?.periodLabel || ''}`.trim() }],
                amount: order.amountArs, currency: 'ARS', metadata: { gymhourOrderId: order.id } })}
              customer-information={JSON.stringify({ email: user.email })} one-click-checkout="false" language="es"
              display={JSON.stringify({ checkoutSummary: false, excludePaymentMethods: ['card', 'cash'] })} />}
            {transferPending && !paymentIds && <>
              <p>Cuando se acredite la transferencia, el acceso se habilita solo. Puede demorar unos minutos.</p>
              <button type="button" className="subscription-checkout__primary" disabled={busy} onClick={() => verifyTransfer()}>
                {busy ? 'Verificando…' : 'Ya transferí, verificar ahora'}
              </button>
            </>}
            {paymentIds && <button type="button" className="subscription-checkout__primary" disabled={busy}
              onClick={() => { setError(''); setPaymentIds({ ...paymentIds }); }}>Verificar acreditación</button>}
          </div>}
          {order && method === 'CARD' && planId && <div className="subscription-checkout__rebill">
            <p>Usá el mismo email de tu cuenta Gymhour: <strong>{user.email}</strong>.</p>
            <rebill-checkout ref={checkoutRef} public-key={catalog.rebillPublicKey} plan-id={planId}
              customer-information={JSON.stringify({ email: user.email })} one-click-checkout="false" language="es"
              display={JSON.stringify({ checkoutSummary: false, excludePaymentMethods: ['cash', 'bank_transfer'] })} />
            {busy && <p>Confirmando tu pago…</p>}
            {paymentIds && error && <button type="button" className="subscription-checkout__primary" onClick={() => { setError(''); setPaymentIds({ ...paymentIds }); }}>Reintentar confirmación</button>}
          </div>}
        </>}
        {error && <p className="subscription-checkout__error" role="alert">{error}</p>}
        {!catalog && !error && <p>Cargando planes…</p>}
        <a className="subscription-checkout__help" href={subscriptionLink(tenant)} target="_blank" rel="noopener noreferrer">Necesito ayuda</a>
      </div>}
    </section>
  </div>;
}
