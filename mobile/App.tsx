import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {useSessionBootstrap} from './src/hooks/useSessionBootstrap';
import {assertSafeMobileConfiguration} from './src/config/environment';
import {clearOrderAttempt, loadOrderAttempt, saveOrderAttempt} from './src/services/orderAttemptStorage';

import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';

import {
  NavigationContainer,
  createNavigationContainerRef,
  LinkingOptions,
} from '@react-navigation/native';

import {
  createNativeStackNavigator,
} from '@react-navigation/native-stack';

import WelcomeScreen from './src/screens/WelcomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import DriverLoginScreen from './src/screens/DriverLoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import OtpScreen from './src/screens/OtpScreen';
import HomeScreen from './src/screens/HomeScreen';
import CategoryScreen from './src/screens/CategoryScreen';
import CartScreen from './src/screens/CartScreen';
import AddressScreen from './src/screens/AddressScreen';
import AddressFormScreen from './src/screens/AddressFormScreen';
import LocationPickerScreen from './src/screens/LocationPickerScreen';
import PickupSlotScreen from './src/screens/PickupSlotScreen';
import OrderReviewScreen from './src/screens/OrderReviewScreen';
import PaymentScreen from './src/screens/PaymentScreen';
import OrderSuccessScreen from './src/screens/OrderSuccessScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import OrderDetailsScreen from './src/screens/OrderDetailsScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import BenefitsScreen from './src/screens/BenefitsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import DriverProfileScreen from './src/screens/DriverProfileScreen';
import DriverDashboardScreen from './src/screens/DriverDashboardScreen';
import FacilityDashboardScreen from './src/screens/FacilityDashboardScreen';
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';
import AdminCustomersScreen from './src/screens/AdminCustomersScreen';
import AdminCustomerDetailScreen from './src/screens/AdminCustomerDetailScreen';
import AdminOrderDetailScreen from './src/screens/AdminOrderDetailScreen';
import AdminIssuesScreen from './src/screens/AdminIssuesScreen';
import AdminIssueDetailScreen from './src/screens/AdminIssueDetailScreen';
import AdminGrowthScreen from './src/screens/AdminGrowthScreen';
import AdminFacilityOversightScreen from './src/screens/AdminFacilityOversightScreen';
import AdminReportsScreen from './src/screens/AdminReportsScreen';
import AdminStaffScreen from './src/screens/AdminStaffScreen';
import AdminStaffDetailScreen from './src/screens/AdminStaffDetailScreen';
import AdminAssignmentsScreen from './src/screens/AdminAssignmentsScreen';
import AdminCatalogueScreen from './src/screens/AdminCatalogueScreen';
import AdminLocationsScreen from './src/screens/AdminLocationsScreen';
import FacilityIntakeScreen from './src/screens/FacilityIntakeScreen';
import FacilityVerificationScreen from './src/screens/FacilityVerificationScreen';
import DriverNotificationsScreen from './src/screens/DriverNotificationsScreen';
import DriverJobDetailScreen from './src/screens/DriverJobDetailScreen';
import {stopDriverTripBackground} from './src/services/driverTripBackground';
import {accountRoleFromProfile} from './src/services/driverProfileApi';
import {customerNameFromProfile} from './src/services/profileApi';
import SupportScreen from './src/screens/SupportScreen';
import ReceiptScreen from './src/screens/ReceiptScreen';
import AccountScreen from './src/screens/AccountScreen';
import CustomerTabFrame from './src/components/CustomerTabFrame';
import type {CreateOrderInput, CustomerOrder} from './src/types/order';
import {buildReorderPlan} from './src/utils/reorder';
import {normalizePhone} from './src/utils/contactValidation';
import type {CustomerPackage} from './src/services/packagesApi';
import {packageDiscount} from './src/utils/packagePricing';
import type {CouponResult} from './src/services/growthApi';

import {
  calculateCheckoutPricing,
} from './src/utils/orderPricing';
import type {CheckoutPricingPolicy} from './src/utils/orderPricing';

import type {
  RootStackParamList,
} from './src/navigation/types';

import type {
  ServiceCategory,
  ServiceItem,
} from './src/types/service';

import type {
  PickupSlot,
} from './src/hooks/usePickupSchedule';

import type {
  SelectedLocation,
} from './src/types/location';

import {
  useCart,
} from './src/hooks/useCart';

import {
  usePickupSchedule,
} from './src/hooks/usePickupSchedule';

import {
  useCheckoutState,
} from './src/hooks/useCheckoutState';

import {
  useSessionState,
} from './src/hooks/useSessionState';

import {
  useAddresses,
} from './src/hooks/useAddresses';

import {
  getAccessTokenFromVerification,
  verifyPhoneOtp,
} from './src/services/authApi';

import {
  getServices,
  getCheckoutPricingPolicy,
} from './src/services/servicesApi';

import {
  createOrder as createOrderApi,
  newOrderAttemptKey,
} from './src/services/ordersApi';
import type {CreateOrderResponse} from './src/services/ordersApi';

import {
  createPaymentOrder,
  verifyPayment,
} from './src/services/paymentsApi';

import {
  openRazorpayCheckout,
  PaymentCheckoutCancelledError,
} from './src/services/razorpayCheckout';

assertSafeMobileConfiguration();

const Stack =
  createNativeStackNavigator<
    RootStackParamList
  >();

const navigationRef =
  createNavigationContainerRef<
    RootStackParamList
  >();

const linking: LinkingOptions<any> = {
  prefixes: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'brightwhite://',
  ],
  config: {
    screens: {
      ResetPassword: 'auth/reset-password',
      ForgotPassword: 'auth/forgot-password',
      Login: 'login',
      SignUp: 'signup',
      DriverLogin: 'driver/login',
    },
  },
};

const CATEGORY_ORDER = [
  'Wash & Fold',
  'Wash & Steam Iron',
  'Premium Laundry',
  'Wash & Iron',
  'Steam Ironing',
  'Dry Cleaning',
  'Household & Linen Care',
  'Shoe Cleaning',
  'Add-On Services',
];

