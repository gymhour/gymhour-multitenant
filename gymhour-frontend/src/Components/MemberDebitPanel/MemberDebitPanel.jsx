import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { toast } from 'react-toastify';
import apiService from '../../services/apiService';
import { useAuth } from '../../context/AuthContext';
import ConfirmationPopup from '../utils/ConfirmationPopUp/ConfirmationPopUp';
import './MemberDebitPanel.css';

// Débito automático de un socio, visto por el admin en su ficha (ver gymhour-backend/MERCADOPAGO.md).
const STATUS_LABELS = {
  PENDIENTE: 'Pendiente de autorizar en Mercado Pago',
  ACTIVO: 'Activo',
  CON_RECHAZO: 'Con un cobro rechazado (Mercado Pago reintenta)',
  PAUSADO: 'Pausado desde Mercado Pago',
};
const LAST_CHARGE = { approved: 'aprobado', rejected: 'rechazado', pending: 'en revisión', in_process: 'en revisión' };
const formatDate = value => value ? new Date(value).toLocaleDateString('es-AR', { timeZone: 'UTC' }) : '';
const money = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value ?? 0);

export default function MemberDebitPanel({ userId }) {
  const { tenant } = useAuth();
  const enabled = Boolean(tenant?.billing?.features?.MEMBER_PAYMENTS);
  const [debit, setDebit] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const debits = await apiService.getAutomaticDebits();
      setDebit((debits || []).find(item => Number(item.ID_Usuario) === Number(userId)) || null);
    } catch { setDebit(null); }
  }, [enabled, userId]);

  useEffect(() => { load(); }, [load]);

  if (!debit) return null;

  // Por si Mercado Pago cobró y el aviso no llegó: busca los cobros que falten y los registra.
  const verify = async () => {
    setBusy(true);
    try {
      const result = await apiService.verifyAutomaticDebit(debit.id);
      if (result.cobrosRegistrados > 0) toast.success(`Registramos ${result.cobrosRegistrados === 1 ? '1 cobro' : `${result.cobrosRegistrados} cobros`} del débito que faltaban.`);
      else toast.info('No hay cobros del débito sin registrar.');
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await apiService.cancelAutomaticDebit(debit.id, 'Cancelado por el gimnasio desde la ficha del socio.');
      toast.success('Débito automático cancelado.');
      setConfirm(false);
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="member-debit-panel" aria-label="Débito automático">
      <CalendarClock size={18} />
      <div>
        <strong>Débito automático: {STATUS_LABELS[debit.status] || debit.status}</strong>
        <span>
          {money(debit.amount)} por período · desde el {formatDate(debit.createdAt)}
          {debit.nextChargeDate ? ` · próximo cobro el ${formatDate(debit.nextChargeDate)}` : ''}
          {debit.lastChargeStatus ? ` · último cobro ${LAST_CHARGE[debit.lastChargeStatus] || debit.lastChargeStatus}` : ''}
        </span>
      </div>
      <div className="member-debit-actions">
        <button type="button" onClick={verify} disabled={busy}>Verificar cobros</button>
        <button type="button" onClick={() => setConfirm(true)} disabled={busy}>Cancelar débito</button>
      </div>
      <ConfirmationPopup
        isOpen={confirm}
        isLoading={busy}
        confirmText="Cancelar débito"
        message="¿Cancelar el débito automático del socio? Mercado Pago no le va a cobrar más la cuota y tendrá que volver a adherirse si quiere seguir con el débito."
        onClose={() => setConfirm(false)}
        onConfirm={cancel}
      />
    </section>
  );
}
