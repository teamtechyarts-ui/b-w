import { Module, ServiceUnavailableException } from '@nestjs/common';
import { getProviderConfiguration } from '../../config/provider-config';
import { GoogleMapsProvider } from './google-maps.provider';
import { DevelopmentMapsProvider } from './development-maps.provider';
import { MAPS_PROVIDER } from './maps.provider';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';

function isConfiguredMapsKey(serverKey?: string): boolean {
  if (!serverKey) return false;
  const normalized = serverKey.trim().toLowerCase();
  if (
    normalized.includes('placeholder') ||
    normalized.startsWith('dev-') ||
    normalized.startsWith('dev_') ||
    normalized.includes('replace_me') ||
    normalized.includes('change_me') ||
    normalized.includes('your_key_here')
  ) {
    return false;
  }
  return true;
}

@Module({
  controllers: [MapsController],
  providers: [
    {
      provide: MAPS_PROVIDER,
      useFactory: () => {
        const configuration = getProviderConfiguration();

        if (configuration.nodeEnv === 'production') {
          if (
            !configuration.maps.serverKey ||
            !isConfiguredMapsKey(configuration.maps.serverKey)
          ) {
            throw new ServiceUnavailableException(
              'Google Maps server API key is not configured for production',
            );
          }
          return new GoogleMapsProvider(configuration.maps.serverKey);
        }

        if (
          configuration.maps.serverKey &&
          isConfiguredMapsKey(configuration.maps.serverKey)
        ) {
          return new GoogleMapsProvider(configuration.maps.serverKey);
        }

        return new DevelopmentMapsProvider();
      },
    },
    MapsService,
  ],
  exports: [MapsService, MAPS_PROVIDER],
})
export class MapsModule {}
