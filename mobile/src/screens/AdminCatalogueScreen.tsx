import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AdminCatalogue,
  CatalogueCategory,
  CatalogueService,
  createAdminCategory,
  createAdminService,
  getAdminCatalogue,
  setAdminPackageEligibility,
  setAdminPricingPolicy,
  setAdminServicePrice,
  updateAdminCategory,
  updateAdminService,
} from '../services/adminCatalogueApi';
import {FacilityChoice, listAdminFacilities} from '../services/adminStaffApi';
import AppIcon from '../components/AppIcon';

type Props = {
  accessToken: string;
  onBack: () => void;
};

const formatCurrency = (val: number | null | undefined): string => {
  if (val === undefined || val === null || isNaN(Number(val))) return 'Quote only';
  return `₹${Number(val).toFixed(2)}`;
};

const formatActivityDate = (isoString: string): string => {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
};

const COMMON_UNITS = ['piece', 'pair', 'kg', 'item', 'set', 'meter'];

// Memoized Service Card Component
interface ServiceCardProps {
  item: CatalogueService;
  categoryName: string;
  price: number | undefined;
  packageCount: number;
  onEdit: (item: CatalogueService) => void;
  onOpenActions: (item: CatalogueService) => void;
  onOpenPrice: (item: CatalogueService) => void;
  onOpenPackageEligibility: (item: CatalogueService) => void;
}

