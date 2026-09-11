import React, { useEffect, useState } from 'react';
import { CheckCircle2, LogIn, RotateCcw, ShieldCheck, X, XCircle } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CustomInput from '../../../Components/utils/CustomInput/CustomInput';
import apiService from '../../../services/apiService';
import CLIENT_SETUP from '../../../setup';
import './PublicCheckInPage.css';

// En modo kiosko el resultado se cierra solo para dejar la pantalla lista al próximo alumno.
const KIOSK_RESULT_TIMEOUT_MS = 15000;
const darkenHex = (hex, amount = 0.16) => {
  const value = hex.slice(1);
  const channel = offset => Math.max(0, Math.round(parseInt(value.slice(offset, offset + 2), 16) * (1 - amount)))
    .toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
};

const PublicCheckInPage = () => {
  const navigate = useNavigate();
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const isKiosk = searchParams.get('mode') === 'kiosk';
  const [dni, setDni] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState(null);
  const [brandingError, setBrandingError] = useState(false);
  const [brandingLoading, setBrandingLoading] = useState(Boolean(slug));
  const [kioskToken] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const activationToken = fragment.get('token');
    if (activationToken) {
      localStorage.setItem('gymhourKioskToken', activationToken);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      return activationToken;
    }
    return localStorage.getItem('gymhourKioskToken') || '';
  });

  useEffect(() => {
    let active = true;
    if (!slug) return () => { active = false; };
    apiService.getTenantBranding(slug)
      .then(data => { if (active) setBranding(data); })
      .catch(() => { if (active) setBrandingError(true); })
      .finally(() => { if (active) setBrandingLoading(false); });
    return () => { active = false; };
  }, [slug]);

  // Logo según el tema (claro = negro, oscuro = el actual). Reactivo a cambios de tema.
  const [theme, setTheme] = useState(
    () => document.body.getAttribute('data-theme') || localStorage.getItem('theme') || 'dark'
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.body.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const logoSrc = branding?.logoUrl || (theme === 'light'
    ? (CLIENT_SETUP.branding.logoLight || CLIENT_SETUP.branding.logo)
    : CLIENT_SETUP.branding.logo);

  const handleSubmit = async event => {
    event.preventDefault();
    if (!dni.trim() || loading) return;

    setLoading(true);
    try {
      if (!slug && !kioskToken) throw new Error('Este enlace de ingreso no identifica al gimnasio.');
      const data = await apiService.registerAttendance({
        dni,
        method: isKiosk ? 'DNI' : 'QR',
        kioskToken: slug ? null : kioskToken,
        tenantSlug: slug,
      });
      setResult(data);
      if (data.allowed) {
        setDni('');
      }
    } catch (error) {
      setResult({
        allowed: false,
        status: 'rejected',
        message: error.message || 'No se pudo registrar el ingreso.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setDni('');
  };

  // Auto-cierre del resultado en modo kiosko (con opción de cerrar antes desde la X).
  useEffect(() => {
    if (!isKiosk || !result) return undefined;
    const timeoutId = setTimeout(handleRetry, KIOSK_RESULT_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [isKiosk, result]);

  const isAllowed = result?.allowed === true;

  return (
    <main className="public-checkin-page" style={branding?.primaryColor ? {
      '--primary-color': branding.primaryColor,
      '--primary-color-hover': darkenHex(branding.primaryColor),
      '--background-hover-color': `${branding.primaryColor}26`,
    } : undefined}>
      <section className="public-checkin-shell">
        <div className="public-checkin-card">
          <img src={logoSrc} alt={branding ? `Logo de ${branding.name}` : CLIENT_SETUP.branding.logoAlt} className="public-checkin-logo" />
          <div className="public-checkin-heading">
            <ShieldCheck className="public-checkin-icon" />
            <div>
              <h1>{branding?.name ? `Ingreso a ${branding.name}` : 'Ingreso al gimnasio'}</h1>
              <p>Ingresá tu DNI para registrar la asistencia.</p>
            </div>
          </div>

          {brandingLoading ? (
            <div className="public-checkin-result-copy"><p>Cargando gimnasio...</p></div>
          ) : brandingError ? (
            <section className="public-checkin-result error" aria-live="polite">
              <XCircle className="public-checkin-result-icon" />
              <div className="public-checkin-result-copy"><h2>Enlace no disponible</h2><p>Pedile al gimnasio su enlace de ingreso actualizado.</p></div>
            </section>
          ) : !result ? (
            <form className="public-checkin-form" onSubmit={handleSubmit}>
              <CustomInput
                value={dni}
                onChange={event => setDni(event.target.value.replace(/\D/g, ''))}
                placeholder="DNI"
                inputMode="numeric"
                width="100%"
                autoFocus={isKiosk}
              />
              <button type="submit" className="attendance-primary-action public-checkin-submit" disabled={loading || !dni.trim()}>
                {loading ? 'Registrando...' : 'Registrar ingreso'}
              </button>
            </form>
          ) : (
            <section className={`public-checkin-result ${isAllowed ? 'success' : 'error'}`} aria-live="polite">
              {isKiosk && (
                <button
                  type="button"
                  className="public-checkin-result-close"
                  onClick={handleRetry}
                  aria-label="Cerrar"
                  title="Cerrar"
                >
                  <X size={22} />
                </button>
              )}

              <div className="public-checkin-result-icon-wrap">
                {isAllowed ? (
                  <CheckCircle2 className="public-checkin-result-icon" />
                ) : (
                  <XCircle className="public-checkin-result-icon" />
                )}
              </div>

              <div className="public-checkin-result-copy">
                <h2>{isAllowed ? 'Ingreso registrado' : 'Ingreso rechazado'}</h2>

                {isAllowed ? (
                  <p>{result.message}</p>
                ) : (
                  <>
                    <div className="public-checkin-result-reason" role="alert">
                      {result.message}
                    </div>
                    <p className="public-checkin-result-help">
                      Hablá con el administrador para solucionar este inconveniente.
                    </p>
                  </>
                )}
              </div>

              <button
                type="button"
                className="attendance-primary-action public-checkin-result-action"
                onClick={isAllowed && !isKiosk ? () => navigate(slug ? `/${slug}/login` : '/') : handleRetry}
              >
                {isAllowed && !isKiosk ? <LogIn size={18} /> : <RotateCcw size={18} />}
                {isKiosk ? 'Registrar otro ingreso' : (isAllowed ? 'Ir a la App' : 'Intentarlo nuevamente')}
              </button>
            </section>
          )}
        </div>
      </section>
    </main>
  );
};

export default PublicCheckInPage;
