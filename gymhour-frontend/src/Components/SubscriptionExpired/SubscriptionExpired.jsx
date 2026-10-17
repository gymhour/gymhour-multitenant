import React, { useEffect, useRef } from 'react';
import { FaWhatsapp } from 'react-icons/fa';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { subscriptionLink } from './subscriptionLink';
import './SubscriptionExpired.css';

export default function SubscriptionExpired() {
  const { user, tenant } = useAuth();
  const cardRef = useRef(null);
  const admin = user?.role === 'ADMIN';

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cardRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  return <div className="subscription-expired">
    <section ref={cardRef} tabIndex={-1} className="subscription-expired__card" role="dialog" aria-modal="true" aria-labelledby="subscription-expired-title" aria-describedby="subscription-expired-description">
      <div className="subscription-expired__header">
        <div className="subscription-expired__icon"><LockKeyhole size={22} strokeWidth={1.8} aria-hidden="true" /></div>
        <span className="subscription-expired__eyebrow">Gymhour <span aria-hidden="true">/</span> Suscripción</span>
      </div>
      <h1 id="subscription-expired-title">Tu acceso está en pausa</h1>
      <p id="subscription-expired-description">{admin
        ? 'Terminó el período de prueba o venció la suscripción. Pedinos el enlace para seguir usando Gymhour.'
        : `La suscripción de ${tenant?.name || 'tu gimnasio'} venció. Contactá al administrador de tu gimnasio para volver a usar Gymhour.`}</p>
      {admin && <div className="subscription-expired__actions">
        <a className="subscription-expired__whatsapp" href={subscriptionLink(tenant)} target="_blank" rel="noopener noreferrer">
          <FaWhatsapp aria-hidden="true" /> Pedir link de suscripción
        </a>
      </div>}
    </section>
  </div>;
}
