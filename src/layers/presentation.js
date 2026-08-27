export const airportPresentation = {
  label: 'Airport Boundary',
  fill: 'rgba(23, 105, 224, 0.06)',
  stroke: '#1769e0',
};

export const runwayPresentation = {
  label: 'Runway',
  fill: 'rgba(38, 43, 51, 0.94)',
  stroke: 'rgba(255, 255, 255, 0.95)',
};

const olsSurfaces = {
  1: 'Inner Horizontal',
  2: 'Conical',
  3: 'Approach',
  4: 'Take Off',
  5: 'Transitional',
};

const olsPalette = [
  { fill: 'rgba(245, 158, 11, 0.36)', stroke: '#d97706', solid: '#f59e0b' },
  { fill: 'rgba(16, 185, 129, 0.34)', stroke: '#059669', solid: '#10b981' },
  { fill: 'rgba(59, 130, 246, 0.34)', stroke: '#2563eb', solid: '#3b82f6' },
  { fill: 'rgba(236, 72, 153, 0.32)', stroke: '#db2777', solid: '#ec4899' },
  { fill: 'rgba(139, 92, 246, 0.34)', stroke: '#7c3aed', solid: '#8b5cf6' },
  { fill: 'rgba(20, 184, 166, 0.32)', stroke: '#0d9488', solid: '#14b8a6' },
  { fill: 'rgba(239, 68, 68, 0.3)', stroke: '#dc2626', solid: '#ef4444' },
  { fill: 'rgba(132, 204, 22, 0.32)', stroke: '#65a30d', solid: '#84cc16' },
  { fill: 'rgba(14, 165, 233, 0.32)', stroke: '#0284c7', solid: '#0ea5e9' },
  { fill: 'rgba(249, 115, 22, 0.32)', stroke: '#ea580c', solid: '#f97316' },
];

export function getOlsSurfaceLabel(ostId) {
  return olsSurfaces[String(ostId)] ?? 'Unknown Surface';
}

export function getOlsPresentation(ostId, index = 0) {
  const colors = olsPalette[index % olsPalette.length];

  return {
    label: getOlsSurfaceLabel(ostId),
    ...colors,
  };
}
