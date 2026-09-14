import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authClient } from '../../../axiosConfig';
import { useAuth } from '../../../context/AuthContext';
import CustomInput from '../../../Components/utils/CustomInput/CustomInput';
import AuthShell from '../AuthShell/AuthShell';
import './signup.css';

const SignUp = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  const handleSubmit = async event => {
    event.preventDefault();
    setLoading(true); setMessage('');
    try {
      const { data } = await authClient.post('/auth/tenants', form);
      await login(data.token);
      if (data.kioskActivationToken) sessionStorage.setItem('newKioskActivationToken', data.kioskActivationToken);
      navigate('/onboarding', { replace: true });
    } catch (error) {
      setMessage(error.response?.data?.message || 'No se pudo crear el gimnasio.');
    } finally { setLoading(false); }
  };

  return (
    <AuthShell variant="signup">
      <div className="auth-card__heading signup-heading">
        <span className="auth-card__kicker">Cuenta para propietarios</span>
        <h2>Creá tu cuenta</h2>
        <p>Primero configurá tus datos de acceso. Después personalizaremos tu gimnasio.</p>
      </div>

      <form className="signup-form" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>Email</span>
          <CustomInput name="email" type="email" placeholder="tu@email.com" value={form.email}
            onChange={change} width="100%" autoComplete="email" required />
        </label>

        <label className="auth-field">
          <span>Contraseña</span>
          <CustomInput name="password" type="password" minLength={8} placeholder="Mínimo 8 caracteres"
            value={form.password} onChange={change} width="100%" autoComplete="new-password" required />
        </label>

        {message && <div className="signup-error" role="alert">{message}</div>}

        <button className="btn-login signup-submit" type="submit" disabled={loading}>
          <span>{loading ? 'Creando tu cuenta...' : 'Continuar'}</span>
        </button>
      </form>

      <div className="auth-card__footer">
        <div>
          <strong>¿Ya tenés cuenta?</strong>
        </div>
        <Link to="/">Iniciar sesión</Link>
      </div>
    </AuthShell>
  );
};

export default SignUp;
