import {
  Coordinate,
  PlaceDetailsResult,
  PlaceSearchResult,
  ReverseGeocodeResult,
  RouteResult,
} from './maps.types';

export const MAPS_PROVIDER = Symbol('MAPS_PROVIDER');

export interface MapsProvider {
  readonly mode: 'live' | 'development';

  getRoute(
    origin: Coordinate,
    destination: Coordinate,
  ): Promise<RouteResult>;

  searchPlaces(
    query: string,
  ): Promise<PlaceSearchResult[]>;

  getPlaceDetails(
    placeId: string,
  ): Promise<PlaceDetailsResult>;

  reverseGeocode(
    coordinate: Coordinate,
  ): Promise<ReverseGeocodeResult>;
}
