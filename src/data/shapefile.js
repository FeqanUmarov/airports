import { parseZip } from 'shpjs';

export async function readBuildingFromZip(file) {
  if (!file || !file.name.toLowerCase().endsWith('.zip')) throw new Error('.zip formatında Shapefile arxivi seçin.');
  const parsed = await parseZip(await file.arrayBuffer());
  const collections = Array.isArray(parsed) ? parsed : [parsed];
  const feature = collections
    .flatMap((collection) => collection?.features ?? (collection?.type === 'Feature' ? [collection] : []))
    .find((candidate) => ['Polygon', 'MultiPolygon'].includes(candidate?.geometry?.type));

  if (!feature) throw new Error('ZIP arxivində Polygon və ya MultiPolygon tipli obyekt tapılmadı.');
  const coordinates = feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates[0]
    : feature.geometry.coordinates[0][0];
  if (!coordinates || coordinates.length < 4) throw new Error('Bina poliqonunda kifayət qədər təpə nöqtəsi yoxdur.');
  return removeClosingCoordinate(coordinates).map(([longitude, latitude]) => [Number(longitude), Number(latitude)]);
}

function removeClosingCoordinate(coordinates) {
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? coordinates.slice(0, -1) : coordinates;
}
