import React, { useEffect, useRef, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import gymhourLogo from '../../assets/gymhour/logo_gymhour_black_text_right.png';
import apiClient from '../../axiosConfig';
import { useAuth } from '../../context/AuthContext';
import { subscriptionLink } from './subscriptionLink';
import './SubscriptionExpired.css';

const money = amount => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount);

export default function SubscriptionExpired() {
  const { user, tenant, refresh } = useAuth();
  const cardRef = useRef(null);
  const checkoutRef = useRef(null);
  const admin = user?.role === 'ADMIN';
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState(null);
  const [method, setMethod] = useState('CARD');
  const [order, setOrder] = useState(null);
  const [planId, setPlanId] = useState(null);
  const [paymentIds, setPaymentIds] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pendingKey = `gymhour:rebill-pending:${tenant?.id || tenant?.slug}`;

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
        setCatalog(data); setSelected(data.plans?.[0]?.code || null);
        if (!data.plans?.[0]?.cardAvailable) setMethod('TRANSFER');
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
            }
          } catch { sessionStorage.removeItem(pendingKey); }
        }
      }
    }).catch(() => { if (active) setError('No pudimos cargar los planes. Intentá actualizar la página.'); });
    return () => { active = false; };
  }, [admin, pendingKey]);

  useEffect(() => {
    if (!order) return undefined;
    let active = true;
    import('rebill/loader').then(({ defineCustomElements }) => {
      if (active) defineCustomElements(window);
    }).catch(() => { if (active) setError('No pudimos cargar el formulario de pago.'); });
    return () => { active = false; };
  }, [order]);

  useEffect(() => {
    const checkout = checkoutRef.current;
    if (!checkout || !order) return undefined;
    const onSuccess = event => {
      const result = event.detail?.data?.result;
      if (!result?.paymentId || (method === 'CARD' && !result.subscriptionId)) {
        setError('El pago se registró, pero no se creó la suscripción. No vuelvas a pagar; contactá a soporte con el comprobante.'); return;
      }
      const ids = { paymentId: result.paymentId, ...(method === 'CARD' ? { subscriptionId: result.subscriptionId } : {}) };
      sessionStorage.setItem(pendingKey, JSON.stringify({ order, planId, paymentIds: ids }));
      setPaymentIds(ids);
    };
    checkout.addEventListener('success', onSuccess);
    return () => checkout.removeEventListener('success', onSuccess);
  }, [order, method, pendingKey, planId]);

  useEffect(() => {
    if (!paymentIds || !order) return;
    let active = true;
    setBusy(true);
    apiClient.post(`/billing/orders/${order.id}/confirm-${method === 'CARD' ? 'card' : 'transfer'}`, paymentIds).then(({ status }) => {
      if (status === 202) { if (active) setError('La transferencia sigue pendiente. Podés verificarla nuevamente cuando se acredite.'); return; }
      sessionStorage.removeItem(pendingKey);
      return refresh();
    })
      .catch(err => { if (active) setError(err.response?.data?.message || 'El pago se procesó, pero todavía no pudimos confirmar el acceso. Reintentá la confirmación.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [paymentIds, order, method, refresh, pendingKey]);

  const startPayment = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const { data } = await apiClient.post('/billing/orders', { planCode: selected, method });
      setOrder(data.order); setPlanId(data.planId || null);
    } catch (err) {
      setError(err.response?.data?.message || 'No pudimos iniciar el pago. Intentá de nuevo.');
    } finally { setBusy(false); }
  };

  const plan = catalog?.plans?.find(item => item.code === selected);

  return <div className="subscription-expired">
    <section ref={cardRef} tabIndex={-1} className={`subscription-expired__card${order ? ' subscription-expired__card--payment' : ''}`} role="dialog" aria-modal="true" aria-labelledby="subscription-expired-title" aria-describedby="subscription-expired-description">
      <div className="subscription-expired__header">
        <img className="subscription-expired__logo" src={gymhourLogo} alt="Gymhour" />
      </div>
      <h1 id="subscription-expired-title">{admin ? order ? 'Completá el pago' : 'Elegí tu plan' : 'Tu acceso está en pausa'}</h1>
      <p id="subscription-expired-description">{admin
        ? order ? 'Finalizá el pago para volver a usar Gymhour.' : 'Seleccioná la duración y el medio de pago para continuar.'
        : `La suscripción de ${tenant?.name || 'tu gimnasio'} venció. Contactá al administrador para volver a usar Gymhour.`}</p>
      {admin && <div className="subscription-checkout">
        {catalog?.offer?.kind === 'ENTERPRISE' ? <p>Para más de 1000 alumnos, contactanos para armar tu plan.</p> : <>
          {!order && catalog?.plans?.length > 0 && <>
            <div className="subscription-checkout__tier"><span>{catalog.offer?.tier?.label}</span><span>{catalog.activeStudents} alumnos activos</span></div>
            <h2 className="subscription-checkout__section-title">Elegí la duración</h2>
            <div className="subscription-checkout__plans" role="group" aria-label="Duración del plan">
              {catalog.plans.map(item => <button key={item.code} type="button" className={selected === item.code ? 'selected' : ''}
                onClick={() => setSelected(item.code)} aria-pressed={selected === item.code}>
                <span>{item.periodLabel}</span>
                <strong>{money(item.amountArs)}</strong>
                {item.discountPercent > 0 && <small>{item.discountPercent}% de descuento</small>}
              </button>)}
            </div>
            <h2 className="subscription-checkout__section-title">Elegí cómo pagar</h2>
            <div className="subscription-checkout__methods" role="group" aria-label="Medio de pago">
              <button type="button" disabled={!plan?.cardAvailable} aria-pressed={method === 'CARD'} className={method === 'CARD' ? 'selected' : ''} onClick={() => setMethod('CARD')}><span className="subscription-checkout__method-indicator" /><span>Tarjeta <small>Renovación automática cada {plan?.months === 1 ? 'mes' : `${plan?.months || ''} meses`}</small></span></button>
              <button type="button" disabled={!plan?.transferAvailable} aria-pressed={method === 'TRANSFER'} className={method === 'TRANSFER' ? 'selected' : ''} onClick={() => setMethod('TRANSFER')}><span className="subscription-checkout__method-indicator" /><span>Transferencia <small>Renovación manual al vencer</small></span></button>
            </div>
            <button className="subscription-checkout__primary" type="button" disabled={busy || !plan || (method === 'CARD' ? !plan.cardAvailable : !plan.transferAvailable)} onClick={startPayment}><LockKeyhole size={17} strokeWidth={1.8} aria-hidden="true" />{busy ? 'Preparando el pago…' : 'Continuar con la compra segura'}</button>
          </>}
          {order && !paymentIds && <button className="subscription-checkout__back" type="button" onClick={() => { setOrder(null); setPlanId(null); setError(''); }}>← Elegir otro medio o plan</button>}
          {order && <div className="subscription-checkout__summary">
            <div><span>Plan seleccionado</span><strong>{plan?.periodLabel || order.planCode} · {catalog?.offer?.tier?.label}</strong></div>
            <strong>{money(order.amountArs)}</strong>
          </div>}
          {order && method === 'TRANSFER' && <div className="subscription-checkout__rebill">
            <p>Seguí las instrucciones para transferir {money(order.amountArs)}. Usá el email <strong>{user.email}</strong>.</p>
            {!paymentIds && <rebill-checkout ref={checkoutRef} public-key={catalog.rebillPublicKey}
              instant-product={JSON.stringify({ name: [{ language: 'es', text: `Gymhour ${plan?.periodLabel || ''}` }],
                amount: order.amountArs, currency: 'ARS', metadata: { gymhourOrderId: order.id } })}
              customer-information={JSON.stringify({ email: user.email })} one-click-checkout="false" language="es"
              display={JSON.stringify({ checkoutSummary: false, excludePaymentMethods: ['card', 'cash'] })} />}
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
