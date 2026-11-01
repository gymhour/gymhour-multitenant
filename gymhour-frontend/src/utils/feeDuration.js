export const parseFeeDuration = value => {
  const legacy = {
    SEMANAL: ['WEEKS', 1],
    MENSUAL: ['MONTHS', 1],
    BIMESTRAL: ['MONTHS', 2],
    TRIMESTRAL: ['MONTHS', 3],
    SEMESTRAL: ['MONTHS', 6],
    ANUAL: ['MONTHS', 12],
  };
  const normalized = String(value || '').toUpperCase();
  const custom = /^(WEEKS|MONTHS):(\d+)$/.exec(normalized);
  const [unit, count] = legacy[normalized] || (custom ? [custom[1], Number(custom[2])] : legacy.MENSUAL);
  return { unit, count };
};

export const feeDurationLabel = value => {
  const { unit, count } = parseFeeDuration(value);
  return `${count} ${unit === 'WEEKS' ? (count === 1 ? 'semana' : 'semanas') : (count === 1 ? 'mes' : 'meses')}`;
};
