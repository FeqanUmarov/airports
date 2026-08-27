export function resolveOlsElevations(properties = {}) {
  const startElevation = toNumber(properties.START_ELEVATION, 0);
  const length = toOptionalNumber(properties.LENGTH);
  const slopePercent = toOptionalNumber(properties.SLOPE_PERCENT);
  const explicitEndElevation = toOptionalNumber(properties.END_ELEVATION);
  const derivedEndElevation = length !== null && slopePercent !== null
    ? startElevation + (length * slopePercent) / 100
    : null;
  const endElevation = explicitEndElevation ?? derivedEndElevation ?? startElevation;
  const resolvedSlopePercent = slopePercent ?? (
    length && length > 0 ? ((endElevation - startElevation) / length) * 100 : null
  );

  return {
    startElevation,
    endElevation,
    volumeBaseElevation: getVolumeBaseElevation(startElevation, endElevation),
    slopePercent: resolvedSlopePercent,
    length,
    isFlat: Math.abs(endElevation - startElevation) < 0.001,
  };
}

function getVolumeBaseElevation(startElevation, endElevation) {
  if (Math.abs(endElevation - startElevation) < 0.001) {
    return Math.min(0, startElevation);
  }

  return Math.min(startElevation, endElevation);
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
