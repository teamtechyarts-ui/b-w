import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import AppIcon, {IconName} from '../components/AppIcon';
import {borderRadius, colors, shadows, spacing} from '../theme/designSystem';
import type {AddressItem} from '../types/address';
import type {ServiceCategory, ServiceItem} from '../types/service';
import type {CustomerOrder} from '../types/order';
import {getOrders} from '../services/ordersApi';
import {useCustomerRealtime} from '../hooks/useRealtime';
import {isMalformedCategoryName} from '../utils/categoryQuality';

type Props = {
  customerName: string | null;
  servicesLoading: boolean;
  servicesError: string;
  services: ServiceItem[];
  categories: ServiceCategory[];
  selectedCategory?: string | null;
  addresses: AddressItem[];
  selectedAddressId: string | null;
  cartItemCount: number;
  cartSubtotal?: number;
  accessToken?: string;
  activeUrgentOrders?: CustomerOrder[];
  getQuantity: (serviceId: string) => number;
  onSelectAddress: (addressId: string) => void;
  onManageAddresses: () => void;
  onOpenCart: () => void;
  onOpenNotifications: () => void;
  onRetryServices: () => void;
  onUpdateQuantity: (service: ServiceItem, change: number) => void;
  onOpenCategory?: (categoryName: string) => void;
  onOpenOrder?: (orderId: string) => void;
};

function getCategoryIconName(name: string): IconName {
  const lower = name.toLowerCase();
  if (lower.includes('fold')) return 'fold';
  if (lower.includes('iron') || lower.includes('steam')) return 'iron';
  if (lower.includes('dry')) return 'hanger';
  if (lower.includes('linen') || lower.includes('bed') || lower.includes('house') || lower.includes('curtain') || lower.includes('carpet')) return 'bed';
  if (lower.includes('shoe')) return 'shoe';
  if (lower.includes('premium')) return 'sparkles';
  if (lower.includes('add')) return 'plus';
  if (lower.includes('wash')) return 'wash';
  return 'sparkles';
}

