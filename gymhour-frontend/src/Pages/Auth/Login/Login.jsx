import React, { useState } from 'react';
import './login.css';
import { useNavigate, useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { authClient } from '../../../axiosConfig';
import CustomInput from '../../../Components/utils/CustomInput/CustomInput';
import { toast } from 'react-toastify';
import { HOME_BY_ROLE, useAuth } from '../../../context/AuthContext';
import AuthShell from '../AuthShell/AuthShell';

const Login = () => {
  const navigate = useNavigate();
  const { slug: routeSlug } = useParams();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tenantSelection, setTenantSelection] = useState(null);

  const [showBirthdayModal, setShowBirthdayModal] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState(null);

  const todayKey = () => {
    // YYYY-MM-DD en horario local del navegador
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const buildBirthdayDismissKey = (userId) => `birthdayDismissed:${userId}:${todayKey()}`;

  const completeLogin = async ({ token, isBirthday }) => {
      const currentSession = await login(token);
      if (!currentSession?.user) throw new Error('No se pudo cargar la sesión.');
      const targetRoute = currentSession.user.role === 'ADMIN'
        && currentSession.tenant?.settings?.onboardingCompleted === false
        ? '/onboarding'
        : HOME_BY_ROLE[currentSession.user.role] || '/';

      const userId = currentSession.user.id;
      const dismissKey = buildBirthdayDismissKey(userId);
      const alreadyDismissedToday = localStorage.getItem(dismissKey) === '1';

      if (isBirthday && !alreadyDismissedToday) {
        setPendingRedirect(targetRoute);
        setShowBirthdayModal(true);
        toast.success('Inicio de sesión exitoso');
      } else {
        navigate(targetRoute);
        toast.success('Inicio de sesión exitoso');
      }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data } = await authClient.post('/auth/login', { email, password });
      if (data.requiresTenantSelection) {
        setTenantSelection({ token: data.selectionToken, tenants: data.tenants });
        return;
      }
      await completeLogin(data);

    } catch (error) {
      const data = error?.response?.data;
      toast.error(
        data?.message || data?.error || "No pudimos iniciar sesión. Revisá tu conexión e intentá de nuevo.",
        { autoClose: 8000 }
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleTenantSelection = async tenantId => {
    setIsLoading(true);
    try {
      const { data } = await authClient.post('/auth/login/select-tenant', {
        selectionToken: tenantSelection.token,
        tenantId,
      });
      await completeLogin(data);
    } catch (error) {
      const data = error?.response?.data;
      toast.error(data?.message || data?.error || 'No pudimos ingresar a ese gimnasio. Intentá nuevamente.');
      setTenantSelection(null);
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  };

  const restartLogin = () => {
    setTenantSelection(null);
    setPassword('');
  };

  const handleCloseBirthdayModal = () => {
    if (pendingRedirect) {
      navigate(pendingRedirect);
    }
  };

  return (
    <>
      <AuthShell variant="login">
        <div className="auth-card__heading">
          {!tenantSelection && <span className="auth-card__kicker">Acceso a tu cuenta</span>}
          <h2>{tenantSelection ? 'Elegí tu gimnasio' : 'Bienvenido de nuevo'}</h2>
          <p>{tenantSelection
            ? 'Tus credenciales coinciden en más de un gimnasio.'
            : 'Ingresá para gestionar tu gimnasio o acceder como parte del equipo.'}</p>
        </div>
        <div className="login-form-container">
          {tenantSelection ? (
            <div className="tenant-selection" aria-live="polite">
              <div className="tenant-options">
                {tenantSelection.tenants.map(tenant => (
                  <button key={tenant.id} type="button" className="tenant-option"
                    disabled={isLoading} onClick={() => handleTenantSelection(tenant.id)}>
                    <span>{tenant.name}</span>
                    <small>{tenant.role === 'ADMIN' ? 'Administrador' : tenant.role === 'TRAINER' ? 'Entrenador' : 'Alumno'}</small>
                  </button>
                ))}
              </div>
              <button type="button" className="restart-login" onClick={restartLogin} disabled={isLoading}>
                Usar otra cuenta
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="auth-field">
                <span>Email</span>
                <CustomInput type="email" placeholder="tu@email.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} width='100%' autoComplete="email" required />
              </label>
              <label className="auth-field">
                <span>Contraseña</span>
                <CustomInput type="password" placeholder="Ingresá tu contraseña" value={password}
                  onChange={(e) => setPassword(e.target.value)} width='100%' autoComplete="current-password" required />
              </label>

              <div className="login-form__help">
                <span />
                <Link to={routeSlug ? `/g/${routeSlug}/forgot-password` : '/forgot-password'}>
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>

              <button className='btn-login' type="submit" disabled={isLoading}>
                <span>{isLoading ? 'Ingresando...' : 'Ingresar a Gymhour'}</span>
                {!isLoading && <b aria-hidden="true">→</b>}
              </button>
            </form>
          )}
        </div>

        {!tenantSelection && (
          <div className="auth-card__footer">
            <div>
              <strong>¿Sos dueño de un gimnasio?</strong>
              {/* <span>Creá tu espacio de gestión en pocos minutos.</span> */}
            </div>
            <Link to="/sign-up">Registrar mi gimnasio <b aria-hidden="true">→</b></Link>
          </div>
        )}
      </AuthShell>

      {showBirthdayModal && (
        <div className="birthday-overlay" aria-modal="true" role="dialog">
          <div className="birthday-modal">
            <h3 style={{ margin: 0, fontSize: 22 }}>🎉 ¡Feliz cumpleaños! 🎉</h3>
            <p style={{ margin: '14px 0 0', lineHeight: 1.5 }}>
              Te deseamos un gran día y muchos logros. ¡A entrenar con todo! 💪
            </p>

            <button onClick={handleCloseBirthdayModal} className="btn-primary">
              Gracias 🙌
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Login;
