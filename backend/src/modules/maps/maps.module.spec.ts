import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { MapsModule } from './maps.module';
import { MapsService } from './maps.service';
import { MAPS_PROVIDER, MapsProvider } from './maps.provider';
import { DevelopmentMapsProvider } from './development-maps.provider';
import { GoogleMapsProvider } from './google-maps.provider';

describe('MapsModule provider configuration', () => {
  jest.setTimeout(15000);
  const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    GOOGLE_MAPS_SERVER_KEY: process.env.GOOGLE_MAPS_SERVER_KEY,
  };
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;

    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };

    restore('NODE_ENV', originalEnvironment.NODE_ENV);
    restore('GOOGLE_MAPS_SERVER_KEY', originalEnvironment.GOOGLE_MAPS_SERVER_KEY);
  });

  it('selects DevelopmentMapsProvider when key is absent in development', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.GOOGLE_MAPS_SERVER_KEY;

    const module = await Test.createTestingModule({
      imports: [MapsModule],
    }).compile();

    const provider = module.get<MapsProvider>(MAPS_PROVIDER);
    expect(provider).toBeInstanceOf(DevelopmentMapsProvider);
    expect(provider.mode).toBe('development');

    const service = module.get(MapsService);
    expect(service.providerName).toBe('google');
    const route = await service.getRoute(
      { latitude: 17.44, longitude: 78.34 },
      { latitude: 17.38, longitude: 78.48 },
    );
    expect(route.distanceMeters).toBeGreaterThan(0);
  });

  it('configures GoogleMapsProvider when key is present', async () => {
    process.env.NODE_ENV = 'test';
    process.env.GOOGLE_MAPS_SERVER_KEY = 'real-test-key-123';
    global.fetch = jest.fn();

    const module = await Test.createTestingModule({
      imports: [MapsModule],
    }).compile();

    const provider = module.get<MapsProvider>(MAPS_PROVIDER);
    expect(provider).toBeInstanceOf(GoogleMapsProvider);
    expect(provider.mode).toBe('live');

    const service = module.get(MapsService);
    expect(service.providerName).toBe('google');
  });

  it('fails in production when key is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GOOGLE_MAPS_SERVER_KEY;

    await expect(
      Test.createTestingModule({
        imports: [MapsModule],
      }).compile(),
    ).rejects.toThrow();
  });
});
