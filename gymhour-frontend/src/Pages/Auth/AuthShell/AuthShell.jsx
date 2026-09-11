import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChartNoAxesCombined, UsersRound } from 'lucide-react';
import CLIENT_SETUP from '../../../setup';
import './authShell.css';

const COPY = {
  login: {
    eyebrow: 'El centro de control de tu gimnasio',
    title: <>Más orden.<br /><span>Más gimnasio.</span></>,
    description: 'Gestioná socios, turnos, cuotas y rutinas desde un solo lugar. Todo tu equipo conectado, estés donde estés.',
  },
  signup: {
    eyebrow: 'Tu gimnasio empieza acá',
    title: <>Hacé crecer<br /><span>tu comunidad.</span></>,
    description: 'Abrí el espacio digital de tu gimnasio en minutos. Después vas a poder invitar a tu equipo y sumar a tus socios.',
  },
};

const AuthShell = ({ variant = 'login', children }) => {
  const content = COPY[variant] || COPY.login;

  return (
    <main className={`auth-shell auth-shell--${variant}`}
      style={{ '--auth-background': `url(${CLIENT_SETUP.branding.loginBackground})` }}>
      <div className="auth-shell__inner">
        <header className="auth-shell__header">
          <Link className="auth-shell__brand" to="/" aria-label="Gymhour, inicio">
            <img src={CLIENT_SETUP.branding.logo} alt={CLIENT_SETUP.branding.logoAlt} />
            <span>Portal de gestión</span>
          </Link>
          <nav className="auth-shell__nav" aria-label="Acceso a Gymhour">
            <Link className={variant === 'login' ? 'is-active' : ''} to="/">Iniciar sesión</Link>
            <Link className={variant === 'signup' ? 'is-active' : ''} to="/sign-up">Crear gimnasio</Link>
          </nav>
        </header>

        <div className="auth-shell__grid">
          <section className="auth-story" aria-label="Gymhour">
            <div className="auth-story__eyebrow"><i /> {content.eyebrow}</div>
            <h1>{content.title}</h1>
            <p>{content.description}</p>

            <div className="auth-story__features">
              <div><CalendarDays aria-hidden="true" /><span>Turnos inteligentes</span></div>
              <div><ChartNoAxesCombined aria-hidden="true" /><span>Tu gestión en tiempo real</span></div>
              <div><UsersRound aria-hidden="true" /><span>Equipo y socios conectados</span></div>
            </div>
          </section>

          <section className="auth-card">
            {children}
          </section>
        </div>
      </div>
    </main>
  );
};

export default AuthShell;
