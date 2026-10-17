import React from 'react';
import './TrialStatusBar.css';

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysRemaining = billing => {
  const end = Date.parse(billing?.trialEndsAt || '');
  const now = Date.parse(billing?.serverNow || '');
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
  return Math.max(1, Math.ceil((end - now) / DAY_MS));
};

export default function TrialStatusBar({ billing }) {
  if (billing?.state !== 'TRIAL') return null;
  const days = daysRemaining(billing);
  if (days === null) return null;
  return <div className="trial-status-bar" role="status" aria-label={`En prueba. ${days} ${days === 1 ? 'día restante' : 'días restantes'}`}>
    <span className="trial-status-bar__label">En prueba <span aria-hidden="true">·</span> {days} {days === 1 ? 'día restante' : 'días restantes'}</span>
  </div>;
}
