import {
  apiRequest,
} from './api';

export type MapsProviderName =
  | 'google';

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type PlaceSearchResult = {
  placeId: string;

  primaryText: string;
  secondaryText: string;
  formattedText: string;

  provider: MapsProviderName;
};

export type ResolvedPlace = {
  placeId: string | null;

  formattedAddress: string;

  addressLine1: string;
  addressLine2: string;

  city: string;
  state: string;
  postalCode: string;
  country: string;

  coordinate: MapCoordinate;

  provider: MapsProviderName;
};

export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string | null;
  provider: MapsProviderName;
};

export async function searchPlaces(
  accessToken: string,
  query: string,
): Promise<
  PlaceSearchResult[]
> {
  const normalizedQuery =
    query.trim();

  if (
    normalizedQuery.length <
    2
  ) {
    return [];
  }

  const result =
    await apiRequest<
      PlaceSearchResult[]
    >(
      `/maps/search?query=${encodeURIComponent(
        normalizedQuery,
      )}`,
      {
        accessToken,
      },
    );

  if (
    !Array.isArray(
      result,
    )
  ) {
    throw new Error(
      'Invalid place search response',
    );
  }

  return result;
}

export async function getPlaceDetails(
  accessToken: string,
  placeId: string,
): Promise<ResolvedPlace> {
  const normalizedPlaceId =
    placeId.trim();

  if (
    !normalizedPlaceId
  ) {
    throw new Error(
      'Place ID is required',
    );
  }

  return apiRequest<
    ResolvedPlace
  >(
    `/maps/place/${encodeURIComponent(
      normalizedPlaceId,
    )}`,
    {
      accessToken,
    },
  );
}

export async function reverseGeocode(
  accessToken: string,
  latitude: number,
  longitude: number,
): Promise<ResolvedPlace> {
  return apiRequest<
    ResolvedPlace
  >(
    `/maps/reverse-geocode?latitude=${encodeURIComponent(
      String(
        latitude,
      ),
    )}&longitude=${encodeURIComponent(
      String(
        longitude,
      ),
    )}`,
    {
      accessToken,
    },
  );
}

export async function getRoute(
  accessToken: string,
  origin: MapCoordinate,
  destination: MapCoordinate,
): Promise<RouteResult> {
  return apiRequest<
    RouteResult
  >(
    '/maps/route',
    {
      method:
        'POST',

      accessToken,

      body: {
        origin,
        destination,
      },
    },
  );
}
