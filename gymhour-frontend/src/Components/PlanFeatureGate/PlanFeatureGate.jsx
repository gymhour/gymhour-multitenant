import React from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole, ArrowUpRight } from 'lucide-react';
import SidebarMenu from '../SidebarMenu/SidebarMenu';
import './PlanFeatureGate.css';

export const featureForPath = path => {
  if (/^\/(admin|entrenador)\/asistente-ia\/?$/.test(path)) return 'AI';
  if (path === '/admin/predictor-bajas') return 'CHURN';
  if (path === '/admin/ingreso') return 'CHECK_IN';
  if (path === '/admin/asistencias' || path === '/alumno/mis-asistencias') return 'ATTENDANCE';
  return null;
};

const featureDetails = {
  AI: { title: 'Asistente con IA', description: 'Consultá información de tu gimnasio, encontrá socios y prepará borradores de rutinas con ayuda de un asistente que responde a tus preguntas.' },
  CHURN: { title: 'Predictor de bajas', description: 'Identificá socios que podrían dejar de asistir y anticipate con promociones o un seguimiento personalizado para ayudar a retenerlos.' },
  CHECK_IN: { title: 'Ingreso por QR y DNI', description: 'Agilizá el ingreso de tus socios con un código QR o su DNI y registrá su asistencia al llegar al gimnasio.' },
  ATTENDANCE: { title: 'Registro de asistencias', description: 'Consultá las visitas de tus socios y seguí su frecuencia de asistencia para conocer su actividad en el gimnasio.' },
};

export default function PlanFeatureGate({ feature, billing, role, children }) {
  if (!feature || billing?.features?.[feature] !== false) return children;
  const details = featureDetails[feature];
  const description = feature === 'ATTENDANCE' && role === 'STUDENT'
    ? 'Consultá tu historial de visitas y seguí tu frecuencia de asistencia al gimnasio.' : details?.description;
  return <div className="page-layout"><SidebarMenu isAdmin={role === 'ADMIN'} isEntrenador={role === 'TRAINER'} />
    <main className="content-layout plan-locked" aria-labelledby="plan-locked-title">
    <div className="plan-locked__preview" aria-hidden="true">
      <div className="plan-locked__preview-top"><span /><span /><span /></div>
      <div className="plan-locked__preview-title" /><div className="plan-locked__preview-subtitle" />
      <div className="plan-locked__preview-grid"><span /><span /><span /></div>
      <div className="plan-locked__preview-table"><span /><span /><span /><span /></div>
    </div>
    <div className="plan-locked__veil" />
    <section className="plan-locked__card">
      <span className="plan-locked__eyebrow"><LockKeyhole size={14} /> Disponible en Pro</span>
      <h1 id="plan-locked-title">{details?.title}</h1>
      <p>{description}</p>
      {role === 'ADMIN' ? <Link to="/admin/suscripcion" className="plan-locked__action">Ver planes <ArrowUpRight size={18} /></Link>
        : <p className="plan-locked__staff-note">Pedile al administrador que active el plan Pro.</p>}
    </section>
    </main></div>;
}
