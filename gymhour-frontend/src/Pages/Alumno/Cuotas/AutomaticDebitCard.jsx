import React, { useState } from 'react';
import { CalendarClock, CreditCard, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';
import apiService from '../../../services/apiService';
import ConfirmationPopup from '../../../Components/utils/ConfirmationPopUp/ConfirmationPopUp';
import { feeDurationLabel } from '../../../utils/feeDuration';

// Débito automático de la cuota con Mercado Pago. Ver gymhour-backend/MERCADOPAGO.md.
const formatDate = value => value ? new Date(value).toLocaleDateString('es-AR', { timeZone: 'UTC' }) : '';

export default function AutomaticDebitCard({ debit, plan, defaultEmail, formatCurrency, onChange }) {
  const [email, setEmail] = useState(defaultEmail || '');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const status = debit && debit.status !== 'CANCELADO' ? debit.status : null;

  const run = async (action, success) => {
    setBusy(true);
    try {
      const result = await action();
      if (success) toast.success(success);
      await onChange?.();
      return result;
    } catch (error) {
      toast.error(error.message);
      return null;
    } finally { setBusy(false); setConfirm(null); }
  };

  const adhere = async event => {
    event.preventDefault();
    const result = await run(() => apiService.adhereAutomaticDebit(email));
    if (result?.initPoint) window.location.assign(result.initPoint);
  };

  const cancel = reason => run(() => apiService.cancelMyAutomaticDebit(reason), 'Diste de baja el débito automático.');

  // Si Mercado Pago ya le cobró y la cuota sigue impaga (se perdió el aviso), la busca y la registra.
  const verifyCharges = async () => {
    const result = await run(() => apiService.verifyMyAutomaticDebit());
    if (!result) return;
    if (result.cobrosRegistrados > 0) toast.success('Encontramos tu pago en Mercado Pago y ya quedó registrado.');
    else toast.info('No encontramos cobros nuevos en Mercado Pago.');
  };

  return (
    <div className="cuotas-debito">
      <div className="cuotas-debito-head">
        <CalendarClock size={18} />
        <div>
          <h2>Débito automático</h2>
          <p>Mercado Pago te cobra la cuota en cada período, sin que tengas que entrar a pagar.</p>
        </div>
      </div>

      {!status && (plan?.precio > 0 ? (
        <form className="cuotas-debito-body" onSubmit={adhere}>
          <p>
            Se cobran {formatCurrency(plan.precio)} cada {feeDurationLabel(plan.duracion)}, a partir del próximo período que todavía no pagaste.
            Podés darte de baja cuando quieras desde acá.
          </p>
          <label>
            Email de tu cuenta de Mercado Pago
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            <small>Tiene que ser el mismo con el que vas a autorizar el débito en Mercado Pago.</small>
          </label>
          <button className="cuotas-pay-btn" disabled={busy}>{busy ? 'Abriendo Mercado Pago…' : 'Adherirme al débito automático'}</button>
        </form>
      ) : <p className="cuotas-debito-body">Para adherirte necesitás tener un plan con costo asignado. Consultalo con el gimnasio.</p>)}

      {status === 'PENDIENTE' && (
        <div className="cuotas-debito-body">
          <p>Falta que autorices el débito en Mercado Pago. Hasta entonces no se cobra nada.</p>
          <div className="cuotas-debito-actions">
            {debit.initPoint && <a className="cuotas-pay-btn" href={debit.initPoint}>Autorizar en Mercado Pago</a>}
            <button type="button" className="cuotas-secondary-btn" disabled={busy} onClick={() => run(() => apiService.verifyMyAutomaticDebit())}>
              <RefreshCw size={14} /> Ya lo autoricé, verificar
            </button>
            <button type="button" className="cuotas-link-btn" disabled={busy} onClick={() => setConfirm('cancelar')}>Cancelar</button>
          </div>
        </div>
      )}

      {(status === 'ACTIVO' || status === 'CON_RECHAZO' || status === 'PAUSADO') && (
        <div className="cuotas-debito-body">
          {status === 'ACTIVO' && <p><strong>Activo.</strong> {formatCurrency(debit.amount)} por período{debit.nextChargeDate ? ` · próximo cobro el ${formatDate(debit.nextChargeDate)}` : ''}.</p>}
          {status === 'CON_RECHAZO' && <p className="cuotas-debito-warning"><strong>No pudimos cobrar tu débito automático.</strong> Mercado Pago lo reintenta hasta 4 veces en 10 días. Podés actualizar tu tarjeta, o pagar por otro medio dando de baja el débito.</p>}
          {status === 'PAUSADO' && <p className="cuotas-debito-warning"><strong>Tu débito está pausado en Mercado Pago.</strong> Reactivalo desde Mercado Pago o dalo de baja para pagar de otra forma.</p>}
          <div className="cuotas-debito-actions">
            {debit.initPoint && <a className="cuotas-secondary-btn" href={debit.initPoint}><CreditCard size={14} /> Actualizar mi tarjeta</a>}
            {status === 'CON_RECHAZO' && <button type="button" className="cuotas-pay-btn" disabled={busy} onClick={() => setConfirm('otro-medio')}>Pagar por otro medio</button>}
            <button type="button" className="cuotas-secondary-btn" disabled={busy} onClick={verifyCharges}>
              <RefreshCw size={14} /> Ya me cobraron, verificar
            </button>
            <button type="button" className="cuotas-link-btn" disabled={busy} onClick={() => setConfirm('baja')}>Dar de baja el débito automático</button>
          </div>
        </div>
      )}

      <ConfirmationPopup
        isOpen={Boolean(confirm)}
        isLoading={busy}
        confirmText={confirm === 'otro-medio' ? 'Cancelar débito y pagar' : 'Dar de baja'}
        message={confirm === 'otro-medio'
          ? 'Para pagar de otra forma vamos a cancelar tu débito automático en Mercado Pago. Después te podés volver a adherir.'
          : '¿Dar de baja el débito automático? Mercado Pago no te va a cobrar más la cuota. Te podés volver a adherir cuando quieras.'}
        onClose={() => setConfirm(null)}
        onConfirm={() => cancel(confirm === 'otro-medio' ? 'El socio eligió pagar por otro medio.' : 'Baja pedida por el socio.')}
      />
    </div>
  );
}