const ServiceCard = React.memo(function ServiceCard({
  item,
  categoryName,
  price,
  packageCount,
  onEdit,
  onOpenActions,
  onOpenPrice,
  onOpenPackageEligibility,
}: ServiceCardProps) {
  const priceDisplay = price !== undefined ? `₹${price}` : 'Quote only';
  const unitSuffix = price !== undefined ? ` / ${item.pricing_unit}` : '';

  return (
    <View style={styles.card} accessibilityLabel={`Service ${item.name}`}>
      {/* Service Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text style={styles.serviceName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.categoryName} numberOfLines={1}>
            {categoryName}
          </Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            item.is_active ? styles.statusBadgeActive : styles.statusBadgeInactive,
          ]}
          accessibilityLabel={`Status: ${item.is_active ? 'Active' : 'Inactive'}`}>
          <Text
            style={[
              styles.statusDot,
              item.is_active ? styles.statusDotActive : styles.statusDotInactive,
            ]}>
            ●
          </Text>
          <Text
            style={[
              styles.statusText,
              item.is_active ? styles.statusTextActive : styles.statusTextInactive,
            ]}>
            {item.is_active ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>

      {/* Optional Description */}
      {item.description ? (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}

      {/* Price & Package Info */}
      <View style={styles.cardMetaRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Price: ${priceDisplay}${unitSuffix}`}
          style={styles.priceContainer}
          onPress={() => onOpenPrice(item)}>
          <Text style={styles.priceValue}>
            {priceDisplay}
            {unitSuffix ? <Text style={styles.priceUnit}>{unitSuffix}</Text> : null}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${packageCount} packages available`}
          style={styles.packageTag}
          onPress={() => onOpenPackageEligibility(item)}>
          <Text style={styles.packageText}>
            {packageCount} {packageCount === 1 ? 'package' : 'packages'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Action Footer */}
      <View style={styles.cardActionsRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.name}`}
          style={styles.editBtn}
          onPress={() => onEdit(item)}>
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${item.name}`}
          style={styles.overflowBtn}
          onPress={() => onOpenActions(item)}>
          <Text style={styles.overflowBtnText}>⋮</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// Skeleton Loader Component
function CatalogueSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map(i => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonHeaderRow}>
            <View style={{flex: 1, gap: 6, flexShrink: 1, paddingRight: 8}}>
              <View style={[styles.skeletonLine, {width: '65%', height: 16}]} />
              <View style={[styles.skeletonLine, {width: '40%', height: 12}]} />
            </View>
            <View style={[styles.skeletonLine, {width: 64, height: 22, borderRadius: 12}]} />
          </View>
          <View style={{marginTop: 14, gap: 6}}>
            <View style={[styles.skeletonLine, {width: '35%', height: 18}]} />
            <View style={[styles.skeletonLine, {width: '25%', height: 12}]} />
          </View>
          <View style={styles.skeletonActionsRow}>
            <View style={[styles.skeletonLine, {flex: 1, height: 44, borderRadius: 10, marginRight: 10}]} />
            <View style={[styles.skeletonLine, {width: 44, height: 44, borderRadius: 10}]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function AdminCatalogueScreen({accessToken, onBack}: Props) {
  const [data, setData] = useState<AdminCatalogue | null>(null);
  const [facilities, setFacilities] = useState<FacilityChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState('');

  // Modals state: Service Add/Edit
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<CatalogueService | null>(null);
  const [serviceName, setServiceName] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [servicePricingUnit, setServicePricingUnit] = useState('piece');
  const [serviceCategoryId, setServiceCategoryId] = useState('');
  const [serviceInitialPrice, setServiceInitialPrice] = useState('');
  const [serviceFieldErrors, setServiceFieldErrors] = useState<Record<string, string>>({});
  const [formCategoryPickerOpen, setFormCategoryPickerOpen] = useState(false);

  // Price Modal
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [pricingService, setPricingService] = useState<CatalogueService | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const [priceFacilityId, setPriceFacilityId] = useState('');
  const [priceError, setPriceError] = useState('');

  // Category Add/Edit Modal
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CatalogueCategory | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryDescription, setCategoryDescription] = useState('');
  const [categoryError, setCategoryError] = useState('');

  // Category Actions Sheet & Delete
  const [activeCategoryMenu, setActiveCategoryMenu] = useState<CatalogueCategory | null>(null);
  const [categoryDeleteCandidate, setCategoryDeleteCandidate] = useState<CatalogueCategory | null>(null);
  const [categoryBlockedDialog, setCategoryBlockedDialog] = useState<{name: string; count: number} | null>(null);

  // Package Eligibility Modal
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [eligibilityService, setEligibilityService] = useState<CatalogueService | null>(null);
  const [packageUsageLimits, setPackageUsageLimits] = useState<Record<string, string>>({});

  // Action Menu Sheet for Service
  const [activeActionService, setActiveActionService] = useState<CatalogueService | null>(null);

  // Deactivation / Delete Service Confirmation Modal
  const [deactivateConfirmService, setDeactivateConfirmService] = useState<CatalogueService | null>(null);
  const [deleteConfirmService, setDeleteConfirmService] = useState<CatalogueService | null>(null);

  // Collapsible Footer Sections (Checkout Policy & Activity)
  const [policyExpanded, setPolicyExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  // Policy Form State
  const [fee, setFee] = useState('');
  const [threshold, setThreshold] = useState('');
  const [gst, setGst] = useState('');
  const [minimum, setMinimum] = useState('');
  const [policySaving, setPolicySaving] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const [next, places] = await Promise.all([
          getAdminCatalogue(accessToken),
          listAdminFacilities(accessToken),
        ]);
        setData(next);
        setFacilities(places.filter(place => place.is_active));
        setFee(String(next.policy.pickupDeliveryFee));
        setThreshold(String(next.policy.freeDeliveryThreshold));
        setGst(String(next.policy.gstRatePercent));
        setMinimum(String(next.policy.minimumOrderAmount));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Catalogue unavailable.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (action: () => Promise<unknown>, successMsg: string) => {
    if (saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await action();
      await load();
      setSuccess(successMsg);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Change was not saved.');
    } finally {
      setSaving(false);
    }
  };

  const getLatestPrice = useCallback(
    (serviceId: string, facilityId: string | null = null) => {
      return data?.prices.find(
        row => row.service_id === serviceId && row.facility_id === facilityId,
      )?.price;
    },
    [data?.prices],
  );

  // Filtered Services List
  const filteredServices = useMemo(() => {
    if (!data?.services) return [];
    return data.services.filter(item => {
      if (statusFilter === 'active' && !item.is_active) return false;
      if (statusFilter === 'inactive' && item.is_active) return false;
      if (categoryFilter !== 'all' && item.category_id !== categoryFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const cat = data.categories.find(c => c.id === item.category_id)?.name.toLowerCase() || '';
        const nameMatch = item.name.toLowerCase().includes(q);
        const descMatch = item.description?.toLowerCase().includes(q) || false;
        const unitMatch = item.pricing_unit.toLowerCase().includes(q);
        const catMatch = cat.includes(q);
        if (!nameMatch && !descMatch && !unitMatch && !catMatch) return false;
      }
      return true;
    });
  }, [data, searchQuery, statusFilter, categoryFilter]);

  // Filtered categories for bottom sheet search
  const filteredCategoriesForSheet = useMemo(() => {
    const cats = data?.categories || [];
    if (!categorySearchQuery.trim()) return cats;
    const q = categorySearchQuery.toLowerCase().trim();
    return cats.filter(c => c.name.toLowerCase().includes(q));
  }, [data?.categories, categorySearchQuery]);

  // Statistics
  const totalServices = data?.services.length ?? 0;
  const activeServices = data?.services.filter(s => s.is_active).length ?? 0;

  // Selected Category Name
  const selectedCategoryName = useMemo(() => {
    if (categoryFilter === 'all') return 'All Categories';
    const cat = data?.categories.find(c => c.id === categoryFilter);
    return cat ? cat.name : 'All Categories';
  }, [categoryFilter, data?.categories]);

  // Form Selected Category Name
  const formSelectedCategoryName = useMemo(() => {
    if (!serviceCategoryId) return 'Select category';
    const cat = data?.categories.find(c => c.id === serviceCategoryId);
    return cat ? cat.name : 'Select category';
  }, [serviceCategoryId, data?.categories]);

  // Service Form Category Options (Active categories + current service category if editing)
  const [serviceCategorySearchQuery, setServiceCategorySearchQuery] = useState('');
  const serviceFormCategoryOptions = useMemo(() => {
    if (!data?.categories) return [];
    const activeOrCurrent = data.categories.filter(
      c => c.is_active || (editingService && c.id === editingService.category_id),
    );
    if (!serviceCategorySearchQuery.trim()) return activeOrCurrent;
    const q = serviceCategorySearchQuery.toLowerCase().trim();
    return activeOrCurrent.filter(c => c.name.toLowerCase().includes(q));
  }, [data?.categories, editingService, serviceCategorySearchQuery]);

  // Handlers for Add/Edit Service
  const openAddServiceModal = () => {
    setEditingService(null);
    setServiceName('');
    setServiceDescription('');
    setServicePricingUnit('piece');
    const firstActive = data?.categories.filter(c => c.is_active)[0]?.id || '';
    setServiceCategoryId(firstActive);
    setServiceInitialPrice('');
    setServiceFieldErrors({});
    setServiceCategorySearchQuery('');
    setFormCategoryPickerOpen(false);
    setServiceModalOpen(true);
  };

  const openEditServiceModal = useCallback(
    (item: CatalogueService) => {
      setEditingService(item);
      setServiceName(item.name);
      setServiceDescription(item.description || '');
      setServicePricingUnit(item.pricing_unit || 'piece');
      setServiceCategoryId(item.category_id || '');
      const currentPrice = getLatestPrice(item.id, null);
      setServiceInitialPrice(currentPrice !== undefined ? String(currentPrice) : '');
      setServiceFieldErrors({});
      setServiceCategorySearchQuery('');
      setFormCategoryPickerOpen(false);
      setActiveActionService(null);
      setServiceModalOpen(true);
    },
    [getLatestPrice],
  );

  const handleSaveService = async () => {
    const errors: Record<string, string> = {};
    if (!serviceName.trim()) errors.name = 'Service name is required.';
    if (!servicePricingUnit.trim()) errors.unit = 'Pricing unit is required.';
    if (Object.keys(errors).length > 0) {
      setServiceFieldErrors(errors);
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (editingService) {
        await updateAdminService(accessToken, editingService.id, {
          name: serviceName.trim(),
          description: serviceDescription.trim() || undefined,
          pricingUnit: servicePricingUnit.trim(),
          categoryId: serviceCategoryId || undefined,
        });
        if (serviceInitialPrice.trim() && !isNaN(Number(serviceInitialPrice))) {
          await setAdminServicePrice(accessToken, editingService.id, Number(serviceInitialPrice));
        }
        setSuccess(`Service "${serviceName.trim()}" updated successfully.`);
      } else {
        const created = await createAdminService(accessToken, {
          name: serviceName.trim(),
          description: serviceDescription.trim() || undefined,
          pricingUnit: servicePricingUnit.trim(),
          categoryId: serviceCategoryId || undefined,
        });
        if (serviceInitialPrice.trim() && !isNaN(Number(serviceInitialPrice))) {
          const serviceId = (created as any)?.id || (created as any)?.service?.id;
          if (serviceId) {
            await setAdminServicePrice(accessToken, serviceId, Number(serviceInitialPrice));
          }
        }
        setSuccess(`Service "${serviceName.trim()}" created successfully.`);
      }
      setServiceModalOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save service.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleServiceStatus = (item: CatalogueService) => {
    setActiveActionService(null);
    if (item.is_active) {
      setDeactivateConfirmService(item);
    } else {
      runAction(
        () => updateAdminService(accessToken, item.id, {isActive: true}),
        `Activated "${item.name}".`,
      );
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateConfirmService) return;
    const target = deactivateConfirmService;
    setDeactivateConfirmService(null);
    await runAction(
      () => updateAdminService(accessToken, target.id, {isActive: false}),
      `Deactivated "${target.name}".`,
    );
  };

  const handleDeleteServiceClick = (item: CatalogueService) => {
    setActiveActionService(null);
    setDeleteConfirmService(item);
  };

  const handleConfirmDeleteService = async () => {
    if (!deleteConfirmService) return;
    const target = deleteConfirmService;
    setDeleteConfirmService(null);
    await runAction(
      () => updateAdminService(accessToken, target.id, {isActive: false}),
      `Service "${target.name}" deleted successfully.`,
    );
  };

  // Pricing Modal Handler
  const openPriceModal = useCallback(
    (item: CatalogueService) => {
      setPricingService(item);
      const curr = getLatestPrice(item.id, null);
      setNewPrice(curr !== undefined ? String(curr) : '');
      setPriceFacilityId('');
      setPriceError('');
      setActiveActionService(null);
      setPriceModalOpen(true);
    },
    [getLatestPrice],
  );

  const handleSavePrice = async () => {
    if (!pricingService) return;
    if (!newPrice.trim() || isNaN(Number(newPrice)) || Number(newPrice) < 0) {
      setPriceError('Please enter a valid non-negative price.');
      return;
    }
    setSaving(true);
    setPriceError('');
    try {
      await setAdminServicePrice(
        accessToken,
        pricingService.id,
        Number(newPrice),
        priceFacilityId || undefined,
      );
      setSuccess(`Updated price for "${pricingService.name}".`);
      setPriceModalOpen(false);
      await load();
    } catch (cause) {
      setPriceError(cause instanceof Error ? cause.message : 'Failed to save price.');
    } finally {
      setSaving(false);
    }
  };

  // Category Modal Handlers
  const openAddCategoryModal = () => {
    setCategorySheetOpen(false);
    setActiveCategoryMenu(null);
    setEditingCategory(null);
    setCategoryName('');
    setCategoryDescription('');
    setCategoryError('');
    setCategoryModalOpen(true);
  };

  const openEditCategoryModal = (cat: CatalogueCategory) => {
    setCategorySheetOpen(false);
    setActiveCategoryMenu(null);
    setEditingCategory(cat);
    setCategoryName(cat.name);
    setCategoryDescription(cat.description || '');
    setCategoryError('');
    setCategoryModalOpen(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryName.trim()) {
      setCategoryError('Category name is required.');
      return;
    }
    setSaving(true);
    setCategoryError('');
    try {
      if (editingCategory) {
        await updateAdminCategory(accessToken, editingCategory.id, {
          name: categoryName.trim(),
          description: categoryDescription.trim() || undefined,
        });
        setSuccess(`Category "${categoryName.trim()}" updated successfully.`);
      } else {
        await createAdminCategory(accessToken, {
          name: categoryName.trim(),
          description: categoryDescription.trim() || undefined,
        });
        setSuccess(`Category "${categoryName.trim()}" added successfully.`);
      }
      setCategoryModalOpen(false);
      await load();
    } catch (cause) {
      setCategoryError(cause instanceof Error ? cause.message : 'Failed to save category.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategoryClick = (cat: CatalogueCategory) => {
    setActiveCategoryMenu(null);
    setCategorySheetOpen(false);
    // Check if services are assigned to this category
    const assignedCount = data?.services?.filter(s => s.category_id === cat.id && s.is_active).length || 0;
    if (assignedCount > 0) {
      setCategoryBlockedDialog({name: cat.name, count: assignedCount});
    } else {
      setCategoryDeleteCandidate(cat);
    }
  };

  const handleConfirmDeleteCategory = async () => {
    if (!categoryDeleteCandidate) return;
    const target = categoryDeleteCandidate;
    setCategoryDeleteCandidate(null);
    await runAction(
      () => updateAdminCategory(accessToken, target.id, {isActive: false}),
      `Category "${target.name}" deleted successfully.`,
    );
    if (categoryFilter === target.id) {
      setCategoryFilter('all');
    }
  };

  // Package Eligibility Handler
  const openPackageEligibilityModal = useCallback(
    (item: CatalogueService) => {
      setEligibilityService(item);
      const limits: Record<string, string> = {};
      if (data?.packageEligibility) {
        data.packageEligibility
          .filter(pe => pe.service_id === item.id)
          .forEach(pe => {
            limits[pe.package_id] = pe.usage_limit !== null ? String(pe.usage_limit) : '';
          });
      }
      setPackageUsageLimits(limits);
      setActiveActionService(null);
      setPackageModalOpen(true);
    },
    [data?.packageEligibility],
  );

  const handleTogglePackageEligibility = async (
    packageId: string,
    currentlyEligible: boolean,
  ) => {
    if (!eligibilityService) return;
    const limitStr = packageUsageLimits[packageId];
    const limitNum = limitStr && limitStr.trim() ? Number(limitStr) : null;
    await runAction(
      () =>
        setAdminPackageEligibility(
          accessToken,
          packageId,
          eligibilityService.id,
          !currentlyEligible,
          limitNum,
        ),
      `Package eligibility updated for "${eligibilityService.name}".`,
    );
  };

  // Policy Save Handler
  const handleSavePolicy = async () => {
    if (!fee || !threshold || !gst || !minimum) {
      setError('Please fill out all checkout policy fields.');
      return;
    }
    setPolicySaving(true);
    setError('');
    setSuccess('');
    try {
      await setAdminPricingPolicy(accessToken, {
        pickupDeliveryFee: Number(fee),
        freeDeliveryThreshold: Number(threshold),
        gstRatePercent: Number(gst),
        minimumOrderAmount: Number(minimum),
      });
      await load();
      setSuccess('Checkout policy saved successfully.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save checkout policy.');
    } finally {
      setPolicySaving(false);
    }
  };

  // Action Menu trigger from card
  const handleOpenActions = useCallback((item: CatalogueService) => {
    setActiveActionService(item);
  }, []);

  const renderServiceItem = useCallback(
    ({item}: {item: CatalogueService}) => {
      const catName =
        data?.categories.find(c => c.id === item.category_id)?.name || 'Uncategorized';
      const price = getLatestPrice(item.id, null);
      const packageCount =
        data?.packageEligibility?.filter(row => row.service_id === item.id).length || 0;

      return (
        <ServiceCard
          item={item}
          categoryName={catName}
          price={price}
          packageCount={packageCount}
          onEdit={openEditServiceModal}
          onOpenActions={handleOpenActions}
          onOpenPrice={openPriceModal}
          onOpenPackageEligibility={openPackageEligibilityModal}
        />
      );
    },
    [
      data?.categories,
      data?.packageEligibility,
      getLatestPrice,
      openEditServiceModal,
      handleOpenActions,
      openPriceModal,
      openPackageEligibilityModal,
    ],
  );

  // List Header Component
  const listHeader = useMemo(() => {
    if (!data) return null;
    return (
      <View style={styles.listHeaderContainer}>
        {/* Top Bar Navigation */}
        <View style={styles.topNavigation}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back to admin dashboard"
            style={styles.backButton}
            onPress={onBack}>
            <Text style={styles.backButtonText}>← Admin</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Add service"
            style={styles.headerAddBtn}
            onPress={openAddServiceModal}>
            <Text style={styles.headerAddBtnText}>+ Add Service</Text>
          </TouchableOpacity>
        </View>

        {/* Page Header */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Service Catalogue</Text>
          <Text style={styles.pageSubtitle}>
            {totalServices} {totalServices === 1 ? 'service' : 'services'} · {activeServices} active
          </Text>
        </View>

        {/* Category Header & Trigger Block */}
        <View style={styles.categoryFilterBlock}>
          <View style={styles.categoryHeaderRow}>
            <Text style={styles.filterSectionLabel}>Categories</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Add category"
              style={styles.addCategoryLinkBtn}
              onPress={openAddCategoryModal}>
              <Text style={styles.addCategoryLinkText}>+ Add Category</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Category filter: ${selectedCategoryName}`}
            style={styles.categoryDropdownTrigger}
            onPress={() => {
              setCategorySearchQuery('');
              setCategorySheetOpen(true);
            }}>
            <Text style={styles.categoryDropdownText} numberOfLines={1}>
              {selectedCategoryName}
            </Text>
            <Text style={styles.dropdownChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Search Field */}
        <View style={styles.searchContainer}>
          <AppIcon name="search" size={16} color="#94A3B8" />
          <TextInput
            accessibilityLabel="Search services"
            style={styles.searchInput}
            placeholder="Search services..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={styles.clearSearchBtn}
              onPress={() => setSearchQuery('')}>
              <AppIcon name="close" size={14} color="#94A3B8" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Status Segmented Control */}
        <View style={styles.statusSegment}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Show all services"
            style={[
              styles.statusSegmentBtn,
              statusFilter === 'all' && styles.statusSegmentBtnActive,
            ]}
            onPress={() => setStatusFilter('all')}>
            <Text
              style={[
                styles.statusSegmentText,
                statusFilter === 'all' && styles.statusSegmentTextActive,
              ]}>
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Show active services"
            style={[
              styles.statusSegmentBtn,
              statusFilter === 'active' && styles.statusSegmentBtnActive,
            ]}
            onPress={() => setStatusFilter('active')}>
            <Text
              style={[
                styles.statusSegmentText,
                statusFilter === 'active' && styles.statusSegmentTextActive,
              ]}>
              Active
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Show inactive services"
            style={[
              styles.statusSegmentBtn,
              statusFilter === 'inactive' && styles.statusSegmentBtnActive,
            ]}
            onPress={() => setStatusFilter('inactive')}>
            <Text
              style={[
                styles.statusSegmentText,
                statusFilter === 'inactive' && styles.statusSegmentTextActive,
              ]}>
              Inactive
            </Text>
          </TouchableOpacity>
        </View>

        {/* Result Count Banner */}
        <View style={styles.resultCountRow}>
          <Text style={styles.resultCountText}>
            {filteredServices.length}{' '}
            {filteredServices.length === 1 ? 'service found' : 'services found'}
          </Text>
          {searchQuery || categoryFilter !== 'all' || statusFilter !== 'all' ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Reset all filters"
              onPress={() => {
                setSearchQuery('');
                setCategoryFilter('all');
                setStatusFilter('all');
              }}>
              <Text style={styles.clearFiltersLink}>Reset filters</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }, [
    data,
    totalServices,
    activeServices,
    searchQuery,
    selectedCategoryName,
    statusFilter,
    filteredServices.length,
    categoryFilter,
    onBack,
  ]);

  // List Empty Component
  const listEmpty = useMemo(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyState}>
        <AppIcon name="info" size={32} color="#94A3B8" />
        <Text style={styles.emptyStateTitle}>No services found</Text>
        <Text style={styles.emptyStateSubtitle}>
          {searchQuery || statusFilter !== 'all' || categoryFilter !== 'all'
            ? 'Try changing your search or filters.'
            : 'Get started by creating your first laundry service.'}
        </Text>
        {searchQuery || statusFilter !== 'all' || categoryFilter !== 'all' ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Clear filters"
            style={styles.emptyStateBtn}
            onPress={() => {
              setSearchQuery('');
              setCategoryFilter('all');
              setStatusFilter('all');
            }}>
            <Text style={styles.emptyStateBtnText}>Clear filters</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Add service"
            style={styles.emptyStateBtn}
            onPress={openAddServiceModal}>
            <Text style={styles.emptyStateBtnText}>+ Add service</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [loading, searchQuery, statusFilter, categoryFilter]);

  // List Footer Component: Collapsible Policy & Recent Activity
  const listFooter = useMemo(() => {
    if (!data) return null;
    return (
      <View style={styles.footerContainer}>
        {/* CHECKOUT POLICY ACCORDION */}
        <View style={styles.footerAccordionCard}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Toggle checkout policy section"
            style={styles.accordionHeader}
            onPress={() => setPolicyExpanded(!policyExpanded)}>
            <View style={styles.accordionHeaderLeft}>
              <Text style={styles.accordionTitle}>Checkout Policy</Text>
              <Text style={styles.accordionSubtitle}>
                Delivery fees, free threshold, GST & minimum order
              </Text>
            </View>
            <Text style={styles.accordionChevron}>{policyExpanded ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {policyExpanded ? (
            <View style={styles.accordionContent}>
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Delivery Fee</Text>
                <View style={styles.inputWithAdornment}>
                  <Text style={styles.adornmentText}>₹</Text>
                  <TextInput
                    accessibilityLabel="Pickup and delivery fee"
                    style={styles.adornmentInput}
                    value={fee}
                    onChangeText={setFee}
                    keyboardType="decimal-pad"
                    placeholder="40"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <Text style={styles.fieldHelper}>Fee charged when subtotal is below threshold.</Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Free Delivery Threshold</Text>
                <View style={styles.inputWithAdornment}>
                  <Text style={styles.adornmentText}>₹</Text>
                  <TextInput
                    accessibilityLabel="Free delivery threshold"
                    style={styles.adornmentInput}
                    value={threshold}
                    onChangeText={setThreshold}
                    keyboardType="decimal-pad"
                    placeholder="499"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <Text style={styles.fieldHelper}>Orders above this amount receive free delivery.</Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>GST Rate</Text>
                <View style={styles.inputWithAdornment}>
                  <TextInput
                    accessibilityLabel="GST rate percent"
                    style={[styles.adornmentInput, {paddingLeft: 12}]}
                    value={gst}
                    onChangeText={setGst}
                    keyboardType="decimal-pad"
                    placeholder="18"
                    placeholderTextColor="#94A3B8"
                  />
                  <Text style={[styles.adornmentText, {paddingRight: 12}]}>%</Text>
                </View>
                <Text style={styles.fieldHelper}>Applicable goods & services tax percentage.</Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Minimum Order Value</Text>
                <View style={styles.inputWithAdornment}>
                  <Text style={styles.adornmentText}>₹</Text>
                  <TextInput
                    accessibilityLabel="Minimum order amount"
                    style={styles.adornmentInput}
                    value={minimum}
                    onChangeText={setMinimum}
                    keyboardType="decimal-pad"
                    placeholder="199"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <Text style={styles.fieldHelper}>Minimum cart subtotal required to place order.</Text>
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                disabled={policySaving || !fee || !threshold || !gst || !minimum}
                style={[
                  styles.savePolicyBtn,
                  (policySaving || !fee || !threshold || !gst || !minimum) &&
                    styles.btnDisabled,
                ]}
                onPress={handleSavePolicy}>
                <Text style={styles.savePolicyBtnText}>
                  {policySaving ? 'Saving policy...' : 'Save checkout policy'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* RECENT ACTIVITY ACCORDION */}
        <View style={styles.footerAccordionCard}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Toggle recent catalogue activity"
            style={styles.accordionHeader}
            onPress={() => setActivityExpanded(!activityExpanded)}>
            <View style={styles.accordionHeaderLeft}>
              <Text style={styles.accordionTitle}>Recent Activity</Text>
              <Text style={styles.accordionSubtitle}>Audit trail of catalogue modifications</Text>
            </View>
            <Text style={styles.accordionChevron}>{activityExpanded ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {activityExpanded ? (
            <View style={styles.accordionContent}>
              {!data.audit || data.audit.length === 0 ? (
                <Text style={styles.emptyActivityText}>No catalogue audit logs recorded yet.</Text>
              ) : (
                <View style={styles.activityList}>
                  {data.audit.slice(0, 10).map(item => (
                    <View key={item.id} style={styles.activityRow}>
                      <View style={styles.activityDot} />
                      <View style={styles.activityContent}>
                        <Text style={styles.activityAction}>
                          {item.action
                            .replace(/_/g, ' ')
                            .replace(/\b\w/g, l => l.toUpperCase())}
                        </Text>
                        <Text style={styles.activityTime}>
                          {formatActivityDate(item.created_at)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : null}
        </View>
      </View>
    );
  }, [
    data,
    policyExpanded,
    activityExpanded,
    fee,
    threshold,
    gst,
    minimum,
    policySaving,
  ]);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.mainWrapper}>
        {/* Error Alert */}
        {error ? (
          <View style={styles.alertError} accessibilityRole="alert">
            <Text style={styles.alertErrorText}>{error}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry catalogue"
              onPress={() => load()}
              style={styles.alertRetryBtn}>
              <Text style={styles.alertRetryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Success Alert */}
        {success ? (
          <View style={styles.alertSuccess} accessibilityRole="alert">
            <Text style={styles.alertSuccessText}>{success}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Dismiss success message"
              onPress={() => setSuccess('')}>
              <AppIcon name="close" size={14} color="#065F46" />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Loading Skeleton */}
        {loading && !data ? (
          <View style={styles.loadingWrapper}>
            <View style={styles.topNavigation}>
              <TouchableOpacity style={styles.backButton} onPress={onBack}>
                <Text style={styles.backButtonText}>← Admin</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.pageTitle}>Service Catalogue</Text>
            <CatalogueSkeleton />
          </View>
        ) : (
          <FlatList
            data={filteredServices}
            keyExtractor={item => item.id}
            renderItem={renderServiceItem}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            ListFooterComponent={listFooter}
            style={styles.flatListStyle}
            contentContainerStyle={styles.listContentContainer}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
            }
          />
        )}
      </View>

      {/* =========================================================================
          BOTTOM SHEET: CATEGORY SELECTOR & MANAGEMENT
          ========================================================================= */}
      <Modal
        visible={categorySheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCategorySheetOpen(false)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setCategorySheetOpen(false)}>
          <View
            style={styles.bottomSheetCard}
            onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Categories</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close category selector"
                onPress={() => setCategorySheetOpen(false)}>
                <AppIcon name="close" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Category Search in Sheet */}
            <View style={styles.categorySheetSearchWrap}>
              <TextInput
                accessibilityLabel="Search categories"
                style={styles.categorySheetSearchInput}
                placeholder="Search categories..."
                placeholderTextColor="#94A3B8"
                value={categorySearchQuery}
                onChangeText={setCategorySearchQuery}
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={[
                {id: 'all', name: 'All Categories', is_active: true},
                ...filteredCategoriesForSheet,
              ]}
              keyExtractor={item => item.id}
              style={{maxHeight: 320, width: '100%'}}
              renderItem={({item}) => {
                const isSelected = categoryFilter === item.id;
                const count =
                  item.id === 'all'
                    ? data?.services.length || 0
                    : data?.services.filter(s => s.category_id === item.id).length || 0;

                return (
                  <View style={[styles.categoryOptionRow, isSelected && styles.categoryOptionRowSelected]}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Select category ${item.name}`}
                      style={styles.categoryOptionSelectPressable}
                      onPress={() => {
                        setCategoryFilter(item.id);
                        setCategorySheetOpen(false);
                      }}>
                      <View style={styles.categoryOptionTextWrap}>
                        <Text
                          style={[
                            styles.categoryOptionName,
                            isSelected && styles.categoryOptionNameSelected,
                          ]}
                          numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.categoryOptionCount}>({count})</Text>
                      </View>
                    </TouchableOpacity>

                    {item.id !== 'all' ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Manage category ${item.name}`}
                        style={styles.categoryItemActionBtn}
                        onPress={() => {
                          setActiveCategoryMenu(item as CatalogueCategory);
                        }}>
                        <Text style={styles.categoryItemActionText}>⋮</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              }}
            />

            <View style={styles.sheetFooter}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Add new category"
                style={styles.sheetActionBtn}
                onPress={openAddCategoryModal}>
                <Text style={styles.sheetActionBtnText}>+ Add Category</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* =========================================================================
          BOTTOM SHEET: CATEGORY ITEM ACTION MENU (EDIT / DELETE)
          ========================================================================= */}
      <Modal
        visible={!!activeCategoryMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveCategoryMenu(null)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setActiveCategoryMenu(null)}>
          <View
            style={styles.bottomSheetCard}
            onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{flex: 1, paddingRight: 8}}>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {activeCategoryMenu?.name}
                </Text>
                <Text style={styles.sheetSubtitle}>Category Actions</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close category actions"
                onPress={() => setActiveCategoryMenu(null)}>
                <AppIcon name="close" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            {activeCategoryMenu ? (
              <View style={styles.actionMenuList}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Edit category"
                  style={styles.actionMenuItem}
                  onPress={() => openEditCategoryModal(activeCategoryMenu)}>
                  <AppIcon name="edit" size={18} color="#475569" />
                  <View style={{flex: 1}}>
                    <Text style={styles.actionMenuLabel}>Edit category</Text>
                    <Text style={styles.actionMenuSub}>Change category name & description</Text>
                  </View>
                  <Text style={styles.actionMenuArrow}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Delete category"
                  style={[styles.actionMenuItem, styles.actionMenuItemBorderNone]}
                  onPress={() => handleDeleteCategoryClick(activeCategoryMenu)}>
                  <AppIcon name="trash" size={18} color="#DC2626" />
                  <View style={{flex: 1}}>
                    <Text style={[styles.actionMenuLabel, styles.textDanger]}>Delete category</Text>
                    <Text style={styles.actionMenuSub}>Remove category from active list</Text>
                  </View>
                  <Text style={styles.actionMenuArrow}>›</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* =========================================================================
          MODAL: DELETE CATEGORY CONFIRMATION
          ========================================================================= */}
      <Modal
        visible={!!categoryDeleteCandidate}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryDeleteCandidate(null)}>
        <View style={styles.centerModalBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Delete category?</Text>
            <Text style={styles.dialogSubtitle}>
              This category will be removed from the active catalogue.
            </Text>

            <View style={styles.dialogActionsRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel category deletion"
                style={styles.dialogCancelBtn}
                onPress={() => setCategoryDeleteCandidate(null)}>
                <Text style={styles.dialogCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Confirm delete category"
                style={styles.dialogConfirmBtn}
                onPress={handleConfirmDeleteCategory}>
                <Text style={styles.dialogConfirmBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          MODAL: CATEGORY DELETION BLOCKED DIALOG (Services exist)
          ========================================================================= */}
      <Modal
        visible={!!categoryBlockedDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryBlockedDialog(null)}>
        <View style={styles.centerModalBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Cannot delete this category</Text>
            <Text style={styles.dialogSubtitle}>
              {categoryBlockedDialog?.count} {categoryBlockedDialog?.count === 1 ? 'service is' : 'services are'} currently assigned to "{categoryBlockedDialog?.name}".
              {'\n\n'}Move or delete those services first.
            </Text>

            <View style={styles.dialogActionsRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close blocked category dialog"
                style={[styles.dialogConfirmBtn, {backgroundColor: '#2563EB'}]}
                onPress={() => setCategoryBlockedDialog(null)}>
                <Text style={styles.dialogConfirmBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          BOTTOM SHEET: SERVICE ACTION OVERFLOW MENU
          ========================================================================= */}
      <Modal
        visible={!!activeActionService}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveActionService(null)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setActiveActionService(null)}>
          <View
            style={styles.bottomSheetCard}
            onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{flex: 1, paddingRight: 8}}>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {activeActionService?.name}
                </Text>
                <Text style={styles.sheetSubtitle}>Service Actions</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close actions"
                onPress={() => setActiveActionService(null)}>
                <AppIcon name="close" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            {activeActionService ? (
              <View style={styles.actionMenuList}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Edit service"
                  style={styles.actionMenuItem}
                  onPress={() => openEditServiceModal(activeActionService)}>
                  <AppIcon name="edit" size={18} color="#475569" />
                  <View style={{flex: 1}}>
                    <Text style={styles.actionMenuLabel}>Edit service</Text>
                    <Text style={styles.actionMenuSub}>Change name, category, unit, details</Text>
                  </View>
                  <Text style={styles.actionMenuArrow}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Set service price"
                  style={styles.actionMenuItem}
                  onPress={() => openPriceModal(activeActionService)}>
                  <AppIcon name="tag" size={18} color="#475569" />
                  <View style={{flex: 1}}>
                    <Text style={styles.actionMenuLabel}>Set price</Text>
                    <Text style={styles.actionMenuSub}>Update global or facility rate</Text>
                  </View>
                  <Text style={styles.actionMenuArrow}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Package eligibility"
                  style={styles.actionMenuItem}
                  onPress={() => openPackageEligibilityModal(activeActionService)}>
                  <AppIcon name="box" size={18} color="#475569" />
                  <View style={{flex: 1}}>
                    <Text style={styles.actionMenuLabel}>Package eligibility</Text>
                    <Text style={styles.actionMenuSub}>Link customer packages</Text>
                  </View>
                  <Text style={styles.actionMenuArrow}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={
                    activeActionService.is_active ? 'Deactivate service' : 'Activate service'
                  }
                  style={styles.actionMenuItem}
                  onPress={() => handleToggleServiceStatus(activeActionService)}>
                  <AppIcon
                    name={activeActionService.is_active ? 'pause' : 'play'}
                    size={18}
                    color={activeActionService.is_active ? '#D97706' : '#059669'}
                  />
                  <View style={{flex: 1}}>
                    <Text
                      style={[
                        styles.actionMenuLabel,
                        activeActionService.is_active ? styles.textWarning : styles.textSuccess,
                      ]}>
                      {activeActionService.is_active ? 'Deactivate service' : 'Activate service'}
                    </Text>
                    <Text style={styles.actionMenuSub}>
                      {activeActionService.is_active
                        ? 'Temporarily hide from customer catalogue'
                        : 'Make visible to customers'}
                    </Text>
                  </View>
                  <Text style={styles.actionMenuArrow}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Delete service"
                  style={[styles.actionMenuItem, styles.actionMenuItemBorderNone]}
                  onPress={() => handleDeleteServiceClick(activeActionService)}>
                  <AppIcon name="trash" size={18} color="#DC2626" />
                  <View style={{flex: 1}}>
                    <Text style={[styles.actionMenuLabel, styles.textDanger]}>Delete service</Text>
                    <Text style={styles.actionMenuSub}>Remove this service from catalogue</Text>
                  </View>
                  <Text style={styles.actionMenuArrow}>›</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* =========================================================================
          MODAL: DEACTIVATE CONFIRMATION
          ========================================================================= */}
      <Modal
        visible={!!deactivateConfirmService}
        transparent
        animationType="fade"
        onRequestClose={() => setDeactivateConfirmService(null)}>
        <View style={styles.centerModalBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Deactivate service?</Text>
            <Text style={styles.dialogSubtitle}>
              Customers will no longer be able to use this service.
            </Text>

            <View style={styles.dialogActionsRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel deactivation"
                style={styles.dialogCancelBtn}
                onPress={() => setDeactivateConfirmService(null)}>
                <Text style={styles.dialogCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Confirm deactivate service"
                style={styles.dialogConfirmBtn}
                onPress={handleConfirmDeactivate}>
                <Text style={styles.dialogConfirmBtnText}>Deactivate</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          MODAL: DELETE SERVICE CONFIRMATION
          ========================================================================= */}
      <Modal
        visible={!!deleteConfirmService}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmService(null)}>
        <View style={styles.centerModalBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Delete service?</Text>
            <Text style={styles.dialogSubtitle}>
              This service will no longer be available in the catalogue.
            </Text>

            <View style={styles.dialogActionsRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel service deletion"
                style={styles.dialogCancelBtn}
                onPress={() => setDeleteConfirmService(null)}>
                <Text style={styles.dialogCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Confirm delete service"
                style={styles.dialogConfirmBtn}
                onPress={handleConfirmDeleteService}>
                <Text style={styles.dialogConfirmBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          MODAL: ADD / EDIT SERVICE
          ========================================================================= */}
      <Modal
        visible={serviceModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setServiceModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {formCategoryPickerOpen
                  ? 'Select Category'
                  : editingService
                  ? 'Edit Service'
                  : 'Add New Service'}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={
                  formCategoryPickerOpen ? 'Close category selector' : 'Close service modal'
                }
                onPress={() => {
                  if (formCategoryPickerOpen) {
                    setFormCategoryPickerOpen(false);
                  } else {
                    setServiceModalOpen(false);
                  }
                }}>
                <AppIcon name="close" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            {formCategoryPickerOpen ? (
              <View style={styles.serviceCategoryPickerContainer}>
                {/* Category Search in Service Form */}
                <View style={styles.categorySheetSearchWrap}>
                  <TextInput
                    accessibilityLabel="Search categories"
                    style={styles.categorySheetSearchInput}
                    placeholder="Search categories..."
                    placeholderTextColor="#94A3B8"
                    value={serviceCategorySearchQuery}
                    onChangeText={setServiceCategorySearchQuery}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {serviceCategorySearchQuery ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Clear category search"
                      style={styles.sheetSearchClearBtn}
                      onPress={() => setServiceCategorySearchQuery('')}>
                      <AppIcon name="close" size={14} color="#94A3B8" />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* All Available Categories List */}
                <FlatList
                  data={serviceFormCategoryOptions}
                  keyExtractor={item => item.id}
                  keyboardShouldPersistTaps="handled"
                  style={styles.serviceCategoryPickerList}
                  contentContainerStyle={styles.serviceCategoryPickerListContent}
                  ListEmptyComponent={
                    <View style={styles.categoryPickerEmptyWrap}>
                      <Text style={styles.categoryPickerEmptyText}>
                        {serviceCategorySearchQuery
                          ? `No categories matching "${serviceCategorySearchQuery}"`
                          : 'No categories available'}
                      </Text>
                    </View>
                  }
                  renderItem={({item}) => {
                    const isSelected = serviceCategoryId === item.id;
                    return (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Choose category ${item.name}`}
                        style={[
                          styles.serviceCategoryPickerItem,
                          isSelected && styles.serviceCategoryPickerItemActive,
                        ]}
                        onPress={() => {
                          setServiceCategoryId(item.id);
                          setFormCategoryPickerOpen(false);
                        }}>
                        <View style={styles.serviceCategoryPickerItemLeft}>
                          <Text
                            style={[
                              styles.serviceCategoryPickerItemText,
                              isSelected && styles.serviceCategoryPickerItemTextActive,
                            ]}
                            numberOfLines={1}>
                            {item.name}
                          </Text>
                          {!item.is_active ? (
                            <View style={styles.inactiveBadgeSmall}>
                              <Text style={styles.inactiveBadgeSmallText}>Inactive</Text>
                            </View>
                          ) : null}
                        </View>
                        {isSelected ? (
                          <AppIcon name="check" size={16} color="#059669" />
                        ) : null}
                      </TouchableOpacity>
                    );
                  }}
                />

                <View style={styles.sheetFooter}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Back to service form"
                    style={styles.sheetActionBtn}
                    onPress={() => setFormCategoryPickerOpen(false)}>
                    <Text style={styles.sheetActionBtnText}>Back to Form</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <FlatList
                  data={[1]}
                  keyExtractor={() => 'form'}
                  style={styles.modalBodyScroll}
                  renderItem={() => (
                    <View style={styles.formContainer}>
                      {/* Service Name */}
                      <View style={styles.formGroup}>
                        <Text style={styles.inputLabel}>Service name *</Text>
                        <TextInput
                          accessibilityLabel="Service name"
                          style={[styles.textInput, serviceFieldErrors.name && styles.inputErrorBorder]}
                          value={serviceName}
                          onChangeText={setServiceName}
                          placeholder="e.g. Antibacterial Wash"
                          placeholderTextColor="#94A3B8"
                        />
                        {serviceFieldErrors.name ? (
                          <Text style={styles.inputErrorText}>{serviceFieldErrors.name}</Text>
                        ) : null}
                      </View>

                      {/* Category Selection Trigger */}
                      <View style={styles.formGroup}>
                        <Text style={styles.inputLabel}>Category *</Text>
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Selected Category: ${formSelectedCategoryName}`}
                          style={styles.formCategoryTrigger}
                          onPress={() => {
                            setServiceCategorySearchQuery('');
                            setFormCategoryPickerOpen(true);
                          }}>
                          <Text style={styles.formCategoryTriggerText} numberOfLines={1}>
                            {formSelectedCategoryName}
                          </Text>
                          <Text style={styles.dropdownChevron}>›</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Pricing Unit */}
                      <View style={styles.formGroup}>
                        <Text style={styles.inputLabel}>Pricing unit *</Text>
                        <View style={styles.unitQuickChips}>
                          {COMMON_UNITS.map(u => (
                            <TouchableOpacity
                              accessibilityRole="button"
                              accessibilityLabel={`Unit ${u}`}
                              key={u}
                              style={[
                                styles.unitQuickChip,
                                servicePricingUnit === u && styles.unitQuickChipActive,
                              ]}
                              onPress={() => setServicePricingUnit(u)}>
                              <Text
                                style={[
                                  styles.unitQuickChipText,
                                  servicePricingUnit === u && styles.unitQuickChipTextActive,
                                ]}>
                                {u}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TextInput
                          accessibilityLabel="Pricing unit"
                          style={[
                            styles.textInput,
                            {marginTop: 8},
                            serviceFieldErrors.unit && styles.inputErrorBorder,
                          ]}
                          value={servicePricingUnit}
                          onChangeText={setServicePricingUnit}
                          placeholder="Custom unit: piece, pair, kg..."
                          placeholderTextColor="#94A3B8"
                        />
                        {serviceFieldErrors.unit ? (
                          <Text style={styles.inputErrorText}>{serviceFieldErrors.unit}</Text>
                        ) : null}
                      </View>

                      {/* Description */}
                      <View style={styles.formGroup}>
                        <Text style={styles.inputLabel}>Description</Text>
                        <TextInput
                          accessibilityLabel="Service description"
                          style={[styles.textInput, {height: 80, textAlignVertical: 'top'}]}
                          value={serviceDescription}
                          onChangeText={setServiceDescription}
                          placeholder="Optional service details and garment care guidelines..."
                          placeholderTextColor="#94A3B8"
                          multiline
                        />
                      </View>

                      {/* Initial Global Price */}
                      <View style={styles.formGroup}>
                        <Text style={styles.inputLabel}>Global Price (₹)</Text>
                        <TextInput
                          accessibilityLabel="Initial price"
                          style={styles.textInput}
                          value={serviceInitialPrice}
                          onChangeText={setServiceInitialPrice}
                          placeholder="e.g. 30"
                          placeholderTextColor="#94A3B8"
                          keyboardType="decimal-pad"
                        />
                        <Text style={styles.fieldHelper}>
                          Applies to all facilities without custom pricing.
                        </Text>
                      </View>
                    </View>
                  )}
                />

                <View style={styles.modalFooter}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Cancel service creation"
                    style={styles.modalCancelBtn}
                    onPress={() => setServiceModalOpen(false)}>
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={editingService ? 'Save changes' : 'Add Service'}
                    disabled={saving || !serviceName.trim() || !servicePricingUnit.trim()}
                    style={[
                      styles.modalSubmitBtn,
                      (saving || !serviceName.trim() || !servicePricingUnit.trim()) &&
                        styles.btnDisabled,
                    ]}
                    onPress={handleSaveService}>
                    <Text style={styles.modalSubmitBtnText}>
                      {saving
                        ? 'Saving...'
                        : editingService
                        ? 'Save changes'
                        : 'Add Service'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =========================================================================
          MODAL: SET FUTURE SERVICE PRICE
          ========================================================================= */}
      <Modal
        visible={priceModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPriceModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{flex: 1, paddingRight: 8}}>
                <Text style={styles.sheetTitle}>Set Service Price</Text>
                <Text style={styles.sheetSubtitle} numberOfLines={1}>{pricingService?.name}</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close price modal"
                onPress={() => setPriceModalOpen(false)}>
                <AppIcon name="close" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBodyPadding}>
              {priceError ? (
                <View style={styles.alertError}>
                  <Text style={styles.alertErrorText}>{priceError}</Text>
                </View>
              ) : null}

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Price in Rupees (₹) *</Text>
                <TextInput
                  accessibilityLabel="Service price"
                  style={styles.textInput}
                  value={newPrice}
                  onChangeText={setNewPrice}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 75"
                  placeholderTextColor="#94A3B8"
                  autoFocus
                />
                <Text style={styles.fieldHelper}>
                  Past order prices remain preserved. New pricing applies to future orders.
                </Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Price Scope</Text>
                <View style={styles.facilityRadioWrap}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Scope: Global all facilities"
                    style={[
                      styles.facilityRadioChip,
                      priceFacilityId === '' && styles.facilityRadioChipActive,
                    ]}
                    onPress={() => setPriceFacilityId('')}>
                    <Text
                      style={[
                        styles.facilityRadioChipText,
                        priceFacilityId === '' && styles.facilityRadioChipTextActive,
                      ]}>
                      Global (All Facilities)
                    </Text>
                  </TouchableOpacity>
                  {facilities.map(f => (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Scope: ${f.name}`}
                      key={f.id}
                      style={[
                        styles.facilityRadioChip,
                        priceFacilityId === f.id && styles.facilityRadioChipActive,
                      ]}
                      onPress={() => setPriceFacilityId(f.id)}>
                      <Text
                        style={[
                          styles.facilityRadioChipText,
                          priceFacilityId === f.id && styles.facilityRadioChipTextActive,
                        ]}>
                        {f.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel price update"
                style={styles.modalCancelBtn}
                onPress={() => setPriceModalOpen(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Save new price"
                disabled={saving || !newPrice.trim()}
                style={[
                  styles.modalSubmitBtn,
                  (saving || !newPrice.trim()) && styles.btnDisabled,
                ]}
                onPress={handleSavePrice}>
                <Text style={styles.modalSubmitBtnText}>
                  {saving ? 'Saving...' : 'Save new price'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =========================================================================
          MODAL: ADD / EDIT CATEGORY
          ========================================================================= */}
      <Modal
        visible={categoryModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCategoryModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close category modal"
                onPress={() => setCategoryModalOpen(false)}>
                <AppIcon name="close" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBodyPadding}>
              {categoryError ? (
                <View style={styles.alertError}>
                  <Text style={styles.alertErrorText}>{categoryError}</Text>
                </View>
              ) : null}

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Category name *</Text>
                <TextInput
                  accessibilityLabel="Category name"
                  style={styles.textInput}
                  value={categoryName}
                  onChangeText={setCategoryName}
                  placeholder="e.g. Dry Cleaning, Add-On Services..."
                  placeholderTextColor="#94A3B8"
                  autoFocus
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Description</Text>
                <TextInput
                  accessibilityLabel="Category description"
                  style={[styles.textInput, {height: 80, textAlignVertical: 'top'}]}
                  value={categoryDescription}
                  onChangeText={setCategoryDescription}
                  placeholder="Optional category description..."
                  placeholderTextColor="#94A3B8"
                  multiline
                />
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel category edit"
                style={styles.modalCancelBtn}
                onPress={() => setCategoryModalOpen(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={editingCategory ? 'Save changes' : 'Add Category'}
                disabled={saving || !categoryName.trim()}
                style={[
                  styles.modalSubmitBtn,
                  (saving || !categoryName.trim()) && styles.btnDisabled,
                ]}
                onPress={handleSaveCategory}>
                <Text style={styles.modalSubmitBtnText}>
                  {saving
                    ? 'Saving...'
                    : editingCategory
                    ? 'Save changes'
                    : 'Add Category'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =========================================================================
          MODAL: PACKAGE ELIGIBILITY
          ========================================================================= */}
      <Modal
        visible={packageModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPackageModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{flex: 1, paddingRight: 8}}>
                <Text style={styles.sheetTitle}>Package Eligibility</Text>
                <Text style={styles.sheetSubtitle} numberOfLines={1}>{eligibilityService?.name}</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close package eligibility modal"
                onPress={() => setPackageModalOpen(false)}>
                <AppIcon name="close" size={16} color="#64748B" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={data?.packages || []}
              keyExtractor={pkg => pkg.id}
              style={{maxHeight: 360, width: '100%', paddingHorizontal: 16}}
              ListEmptyComponent={
                <Text style={styles.emptyActivityText}>No active packages configured.</Text>
              }
              renderItem={({item: pkg}) => {
                const current = data?.packageEligibility?.find(
                  pe => pe.package_id === pkg.id && pe.service_id === eligibilityService?.id,
                );
                const isEligible = !!current;

                return (
                  <View style={styles.packageEligibilityRow}>
                    <View style={{flex: 1, paddingRight: 8}}>
                      <Text style={styles.packageNameText} numberOfLines={1}>{pkg.name}</Text>
                      <Text style={styles.packageStatusText}>
                        {isEligible
                          ? `Eligible · Limit: ${current?.usage_limit ?? 'Unlimited'}`
                          : 'Not eligible'}
                        {pkg.isLocked ? ' · Locked' : ''}
                      </Text>
                    </View>

                    {!pkg.isLocked ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`${isEligible ? 'Remove' : 'Add'} package ${pkg.name}`}
                        style={[
                          styles.packageToggleBtn,
                          isEligible
                            ? styles.packageToggleBtnRemove
                            : styles.packageToggleBtnAdd,
                        ]}
                        onPress={() => handleTogglePackageEligibility(pkg.id, isEligible)}>
                        <Text
                          style={[
                            styles.packageToggleBtnText,
                            isEligible ? styles.textDanger : styles.textSuccess,
                          ]}>
                          {isEligible ? 'Remove' : 'Add'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              }}
            />

            <View style={styles.modalFooter}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Done"
                style={styles.modalSubmitBtn}
                onPress={() => setPackageModalOpen(false)}>
                <Text style={styles.modalSubmitBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  mainWrapper: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  flatListStyle: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  listContentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    width: '100%',
    maxWidth: '100%',
  },
  listHeaderContainer: {
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
    width: '100%',
    maxWidth: '100%',
  },

  // Top Navigation & Header
  topNavigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    maxWidth: '100%',
    marginBottom: 4,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#344054',
  },
  headerAddBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    shadowColor: '#2563EB',
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 1},
    elevation: 2,
  },
  headerAddBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },

  // Page Header
  pageHeader: {
    gap: 2,
    width: '100%',
    maxWidth: '100%',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#172033',
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#667085',
  },

  // Search Field
  searchContainer: {
    width: '100%',
    maxWidth: '100%',
    height: 48,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
    alignSelf: 'stretch',
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 8,
    color: '#667085',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontSize: 15,
    color: '#172033',
    paddingVertical: 0,
  },
  clearSearchBtn: {
    padding: 6,
  },
  clearSearchIcon: {
    fontSize: 14,
    color: '#98A2B3',
    fontWeight: '600',
  },

  // Category Filter Trigger & Header
  categoryFilterBlock: {
    gap: 6,
    width: '100%',
    maxWidth: '100%',
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    maxWidth: '100%',
  },
  filterSectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#344054',
  },
  addCategoryLinkBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  addCategoryLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
  categoryDropdownTrigger: {
    width: '100%',
    maxWidth: '100%',
    height: 46,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    alignSelf: 'stretch',
  },
  categoryDropdownText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#172033',
    flex: 1,
    minWidth: 0,
  },
  dropdownChevron: {
    fontSize: 18,
    color: '#667085',
    marginLeft: 8,
  },

  // Category Sheet Search
  categorySheetSearchWrap: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: '100%',
    maxWidth: '100%',
  },
  categorySheetSearchInput: {
    height: 44,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#172033',
    width: '100%',
    maxWidth: '100%',
  },

  // Status Filter (Segmented Control)
  statusSegment: {
    flexDirection: 'row',
    backgroundColor: '#EAECF0',
    borderRadius: 10,
    padding: 3,
    height: 42,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  statusSegmentBtn: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  statusSegmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
    elevation: 2,
  },
  statusSegmentText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#667085',
  },
  statusSegmentTextActive: {
    fontWeight: '700',
    color: '#172033',
  },

  // Result Count Row
  resultCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    width: '100%',
    maxWidth: '100%',
  },
  resultCountText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#667085',
  },
  clearFiltersLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },

  // Service Card
  card: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
    maxWidth: '100%',
  },
  cardHeaderLeft: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    paddingRight: 8,
  },
  serviceName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#172033',
    lineHeight: 22,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  categoryName: {
    fontSize: 13,
    color: '#667085',
    marginTop: 2,
    flexShrink: 1,
  },
  cardDescription: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 6,
    lineHeight: 18,
    flexShrink: 1,
  },

  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  statusBadgeActive: {
    backgroundColor: '#ECFDF5',
  },
  statusBadgeInactive: {
    backgroundColor: '#F1F5F9',
  },
  statusDot: {
    fontSize: 8,
  },
  statusDotActive: {
    color: '#10B981',
  },
  statusDotInactive: {
    color: '#94A3B8',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTextActive: {
    color: '#065F46',
  },
  statusTextInactive: {
    color: '#64748B',
  },

  // Price & Package Meta Row
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F2F4F7',
    width: '100%',
    maxWidth: '100%',
    flexWrap: 'wrap',
    gap: 8,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#172033',
  },
  priceUnit: {
    fontSize: 13,
    fontWeight: '400',
    color: '#667085',
  },
  packageTag: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    flexShrink: 0,
  },
  packageText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475467',
  },

  // Card Action Buttons
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F2F4F7',
    width: '100%',
    maxWidth: '100%',
  },
  editBtn: {
    flex: 1,
    minWidth: 0,
    height: 44,
    marginRight: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#344054',
  },
  overflowBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overflowBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#344054',
  },

  // Skeleton States
  skeletonContainer: {
    gap: 12,
    marginTop: 16,
    width: '100%',
    maxWidth: '100%',
  },
  skeletonCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    width: '100%',
    maxWidth: '100%',
  },
  skeletonHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: '100%',
  },
  skeletonLine: {
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
  },
  skeletonActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F2F4F7',
    width: '100%',
    maxWidth: '100%',
  },
  loadingWrapper: {
    paddingHorizontal: 16,
    paddingTop: 12,
    width: '100%',
    maxWidth: '100%',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    marginTop: 8,
    width: '100%',
    maxWidth: '100%',
  },
  emptyStateIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyStateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#172033',
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#667085',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 280,
  },
  emptyStateBtn: {
    marginTop: 16,
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyStateBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },

  // Footer Accordions
  footerContainer: {
    marginTop: 16,
    gap: 12,
    width: '100%',
    maxWidth: '100%',
  },
  footerAccordionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    overflow: 'hidden',
    width: '100%',
    maxWidth: '100%',
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    width: '100%',
    maxWidth: '100%',
  },
  accordionHeaderLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  accordionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#172033',
  },
  accordionSubtitle: {
    fontSize: 13,
    color: '#667085',
    marginTop: 2,
  },
  accordionChevron: {
    fontSize: 12,
    color: '#667085',
  },
  accordionContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#F2F4F7',
    paddingTop: 12,
    gap: 12,
    width: '100%',
    maxWidth: '100%',
  },

  // Form Fields
  formContainer: {
    padding: 16,
    gap: 16,
    width: '100%',
    maxWidth: '100%',
  },
  formGroup: {
    gap: 6,
    width: '100%',
    maxWidth: '100%',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#344054',
  },
  textInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#172033',
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: '100%',
  },
  inputErrorBorder: {
    borderColor: '#EF4444',
  },
  inputErrorText: {
    fontSize: 12,
    color: '#DC2626',
  },
  fieldHelper: {
    fontSize: 12,
    color: '#667085',
  },
  inputWithAdornment: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    height: 48,
    width: '100%',
    maxWidth: '100%',
  },
  adornmentText: {
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '600',
    color: '#667085',
  },
  adornmentInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontSize: 15,
    color: '#172033',
    paddingHorizontal: 8,
  },
  savePolicyBtn: {
    backgroundColor: '#2563EB',
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    width: '100%',
    maxWidth: '100%',
  },
  savePolicyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },

  // Category Selector in Form
  formCategoryTrigger: {
    width: '100%',
    maxWidth: '100%',
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  formCategoryTriggerText: {
    fontSize: 15,
    color: '#172033',
    fontWeight: '500',
    flex: 1,
    minWidth: 0,
  },
  serviceCategoryPickerContainer: {
    width: '100%',
    maxWidth: '100%',
  },
  serviceCategoryPickerList: {
    maxHeight: 320,
    width: '100%',
    maxWidth: '100%',
  },
  serviceCategoryPickerListContent: {
    paddingBottom: 12,
  },
  serviceCategoryPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F4F7',
    width: '100%',
    maxWidth: '100%',
  },
  serviceCategoryPickerItemActive: {
    backgroundColor: '#EFF6FF',
  },
  serviceCategoryPickerItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  serviceCategoryPickerItemText: {
    fontSize: 15,
    color: '#344054',
    fontWeight: '500',
    flexShrink: 1,
  },
  serviceCategoryPickerItemTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  serviceCategoryPickerCheckmark: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2563EB',
    marginLeft: 8,
  },
  categoryPickerEmptyWrap: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryPickerEmptyText: {
    fontSize: 14,
    color: '#667085',
  },
  inactiveBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#FEF3F2',
  },
  inactiveBadgeSmallText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B42318',
  },
  sheetSearchClearBtn: {
    padding: 6,
  },
  sheetSearchClearText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
  },

  // Unit quick chips
  unitQuickChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    width: '100%',
    maxWidth: '100%',
  },
  unitQuickChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  unitQuickChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  unitQuickChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#475467',
  },
  unitQuickChipTextActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },

  // Facility Scope Chips
  facilityRadioWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
    maxWidth: '100%',
  },
  facilityRadioChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  facilityRadioChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  facilityRadioChipText: {
    fontSize: 13,
    color: '#475467',
  },
  facilityRadioChipTextActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },

  // Modals & Bottom Sheets
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
    width: '100%',
    maxWidth: '100%',
  },
  centerModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    width: '100%',
    maxWidth: '100%',
  },
  bottomSheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 24,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#D0D5DD',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F4F7',
    width: '100%',
    maxWidth: '100%',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#172033',
  },
  sheetSubtitle: {
    fontSize: 13,
    color: '#667085',
    marginTop: 2,
  },
  modalCloseBtn: {
    fontSize: 18,
    color: '#667085',
    padding: 6,
  },
  modalBodyScroll: {
    maxHeight: 460,
    width: '100%',
    maxWidth: '100%',
  },
  modalBodyPadding: {
    padding: 16,
    gap: 16,
    width: '100%',
    maxWidth: '100%',
  },
  modalFooter: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F2F4F7',
    width: '100%',
    maxWidth: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    minWidth: 0,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  modalCancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#344054',
  },
  modalSubmitBtn: {
    flex: 1.5,
    minWidth: 0,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSubmitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // Category Selector Sheet Options
  categoryOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F4F7',
    width: '100%',
    maxWidth: '100%',
  },
  categoryOptionRowSelected: {
    backgroundColor: '#F8FAFC',
  },
  categoryOptionSelectPressable: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
    marginRight: 8,
  },
  categoryOptionTextWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  categoryOptionName: {
    fontSize: 15,
    color: '#344054',
    fontWeight: '500',
    flexShrink: 1,
  },
  categoryOptionNameSelected: {
    color: '#2563EB',
    fontWeight: '700',
  },
  categoryOptionCount: {
    fontSize: 13,
    color: '#667085',
    marginLeft: 6,
    flexShrink: 0,
  },
  categoryItemActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#F2F4F7',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  categoryItemActionText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#475467',
  },
  sheetFooter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    width: '100%',
    maxWidth: '100%',
  },
  sheetActionBtn: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxWidth: '100%',
  },
  sheetActionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563EB',
  },

  // Action Menu Overflow
  actionMenuList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    width: '100%',
    maxWidth: '100%',
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F4F7',
    gap: 12,
    width: '100%',
    maxWidth: '100%',
  },
  actionMenuItemBorderNone: {
    borderBottomWidth: 0,
  },
  actionMenuIcon: {
    fontSize: 20,
    flexShrink: 0,
  },
  actionMenuLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#172033',
  },
  actionMenuSub: {
    fontSize: 12,
    color: '#667085',
    marginTop: 2,
  },
  actionMenuArrow: {
    fontSize: 18,
    color: '#98A2B3',
    flexShrink: 0,
  },

  // Deactivate & Delete Confirmation Dialog
  dialogCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    alignSelf: 'center',
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#172033',
  },
  dialogSubtitle: {
    fontSize: 14,
    color: '#667085',
    marginTop: 8,
    lineHeight: 20,
  },
  dialogActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    width: '100%',
    maxWidth: '100%',
  },
  dialogCancelBtn: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialogCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#344054',
  },
  dialogConfirmBtn: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialogConfirmBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Package Eligibility Row
  packageEligibilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F4F7',
    width: '100%',
    maxWidth: '100%',
  },
  packageNameText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#172033',
  },
  packageStatusText: {
    fontSize: 12,
    color: '#667085',
    marginTop: 2,
  },
  packageToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    minHeight: 36,
    justifyContent: 'center',
    flexShrink: 0,
  },
  packageToggleBtnAdd: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  packageToggleBtnRemove: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  packageToggleBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },

  // Activity list
  activityList: {
    gap: 10,
    width: '100%',
    maxWidth: '100%',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    maxWidth: '100%',
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    flexShrink: 0,
  },
  activityContent: {
    flex: 1,
    minWidth: 0,
  },
  activityAction: {
    fontSize: 13,
    fontWeight: '600',
    color: '#172033',
  },
  activityTime: {
    fontSize: 11,
    color: '#667085',
  },
  emptyActivityText: {
    fontSize: 13,
    color: '#667085',
    textAlign: 'center',
    paddingVertical: 8,
  },

  // Alerts
  alertError: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  alertErrorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    minWidth: 0,
  },
  alertRetryBtn: {
    backgroundColor: '#DC2626',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexShrink: 0,
  },
  alertRetryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  alertSuccess: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: '100%',
  },
  alertSuccessText: {
    color: '#065F46',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    minWidth: 0,
  },
  alertDismissText: {
    color: '#065F46',
    fontSize: 14,
    fontWeight: '700',
    padding: 4,
    flexShrink: 0,
  },

  // Utility colors
  textGreen: {
    color: '#10B981',
  },
  textSuccess: {
    color: '#059669',
  },
  textWarning: {
    color: '#D97706',
  },
  textDanger: {
    color: '#DC2626',
  },
});
