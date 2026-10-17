import React from 'react';
import { AUTOMATIC_SUBSCRIPTION_HELP } from './subscriptionHelp';
import '../TrialStatusBar/TrialStatusBar.css';
import './SubscriptionRenewalStatusBar.css';

const DAY_MS = 24 * 60 * 60 * 1000;

export const renewalDaysRemaining = billing => {
  if (billing?.state !== 'PAID') return null;
  const end = Date.parse(billing.paidUntil || '');
  const now = Date.parse(billing.serverNow || '');
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
  const remaining = end - now;
  if (remaining <= 0 || remaining > 3 * DAY_MS) return null;
  return Math.ceil(remaining / DAY_MS);
};

export default function SubscriptionRenewalStatusBar({ days }) {
  return <div className="trial-status-bar subscription-renewal-status-bar" role="status" aria-label={`Suscripción por vencer. ${days} ${days === 1 ? 'día restante' : 'días restantes'}`}>
    <span className="trial-status-bar__label subscription-renewal-status-bar__label">
      Suscripción <span aria-hidden="true">·</span> {days} {days === 1 ? 'día restante' : 'días restantes'}
      <span className="subscription-renewal-status-bar__help">
        <button type="button" aria-label="Información sobre la suscripción" aria-describedby="subscription-renewal-status-bar-tooltip">?</button>
        <span id="subscription-renewal-status-bar-tooltip" role="tooltip" className="subscription-renewal-status-bar__tooltip">{AUTOMATIC_SUBSCRIPTION_HELP}</span>
      </span>
    </span>
  </div>;
}
