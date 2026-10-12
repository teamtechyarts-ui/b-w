import React, {useMemo, useState} from 'react';
import {
  FlatList,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import AppIcon, {IconName} from '../components/AppIcon';
import StateView from '../components/StateView';
import {borderRadius, colors, shadows, spacing, typography} from '../theme/designSystem';

type ServiceItem = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  pricingUnit: string;
  price: number | null;
  facilityId: string | null;
};

type CategoryScreenProps = {
  categoryName: string;
  services: ServiceItem[];
  cartItemCount: number;
  cartSubtotal: number;
  servicesLoading?: boolean;
  servicesError?: string;
  onRetryServices?: () => void;
  getQuantity: (serviceId: string) => number;
  onBack: () => void;
  onOpenCart: () => void;
  onUpdateQuantity: (
    service: ServiceItem,
    change: number,
  ) => void;
};

function formatMoney(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

function categoryIconName(name: string): IconName {
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

function categoryDescription(name: string) {
  switch (name) {
    case 'Wash & Fold':
      return 'Everyday laundry washed, dried, and neatly folded';
    case 'Wash & Steam Iron':
      return 'Deep cleaned, sanitised, and steam ironed';
    case 'Premium Laundry':
      return 'Specialised care for delicate and luxury garments';
    case 'Wash & Iron':
      return 'Washed and crisply ironed for daily wear';
    case 'Steam Ironing':
      return 'Wrinkle-free steam pressing on hangers';
    case 'Dry Cleaning':
      return 'Chemical-free gentle dry cleaning for suits & silks';
    case 'Household & Linen Care':
      return 'Curtains, bedsheets, blankets, and towels';
    case 'Shoe Cleaning':
      return 'Deep cleaning, sanitisation, and buffing';
    case 'Add-On Services':
      return 'Antimicrobial rinse, stain removal & custom care';
    default:
      return 'Professional laundry care';
  }
}

export default function CategoryScreen({
  categoryName,
  services,
  cartItemCount,
  cartSubtotal,
  servicesLoading = false,
  servicesError = '',
  onRetryServices,
  getQuantity,
  onBack,
  onOpenCart,
  onUpdateQuantity,
}: CategoryScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectionItem, setInspectionItem] = useState<ServiceItem | null>(null);

  const filteredServices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return services;
    return services.filter(
      s =>
        s.name.toLowerCase().includes(query) ||
        (s.description && s.description.toLowerCase().includes(query)),
    );
  }, [services, searchQuery]);

  const renderServiceCard = ({item: service}: {item: ServiceItem}) => {
    const quantity = getQuantity(service.id);
    const unitPrice = service.price ?? 0;

    return (
      <View style={styles.serviceCard}>
        <View style={styles.cardInfoCol}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${service.name}, ₹${formatMoney(unitPrice)} per ${service.pricingUnit}. Tap for details.`}
            activeOpacity={0.7}
            onPress={() => setInspectionItem(service)}>
            <Text style={styles.serviceName}>{service.name}</Text>
            {service.description ? (
              <Text style={styles.serviceDesc} numberOfLines={2}>
                {service.description}
              </Text>
            ) : null}
            <Text style={styles.servicePrice}>
              ₹{formatMoney(unitPrice)}{' '}
              <Text style={styles.pricingUnit}>/ {service.pricingUnit}</Text>
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cardActionCol}>
          {quantity > 0 ? (
            <View style={styles.quantityControl}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Decrease quantity for ${service.name}`}
                style={styles.qtyBtn}
                onPress={() => onUpdateQuantity(service, -1)}>
                <AppIcon name="minus" size={14} color={colors.textPrimary} strokeWidth={2.5} />
              </TouchableOpacity>
              <Text style={styles.qtyCount}>{quantity}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Increase quantity for ${service.name}`}
                style={styles.qtyBtn}
                onPress={() => onUpdateQuantity(service, 1)}>
                <AppIcon name="plus" size={14} color={colors.textPrimary} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Add ${service.name} to cart`}
              style={styles.addButton}
              onPress={() => onUpdateQuantity(service, 1)}>
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.screenContainer}>
        {/* Header */}
        <View style={styles.pageHeader}>
          <TouchableOpacity
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}>
            <View style={styles.backRow}>
              <AppIcon name="arrow-left" size={16} color={colors.textPrimary} />
              <Text style={styles.pageBack}>Back</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.pageHeaderTitle} numberOfLines={1}>
            {categoryName}
          </Text>

          <TouchableOpacity
            style={styles.headerCartButton}
            accessibilityRole="button"
            accessibilityLabel={`Cart with ${cartItemCount} items, total ₹${formatMoney(cartSubtotal)}`}
            onPress={onOpenCart}>
            <AppIcon name="cart" size={20} color={colors.textPrimary} />
            {cartItemCount > 0 ? (
              <View style={styles.headerCartBadge}>
                <Text style={styles.headerCartBadgeText}>{cartItemCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchBarContainer}>
          <AppIcon name="search" size={16} color={colors.textMuted} />
          <TextInput
            accessibilityLabel={`Search in ${categoryName}`}
            placeholder={`Search in ${categoryName}...`}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />
          {searchQuery ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setSearchQuery('')}>
              <AppIcon name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Category Hero Banner */}
        <View style={styles.categoryHero}>
          <View style={styles.heroIconBox}>
            <AppIcon
              name={categoryIconName(categoryName)}
              size={22}
              color={colors.primary}
            />
          </View>
          <View style={styles.heroTextCol}>
            <Text style={styles.heroTitle}>{categoryName}</Text>
            <Text style={styles.heroSubtitle}>{categoryDescription(categoryName)}</Text>
          </View>
        </View>

        {/* Services List */}
        <FlatList
          data={filteredServices}
          keyExtractor={item => item.id}
          renderItem={renderServiceCard}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            servicesLoading ? (
              <StateView
                type="loading"
                message="Loading services..."
              />
            ) : servicesError ? (
              <StateView
                type="error"
                title="Unable to load services"
                message={servicesError}
                actionLabel="Try again"
                onAction={onRetryServices}
              />
            ) : searchQuery.trim() ? (
              <StateView
                type="empty"
                icon="search"
                title="No services found"
                message={`We couldn't find any services matching "${searchQuery}".`}
                actionLabel="Clear Search"
                onAction={() => setSearchQuery('')}
              />
            ) : (
              <StateView
                type="empty"
                icon="box"
                title="No services available"
                message="No services are currently available in this category."
              />
            )
          }
        />

        {/* Floating Cart Bottom Bar */}
        {cartItemCount > 0 ? (
          <View style={styles.bottomCartBar}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`View Cart: ${cartItemCount} items, ₹${formatMoney(cartSubtotal)}`}
              style={styles.cartBarButton}
              onPress={onOpenCart}>
              <View style={styles.cartBarLeft}>
                <View style={styles.cartBadgeSmall}>
                  <Text style={styles.cartBadgeSmallText}>{cartItemCount}</Text>
                </View>
                <Text style={styles.cartBarLabel}>
                  {cartItemCount === 1 ? '1 Item' : `${cartItemCount} Items`}
                </Text>
              </View>

              <View style={styles.cartBarRight}>
                <Text style={styles.cartBarTotal}>
                  ₹{formatMoney(cartSubtotal)}
                </Text>
                <Text style={styles.cartBarAction}>View Cart</Text>
                <AppIcon name="arrow-right" size={16} color={colors.textInverse} strokeWidth={2.5} />
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Service Inspection Modal */}
        <Modal
          visible={inspectionItem !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setInspectionItem(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleRow}>
                  <AppIcon name="info" size={18} color={colors.primary} />
                  <Text style={styles.modalTitle}>{inspectionItem?.name}</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close service details"
                  style={styles.modalCloseBtn}
                  onPress={() => setInspectionItem(null)}>
                  <AppIcon name="close" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalDesc}>
                {inspectionItem?.description || 'Standard professional laundry care for this garment.'}
              </Text>

              <View style={styles.modalPricingCard}>
                <Text style={styles.modalPricingLabel}>Unit Price</Text>
                <Text style={styles.modalPricingValue}>
                  ₹{formatMoney(inspectionItem?.price ?? 0)} / {inspectionItem?.pricingUnit}
                </Text>
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.modalDismissBtn}
                onPress={() => setInspectionItem(null)}>
                <Text style={styles.modalDismissBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  pageHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    minWidth: 54,
    minHeight: 44,
    justifyContent: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pageBack: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pageHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    marginHorizontal: spacing.sm,
  },
  headerCartButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCartBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  headerCartBadgeText: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: '800',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    height: 44,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  categoryHero: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.sm,
  },
  heroIconBox: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextCol: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  heroSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  serviceCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadows.sm,
  },
  cardInfoCol: {
    flex: 1,
    paddingRight: spacing.md,
  },
  serviceName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  serviceDesc: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 3,
    lineHeight: 16,
  },
  servicePrice: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 6,
  },
  pricingUnit: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  cardActionCol: {
    alignItems: 'flex-end',
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 38,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  qtyBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
  },
  qtyCount: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  bottomCartBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
  },
  cartBarButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    ...shadows.lg,
  },
  cartBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cartBadgeSmall: {
    backgroundColor: '#374151',
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  cartBadgeSmallText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '800',
  },
  cartBarLabel: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  cartBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cartBarTotal: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '900',
  },
  cartBarAction: {
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    ...shadows.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  modalCloseBtn: {
    padding: spacing.xs,
  },
  modalDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  modalPricingCard: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalPricingLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  modalPricingValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  modalDismissBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  modalDismissBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
});