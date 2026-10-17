const SUPPORT_PHONE = '5493415936396';

export const subscriptionLink = tenant => {
  const message = `Hola, soy administrador de ${tenant?.name || 'mi gimnasio'} (${tenant?.slug || ''}). Quiero el link de suscripción de Gymhour.`;
  return `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
};
