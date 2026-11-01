import './SupportWhatsAppButton.css';
import { useLocation } from 'react-router-dom';
import { FaWhatsapp } from 'react-icons/fa';

// Número de soporte de Gymhour (código de país incluido, sin "+").
const SUPPORT_PHONE = '5493415936396';
const SUPPORT_MESSAGE = '¡Hola! Necesito ayuda con Gymhour.';

// Pantallas tipo kiosco donde el botón no debe mostrarse.
const HIDDEN_PATHS = [/\/ingreso\/?$/];

const SupportWhatsAppButton = () => {
    const { pathname } = useLocation();
    if (HIDDEN_PATHS.some((pattern) => pattern.test(pathname))) return null;

    const href = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(SUPPORT_MESSAGE)}`;

    return (
        <a
            className="support-wa-button"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Contactar a soporte por WhatsApp"
            title="Soporte por WhatsApp"
        >
            <FaWhatsapp className="support-wa-icon" aria-hidden="true" />
            <span className="support-wa-text">
                <span className="support-wa-label">¿Necesitás ayuda?</span>
                <span className="support-wa-title">Soporte</span>
            </span>
        </a>
    );
};

export default SupportWhatsAppButton;
