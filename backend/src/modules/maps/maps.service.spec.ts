import {
  BadRequestException,
} from '@nestjs/common';

import {
  MapsProvider,
} from './maps.provider';

import {
  MapsService,
} from './maps.service';

import {
  PlaceDetailsResult,
  PlaceSearchResult,
  ReverseGeocodeResult,
  RouteResult,
} from './maps.types';

describe('MapsService', () => {
  const origin = {
    latitude: 17.4401,
    longitude: 78.3489,
  };

  const destination = {
    latitude: 17.385,
    longitude: 78.4867,
  };

  const route: RouteResult = {
    distanceMeters: 12_345,
    durationSeconds: 987,
    encodedPolyline: null,
    provider: 'mock',
  };

  const searchResults: PlaceSearchResult[] = [
    {
      placeId: 'development-hyderabad-001',
      primaryText: 'Abids',
      secondaryText: 'Hyderabad, Telangana 500001',
      formattedText:
        'Abids, Hyderabad, Telangana 500001',
      provider: 'mock',
    },
  ];

  const placeDetails: PlaceDetailsResult = {
    placeId: 'development-hyderabad-001',
    formattedAddress:
      'Abids, Hyderabad, Telangana 500001',
    addressLine1:
      'Abids',
    addressLine2:
      'Hyderabad',
    city:
      'Hyderabad',
    state:
      'Telangana',
    postalCode:
      '500001',
    country:
      'India',
    coordinate: {
      latitude:
        17.385,
      longitude:
        78.4867,
    },
    provider:
      'mock',
  };

  const reverseGeocodeResult: ReverseGeocodeResult = {
    ...placeDetails,
    coordinate: {
      latitude:
        origin.latitude,
      longitude:
        origin.longitude,
    },
  };

  function fixture() {
    const provider: MapsProvider = {
      mode:
        'live',

      getRoute:
        jest
          .fn()
          .mockResolvedValue(
            route,
          ),

      searchPlaces:
        jest
          .fn()
          .mockResolvedValue(
            searchResults,
          ),

      getPlaceDetails:
        jest
          .fn()
          .mockResolvedValue(
            placeDetails,
          ),

      reverseGeocode:
        jest
          .fn()
          .mockResolvedValue(
            reverseGeocodeResult,
          ),
    };

    return {
      provider,

      service:
        new MapsService(
          provider,
        ),
    };
  }

  it('validates route coordinates before invoking the provider', async () => {
    const {
      provider,
      service,
    } =
      fixture();

    await expect(
      service.getRoute(
        {
          latitude: 91,
          longitude: 0,
        },
        destination,
      ),
    ).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await expect(
      service.getRoute(
        origin,
        {
          latitude: 0,
          longitude:
            Number.NaN,
        },
      ),
    ).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(
      provider.getRoute,
    ).not.toHaveBeenCalled();
  });

  it('returns the selected provider route unchanged', async () => {
    const {
      provider,
      service,
    } =
      fixture();

    await expect(
      service.getRoute(
        origin,
        destination,
      ),
    ).resolves.toEqual(
      route,
    );

    expect(
      provider.getRoute,
    ).toHaveBeenCalledWith(
      origin,
      destination,
    );

    expect(
      service.providerName,
    ).toBe(
      'google',
    );
  });

  it('reports google for the live Maps provider', () => {
    const provider: MapsProvider = {
      mode:
        'live',

      getRoute:
        jest.fn(),

      searchPlaces:
        jest.fn(),

      getPlaceDetails:
        jest.fn(),

      reverseGeocode:
        jest.fn(),
    };

    expect(
      new MapsService(
        provider,
      ).providerName,
    ).toBe(
      'google',
    );
  });
});
