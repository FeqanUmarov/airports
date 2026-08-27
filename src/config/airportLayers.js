export const airportLayers = [
  layer('conical', 'Conical Surface', '/data/Conical_Surface.geojson', 'ols', 10, '#65a30d', 'rgba(132, 204, 22, 0.24)', true),
  layer('innerHorizontal', 'Inner Horizontal Surface', '/data/Inner_Horizontal.geojson', 'ols', 20, '#2563eb', 'rgba(59, 130, 246, 0.24)', true),
  layer('approach03', 'Approach Surface RWY 03', '/data/OLS_Approach_RWY03.geojson', 'ols', 30, '#e11d48', 'rgba(244, 63, 94, 0.27)', true),
  layer('approach21', 'Approach Surface RWY 21', '/data/OLS_Approach_RWY21.geojson', 'ols', 31, '#fb7185', 'rgba(251, 113, 133, 0.25)', true),
  layer('takeoff03', 'Take-off Climb Surface RWY 03', '/data/Takeoff_Climb_RWY03.geojson', 'ols', 40, '#a21caf', 'rgba(192, 38, 211, 0.25)', true),
  layer('takeoff21', 'Take-off Climb Surface RWY 21', '/data/Takeoff_Climb_RWY21.geojson', 'ols', 41, '#d946ef', 'rgba(217, 70, 239, 0.23)', true),
  layer('transitional', 'Transitional Surface', '/data/Transition_surface.geojson', 'ols', 50, '#7c3aed', 'rgba(139, 92, 246, 0.27)', true),
  layer('strip', 'Runway Strip', '/data/Strip.geojson', 'strip', 60, '#64748b', 'rgba(148, 163, 184, 0.22)', false),
  layer('runway', 'Runway', '/data/Runway.geojson', 'runway', 70, '#242a31', 'rgba(36, 42, 49, 0.96)', false),
  {
    ...layer('runwayLine', 'Runway Line', '/data/Runway_line.geojson', 'reference', 80, '#facc15', 'rgba(250, 204, 21, 0.85)', false),
    visible: false,
    showInTree: true,
    showInLegend: true,
    participatesInOls3D: false,
  },
];

export const operationalAirportLayers = airportLayers.filter((item) => item.showInTree);
export const olsAirportLayers = airportLayers.filter((item) => item.category === 'ols');

export function getAirportLayer(layerId) {
  return airportLayers.find((item) => item.id === layerId);
}

function layer(id, title, path, category, zIndex, stroke, fill, participatesInOls3D) {
  return {
    id,
    title,
    path,
    category,
    zIndex,
    visible: true,
    showInTree: true,
    showInLegend: true,
    participatesInOls3D,
    style2D: { fill, stroke, width: category === 'runway' ? 1.8 : 1.25 },
    style3D: { fill, stroke },
  };
}
