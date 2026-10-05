// Browser interactive map shim for react-native-maps
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AppIcon from '../components/AppIcon';
import { colors } from '../theme/designSystem';

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = 'default';

export const Marker: React.FC<any> = ({ coordinate: _coordinate, title, description, children }) => {
  if (children) return <>{children}</>;
  return (
    <View style={styles.markerContainer}>
      <AppIcon name="location" size={24} color={colors.primary} />
      {title && <Text style={styles.markerTitle}>{title}</Text>}
      {description && <Text style={styles.markerDesc}>{description}</Text>}
    </View>
  );
};

export const Polyline: React.FC<any> = () => null;
export const Callout: React.FC<any> = ({ children }) => <View>{children}</View>;
export const Circle: React.FC<any> = () => null;

const MapView: React.FC<any> = ({
  initialRegion,
  region,
  style,
  children,
  onPress,
  onRegionChangeComplete: _onRegionChangeComplete,
  ...props
}) => {
  const currentRegion = region || initialRegion || { latitude: 17.3850, longitude: 78.4867 };
  const lat = Number(currentRegion.latitude || 17.3850).toFixed(4);
  const lng = Number(currentRegion.longitude || 78.4867).toFixed(4);

  return (
    <View style={[styles.mapContainer, style]} {...props}>
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          backgroundColor: '#e5e3df',
          backgroundImage:
            'radial-gradient(#c7c4be 1px, transparent 1px), radial-gradient(#c7c4be 1px, #e5e3df 1px)',
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0, 12px 12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: 'crosshair',
        }}
        onClick={(_e) => {
          if (onPress) {
            onPress({
              nativeEvent: {
                coordinate: {
                  latitude: currentRegion.latitude,
                  longitude: currentRegion.longitude,
                },
              },
            });
          }
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            backgroundColor: 'rgba(255, 255, 255, 0.92)',
            padding: '6px 12px',
            borderRadius: 8,
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            fontSize: 12,
            fontFamily: 'sans-serif',
            color: '#333',
            zIndex: 10,
          }}
        >
          <strong>Interactive Map</strong> (Lat: {lat}, Lng: {lng})
        </div>

        <div style={{ zIndex: 5, pointerEvents: 'none' }}>
          {children}
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            fontSize: 10,
            color: '#777',
            fontFamily: 'sans-serif',
          }}
        >
          © Bright & White Maps
        </div>
      </div>
    </View>
  );
};

const styles = StyleSheet.create({
  mapContainer: {
    overflow: 'hidden',
    minHeight: 200,
    borderRadius: 8,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    backgroundColor: '#fff',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  markerDesc: {
    fontSize: 10,
    color: '#666',
  },
});

export default MapView;
