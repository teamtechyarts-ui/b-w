import { Platform } from 'react-native';

export const colors = {
  // Backgrounds
  background: '#FAF9F6',
  surface: '#FFFFFF',
  surfaceSubtle: '#F9FAFB',
  surfaceElevated: '#FFFFFF',
  
  // Brand / Obsidian
  primary: '#111827',
  primaryHover: '#1F2937',
  primaryMuted: '#374151',
  
  // Text
  textPrimary: '#111827',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
  textSubtle: '#9CA3AF',
  textInverse: '#FFFFFF',
  
  // Borders
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  borderFocused: '#111827',
  
  // Status Colors (Subtle, Restrained)
  success: '#059669',
  successSurface: '#ECFDF5',
  successBorder: '#A7F3D0',
  successText: '#065F46',
  
  warning: '#D97706',
  warningSurface: '#FFFBEB',
  warningBorder: '#FDE68A',
  warningText: '#92400E',
  
  danger: '#DC2626',
  dangerSurface: '#FEF2F2',
  dangerBorder: '#FECACA',
  dangerText: '#991B1B',
  
  info: '#2563EB',
  infoSurface: '#EFF6FF',
  infoBorder: '#BFDBFE',
  infoText: '#1E40AF',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const borderRadius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
};

export const typography = {
  h1: { fontSize: 22, fontWeight: '800' as const, color: colors.textPrimary },
  h2: { fontSize: 18, fontWeight: '800' as const, color: colors.textPrimary },
  h3: { fontSize: 16, fontWeight: '700' as const, color: colors.textPrimary },
  body: { fontSize: 14, fontWeight: '400' as const, color: colors.textSecondary },
  bodyStrong: { fontSize: 14, fontWeight: '600' as const, color: colors.textPrimary },
  small: { fontSize: 12, fontWeight: '500' as const, color: colors.textMuted },
  caption: { fontSize: 11, fontWeight: '600' as const, color: colors.textSubtle, letterSpacing: 0.5 },
};

export const shadows = {
  sm: Platform.select({
    web: {
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
    },
    default: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 2,
      elevation: 1,
    },
  }) as any,
  md: Platform.select({
    web: {
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.06)',
    },
    default: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
      elevation: 2,
    },
  }) as any,
  lg: Platform.select({
    web: {
      boxShadow: '0 4px 8px rgba(0, 0, 0, 0.10)',
    },
    default: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
  }) as any,
};
