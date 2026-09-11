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

const darkenHex = (hex, amount = 0.16) => {
  const value = hex.slice(1);
  const channel = offset => Math.max(0, Math.round(parseInt(value.slice(offset, offset + 2), 16) * (1 - amount)))
    .toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
};

const AuthShell = ({ variant = 'login', children, tenantBranding = null, tenantMode = false }) => {
  const content = COPY[variant] || COPY.login;
  const branded = tenantMode || Boolean(tenantBranding);
  const color = tenantBranding?.primaryColor || CLIENT_SETUP.branding.theme.primaryColor;
  const logo = tenantBranding?.logoUrl || CLIENT_SETUP.branding.logo;
  const name = tenantBranding?.name || CLIENT_SETUP.branding.name;

  return (
    <main className={`auth-shell auth-shell--${variant}${branded ? ' auth-shell--tenant' : ''}`}
      style={{
        '--auth-background': `url(${CLIENT_SETUP.branding.loginBackground})`,
        '--auth-orange': color,
        '--primary-color': color,
        '--primary-color-hover': darkenHex(color),
        '--background-hover-color': `${color}26`,
      }}>
      <div className="auth-shell__inner">
        <header className="auth-shell__header">
          <Link className="auth-shell__brand" to={tenantBranding ? `/${tenantBranding.slug}/login` : '/'} aria-label={`${name}, inicio`}>
            <img className={branded ? 'auth-shell__tenant-logo' : ''} src={logo} alt={`Logo de ${name}`} />
            <span>{branded ? name : 'Portal de gestión'}</span>
          </Link>
          {!branded && <nav className="auth-shell__nav" aria-label="Acceso a Gymhour">
            <Link className={variant === 'login' ? 'is-active' : ''} to="/">Iniciar sesión</Link>
            <Link className={variant === 'signup' ? 'is-active' : ''} to="/sign-up">Crear gimnasio</Link>
          </nav>}
        </header>

        <div className="auth-shell__grid">
          <section className="auth-story" aria-label="Gymhour">
            <div className="auth-story__eyebrow"><i /> {branded ? `Portal de ${name}` : content.eyebrow}</div>
            <h1>{branded ? <>Tu entrenamiento.<br /><span>Tu comunidad.</span></> : content.title}</h1>
            <p>{branded ? `Ingresá a tu cuenta de ${name} para reservar clases, consultar tus rutinas y seguir tu progreso.` : content.description}</p>

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
