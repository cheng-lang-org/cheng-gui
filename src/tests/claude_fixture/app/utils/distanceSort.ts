import type { DistributedContent } from '../data/distributedContent';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6371_000;

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceMeters(from: GeoPoint, to: GeoPoint): number {
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const halfChord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;
  const angularDistance = 2 * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord));
  return EARTH_RADIUS_METERS * angularDistance;
}

export function resolveContentCoordinates(content: Pick<DistributedContent, 'location'>): GeoPoint | null {
  const rawLocation = content.location as unknown as Record<string, unknown> | undefined;
  if (!rawLocation || typeof rawLocation !== 'object') {
    return null;
  }

  const precise = rawLocation.precise as Record<string, unknown> | undefined;
  const preciseLatitude = precise ? asFiniteNumber(precise.latitude) : null;
  const preciseLongitude = precise ? asFiniteNumber(precise.longitude) : null;
  if (preciseLatitude !== null && preciseLongitude !== null) {
    return {
      latitude: preciseLatitude,
      longitude: preciseLongitude,
    };
  }

  const legacyLatitude = asFiniteNumber(rawLocation.latitude);
  const legacyLongitude = asFiniteNumber(rawLocation.longitude);
  if (legacyLatitude !== null && legacyLongitude !== null) {
    return {
      latitude: legacyLatitude,
      longitude: legacyLongitude,
    };
  }

  return null;
}

export function sortContentsByDistance(
  contents: DistributedContent[],
  userLocation: GeoPoint,
  hideMissingCoordinates = true,
): DistributedContent[] {
  const withDistance = contents.map((content) => {
    const coordinates = resolveContentCoordinates(content);
    const distance = coordinates ? haversineDistanceMeters(userLocation, coordinates) : Number.POSITIVE_INFINITY;
    return {
      content,
      distance,
      hasCoordinates: coordinates !== null,
    };
  });

  const filtered = hideMissingCoordinates ? withDistance.filter((row) => row.hasCoordinates) : withDistance;
  return filtered
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return right.content.timestamp - left.content.timestamp;
    })
    .map((row) => row.content);
}
