import React, { useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import './AdminSetupGuide.css';

const STEP_DEFINITIONS = [
  {
    key: 'plan', title: 'Creá tu primer plan',
    actions: [{ label: 'Crear plan', to: '/admin/planes?action=create', description: 'Definí precios, duración y sesiones para ordenar la oferta de tu gimnasio.' }],
  },
  {
    key: 'members', title: 'Agregá socios y asignales un plan',
    actions: [
      { label: 'Crear socio', to: '/admin/crear-usuario', description: 'Da de alta una persona de forma individual y asignale su plan.' },
      { label: 'Importar socios', to: '/admin/usuarios?action=import', description: 'Cargá varios socios juntos usando una planilla de Excel.' },
    ],
  },
  {
    key: 'routine', title: 'Asigná la primera rutina',
    actions: [{ label: 'Asignar rutina', to: '/admin/asignar-rutinas', description: 'Prepará el entrenamiento y elegí qué socios o grupos lo recibirán.' }],
  },
  {
    key: 'quotas', title: 'Generá las primeras cuotas',
    actions: [{ label: 'Generar cuotas', to: '/admin/cuotas?action=generate', description: 'Creá los cargos del mes para todos los socios que tengan un plan.' }],
  },
  {
    key: 'payment', title: 'Registrá el primer cobro',
    actions: [{ label: 'Ver cuotas pendientes', to: '/admin/cuotas?estado=pendiente', description: 'Confirmá un pago para mantener al día la caja y el estado del socio.' }],
  },
];

const AdminSetupGuide = ({ guide, onDismiss, dismissing = false }) => {
  const [expanded, setExpanded] = useState(false);
  const firstPending = STEP_DEFINITIONS.find(step => !guide?.steps?.[step.key])?.key;
  const progress = Math.round(((guide?.completedSteps || 0) / (guide?.totalSteps || 5)) * 100);

  return (
    <section className="admin-setup-guide" aria-labelledby="admin-setup-title">
      <div className="admin-setup-guide__header">
        <div>
          <span className="admin-setup-guide__eyebrow">Primeros pasos</span>
          <h2 id="admin-setup-title">Dejá Gymhour listo para trabajar</h2>
          <p>Completá esta guía para empezar a administrar socios, rutinas y cobros.</p>
        </div>
        <button type="button" className="admin-setup-guide__dismiss" onClick={onDismiss} disabled={dismissing}>
          <X size={15} /> {dismissing ? 'Ocultando…' : 'Ocultar guía'}
        </button>
      </div>

      <div className="admin-setup-guide__progress-row">
        <strong>{guide?.completedSteps || 0} de {guide?.totalSteps || 5} completados</strong>
        <span>{progress}%</span>
      </div>
      <div className="admin-setup-guide__progress" role="progressbar" aria-label="Progreso de configuración" aria-valuemin="0" aria-valuemax="5" aria-valuenow={guide?.completedSteps || 0}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <button type="button" className="admin-setup-guide__toggle" aria-expanded={expanded} aria-controls="admin-setup-actions" onClick={() => setExpanded(value => !value)}>
        <span>{expanded ? 'Ocultar pasos' : 'Ver pasos de configuración'}</span>
        <ChevronDown size={17} className={expanded ? 'is-open' : ''} />
      </button>

      {expanded && <ol id="admin-setup-actions" className="admin-setup-guide__steps">
        {STEP_DEFINITIONS.map((step, index) => {
          const complete = Boolean(guide?.steps?.[step.key]);
          const current = step.key === firstPending;
          return (
            <li key={step.key} className={`${complete ? 'is-complete' : ''} ${current ? 'is-current' : ''}`}>
              <div className="admin-setup-guide__status" aria-hidden="true">
                {complete ? <Check size={14} /> : <span>{index + 1}</span>}
              </div>
              <div className="admin-setup-guide__copy">
                <h3>{step.title}</h3>
                {complete ? <p className="admin-setup-guide__done">Paso completado</p> : step.actions.map(action => (
                  <div className="admin-setup-guide__action" key={action.label}>
                    <p>{action.description}</p>
                    <Link to={action.to}>{action.label}</Link>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>}
    </section>
  );
};

export default AdminSetupGuide;
