// Browser geolocation shim for @react-native-community/geolocation
export const Geolocation = {
  getCurrentPosition(
    success: (position: any) => void,
    error?: (error: any) => void,
    options?: any,
  ) {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          success({
            coords: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              altitude: pos.coords.altitude,
              accuracy: pos.coords.accuracy,
              heading: pos.coords.heading,
              speed: pos.coords.speed,
            },
            timestamp: pos.timestamp,
          });
        },
        (err) => {
          // Fallback to default coordinates (e.g. Hyderabad default) on denial
          if (error) {
            error(err);
          } else {
            success({
              coords: {
                latitude: 17.3850,
                longitude: 78.4867,
                accuracy: 10,
              },
              timestamp: Date.now(),
            });
          }
        },
        options,
      );
    } else {
      success({
        coords: {
          latitude: 17.3850,
          longitude: 78.4867,
          accuracy: 10,
        },
        timestamp: Date.now(),
      });
    }
  },

  watchPosition(
    success: (position: any) => void,
    error?: (error: any) => void,
    options?: any,
  ) {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return navigator.geolocation.watchPosition(
        (pos) => {
          success({
            coords: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            },
            timestamp: pos.timestamp,
          });
        },
        error,
        options,
      );
    }
    return 0;
  },

  clearWatch(id: number) {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(id);
    }
  },

  requestAuthorization() {
    // Web browsers automatically request authorization when getCurrentPosition is called
  },

  setRNConfiguration() {},
};

export default Geolocation;
