import {
  PermissionsAndroid,
  Platform,
} from 'react-native';

import Geolocation from '@react-native-community/geolocation';

import type {
  LocationCoordinates,
} from '../types/location';

export type LocationPermissionState = 'granted' | 'denied' | 'blocked' | 'unavailable';

export async function checkLocationPermissionStatus(): Promise<LocationPermissionState> {
  if (Platform.OS !== 'android') {
    return 'granted';
  }
  try {
    const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const granted = await PermissionsAndroid.check(permission);
    return granted ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function requestLocationPermissionDetailed(
  customMessage?: string,
): Promise<LocationPermissionState> {
  if (Platform.OS !== 'android') {
    return 'granted';
  }

  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  try {
    const alreadyGranted = await PermissionsAndroid.check(permission);
    if (alreadyGranted) {
      return 'granted';
    }

    const result = await PermissionsAndroid.request(permission, {
      title: 'Bright & White Location',
      message:
        customMessage ||
        'Bright & White uses your location to select the correct laundry pickup and delivery address.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    });

    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return 'granted';
    } else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      return 'blocked';
    }
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function requestAndroidLocationPermission():
  Promise<boolean> {
  const status = await requestLocationPermissionDetailed();
  return status === 'granted';
}

export async function getCurrentDeviceLocation(): Promise<LocationCoordinates> {
  if (Platform.OS === 'ios') {
    Geolocation.setRNConfiguration({
      skipPermissionRequests: false,
      authorizationLevel: 'whenInUse',
    });
  }
  const permissionGranted = await requestAndroidLocationPermission();

  if (!permissionGranted) {
    throw new Error('Location permission was not granted');
  }

  return new Promise((resolve, reject) => {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (Platform.OS === 'web' && nav?.geolocation) {
      nav.geolocation.getCurrentPosition(
        (position: any) => {
          const latitude = Number(position.coords.latitude);
          const longitude = Number(position.coords.longitude);
          const accuracy = Number(position.coords.accuracy);
          const timestamp = new Date(
            position.timestamp || Date.now(),
          ).toISOString();

          if (__DEV__) {
            console.log('[DRIVER_GPS_DIAGNOSTIC]', {
              latitude,
              longitude,
              accuracyMeters: Number.isFinite(accuracy) ? accuracy : undefined,
              timestamp,
              source: 'browser-geolocation',
            });
          }

          if (Number.isFinite(accuracy) && accuracy > 1000) {
            reject(
              new Error(
                `Your location accuracy is low (${Math.round(
                  accuracy,
                )}m). Move to an area with a clearer GPS signal and try again.`,
              ),
            );
            return;
          }

          resolve({
            latitude,
            longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
          });
        },
        (error: any) => {
          reject(
            new Error(
              error.message || 'Unable to determine current location',
            ),
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        },
      );
      return;
    }

    Geolocation.getCurrentPosition(
      position => {
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        const accuracy = Number(position.coords.accuracy);
        const timestamp = new Date(
          position.timestamp || Date.now(),
        ).toISOString();

        if (__DEV__) {
          console.log('[DRIVER_GPS_DIAGNOSTIC]', {
            latitude,
            longitude,
            accuracyMeters: Number.isFinite(accuracy) ? accuracy : undefined,
            timestamp,
            source: 'native-geolocation',
          });
        }

        if (Number.isFinite(accuracy) && accuracy > 1000) {
          reject(
            new Error(
              `Your location accuracy is low (${Math.round(
                accuracy,
              )}m). Move to an area with a clearer GPS signal and try again.`,
            ),
          );
          return;
        }

        resolve({
          latitude,
          longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
        });
      },
      error => {
        reject(
          new Error(
            error.message || 'Unable to determine current location',
          ),
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  });
}
