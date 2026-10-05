import {PermissionsAndroid, Platform} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import {
  getCurrentDeviceLocation,
  requestAndroidLocationPermission,
} from './deviceLocationService';

jest.mock('@react-native-community/geolocation', () => ({
  setRNConfiguration: jest.fn(),
  getCurrentPosition: jest.fn(),
}));

describe('deviceLocationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requestAndroidLocationPermission returns true on non-android platforms', async () => {
    Platform.OS = 'ios';
    const result = await requestAndroidLocationPermission();
    expect(result).toBe(true);
  });

  it('requestAndroidLocationPermission requests permission on android', async () => {
    Platform.OS = 'android';
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValueOnce(false);
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValueOnce(PermissionsAndroid.RESULTS.GRANTED);

    const result = await requestAndroidLocationPermission();
    expect(result).toBe(true);
    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      expect.objectContaining({
        title: 'Bright & White Location',
      }),
    );
  });

  it('getCurrentDeviceLocation requests fresh GPS fix with enableHighAccuracy: true and maximumAge: 0', async () => {
    Platform.OS = 'android';
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValueOnce(true);

    (Geolocation.getCurrentPosition as jest.Mock).mockImplementationOnce(
      (successCallback, _errorCallback, options) => {
        expect(options).toEqual({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });

        successCallback({
          coords: {
            latitude: 17.3753,
            longitude: 78.5582,
            accuracy: 15,
          },
          timestamp: Date.now(),
        });
      },
    );

    const location = await getCurrentDeviceLocation();
    expect(location.latitude).toBe(17.3753);
    expect(location.longitude).toBe(78.5582);
    expect(location.accuracy).toBe(15);
  });

  it('getCurrentDeviceLocation rejects when accuracy exceeds threshold (> 1000m)', async () => {
    Platform.OS = 'android';
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValueOnce(true);

    (Geolocation.getCurrentPosition as jest.Mock).mockImplementationOnce(
      (successCallback, _errorCallback) => {
        successCallback({
          coords: {
            latitude: 17.3753,
            longitude: 78.5582,
            accuracy: 1250, // > 1000m
          },
          timestamp: Date.now(),
        });
      },
    );

    await expect(getCurrentDeviceLocation()).rejects.toThrow(
      /Your location accuracy is low/i,
    );
  });
});