export default function HomeScreen(props: Props) {
  const [internalSelectedCategory, setInternalSelectedCategory] = useState<string | null>(null);
  const selectedCategory = props.selectedCategory !== undefined ? props.selectedCategory : internalSelectedCategory;
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [fetchedOrders, setFetchedOrders] = useState<CustomerOrder[]>([]);

  const lastRefreshTimeRef = React.useRef(0);

  const refreshOrders = React.useCallback((force = false) => {
    if (!props.accessToken || props.activeUrgentOrders) return;
    const now = Date.now();
    if (!force && now - lastRefreshTimeRef.current < 1000) return;
    lastRefreshTimeRef.current = now;

    getOrders(props.accessToken)
      .then(orders => {
        if (Array.isArray(orders)) setFetchedOrders(orders);
      })
      .catch(() => {});
  }, [props.accessToken, props.activeUrgentOrders]);

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  const handleRealtimeEvent = React.useCallback((event: any) => {
    if (
      !event ||
      event.eventType === 'RECONNECT_RECONCILE' ||
      event.eventType === 'ORDER_STATUS_CHANGED' ||
      event.eventType === 'ORDER_CREATED'
    ) {
      refreshOrders();
    }
  }, [refreshOrders]);

  useCustomerRealtime(
    null,
    handleRealtimeEvent,
    props.accessToken,
    !!props.accessToken,
  );

  const urgentOrders = useMemo(() => {
    const list = props.activeUrgentOrders || fetchedOrders;
    return list.filter(
      o =>
        o.current_status === 'pickup_otp_pending' ||
        o.current_status === 'delivery_otp_pending',
    );
  }, [props.activeUrgentOrders, fetchedOrders]);

  const selectedAddress = props.addresses.find(
    address => address.id === props.selectedAddressId,
  );

  const displayCategories = useMemo(() => {
    return props.categories.filter(category => !isMalformedCategoryName(category.name));
  }, [props.categories]);

  const handleCategoryPress = (categoryName: string) => {
    setInternalSelectedCategory(categoryName);
    props.onOpenCategory?.(categoryName);
  };

  const handleBookPickupPress = () => {
    if (displayCategories.length > 0) {
      handleCategoryPress(displayCategories[0].name);
    } else if (props.cartItemCount > 0) {
      props.onOpenCart();
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="dark-content" />

      {/* Main Scrollable Content */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        
        {/* Top Header */}
        <View style={styles.topHeader}>
          <View style={styles.brandContainer}>
            <Text style={styles.brandTitle}>Bright & White</Text>
            <Text style={styles.brandTagline}>Premium Garment Care</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              style={styles.iconButton}
              onPress={props.onOpenNotifications}>
              <AppIcon name="bell" size={20} color={colors.textPrimary} />
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Cart with ${props.cartItemCount} items`}
              style={styles.iconButton}
              onPress={props.onOpenCart}>
              <AppIcon name="cart" size={20} color={colors.textPrimary} />
              {props.cartItemCount > 0 ? (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeText}>
                    {props.cartItemCount > 99 ? '99+' : props.cartItemCount}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        {/* Deliver To Location Selector Card */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Choose delivery address"
          style={styles.locationCard}
          onPress={() => setAddressMenuOpen(open => !open)}>
          <View style={styles.locationIconBox}>
            <AppIcon name="location" size={18} color={colors.textPrimary} />
          </View>
          <View style={styles.locationInfo}>
            <Text style={styles.locationEyebrow}>DELIVER TO</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
              <Text numberOfLines={1} style={[styles.locationText, {flexShrink: 1}]}>
                {selectedAddress?.label || selectedAddress?.address_line1 || 'Choose an address'}
              </Text>
              <AppIcon name="arrow-down" size={10} color={colors.textPrimary} strokeWidth={2.5} />
            </View>
          </View>
        </TouchableOpacity>

        {/* Address Selection Dropdown Menu */}
        {addressMenuOpen ? (
          <View style={styles.addressDropdown}>
            <Text style={styles.dropdownSectionTitle}>Your Saved Locations</Text>
            {props.addresses.map(address => (
              <TouchableOpacity
                key={address.id}
                accessibilityRole="button"
                accessibilityLabel={address.label || address.address_line1}
                style={[
                  styles.addressItem,
                  props.selectedAddressId === address.id && styles.addressItemSelected,
                ]}
                onPress={() => {
                  props.onSelectAddress(address.id);
                  setAddressMenuOpen(false);
                }}>
                <View style={styles.addressItemTextContainer}>
                  <Text style={styles.addressItemLabel}>
                    {address.label || 'Saved address'}
                  </Text>
                  <Text numberOfLines={1} style={styles.addressItemLine}>
                    {address.address_line1}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Manage addresses"
              style={styles.manageAddressButton}
              onPress={() => {
                setAddressMenuOpen(false);
                props.onManageAddresses();
              }}>
              <View style={styles.manageAddressRow}>
                <Text style={styles.manageAddressText}>
                  {props.addresses.length ? 'Manage addresses' : 'Add delivery address'}
                </Text>
                <AppIcon name="arrow-right" size={14} color={colors.primary} />
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Active Urgent Order Action Cards (Driver Arrived / OTP Required) */}
        {urgentOrders.map(order => {
          const isPickup = order.current_status === 'pickup_otp_pending';
          return (
            <View
              key={order.id}
              accessibilityLabel={`Driver arrived for Order ${order.order_number}`}
              style={styles.urgentActionCard}>
              <View style={styles.urgentCardHeader}>
                <View style={styles.urgentBadge}>
                  <AppIcon name="truck" size={14} color={colors.info} strokeWidth={2} />
                  <Text style={styles.urgentBadgeText}>DRIVER ARRIVED</Text>
                </View>
                <Text style={styles.urgentOrderNumber}>Order {order.order_number}</Text>
              </View>
              <Text style={styles.urgentMessage}>
                {isPickup
                  ? 'Your pickup driver has arrived. Please provide your pickup OTP.'
                  : 'Your delivery driver has arrived with your clean garments. Please provide your delivery OTP.'}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`View Order ${order.order_number}`}
                style={styles.urgentActionBtn}
                onPress={() => props.onOpenOrder?.(order.id)}>
                <Text style={styles.urgentActionBtnText}>
                  {isPickup ? 'Give Pickup OTP →' : 'Give Delivery OTP →'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Hero Banner / Welcome Section */}
        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <Text style={styles.heroGreeting}>
              {props.customerName ? `Welcome ${props.customerName}` : 'Welcome'}
            </Text>
            <Text style={styles.heroHeadline}>Laundry care, made simple</Text>
          </View>
          <Text style={styles.heroDescription}>
            We pick up your clothes, clean them with care, and deliver them back to your doorstep.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Book a pickup"
            style={styles.heroCta}
            onPress={handleBookPickupPress}>
            <View style={styles.heroCtaRow}>
              <Text style={styles.heroCtaText}>BOOK A PICKUP</Text>
              <AppIcon name="arrow-right" size={16} color={colors.textInverse} strokeWidth={2.5} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Service Categories Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Service categories</Text>
          <Text style={styles.sectionSubtitle}>Choose a category to see available services.</Text>
        </View>

        {/* Loading State */}
        {props.servicesLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator accessibilityLabel="Loading services" size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Loading catalogue...</Text>
          </View>
        ) : null}

        {/* Error State */}
        {props.servicesError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{props.servicesError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={props.onRetryServices}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Empty Catalogue State */}
        {!props.servicesLoading && !props.servicesError && !displayCategories.length ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No services are available right now.</Text>
          </View>
        ) : null}

        {/* 2-Column Responsive Categories Grid */}
        <View style={styles.categoriesGrid}>
          {displayCategories.map(category => {
            const isSelected = selectedCategory === category.name;
            const iconName = getCategoryIconName(category.name);
            return (
              <TouchableOpacity
                key={`${category.id ?? ''}-${category.name}`}
                accessibilityRole="button"
                accessibilityState={{selected: isSelected}}
                style={[
                  styles.categoryCard,
                  isSelected && styles.categoryCardSelected,
                ]}
                onPress={() => handleCategoryPress(category.name)}>
                <View style={styles.categoryCardTop}>
                  <View style={styles.catIconContainer}>
                    <AppIcon name={iconName} size={20} color={colors.primary} />
                  </View>
                  {isSelected ? (
                    <View style={styles.categoryActiveBadge}>
                      <Text style={styles.categoryActiveBadgeText}>Selected</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={2} style={styles.categoryName}>
                  {category.name}
                </Text>
                <Text style={styles.categoryCount}>
                  {category.count} service{category.count === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  brandContainer: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  brandTagline: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: '800',
  },
  locationCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  locationIconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  locationInfo: {
    flex: 1,
  },
  locationEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  locationText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 1,
  },
  addressDropdown: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.md,
  },
  dropdownSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  addressItem: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addressItemSelected: {
    backgroundColor: colors.surfaceSubtle,
  },
  addressItemTextContainer: {
    flex: 1,
  },
  addressItemLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  addressItemLine: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  manageAddressButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  manageAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  manageAddressText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  urgentActionCard: {
    backgroundColor: colors.infoSurface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.infoBorder,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  urgentCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xs,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  urgentBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.info,
    letterSpacing: 0.5,
  },
  urgentOrderNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  urgentMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginVertical: spacing.sm,
  },
  urgentActionBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  urgentActionBtnText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
  },
  heroCard: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    ...shadows.md,
  },
  heroHeader: {
    marginBottom: spacing.sm,
  },
  heroGreeting: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroHeadline: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textInverse,
    marginTop: 2,
  },
  heroDescription: {
    fontSize: 13,
    color: '#D1D5DB',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  heroCta: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  heroCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroCtaText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  sectionHeaderRow: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  categoryCard: {
    width: '47.5%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.sm,
  },
  categoryCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceSubtle,
    ...shadows.md,
  },
  categoryCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  catIconContainer: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryActiveBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  categoryActiveBadgeText: {
    color: colors.textInverse,
    fontSize: 9,
    fontWeight: '800',
  },
  categoryName: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 17,
  },
  categoryCount: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  serviceSection: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  selectedCategoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectedCategoryTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  closeCategoryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  serviceInfo: {
    flex: 1,
    paddingRight: spacing.md,
  },
  serviceName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  serviceDescription: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  servicePrice: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 4,
  },
  serviceAction: {
    alignItems: 'flex-end',
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 34,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '700',
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  stepperButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xs,
    backgroundColor: colors.surface,
  },
  stepperQuantity: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  errorCard: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  errorText: {
    fontSize: 13,
    color: colors.dangerText,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  retryButtonText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
