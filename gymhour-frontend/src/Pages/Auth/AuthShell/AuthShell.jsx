import React from 'react';
import { Link } from 'react-router-dom';
import CLIENT_SETUP from '../../../setup';
import './authShell.css';

const COPY = {
  login: {
    title: <>Tu gimnasio,<br />ordenado.</>,
    description: 'Turnos, rutinas, cuotas y asistencias en un solo lugar.',
  },
  signup: {
    title: <>Empezá<br />en dos minutos.</>,
    description: 'Creás la cuenta con tu email y después cargás los datos del gimnasio.',
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
        <div className="auth-shell__grid">
          <section className="auth-story" aria-label="Gymhour">
            <Link className="auth-story__brand" to={tenantBranding ? `/${tenantBranding.slug}/login` : '/'} aria-label={`${name}, inicio`}>
              <img className={branded ? 'auth-shell__tenant-logo' : ''} src={logo} alt={`Logo de ${name}`} />
            </Link>
            <div className="auth-story__content">
              <h1>{branded ? <>Tu entrenamiento.<br />Tu comunidad.</> : content.title}</h1>
              <p>{branded ? `Ingresá a tu cuenta de ${name} para reservar clases, consultar tus rutinas y seguir tu progreso.` : content.description}</p>
            </div>
            <div className="auth-story__caption">{branded ? `Portal de ${name}` : 'Software para gimnasios'}</div>
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
