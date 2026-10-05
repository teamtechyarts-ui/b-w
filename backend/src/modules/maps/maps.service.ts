import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';

import {
  MAPS_PROVIDER,
  MapsProvider,
} from './maps.provider';

import {
  Coordinate,
} from './maps.types';

@Injectable()
export class MapsService {
  constructor(
    @Inject(
      MAPS_PROVIDER,
    )
    private readonly provider:
      MapsProvider,
  ) {}

  get providerName(): 'google' {
    return 'google';
  }

  private validateCoordinate(
    coordinate:
      Coordinate,

    label:
      string,
  ) {
    if (
      !Number.isFinite(
        coordinate
          ?.latitude,
      ) ||
      !Number.isFinite(
        coordinate
          ?.longitude,
      ) ||
      coordinate.latitude <
        -90 ||
      coordinate.latitude >
        90 ||
      coordinate.longitude <
        -180 ||
      coordinate.longitude >
        180
    ) {
      throw new BadRequestException(
        `Invalid ${label} coordinates`,
      );
    }
  }

  private normalizeSearchQuery(
    query:
      string,
  ): string {
    const normalized =
      query.trim();

    if (
      normalized.length <
      2
    ) {
      throw new BadRequestException(
        'Search query must contain at least 2 characters',
      );
    }

    return normalized;
  }

  private normalizePlaceId(
    placeId:
      string,
  ): string {
    const normalized =
      placeId.trim();

    if (
      !normalized
    ) {
      throw new BadRequestException(
        'Place ID is required',
      );
    }

    return normalized;
  }

  async getRoute(
    origin:
      Coordinate,

    destination:
      Coordinate,
  ) {
    this.validateCoordinate(
      origin,
      'origin',
    );

    this.validateCoordinate(
      destination,
      'destination',
    );

    return this.provider.getRoute(
      origin,
      destination,
    );
  }

  async searchPlaces(
    query:
      string,
  ) {
    const normalizedQuery =
      this.normalizeSearchQuery(
        query,
      );

    return this.provider.searchPlaces(
      normalizedQuery,
    );
  }

  async getPlaceDetails(
    placeId:
      string,
  ) {
    const normalizedPlaceId =
      this.normalizePlaceId(
        placeId,
      );

    return this.provider.getPlaceDetails(
      normalizedPlaceId,
    );
  }

  async reverseGeocode(
    coordinate:
      Coordinate,
  ) {
    this.validateCoordinate(
      coordinate,
      'location',
    );

    return this.provider.reverseGeocode(
      coordinate,
    );
  }
}
