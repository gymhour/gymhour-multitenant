// ============================================================================
// CONFIGURACION POR CLIENTE
//
// Este es el punto central de configuracion visual y comercial del frontend.
// Para personalizar un cliente, agregar sus archivos en src/assets/client y
// editar solamente los imports y valores de este archivo.
// ============================================================================

// Logo blanco para fondos oscuros, variante negra para fondos claros y
// versión cuadrada (marca sobre el color primario) para favicon/PWA.
import logoDark from './assets/gymhour/gymhour-texto-blanco.png';
import logoLight from './assets/gymhour/gymhour-texto-negro.png';
import favicon from './assets/client/gymhour_favicon.png';
import loginBackground from './assets/login/login_background.png';

const CLIENT_SETUP = {
  // REACT_APP_API_URL manda en los builds de cada ambiente. El fallback apunta
  // al backend local a propósito: así un build sin la variable falla de forma
  // evidente en vez de pegarle a la API de otro cliente.
  apiUrl: process.env.REACT_APP_API_URL || 'http://localhost:3000',

  branding: {
    name: 'Gymhour',
    logoAlt: 'Gymhour',
    logo: logoDark,
    logoLight,
    favicon,
    appleTouchIcon: favicon,
    loginBackground,
    metadata: {
      title: 'Gymhour',
      description: 'Gymhour — software de gestión para gimnasios.',
      themeColor: '#DA4632',
    },
    // Estos valores se inyectan como variables CSS en applyClientSetup().
    // Los mismos colores están replicados como fallback en variables.css:
    // si se cambian acá, actualizar también ese archivo.
    theme: {
      primaryColor: '#DA4632',
      primaryColorHover: '#B93C2B',
      backgroundHoverColor: '#DA463226',
    },
  },

  // Datos de cobro. Cada campo se muestra en la pantalla de Cuotas solamente
  // si está completo: mientras conserve el prefijo COMPLETAR_ queda oculto,
  // así que la pantalla se ve consistente hasta tener los datos del cliente.
  payment: {
    accountHolder: 'COMPLETAR_TITULAR',
    alias: 'COMPLETAR_ALIAS',
    cbu: 'COMPLETAR_CBU',
    cuil: 'COMPLETAR_CUIL',
    whatsapp: {
      // Código de país incluido, sin el signo "+". Ej: 5493510000000
      phoneNumber: 'COMPLETAR_WHATSAPP',
      message: '¡Hola, Gymhour! Les comparto el comprobante de pago de este mes:',
    },
  },
};

const setMetaContent = (selector, content) => {
  if (!content) return;
  document.querySelector(selector)?.setAttribute('content', content);
};

const setLinkHref = (selector, href) => {
  if (!href) return;
  document.querySelector(selector)?.setAttribute('href', href);
};

// Aplica la configuración antes de renderizar React para evitar que los
// componentes tengan que conocer detalles de CSS o metadata del cliente.
export const applyClientSetup = () => {
  const { branding } = CLIENT_SETUP;
  const { theme, metadata } = branding;
  const rootStyle = document.documentElement.style;

  rootStyle.setProperty('--primary-color', theme.primaryColor);
  rootStyle.setProperty('--primary-color-hover', theme.primaryColorHover);
  rootStyle.setProperty('--background-hover-color', theme.backgroundHoverColor);

  document.title = metadata.title || branding.name;
  setMetaContent('meta[name="description"]', metadata.description);
  setMetaContent('meta[name="theme-color"]', metadata.themeColor);
  setMetaContent('meta[name="apple-mobile-web-app-title"]', branding.name);
  setLinkHref('link[rel="icon"]', branding.favicon);
  setLinkHref('link[rel="apple-touch-icon"]', branding.appleTouchIcon || branding.favicon);
};

export default CLIENT_SETUP;
