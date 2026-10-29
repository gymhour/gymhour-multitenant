const SUPPORT_PHONE = '5493415936396';

export const subscriptionLink = tenant => {
  const message = `Hola, soy administrador de ${tenant?.name || 'mi gimnasio'} (${tenant?.slug || ''}). Necesito ayuda con el pago de Gymhour o tengo una consulta sobre mi suscripción.`;
  return `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
};