export default function App() {
  /*
   * SESSION
   */

  const {
    phone,

    otp,
    setOtp,

    loading,
    setLoading,

    accessToken,

    hydrating,
    authenticated,

    saveSession,
    profile,
    setProfile,

    resetSession,
  } = useSessionState();

  /*
   * SERVICES
   */

  const [
    services,
    setServices,
  ] =
    useState<
      ServiceItem[]
    >([]);

  const [
    servicesLoading,
    setServicesLoading,
  ] =
    useState(false);
  const [servicesError, setServicesError] = useState('');
  const [pricingPolicy, setPricingPolicy] = useState<CheckoutPricingPolicy | undefined>();

  const [
    selectedCategory,
    setSelectedCategory,
  ] =
    useState<
      string | null
    >(null);

  /*
   * CART
   */

  const {
    cartItems,
    cartItemCount,
    cartSubtotal,
    getQuantity,
    updateQuantity,
    resetCart,
  } = useCart(
    services,
    {
      onQuoteItem:
        () => {
          Alert.alert(
            'Price after inspection',
            'This service requires inspection before the final price can be confirmed.',
          );
        },
    },
  );

  const [appliedCoupon, setAppliedCoupon] = useState<CouponResult | null>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [facilityRefresh, setFacilityRefresh] = useState(0);
  const [selectedPackage, setSelectedPackage] = useState<CustomerPackage | null>(null);
  useEffect(() => {setAppliedCoupon(null); setLoyaltyPoints(0); setSelectedPackage(null);}, [cartSubtotal]);

  const checkoutPricing =
    useMemo(
      () =>
        calculateCheckoutPricing(
          cartSubtotal,
          Math.min(appliedCoupon?.discount ?? 0, Math.max(0, cartSubtotal - packageDiscount(selectedPackage, cartItems))) + loyaltyPoints / 100 + packageDiscount(selectedPackage, cartItems),
          pricingPolicy,
        ),
      [
      cartSubtotal,
      appliedCoupon,
      loyaltyPoints,
      selectedPackage,
      cartItems,
      pricingPolicy,
      ],
    );

  /*
   * ADDRESSES
   */

  const {
    addresses,
    addressesLoading,

    selectedAddressId,
    setSelectedAddressId,
    selectedAddress,

    editingAddressId,

    addressForm,
    setAddressForm,

    addressSaving,

    loadAddresses,

    prepareAddAddress,
    prepareEditAddress,
    cancelAddressEdit,

    saveAddress,
    makeDefaultAddress,
    deleteAddress,

    resetAddresses,
  } = useAddresses({
    accessToken,
  });

  /*
   * PICKUP
   */

  const {
    pickupDateChoices,
    pickupSlots,

    selectedPickupDateKey,
    selectedPickupSlotId,
    selectedPickupDate,

    pickupScheduledAt,
    pickupSlotLabel,

    ensureInitialPickupDate,
    choosePickupDate,
    choosePickupSlot:
      choosePickupSlotState,

    isSlotUnavailable,

    resetPickupSchedule,
  } = usePickupSchedule();

  /*
   * CHECKOUT
   */

  const {
    selectedPaymentMethod,
    setSelectedPaymentMethod,

    termsAccepted,
    setTermsAccepted,

    placingOrder,
    setPlacingOrder,

    successfulOrder,
    setSuccessfulOrder,

    resetPaymentState,
    resetOrderSuccess,
    resetCheckoutState,
  } = useCheckoutState();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const placingOrderRef = useRef(false);
  const createdOrderRef = useRef<CreateOrderResponse | null>(null);
  const orderAttemptRef = useRef<{fingerprint: string; key: string} | null>(null);

  /*
   * DERIVED SERVICES
   */

  const categories =
    useMemo<
      ServiceCategory[]
    >(
      () => {
        const map =
          new Map<
            string,
            ServiceCategory
          >();

        services.forEach(
          service => {
            if (
              !service.categoryName
            ) {
              return;
            }

            const existing =
              map.get(
                service.categoryName,
              );

            if (
              existing
            ) {
              existing.count +=
                1;

              return;
            }

            map.set(
              service.categoryName,
              {
                id:
                  service.categoryId,

                name:
                  service.categoryName,

                count:
                  1,
              },
            );
          },
        );

        return Array.from(
          map.values(),
        ).sort(
          (
            a,
            b,
          ) => {
            const aIndex =
              CATEGORY_ORDER.indexOf(
                a.name,
              );

            const bIndex =
              CATEGORY_ORDER.indexOf(
                b.name,
              );

            if (
              aIndex === -1 &&
              bIndex === -1
            ) {
              return a.name.localeCompare(
                b.name,
              );
            }

            if (
              aIndex === -1
            ) {
              return 1;
            }

            if (
              bIndex === -1
            ) {
              return -1;
            }

            return (
              aIndex -
              bIndex
            );
          },
        );
      },
      [
        services,
      ],
    );

  const selectedCategoryServices =
    useMemo(
      () => {
        if (
          !selectedCategory
        ) {
          return [];
        }

        return services.filter(
          service =>
            service.categoryName ===
            selectedCategory,
        );
      },
      [
        services,
        selectedCategory,
      ],
    );

  /*
   * SERVICE LOADING
   */

  const catalogueSession = useRef(accessToken);
  catalogueSession.current = accessToken;
  const loadServices = useCallback(async (token: string) => {
    setServicesLoading(true);
    setServicesError('');
    const isCurrent = () => catalogueSession.current === token;
    const catalogue = getServices(token).then(result => {
      if (isCurrent()) setServices(result);
    }).catch((error: unknown) => {
      if (isCurrent()) setServicesError(error instanceof Error ? error.message : 'Unable to load services');
    }).finally(() => {
      if (isCurrent()) setServicesLoading(false);
    });
    const pricing = getCheckoutPricingPolicy(token).then(result => {
      if (isCurrent()) setPricingPolicy(result);
    }).catch(() => {
      if (isCurrent()) setPricingPolicy(undefined);
    });
    await Promise.all([catalogue, pricing]);
  }, []);

  /*
   * SESSION RESTORATION
   */

  const initialSessionResolved = useSessionBootstrap({
    hydrating, authenticated, accessToken, profile, setProfile, loadServices, loadAddresses,
  });

  /*
   * NAVIGATION HELPERS
   */

  const resetToHome =
    () => {
      if (
        !navigationRef.isReady()
      ) {
        return;
      }

      navigationRef.reset({
        index: 0,
        routes: [
          {
            name: 'Home',
          },
        ],
      });
    };

  const goBack =
    () => {
      if (
        !navigationRef.isReady()
      ) {
        return;
      }

      if (
        navigationRef.canGoBack()
      ) {
        navigationRef.goBack();
      }
    };

  /*
   * PHONE
   */

  const normalizedPhone =
    () => normalizePhone(phone);

  /*
   * ADDRESS
   */

  const openAddressScreen =
    async () => {
      if (
        !accessToken
      ) {
        Alert.alert(
          'Session Error',
          'Please login again.',
        );

        return;
      }

      if (
        navigationRef.isReady()
      ) {
        navigationRef.navigate(
          'Addresses',
        );
      }

      await loadAddresses();
    };

  const openAddAddress =
    () => {
      prepareAddAddress();

      if (
        navigationRef.isReady()
      ) {
        navigationRef.navigate(
          'AddressForm',
        );
      }
    };

  const openEditAddress =
    (
      address:
        Parameters<
          typeof prepareEditAddress
        >[0],
    ) => {
      prepareEditAddress(
        address,
      );

      if (
        navigationRef.isReady()
      ) {
        navigationRef.navigate(
          'AddressForm',
          {
            addressId:
              address.id,
          },
        );
      }
    };

  const backFromAddressForm =
    () => {
      cancelAddressEdit();

      goBack();
    };

  const saveAddressAndReturn =
    async () => {
      const saved =
        await saveAddress();

      if (
        saved
      ) {
        goBack();
      }
    };

    const openLocationPicker =
  () => {
    if (
      navigationRef.isReady()
    ) {
      navigationRef.navigate(
        'LocationPicker',
      );
    }
  };

const useSelectedLocation =
  (
    location:
      SelectedLocation,
  ) => {
    setAddressForm({
      ...addressForm,

      addressLine1:
        location.addressLine1,

      addressLine2:
        location.addressLine2,

      city:
        location.city,

      state:
        location.state,

      postalCode:
        location.postalCode,

      latitude:
        location.coordinates
          .latitude,

      longitude:
        location.coordinates
          .longitude,
    });

    goBack();
  };

  /*
   * PICKUP
   */

  const openPickupSlotScreen =
    () => {
      if (
        !selectedAddress
      ) {
        Alert.alert(
          'Select an address',
          'Please select a pickup address first.',
        );

        return;
      }

      ensureInitialPickupDate();

      if (
        navigationRef.isReady()
      ) {
        navigationRef.navigate(
          'PickupSlot',
        );
      }
    };

  const choosePickupSlot =
    (
      slot: PickupSlot,
    ) => {
      const result =
        choosePickupSlotState(
          slot,
        );

      if (
        result.ok
      ) {
        return;
      }

      if (
        result.reason ===
        'date_required'
      ) {
        Alert.alert(
          'Select date',
          'Please select a pickup date first.',
        );

        return;
      }

      if (
        result.reason ===
        'unavailable'
      ) {
        Alert.alert(
          'Time unavailable',
          'This pickup time has already passed. Please select another slot.',
        );
      }
    };

  const continueToOrderReview =
    () => {
      if (
        !selectedAddress
      ) {
        Alert.alert(
          'Pickup address required',
          'Please select a pickup address.',
        );

        return;
      }

      if (
        !selectedPickupDateKey
      ) {
        Alert.alert(
          'Pickup date required',
          'Please select a pickup date.',
        );

        return;
      }

      if (
        !pickupScheduledAt ||
        !pickupSlotLabel
      ) {
        Alert.alert(
          'Pickup time required',
          'Please select a pickup time slot.',
        );

        return;
      }

      if (
        navigationRef.isReady()
      ) {
        navigationRef.navigate(
          'OrderReview',
        );
      }
    };

  /*
   * ORDER + PAYMENT
   */

  const placeOrder =
    async () => {
      if (placingOrderRef.current) return;
      if (
        !selectedPaymentMethod
      ) {
        Alert.alert(
          'Select payment method',
          'Please select how you would like to pay.',
        );

        return;
      }

      if (
        !termsAccepted
      ) {
        Alert.alert(
          'Terms required',
          'Please accept the Terms & Conditions and Service Policy before placing your order.',
        );

        return;
      }

      if (
        !selectedAddress
      ) {
        Alert.alert(
          'Address missing',
          'Please select your pickup address again.',
        );

        return;
      }

      if (
        !selectedPickupDate ||
        !pickupScheduledAt ||
        !pickupSlotLabel
      ) {
        Alert.alert(
          'Pickup schedule missing',
          'Please select your pickup date and time again.',
        );

        return;
      }

      if (
        !accessToken
      ) {
        Alert.alert(
          'Session Error',
          'Please login again.',
        );

        return;
      }

      if (
        cartItems.length ===
        0
      ) {
        Alert.alert(
          'Cart Empty',
          'Please add at least one service before placing your order.',
        );

        return;
      }

      try {
        setPaymentError(null);
        placingOrderRef.current = true;
        setPlacingOrder(
          true,
        );

        const orderInput: CreateOrderInput = {
              pickupAddressId:
                selectedAddress.id,

              deliveryAddressId:
                selectedAddress.id,

              pickupScheduledAt,

              pickupSlotLabel,

              paymentMethod:
                selectedPaymentMethod,
              couponCode: appliedCoupon?.code,
              loyaltyPointsToRedeem: loyaltyPoints || undefined,
              packageSubscriptionId: selectedPackage?.id,

              termsAccepted:
                true,

              items:
                cartItems.map(
                  item => ({
                    serviceId:
                      item.id,

                    itemName:
                      item.name,

                    quantity:
                      item.quantity,
                  }),
                ),
            };
        const fingerprint = JSON.stringify(orderInput);
        if (!orderAttemptRef.current) {
          orderAttemptRef.current = await loadOrderAttempt();
        }
        if (orderAttemptRef.current?.fingerprint !== fingerprint) {
          orderAttemptRef.current = {fingerprint, key: newOrderAttemptKey()};
          await saveOrderAttempt(orderAttemptRef.current);
        }
        const order = createdOrderRef.current ?? await createOrderApi(
          accessToken,
          {...orderInput, idempotencyKey: orderAttemptRef.current.key},
        );
        createdOrderRef.current = order;

        let finalStatus =
          order.current_status ??
          'confirmed';

        if (
          selectedPaymentMethod ===
          'razorpay'
        ) {
          const paymentOrder =
            await createPaymentOrder(
              accessToken,
              order.id,
            );

          const verification = await verifyPayment(
            accessToken,
            await openRazorpayCheckout({
                    keyId: String(
                      paymentOrder.keyId ||
                      '',
                    ),
                    orderId: String(
                      paymentOrder.razorpayOrderId ||
                      '',
                    ),
                    amount: Number(
                      paymentOrder.amount ||
                      0,
                    ),
                    currency: String(
                      paymentOrder.currency ||
                      'INR',
                    ),
                    orderNumber:
                      order.order_number,
                  }),
                );

          finalStatus =
            verification.orderStatus ??
            'confirmed';
        }

        setSuccessfulOrder({
          id:
            order.id,

          orderNumber:
            order.order_number,

          status:
            finalStatus,

          paymentMethod:
            selectedPaymentMethod,

          subtotal:
            Number(
              order.subtotal,
            ),

          pickupDeliveryCharge:
            Number(
              order.pickup_delivery_charge,
            ),

          taxableAmount:
            Number(
              order.taxable_amount,
            ),

          gstRate:
            Number(
              order.gst_rate,
            ),

          gstAmount:
            Number(
              order.gst_amount,
            ),

          totalAmount:
            Number(
              order.total_amount,
            ),

          pickupDateLabel:
            selectedPickupDate.fullLabel,

          pickupSlotLabel,
        });

        resetCart();
        createdOrderRef.current = null;
        orderAttemptRef.current = null;
        await clearOrderAttempt();
        setAppliedCoupon(null);
        setLoyaltyPoints(0);

        setSelectedCategory(
          null,
        );

        resetPickupSchedule();

        resetPaymentState();

        if (
          navigationRef.isReady()
        ) {
          navigationRef.reset({
            index: 0,
            routes: [
              {
                name:
                  'OrderSuccess',

                params: {
                  orderId:
                    order.id,
                },
              },
            ],
          });
        }
      } catch (
        error: unknown
      ) {
        if (
          error instanceof
          PaymentCheckoutCancelledError
        ) {
          setPaymentError(
            'Payment was cancelled. Your order is awaiting payment. You can try again or choose Cash on Delivery.',
          );

          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : 'Unable to complete online payment. Please try again or choose Cash on Delivery.';

        setPaymentError(
          message,
        );
      } finally {
        placingOrderRef.current = false;
        setPlacingOrder(
          false,
        );
      }
    };

  /*
   * AUTH
   */

  const verifyOtp =
    async () => {
      if (
        !otp.trim()
      ) {
        Alert.alert(
          'Enter OTP',
        );

        return;
      }

      try {
        setLoading(
          true,
        );

        const verification =
          await verifyPhoneOtp(
            normalizedPhone(),
            otp.trim(),
          );

        const token =
          getAccessTokenFromVerification(
            verification,
          );

        if (
          !token
        ) {
          throw new Error(
            'Login succeeded but access token was not returned',
          );
        }

        await saveSession(
          verification,
        );

        setOtp('');
      } catch (
        error: unknown
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to verify OTP';

        Alert.alert(
          'Verification Error',
          message,
        );
      } finally {
        setLoading(
          false,
        );
      }
    };

  /*
   * LOGOUT
   */

  const logout =
    async () => {
      await stopDriverTripBackground().catch(() => {});
      createdOrderRef.current = null;
      orderAttemptRef.current = null;
      await clearOrderAttempt();
      placingOrderRef.current = false;

      await resetSession();

      setServices(
        [],
      );

      setServicesLoading(
        false,
      );

      setServicesError('');
      setPricingPolicy(undefined);

      resetCart();

      setSelectedCategory(
        null,
      );

      resetAddresses();

      resetPickupSchedule();

      resetCheckoutState();
    };

  /*
   * APP NAVIGATION HELPERS
   */

  const openOrders =
    () => {
      if (
        navigationRef.isReady()
      ) {
        navigationRef.navigate(
          'Orders',
        );
      }
    };

  const openOrderDetails =
    (
      orderId: string,
    ) => {
      if (
        navigationRef.isReady()
      ) {
        navigationRef.navigate(
          'OrderDetails',
          {
            orderId,
          },
        );
      }
    };

  const reorder = (order: CustomerOrder) => {
    let plan: ReturnType<typeof buildReorderPlan>;
    try {plan = buildReorderPlan(order, services);}
    catch (cause) {Alert.alert('Cannot repeat order', cause instanceof Error ? cause.message : 'Please choose services again.'); return;}
    resetCart();
    plan.forEach(({service, quantity}) => updateQuantity(service, quantity));
    setAppliedCoupon(null); setLoyaltyPoints(0); setSelectedPackage(null);
    if (navigationRef.isReady()) navigationRef.navigate('Cart');
  };

  /*
   * INITIAL SESSION HYDRATION
   */

  if (
    hydrating ||
    !initialSessionResolved
  ) {
    return (
      <SafeAreaView
        style={
          styles.sessionLoadingContainer
        }>
        <ActivityIndicator
          size="large"
        />

        <Text
          style={
            styles.sessionLoadingTitle
          }>
          Bright & White
        </Text>

        <Text
          style={
            styles.sessionLoadingText
          }>
          Restoring your session...
        </Text>
      </SafeAreaView>
    );
  }

  /*
   * NAVIGATION
   */

  return (
    <NavigationContainer
      ref={
        navigationRef
      }
      linking={linking}>
      {authenticated && accessToken && !accountRoleFromProfile(profile) ? (
        <Stack.Navigator key="unresolved" screenOptions={{headerShown: false}}>
          <Stack.Screen name="DriverProfile">
            {() => <SafeAreaView><Text>Unable to resolve account access. Please sign in again.</Text><TouchableOpacity onPress={logout}><Text>Log out</Text></TouchableOpacity></SafeAreaView>}
          </Stack.Screen>
        </Stack.Navigator>
      ) : authenticated && accessToken && accountRoleFromProfile(profile) === 'driver' ? (
        <Stack.Navigator key="driver" initialRouteName="DriverDashboard" screenOptions={{headerShown: false}}>
          <Stack.Screen name="DriverDashboard">
            {() => <DriverDashboardScreen accessToken={accessToken} onLogout={logout}
              onNotifications={() => navigationRef.isReady() && navigationRef.navigate('DriverNotifications')}
              onProfile={() => navigationRef.isReady() && navigationRef.navigate('DriverProfile')}
              onJob={assignmentId => navigationRef.isReady() && navigationRef.navigate('DriverJobDetail', {assignmentId})} />}
          </Stack.Screen>
          <Stack.Screen name="DriverNotifications">
            {() => <DriverNotificationsScreen accessToken={accessToken} role={accountRoleFromProfile(profile)}
              onBack={goBack} onJob={assignmentId => navigationRef.isReady() && navigationRef.navigate('DriverJobDetail', {assignmentId})} />}
          </Stack.Screen>
          <Stack.Screen name="DriverJobDetail">
            {({route}) => <DriverJobDetailScreen accessToken={accessToken} assignmentId={route.params.assignmentId} onBack={goBack} />}
          </Stack.Screen>
          <Stack.Screen name="DriverProfile">
            {() => <DriverProfileScreen accessToken={accessToken} onLogout={logout} onBack={goBack} />}
          </Stack.Screen>
        </Stack.Navigator>
      ) : authenticated && accessToken && accountRoleFromProfile(profile) === 'admin' ? (
        <Stack.Navigator key="admin" screenOptions={{headerShown: false}}>
          <Stack.Screen name="AdminDashboard">
            {() => <AdminDashboardScreen accessToken={accessToken} onLogout={logout}
              onCustomers={() => navigationRef.isReady() && navigationRef.navigate('AdminCustomers')}
              onStaff={() => navigationRef.isReady() && navigationRef.navigate('AdminStaff')}
              onAssignments={() => navigationRef.isReady() && navigationRef.navigate('AdminAssignments')}
              onCatalogue={() => navigationRef.isReady() && navigationRef.navigate('AdminCatalogue')}
              onIssues={() => navigationRef.isReady() && navigationRef.navigate('AdminIssues')}
              onGrowth={() => navigationRef.isReady() && navigationRef.navigate('AdminGrowth')}
              onFacilities={() => navigationRef.isReady() && navigationRef.navigate('AdminFacilities')}
              onLocations={() => navigationRef.isReady() && navigationRef.navigate('AdminLocations')}
              onReports={() => navigationRef.isReady() && navigationRef.navigate('AdminReports')} />}
          </Stack.Screen>
          <Stack.Screen name="AdminLocations">
            {() => <AdminLocationsScreen accessToken={accessToken} onBack={goBack} />}
          </Stack.Screen>
          <Stack.Screen name="AdminCustomers">
            {() => <AdminCustomersScreen accessToken={accessToken} onBack={goBack}
              onCustomer={customerId => navigationRef.isReady() && navigationRef.navigate('AdminCustomerDetail', {customerId})}
              onOrder={orderId => navigationRef.isReady() && navigationRef.navigate('AdminOrderDetail', {orderId})} />}
          </Stack.Screen>
          <Stack.Screen name="AdminCustomerDetail">
            {({route}) => <AdminCustomerDetailScreen accessToken={accessToken} customerId={route.params.customerId} onBack={goBack}
              onOrder={orderId => navigationRef.isReady() && navigationRef.navigate('AdminOrderDetail', {orderId})} />}
          </Stack.Screen>
          <Stack.Screen name="AdminOrderDetail">
            {({route}) => <AdminOrderDetailScreen accessToken={accessToken} orderId={route.params.orderId} onBack={goBack} />}
          </Stack.Screen>
          <Stack.Screen name="AdminStaff">
            {() => <AdminStaffScreen accessToken={accessToken} onBack={goBack}
              onStaff={profileId => navigationRef.isReady() && navigationRef.navigate('AdminStaffDetail', {profileId})} />}
          </Stack.Screen>
          <Stack.Screen name="AdminStaffDetail">
            {({route}) => <AdminStaffDetailScreen accessToken={accessToken} profileId={route.params.profileId} onBack={goBack} />}
          </Stack.Screen>
          <Stack.Screen name="AdminAssignments">
            {() => <AdminAssignmentsScreen accessToken={accessToken} onBack={goBack}
              onOrder={orderId => navigationRef.isReady() && navigationRef.navigate('AdminOrderDetail', {orderId})} />}
          </Stack.Screen>
          <Stack.Screen name="AdminCatalogue">
            {() => <AdminCatalogueScreen accessToken={accessToken} onBack={goBack} />}
          </Stack.Screen>
          <Stack.Screen name="AdminIssues">
            {() => <AdminIssuesScreen accessToken={accessToken} onBack={goBack}
              onOrder={orderId => navigationRef.isReady() && navigationRef.navigate('AdminIssueDetail', {orderId})} />}
          </Stack.Screen>
          <Stack.Screen name="AdminIssueDetail">
            {({route}) => <AdminIssueDetailScreen accessToken={accessToken} orderId={route.params.orderId} onBack={goBack}
              onOrder={() => navigationRef.isReady() && navigationRef.navigate('AdminOrderDetail', {orderId: route.params.orderId})} />}
          </Stack.Screen>
          <Stack.Screen name="AdminGrowth">
            {() => <AdminGrowthScreen accessToken={accessToken} onBack={goBack} />}
          </Stack.Screen>
          <Stack.Screen name="AdminFacilities">
            {() => <AdminFacilityOversightScreen accessToken={accessToken} onBack={goBack}
              onFacility={facilityId => navigationRef.isReady() && navigationRef.navigate('AdminFacilityDetail', {facilityId})} />}
          </Stack.Screen>
          <Stack.Screen name="AdminFacilityDetail">
            {({route}) => <AdminFacilityOversightScreen accessToken={accessToken} facilityId={route.params.facilityId} onBack={goBack}
              onOrder={(facilityId, orderId) => navigationRef.isReady() && navigationRef.navigate('AdminFacilityOrder', {facilityId, orderId})} />}
          </Stack.Screen>
          <Stack.Screen name="AdminFacilityOrder">
            {({route}) => <AdminFacilityOversightScreen accessToken={accessToken} facilityId={route.params.facilityId}
              orderId={route.params.orderId} onBack={goBack} />}
          </Stack.Screen>
          <Stack.Screen name="AdminReports">
            {() => <AdminReportsScreen accessToken={accessToken} onBack={goBack} />}
          </Stack.Screen>
        </Stack.Navigator>
      ) : authenticated && accessToken && ['manager', 'facility_employee'].includes(accountRoleFromProfile(profile) || '') ? (
        <Stack.Navigator key="facility" screenOptions={{headerShown: false}}>
          <Stack.Screen name="FacilityDashboard">
            {() => <FacilityDashboardScreen key={facilityRefresh} accessToken={accessToken} onLogout={logout}
              onIntake={() => navigationRef.isReady() && navigationRef.navigate('FacilityIntake')}
              onOrder={orderId => navigationRef.isReady() && navigationRef.navigate('FacilityVerification', {orderId})} />}
          </Stack.Screen>
          <Stack.Screen name="FacilityIntake">
            {() => <FacilityIntakeScreen accessToken={accessToken} onBack={goBack}
              onReceived={() => {setFacilityRefresh(value => value + 1);}} />}
          </Stack.Screen>
          <Stack.Screen name="FacilityVerification">
            {({route}) => <FacilityVerificationScreen accessToken={accessToken} orderId={route.params.orderId}
              onBack={goBack} onChanged={() => setFacilityRefresh(value => value + 1)} />}
          </Stack.Screen>
        </Stack.Navigator>
      ) : authenticated && accessToken && accountRoleFromProfile(profile) && accountRoleFromProfile(profile) !== 'customer' ? (
        <Stack.Navigator key="operational" screenOptions={{headerShown: false}}>
          <Stack.Screen name="DriverProfile">
            {() => <SafeAreaView><Text>Operational account managed by B&W Admin</Text><TouchableOpacity onPress={logout}><Text>Log out</Text></TouchableOpacity></SafeAreaView>}
          </Stack.Screen>
        </Stack.Navigator>
      ) : authenticated &&
      accessToken ? (
        <Stack.Navigator
          key="app"
          initialRouteName="Home"
          screenOptions={{
            headerShown:
              false,
          }}>
          <Stack.Screen
            name="Home">
            {() => (
              <CustomerTabFrame active="home" onHome={resetToHome} onOrders={openOrders} onAccount={() => navigationRef.isReady() && navigationRef.navigate('Account')}><HomeScreen
                customerName={customerNameFromProfile(profile)}
                accessToken={accessToken}
                onOpenOrder={openOrderDetails}
                servicesLoading={
                  servicesLoading
                }
                servicesError={servicesError}
                services={services}
                categories={
                  categories
                }
                addresses={addresses}
                selectedAddressId={selectedAddressId}
                cartItemCount={
                  cartItemCount
                }
                cartSubtotal={
                  cartSubtotal
                }
                getQuantity={getQuantity}
                onSelectAddress={setSelectedAddressId}
                onManageAddresses={openAddressScreen}
                onRetryServices={() => loadServices(accessToken)}
                onUpdateQuantity={updateQuantity}
                onOpenCart={() => {
                  if (
                    navigationRef.isReady()
                  ) {
                    navigationRef.navigate(
                      'Cart',
                    );
                  }
                }}
                onOpenNotifications={() => navigationRef.isReady() && navigationRef.navigate('Notifications')}
                onOpenCategory={categoryName => {
                  setSelectedCategory(categoryName);
                  if (navigationRef.isReady()) {
                    navigationRef.navigate('Category', {categoryName});
                  }
                }}
              /></CustomerTabFrame>
            )}
          </Stack.Screen>

          <Stack.Screen name="Benefits">
            {() => <BenefitsScreen accessToken={accessToken} onBack={goBack} />}
          </Stack.Screen>
          <Stack.Screen name="Account">
            {() => <CustomerTabFrame active="account" onHome={resetToHome} onOrders={openOrders} onAccount={() => {}}><AccountScreen onLogout={logout} onOpen={destination => {
              if (!navigationRef.isReady()) return;
              if (destination === 'profile') navigationRef.navigate('Profile');
              else if (destination === 'addresses') navigationRef.navigate('Addresses', {mode: 'manage'});
              else if (destination === 'offers') navigationRef.navigate('Benefits');
              else if (destination === 'claims') navigationRef.navigate('Orders');
              else if (destination === 'notifications') navigationRef.navigate('Notifications');
              else if (destination === 'terms') navigationRef.navigate('Support', {showTerms: true});
              else navigationRef.navigate('Support');
            }} /></CustomerTabFrame>}
          </Stack.Screen>
          <Stack.Screen name="Profile">
            {() => <ProfileScreen accessToken={accessToken} onBack={goBack} onAddresses={() => navigationRef.isReady() && navigationRef.navigate('Addresses', {mode: 'manage'})} onLogout={logout} />}
          </Stack.Screen>
          <Stack.Screen name="Support">
            {({route}) => <SupportScreen onBack={goBack} onOrders={openOrders} initialTermsVisible={route.params?.showTerms === true} />}
          </Stack.Screen>
          <Stack.Screen name="Receipt">
            {({route}) => <ReceiptScreen accessToken={accessToken} orderId={route.params.orderId} onBack={goBack} />}
          </Stack.Screen>

          <Stack.Screen
            name="Category">
            {({
              route,
            }) => (
              <CategoryScreen
                categoryName={
                  route.params
                    .categoryName
                }
                services={
                  selectedCategoryServices
                }
                cartItemCount={
                  cartItemCount
                }
                cartSubtotal={
                  cartSubtotal
                }
                getQuantity={
                  getQuantity
                }
                onBack={() => {
                  setSelectedCategory(
                    null,
                  );

                  goBack();
                }}
                onOpenCart={() => {
                  if (
                    navigationRef.isReady()
                  ) {
                    navigationRef.navigate(
                      'Cart',
                    );
                  }
                }}
                onUpdateQuantity={
                  updateQuantity
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="Cart">
            {() => (
              <CartScreen
                items={
                  cartItems
                }
                itemCount={
                  cartItemCount
                }
                subtotal={
                  cartSubtotal
                }
                pricingPolicy={pricingPolicy}
                onBack={
                  goBack
                }
                onHome={() => {
                  setSelectedCategory(
                    null,
                  );

                  resetToHome();
                }}
                onBrowseServices={() => {
                  setSelectedCategory(
                    null,
                  );

                  resetToHome();
                }}
                onContinue={
                  openAddressScreen
                }
                onUpdateQuantity={
                  updateQuantity
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="Addresses">
            {({route}) => (
              <AddressScreen
                manageOnly={route.params?.mode === 'manage'}
                addresses={
                  addresses
                }
                loading={
                  addressesLoading
                }
                saving={
                  addressSaving
                }
                selectedAddressId={
                  selectedAddressId
                }
                selectedAddress={
                  selectedAddress
                }
                onBack={
                  goBack
                }
                onSelectAddress={
                  setSelectedAddressId
                }
                onAddAddress={
                  openAddAddress
                }
                onEditAddress={
                  openEditAddress
                }
                onSetDefaultAddress={
                  makeDefaultAddress
                }
                onDeleteAddress={
                  deleteAddress
                }
                onContinue={
                  openPickupSlotScreen
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="AddressForm">
            {() => (
              <AddressFormScreen
                accessToken={accessToken}
                editing={
                  Boolean(
                    editingAddressId,
                  )
                }
                form={
                  addressForm
                }
                saving={
                  addressSaving
                }
                onBack={
                  backFromAddressForm
                }
                onChange={
                  setAddressForm
                }
                onChooseLocation={
                  openLocationPicker
                }
                onSave={
                  saveAddressAndReturn
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
  name="LocationPicker">
  {() => (
    <LocationPickerScreen
      accessToken={
        accessToken
      }
      onBack={
        goBack
      }
      onUseLocation={
        useSelectedLocation
      }
    />
  )}
</Stack.Screen>

          <Stack.Screen
            name="PickupSlot">
            {() => (
              <PickupSlotScreen
                selectedAddress={
                  selectedAddress
                }
                pickupDateChoices={
                  pickupDateChoices
                }
                pickupSlots={
                  pickupSlots
                }
                selectedPickupDateKey={
                  selectedPickupDateKey
                }
                selectedPickupSlotId={
                  selectedPickupSlotId
                }
                pickupScheduledAt={
                  pickupScheduledAt
                }
                pickupSlotLabel={
                  pickupSlotLabel
                }
                selectedPickupDate={
                  selectedPickupDate
                }
                onBack={
                  goBack
                }
                onChoosePickupDate={
                  choosePickupDate
                }
                onChoosePickupSlot={
                  choosePickupSlot
                }
                onContinue={
                  continueToOrderReview
                }
                isSlotUnavailable={
                  isSlotUnavailable
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="OrderReview">
            {() => (
              <OrderReviewScreen
                selectedAddress={
                  selectedAddress
                }
                pickupDateLabel={
                  selectedPickupDate
                    ?.fullLabel ??
                  ''
                }
                pickupSlotLabel={
                  pickupSlotLabel
                }
                cartItems={
                  cartItems
                }
                cartSubtotal={
                  cartSubtotal
                }
                pricingPolicy={pricingPolicy}
                accessToken={accessToken}
                coupon={appliedCoupon}
                onCouponChange={value => {setAppliedCoupon(value); setLoyaltyPoints(0);}}
                loyaltyPoints={loyaltyPoints}
                onLoyaltyPointsChange={setLoyaltyPoints}
                selectedPackage={selectedPackage}
                onPackageChange={value => {setSelectedPackage(value); setAppliedCoupon(null); setLoyaltyPoints(0);}}
                onBack={
                  goBack
                }
                onChangeAddress={() => {
                  if (
                    navigationRef.isReady()
                  ) {
                    navigationRef.navigate(
                      'Addresses',
                    );
                  }
                }}
                onChangePickupTime={() => {
                  if (
                    navigationRef.isReady()
                  ) {
                    navigationRef.navigate(
                      'PickupSlot',
                    );
                  }
                }}
                onContinueToPayment={() => {
                  if (
                    navigationRef.isReady()
                  ) {
                    navigationRef.navigate(
                      'Payment',
                    );
                  }
                }}
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="Payment">
            {() => (
              <PaymentScreen
                pricing={
                  checkoutPricing
                }
                selectedPaymentMethod={
                  selectedPaymentMethod
                }
                termsAccepted={
                  termsAccepted
                }
                placingOrder={
                  placingOrder
                }
                errorMessage={
                  paymentError
                }
                onClearError={() => {
                  setPaymentError(null);
                }}
                onBack={() => {
                  setPaymentError(null);
                  goBack();
                }}
                onSelectPaymentMethod={method => {
                  setSelectedPaymentMethod(method);
                  setPaymentError(null);
                }}
                onTermsAcceptedChange={
                  setTermsAccepted
                }
                onPlaceOrder={
                  placeOrder
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="OrderSuccess">
            {() => {
              if (
                !successfulOrder
              ) {
                return (
                  <HomeScreen
                    customerName={customerNameFromProfile(profile)}
                    accessToken={accessToken}
                    onOpenOrder={openOrderDetails}
                    servicesLoading={
                      servicesLoading
                    }
                    servicesError={servicesError}
                    services={services}
                    categories={
                      categories
                    }
                    addresses={addresses}
                    selectedAddressId={selectedAddressId}
                    cartItemCount={
                      cartItemCount
                    }
                    cartSubtotal={
                      cartSubtotal
                    }
                    getQuantity={getQuantity}
                    onSelectAddress={setSelectedAddressId}
                    onManageAddresses={openAddressScreen}
                    onRetryServices={() => loadServices(accessToken)}
                    onUpdateQuantity={updateQuantity}
                    onOpenCart={() => {
                      if (
                        navigationRef.isReady()
                      ) {
                        navigationRef.navigate(
                          'Cart',
                        );
                      }
                    }}
                    onOpenNotifications={() => navigationRef.isReady() && navigationRef.navigate('Notifications')}
                    onOpenCategory={categoryName => {
                      setSelectedCategory(categoryName);
                      if (navigationRef.isReady()) {
                        navigationRef.navigate('Category', {categoryName});
                      }
                    }}
                  />
                );
              }

              return (
                <OrderSuccessScreen
                  order={
                    successfulOrder
                  }
                  onBackHome={() => {
                    resetOrderSuccess();

                    resetToHome();
                  }}
                  onViewOrders={() => {
                    resetOrderSuccess();

                    if (
                      navigationRef.isReady()
                    ) {
                      navigationRef.reset({
                        index: 1,
                        routes: [
                          {
                            name:
                              'Home',
                          },
                          {
                            name:
                              'Orders',
                          },
                        ],
                      });
                    }
                  }}
                />
              );
            }}
          </Stack.Screen>

          <Stack.Screen
            name="Orders">
            {() => (
              <CustomerTabFrame active="orders" onHome={resetToHome} onOrders={() => {}} onAccount={() => navigationRef.isReady() && navigationRef.navigate('Account')}><OrdersScreen
                accessToken={
                  accessToken
                }
                onBack={
                  resetToHome
                }
                onOpenOrder={
                  openOrderDetails
                }
              /></CustomerTabFrame>
            )}
          </Stack.Screen>

          <Stack.Screen
            name="OrderDetails">
            {({
              route,
            }) => (
              <OrderDetailsScreen
                accessToken={
                  accessToken
                }
                orderId={
                  route.params
                    .orderId
                }
                onBack={
                  goBack
                }
                onReceipt={receiptOrderId => navigationRef.isReady() && navigationRef.navigate('Receipt', {orderId: receiptOrderId})}
                onReorder={reorder}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Notifications">
            {() => (
              <NotificationsScreen
                accessToken={accessToken}
                onBack={goBack}
                onOpenOrder={openOrderDetails}
              />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      ) : (
        <Stack.Navigator
          key="auth"
          initialRouteName={
            typeof window !== 'undefined' &&
            (window.location?.pathname?.includes('reset-password') ||
              window.location?.hash?.includes('type=recovery') ||
              window.location?.hash?.includes('otp_expired') ||
              window.location?.search?.includes('otp_expired'))
              ? 'ResetPassword'
              : 'Welcome'
          }
          screenOptions={{
            headerShown:
              false,
          }}>
          <Stack.Screen
            name="Welcome">
            {({
              navigation,
            }) => (
              <WelcomeScreen
                onGetStarted={() =>
                  navigation.navigate(
                    'Login',
                  )
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="Login">
            {({
              navigation,
            }) => (
              <LoginScreen
                onSessionEstablished={
                  saveSession
                }
                onNavigateToSignUp={() =>
                  navigation.navigate(
                    'SignUp',
                  )
                }
                onNavigateToForgotPassword={() =>
                  navigation.navigate(
                    'ForgotPassword',
                  )
                }
                onNavigateToDriverLogin={() =>
                  navigation.navigate(
                    'DriverLogin',
                  )
                }
                onBack={() =>
                  navigation.goBack()
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="DriverLogin">
            {({
              navigation,
            }) => (
              <DriverLoginScreen
                onSessionEstablished={
                  saveSession
                }
                onNavigateToCustomerLogin={() =>
                  navigation.navigate(
                    'Login',
                  )
                }
                onBack={() =>
                  navigation.goBack()
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="SignUp">
            {({
              navigation,
            }) => (
              <SignUpScreen
                onSessionEstablished={
                  saveSession
                }
                onNavigateToLogin={() =>
                  navigation.navigate(
                    'Login',
                  )
                }
                onBack={() =>
                  navigation.goBack()
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="ForgotPassword">
            {({
              navigation,
            }) => (
              <ForgotPasswordScreen
                onBackToLogin={() =>
                  navigation.navigate(
                    'Login',
                  )
                }
                onBack={() =>
                  navigation.goBack()
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="ResetPassword">
            {({
              navigation,
              route,
            }) => (
              <ResetPasswordScreen
                accessToken={
                  route.params?.accessToken
                }
                onPasswordResetSuccess={() => {}}
                onBackToLogin={() =>
                  navigation.navigate(
                    'Login',
                  )
                }
                onBack={() =>
                  navigation.goBack()
                }
                onNavigateToForgotPassword={() =>
                  navigation.navigate(
                    'ForgotPassword',
                  )
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen
            name="Otp">
            {({
              navigation,
            }) => (
              <OtpScreen
                phone={
                  phone
                }
                otp={
                  otp
                }
                loading={
                  loading
                }
                onOtpChange={
                  setOtp
                }
                onVerifyOtp={
                  verifyOtp
                }
                onBack={() =>
                  navigation.goBack()
                }
              />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles =
  StyleSheet.create({
    sessionLoadingContainer: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        '#FFFFFF',
      paddingHorizontal:
        30,
    },

    sessionLoadingTitle: {
      marginTop: 18,
      fontSize: 22,
      fontWeight:
        '800',
      color:
        '#111111',
    },

    sessionLoadingText: {
      marginTop: 7,
      fontSize: 13,
      color:
        '#666666',
    },
  });
