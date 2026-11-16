import React from 'react';
import { subscriptionLink } from '../SubscriptionExpired/subscriptionLink';
import './TrialStatusBar.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const SELF_SERVICE_LIMIT = 200;

export const daysRemaining = billing => {
  const end = Date.parse(billing?.trialEndsAt || '');
  const now = Date.parse(billing?.serverNow || '');
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
  return Math.max(1, Math.ceil((end - now) / DAY_MS));
};

export default function TrialStatusBar({ billing, admin = false, tenant }) {
  if (billing?.state !== 'TRIAL') return null;
  const days = daysRemaining(billing);
  if (days === null) return null;
  // La prueba no tiene tope, pero al terminar solo hay planes hasta 200 socios activos.
  const overLimit = admin && billing.activeStudents > SELF_SERVICE_LIMIT;
  return <div className="trial-status-bar" role="status" aria-label={`En prueba. ${days} ${days === 1 ? 'día restante' : 'días restantes'}`}>
    <span className={`trial-status-bar__label${overLimit ? ' trial-status-bar__label--warning' : ''}`}>
      En prueba <span aria-hidden="true">·</span> {days} {days === 1 ? 'día restante' : 'días restantes'}
      {overLimit && <> <span aria-hidden="true">·</span> Tenés más de {SELF_SERVICE_LIMIT} socios activos: al terminar la prueba vas a necesitar el plan A medida <span aria-hidden="true">·</span>{' '}
        <a href={subscriptionLink(tenant)} target="_blank" rel="noopener noreferrer">Pedir propuesta</a></>}
    </span>
  </div>;
}
