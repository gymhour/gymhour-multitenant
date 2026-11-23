import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Link2, Wallet } from 'lucide-react';
import { toast } from 'react-toastify';
import apiService from '../../services/apiService';
import ConfirmationPopup from '../utils/ConfirmationPopUp/ConfirmationPopUp';
import './MercadoPagoConnection.css';

// Conexión del gimnasio con su cuenta de Mercado Pago (OAuth). Ver gymhour-backend/MERCADOPAGO.md.
const CONNECTION_ERRORS = {
  CANCELADO: 'No se completó la autorización en Mercado Pago.',
  STATE_INVALID: 'La conexión venció o ya se había usado. Probá de nuevo.',
  PLAN_UPGRADE_REQUIRED: 'Los cobros con Mercado Pago están disponibles en el plan Pro.',
  MODE_MISMATCH: 'Esa cuenta de Mercado Pago no corresponde al modo de cobro de Gymhour (prueba o real).',
  ACCOUNT_CHANGE_BLOCKED: 'Hay pagos en curso o débitos activos de otra cuenta de Mercado Pago. Reconectá la misma cuenta o cancelá antes los débitos.',
};

const formatDate = value => value ? new Date(value).toLocaleDateString('es-AR') : '';

export default function MercadoPagoConnection({ index = '05' }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [debitsToCancel, setDebitsToCancel] = useState(0);

  const load = useCallback(async () => {
    try {
      setStatus(await apiService.getMercadoPagoConnection());
      setLoadError('');
    } catch (error) { setLoadError(error.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Vuelta desde Mercado Pago: ?mp=conectado o ?mp=error&motivo=...
  useEffect(() => {
    const result = searchParams.get('mp');
    if (!result) return;
    if (result === 'conectado') toast.success('Mercado Pago quedó conectado. Tus socios ya pueden pagar sus cuotas online.');
    else toast.error(CONNECTION_ERRORS[searchParams.get('motivo')] || 'No pudimos conectar Mercado Pago. Probá de nuevo.');
    const next = new URLSearchParams(searchParams);
    next.delete('mp');
    next.delete('motivo');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await apiService.connectMercadoPago();
      window.location.assign(url);
    } catch (error) {
      toast.error(error.message);
      setBusy(false);
    }
  };

  const disconnect = async (cancelarDebitos = false) => {
    setBusy(true);
    try {
      const result = await apiService.disconnectMercadoPago(cancelarDebitos);
      toast.success(result.debitosCancelados
        ? `Mercado Pago quedó desconectado y se cancelaron ${result.debitosCancelados} débitos automáticos.`
        : 'Mercado Pago quedó desconectado.');
      setConfirmDisconnect(false);
      setDebitsToCancel(0);
      await load();
    } catch (error) {
      if (error.code === 'DEBITOS_ACTIVOS') {
        setDebitsToCancel(error.details?.debitos || 0);
      } else {
        toast.error(error.message);
        setConfirmDisconnect(false);
      }
    } finally { setBusy(false); }
  };

  const connected = status?.connected;
  return (
    <section className="settings-section" aria-labelledby="settings-mercadopago-title">
      <div className="settings-section-index">{index}</div>
      <div className="settings-section-body">
        <div className="settings-section-heading">
          <div>
            <h2 id="settings-mercadopago-title">Cobros con Mercado Pago</h2>
            <p>Tus socios pagan sus cuotas desde Gymhour con dinero en cuenta, débito o crédito, y la plata llega directo a tu cuenta de Mercado Pago. Cada pago queda registrado en la cuota con su número de operación.</p>
          </div>
          <Wallet size={19} />
        </div>

        {!status && !loadError && <p className="mp-connection-muted">Cargando…</p>}
        {loadError && <p className="mp-connection-muted">{loadError}</p>}

        {status && !status.featureEnabled && (
          <div className="mp-connection-card">
            <strong>Disponible en el plan Pro</strong>
            <span>Con el plan Pro, tus socios pagan sus cuotas online y pueden adherirse al débito automático.</span>
            <Link className="mp-connection-link" to="/admin/suscripcion">Ver planes</Link>
          </div>
        )}

        {status?.featureEnabled && !status.configured && (
          <div className="mp-connection-card">
            <strong>Todavía no disponible</strong>
            <span>Los cobros con Mercado Pago todavía no están habilitados en Gymhour.</span>
          </div>
        )}

        {status?.featureEnabled && status.configured && !connected && (
          <div className="mp-connection-card">
            <strong>Conectá tu cuenta de Mercado Pago</strong>
            <ul>
              <li>Vas a iniciar sesión en Mercado Pago, no en Gymhour: nunca vemos tu contraseña.</li>
              <li>Gymhour solo crea los cobros de las cuotas y consulta esos pagos. No hace devoluciones ni mueve tu plata.</li>
              <li>Podés desconectarla cuando quieras desde acá o desde tu cuenta de Mercado Pago.</li>
            </ul>
            <button type="button" className="mp-connection-primary" disabled={busy} onClick={connect}>
              <Link2 size={15} /> {busy ? 'Abriendo Mercado Pago…' : 'Conectar Mercado Pago'}
            </button>
          </div>
        )}

        {status?.featureEnabled && connected && (
          <div className={`mp-connection-card ${status.status === 'ERROR' ? 'mp-connection-card--warning' : ''}`}>
            {status.status === 'ERROR' ? (
              <>
                <strong><AlertTriangle size={15} /> Hay que reconectar Mercado Pago</strong>
                <span>{status.lastError || 'Mercado Pago dejó de aceptar el acceso de Gymhour.'} Mientras tanto, tus socios no pueden pagar online y los cobros del débito automático se registran cuando reconectes.</span>
              </>
            ) : (
              <>
                <strong><CheckCircle2 size={15} /> Conectado{status.nickname ? ` como ${status.nickname}` : ''}</strong>
                <span>Desde el {formatDate(status.connectedAt)}.{status.testMode ? ' Modo de prueba: los pagos no son reales.' : ''}</span>
                {(status.activeDebits > 0 || status.activeAttempts > 0) && (
                  <span>{status.activeDebits} débitos automáticos activos · {status.activeAttempts} pagos en curso.</span>
                )}
              </>
            )}
            <div className="mp-connection-actions">
              {status.status === 'ERROR' && (
                <button type="button" className="mp-connection-primary" disabled={busy} onClick={connect}>
                  <Link2 size={15} /> Reconectar
                </button>
              )}
              <button type="button" className="mp-connection-secondary" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
                Desconectar
              </button>
            </div>
            <small>Para quitar del todo el acceso, entrá también a tu cuenta de Mercado Pago, en la sección de seguridad, y quitá a Gymhour de las aplicaciones conectadas. Eso no afecta a tu cuenta ni a tu plata.</small>
          </div>
        )}
      </div>

      <ConfirmationPopup
        isOpen={confirmDisconnect}
        isLoading={busy}
        confirmText={debitsToCancel ? `Cancelar ${debitsToCancel} débitos y desconectar` : 'Desconectar'}
        message={debitsToCancel
          ? `Tenés ${debitsToCancel} socios con débito automático. Si desconectás, se van a cancelar todos y tendrán que volver a adherirse. ¿Seguimos?`
          : '¿Desconectar Mercado Pago? Tus socios no van a poder pagar sus cuotas online hasta que vuelvas a conectarlo.'}
        onClose={() => { setConfirmDisconnect(false); setDebitsToCancel(0); }}
        onConfirm={() => disconnect(Boolean(debitsToCancel))}
      />
    </section>
  );
}
