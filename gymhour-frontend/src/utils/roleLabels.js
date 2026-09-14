export const ROLE_LABELS = {
  ADMIN: 'Administrador',
  TRAINER: 'Entrenador',
  STUDENT: 'Socio',
};

export const ROLE_OPTIONS = ['STUDENT', 'TRAINER', 'ADMIN'].map(value => ({
  value,
  label: ROLE_LABELS[value],
}));

export const formatRole = role => ROLE_LABELS[String(role || '').toUpperCase()] || role || '—';
