import React from 'react';
import {
  Image,
  ImageStyle,
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import logoAsset from '../assets/bw_logo.png';

const LOGO_ASPECT_RATIO = 1024 / 788; // 1.2995

export type BrandLogoProps = {
  width?: number;
  height?: number;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export default function BrandLogo({
  width = 160,
  height,
  style,
  containerStyle,
  accessibilityLabel = 'Bright & White Laundry Logo',
}: BrandLogoProps) {
  // Preserve original 1024 x 788 aspect ratio
  const calculatedHeight = height ?? width / LOGO_ASPECT_RATIO;

  const imageSource = React.useMemo(() => {
    if (Platform.OS === 'web') {
      // In web (Vite/browser), logoAsset is an imported string URL; fallback to public URL '/bw_logo.png'
      const uri = typeof logoAsset === 'string' && logoAsset ? logoAsset : '/bw_logo.png';
      return { uri };
    }
    // In native React Native (Android / iOS), Metro supplies the asset ID number or object
    return typeof logoAsset === 'string' ? { uri: logoAsset } : logoAsset;
  }, []);

  return (
    <View style={[styles.container, containerStyle]}>
      <Image
        source={imageSource}
        style={[
          {
            width,
            height: calculatedHeight,
          },
          styles.image,
          style,
        ]}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    // Preserve aspect ratio and transparent background
    backgroundColor: 'transparent',
  },
});

