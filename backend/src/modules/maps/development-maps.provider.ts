import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MapsProvider } from './maps.provider';
import {
  Coordinate,
  PlaceDetailsResult,
  PlaceSearchResult,
  ReverseGeocodeResult,
  RouteResult,
} from './maps.types';

function haversineDistanceMeters(c1: Coordinate, c2: Coordinate): number {
  const R = 6371e3; // Earth radius in meters
  const dLat = ((c2.latitude - c1.latitude) * Math.PI) / 180;
  const dLon = ((c2.longitude - c1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((c1.latitude * Math.PI) / 180) *
      Math.cos((c2.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

@Injectable()
export class DevelopmentMapsProvider implements MapsProvider {
  readonly mode = 'development' as const;

  private readonly userAgent = 'BrightWhiteLaundry/1.0';

  private async fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
    return fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async getRoute(
    origin: Coordinate,
    destination: Coordinate,
  ): Promise<RouteResult> {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full`;
      const response = await this.fetchWithTimeout(url);

      if (response.ok) {
        const data = await response.json();
        const route = data?.routes?.[0];
        if (route && Number.isFinite(route.distance) && Number.isFinite(route.duration)) {
          return {
            distanceMeters: Math.round(route.distance),
            durationSeconds: Math.round(route.duration),
            encodedPolyline: route.geometry ?? null,
            provider: 'google',
          };
        }
      }
    } catch {
      // Fall through to Haversine estimation on network timeout
    }

    const directDistance = haversineDistanceMeters(origin, destination);
    const distanceMeters = Math.round(directDistance * 1.3); // 1.3 estimated road winding factor
    const durationSeconds = Math.max(60, Math.round(distanceMeters / (30 * 1000 / 3600))); // 30 km/h average speed

    return {
      distanceMeters,
      durationSeconds,
      encodedPolyline: null,
      provider: 'google',
    };
  }

  async searchPlaces(query: string): Promise<PlaceSearchResult[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return [];
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        normalizedQuery,
      )}&addressdetails=1&limit=5&countrycodes=in`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new BadGatewayException(
          `Open search returned HTTP ${response.status}`,
        );
      }

      const items = await response.json();
      if (!Array.isArray(items)) {
        return [];
      }

      return items.map((item: any) => {
        const addr = item?.address || {};
        const primaryText =
          item?.name ||
          addr.road ||
          addr.suburb ||
          addr.neighbourhood ||
          normalizedQuery;
        const secondaryParts = [
          addr.suburb !== primaryText ? addr.suburb : '',
          addr.city || addr.town || addr.village,
          addr.state,
        ].filter(Boolean);
        const secondaryText = secondaryParts.join(', ');
        const formattedText =
          item?.display_name ||
          [primaryText, secondaryText].filter(Boolean).join(', ');

        return {
          placeId: String(item?.place_id ?? ''),
          primaryText,
          secondaryText,
          formattedText,
          provider: 'google' as const,
        };
      });
    } catch (error: any) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(
        `Open search service is unavailable: ${error?.message || 'network error'}`,
      );
    }
  }

  async getPlaceDetails(placeId: string): Promise<PlaceDetailsResult> {
    const normalizedPlaceId = placeId.trim();
    if (!normalizedPlaceId) {
      throw new NotFoundException('Place ID is required');
    }

    try {
      const url = `https://nominatim.openstreetmap.org/details?place_id=${encodeURIComponent(
        normalizedPlaceId,
      )}&format=json&addressdetails=1`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new BadGatewayException(
          `Open place details returned HTTP ${response.status}`,
        );
      }

      const data = await response.json();
      const lat =
        data?.centroid?.coordinates?.[1] ??
        Number(data?.lat) ??
        Number.NaN;
      const lon =
        data?.centroid?.coordinates?.[0] ??
        Number(data?.lon) ??
        Number.NaN;

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new NotFoundException('Place details coordinates not found');
      }

      // Use reverseGeocode on resolved centroid for consistent address structure
      return await this.reverseGeocode({ latitude: lat, longitude: lon });
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException(
        `Open place details service is unavailable: ${error?.message || 'network error'}`,
      );
    }
  }

  async reverseGeocode(
    coordinate: Coordinate,
  ): Promise<ReverseGeocodeResult> {
    let response: Response;
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        String(coordinate.latitude),
      )}&lon=${encodeURIComponent(
        String(coordinate.longitude),
      )}&addressdetails=1`;
      response = await this.fetchWithTimeout(url);
    } catch (error: any) {
      throw new BadGatewayException(
        `Reverse geocoding service is unavailable: ${error?.message || 'network error'}`,
      );
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Reverse geocoding service returned HTTP ${response.status}`,
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new BadGatewayException('Reverse geocoding returned invalid JSON');
    }

    if (data?.error) {
      throw new NotFoundException(
        data.error === 'Unable to geocode'
          ? 'No address was found for this location'
          : `Geocoding error: ${data.error}`,
      );
    }

    const addr = data?.address || {};

    const line1Parts = [
      addr.house_number,
      addr.house_name,
      addr.building,
      addr.amenity,
      addr.shop,
      addr.road || addr.pedestrian || addr.footway || addr.path || addr.street,
    ].filter(Boolean);

    let addressLine1 = line1Parts.join(', ').trim();
    if (!addressLine1) {
      addressLine1 = addr.suburb || addr.neighbourhood || addr.residential || '';
    }

    const line2Parts = [
      addr.neighbourhood || addr.residential || addr.quarter,
      addr.suburb,
      addr.city_district || addr.subdistrict,
    ]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i && !addressLine1.includes(v));

    const addressLine2 = line2Parts.join(', ').trim();
    const city =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.county ||
      '';
    const state = addr.state || addr.state_district || '';
    const rawPostcode = (addr.postcode || '').trim();
    const postalCode = /^\d{6}$/.test(rawPostcode) ? rawPostcode : rawPostcode;
    const country = addr.country || 'India';
    const formattedAddress = data?.display_name || '';

    const resolvedLat = Number(data?.lat);
    const resolvedLon = Number(data?.lon);

    return {
      placeId: data?.place_id ? String(data.place_id) : null,
      formattedAddress,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      coordinate: {
        latitude: Number.isFinite(resolvedLat) ? resolvedLat : coordinate.latitude,
        longitude: Number.isFinite(resolvedLon) ? resolvedLon : coordinate.longitude,
      },
      provider: 'google',
    };
  }
}

