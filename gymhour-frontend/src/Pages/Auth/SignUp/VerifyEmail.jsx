import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authClient } from '../../../axiosConfig';
import { useAuth } from '../../../context/AuthContext';
import CLIENT_SETUP from '../../../setup';
import './signup.css';

const verificationRequests = new Map();

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const token = params.get('token');
  const [status, setStatus] = useState(token ? 'Verificando tu email...' : 'El enlace de verificación no es válido.');

  useEffect(() => {
    if (!token) return;
    let active = true;
    if (!verificationRequests.has(token)) {
      verificationRequests.set(token, authClient.post('/auth/verify-email', { token }));
    }
    verificationRequests.get(token)
      .then(async ({ data }) => {
        if (!active) return;
        const session = await login(data.token);
        if (active && session?.user) navigate('/onboarding', { replace: true });
        else if (active) setStatus('El email se verificó, pero no pudimos iniciar sesión. Ingresá con tu cuenta.');
      })
      .catch(error => { if (active) setStatus(error.response?.data?.message || 'No pudimos verificar tu email. Intentá nuevamente.'); });
    return () => { active = false; };
  }, [token, login, navigate]);

  return <main className="signup-page signup-verification">
    <div className="signup-card">
      <img src={CLIENT_SETUP.branding.logo} alt="Gymhour" className="signup-verification__logo" />
      <h1>Verificación de email</h1>
      <p role="status">{status}</p>
      <Link to="/">Ir a iniciar sesión</Link>
    </div>
  </main>;
}
