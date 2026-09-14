import React from 'react';
import { Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import './emptyState.css';

const EmptyState = ({ title = 'Todavía no hay contenido', description, actionLabel, actionTo, onAction, icon: Icon = Inbox, className = '' }) => {
  const action = actionLabel && (actionTo ? (
    <Link className="empty-state__action" to={actionTo}>{actionLabel}</Link>
  ) : (
    <button className="empty-state__action" type="button" onClick={onAction}>{actionLabel}</button>
  ));

  return (
    <section className={`empty-state ${className}`.trim()} aria-live="polite">
      <span className="empty-state__icon" aria-hidden="true"><Icon size={28} /></span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </section>
  );
};

export default EmptyState;
