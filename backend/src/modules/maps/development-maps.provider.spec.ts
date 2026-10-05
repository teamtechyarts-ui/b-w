import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { DevelopmentMapsProvider } from './development-maps.provider';

describe('DevelopmentMapsProvider', () => {
  let provider: DevelopmentMapsProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new DevelopmentMapsProvider();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reports development mode', () => {
    expect(provider.mode).toBe('development');
  });

  it('successfully reverse geocodes coordinates with full address components', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        place_id: 123456,
        lat: '17.3753191',
        lon: '78.5579370',
        display_name: 'LB Nagar - Uppal Road, Nagole, Hyderabad, Telangana, 500060, India',
        address: {
          road: 'LB Nagar - Uppal Road',
          neighbourhood: 'Ananda Nagar',
          suburb: 'Nagole',
          city: 'Hyderabad',
          state: 'Telangana',
          postcode: '500060',
          country: 'India',
        },
      }),
    } as Response);

    const result = await provider.reverseGeocode({ latitude: 17.3753, longitude: 78.5582 });

    expect(result).toEqual({
      placeId: '123456',
      formattedAddress: 'LB Nagar - Uppal Road, Nagole, Hyderabad, Telangana, 500060, India',
      addressLine1: 'LB Nagar - Uppal Road',
      addressLine2: 'Ananda Nagar, Nagole',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500060',
      country: 'India',
      coordinate: {
        latitude: 17.3753191,
        longitude: 78.557937,
      },
      provider: 'google',
    });
  });

  it('handles missing street and leaves addressLine1 empty or fallback without breaking', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        place_id: 999,
        lat: '17.38',
        lon: '78.48',
        display_name: 'Hyderabad, Telangana, 500001, India',
        address: {
          city: 'Hyderabad',
          state: 'Telangana',
          country: 'India',
        },
      }),
    } as Response);

    const result = await provider.reverseGeocode({ latitude: 17.38, longitude: 78.48 });

    expect(result.addressLine1).toBe('');
    expect(result.city).toBe('Hyderabad');
    expect(result.state).toBe('Telangana');
    expect(result.postalCode).toBe('');
  });

  it('throws NotFoundException when geocoding returns an error from provider', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: 'Unable to geocode',
      }),
    } as Response);

    await expect(
      provider.reverseGeocode({ latitude: 0, longitude: 0 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadGatewayException when network fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    await expect(
      provider.reverseGeocode({ latitude: 17.38, longitude: 78.48 }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('computes routes via OSRM or fallback estimation', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [
          {
            distance: 7055.7,
            duration: 568.4,
            geometry: 'sample_polyline',
          },
        ],
      }),
    } as Response);

    const route = await provider.getRoute(
      { latitude: 17.3753, longitude: 78.5582 },
      { latitude: 17.3328, longitude: 78.5795 },
    );

    expect(route.distanceMeters).toBe(7056);
    expect(route.durationSeconds).toBe(568);
    expect(route.encodedPolyline).toBe('sample_polyline');
  });

  it('searches places correctly', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 111,
          name: 'Nagole',
          display_name: 'Nagole, Hyderabad, Telangana, 500060, India',
          address: {
            suburb: 'Nagole',
            city: 'Hyderabad',
            state: 'Telangana',
          },
        },
      ],
    } as Response);

    const results = await provider.searchPlaces('Nagole');
    expect(results).toHaveLength(1);
    expect(results[0].placeId).toBe('111');
    expect(results[0].primaryText).toBe('Nagole');
    expect(results[0].secondaryText).toBe('Hyderabad, Telangana');
  });
});

