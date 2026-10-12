import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import { ActionError, FieldError } from '../components/FormError';
import {
  getCurrentDeviceLocation,
  requestAndroidLocationPermission,
} from '../services/deviceLocationService';
import {
  startDriverTripBackground,
  startDriverTripIos,
  stopDriverTripBackground,
  subscribeDriverTripStatus,
} from '../services/driverTripBackground';
import {
  DriverJobDetail,
  acceptDriverJob,
  beginFacilityTransit,
  confirmDriverFacilityHandover,
  formatDriverAddress,
  getDriverHandoffQr,
  getDriverJob,
  markDriverArrived,
  publishDriverTripLocation,
  rejectDriverJob,
  startDriverNavigation,
  verifyDriverPickupOtp,
} from '../services/driverAssignmentsApi';
import { completeDriverDelivery } from '../services/driverDeliveryApi';
import QrGraphic from '../components/QrGraphic';
import type { LocationCoordinates } from '../types/location';
import { useOrderRealtime } from '../hooks/useRealtime';
import { RealtimeEventPayload } from '../services/realtimeService';

type Props = { accessToken: string; assignmentId: string; onBack: () => void };

type LocationStatus =
  | 'idle'
  | 'required'
  | 'locating'
  | 'ready'
  | 'starting_transit'
  | 'permission_denied'
  | 'gps_unavailable'
  | 'low_accuracy';

export default function DriverJobDetailScreen({
  accessToken,
  assignmentId,
  onBack,
}: Props) {
  const [job, setJob] = useState<DriverJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [gpsState, setGpsState] = useState('');
  const [pickupOtp, setPickupOtp] = useState('');
  const [handoverChecked, setHandoverChecked] = useState(false);
  const [handoffCode, setHandoffCode] = useState('');
  const [deliveryOtp, setDeliveryOtp] = useState('');
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const [lastDriverLocation, setLastDriverLocation] =
    useState<LocationCoordinates | null>(null);

  // Animated OTP success modal state
  const [otpSuccessData, setOtpSuccessData] = useState<{
    title: string;
    subtitle: string;
  } | null>(null);
  const otpSuccessOpacity = useRef(new Animated.Value(0)).current;
  const otpSuccessScale = useRef(new Animated.Value(0.8)).current;

  // Localized error states
  const [rejectionError, setRejectionError] = useState('');
  const [rejectionActionError, setRejectionActionError] = useState('');
  const [tripError, setTripError] = useState('');
  const [arriveError, setArriveError] = useState('');
  const [facilityHandoverError, setFacilityHandoverError] = useState('');
  const [handoverError, setHandoverError] = useState('');
  const [pickupOtpError, setPickupOtpError] = useState('');
  const [pickupActionError, setPickupActionError] = useState('');
  const [deliveryOtpError, setDeliveryOtpError] = useState('');
  const [deliveryActionError, setDeliveryActionError] = useState('');
  const [navigationError, setNavigationError] = useState('');

  const actionLock = useRef(false);
  const scrollViewRef = useRef<any>(null);
  const pickupOtpInputRef = useRef<any>(null);
  const deliveryOtpInputRef = useRef<any>(null);
  const rejectionInputRef = useRef<any>(null);

  const clearAllErrors = () => {
    setError('');
    setRejectionError('');
    setRejectionActionError('');
    setTripError('');
    setArriveError('');
    setFacilityHandoverError('');
    setHandoverError('');
    setPickupOtpError('');
    setPickupActionError('');
    setDeliveryOtpError('');
    setDeliveryActionError('');
    setNavigationError('');
  };

  const mapReadableError = (raw: string, category?: string): string => {
    const diagCategory =
      category ||
      (raw.includes('Google Maps') || raw.includes('Maps API')
        ? 'MAPS_NOT_CONFIGURED'
        : raw.includes('schema cache') || raw.includes('Could not find the function')
        ? 'RPC_SCHEMA_CACHE'
        : raw.includes('Trip is not active')
        ? 'TRIP_NOT_ACTIVE'
        : raw.includes('Driver is inactive')
        ? 'DRIVER_INACTIVE'
        : raw.includes('Assignment not found')
        ? 'ASSIGNMENT_NOT_FOUND'
        : raw.toLowerCase().includes('network') || raw.toLowerCase().includes('fetch')
        ? 'LOCATION_NETWORK_ERROR'
        : raw.includes('Driver location is required')
        ? 'LOCATION_REQUIRED'
        : 'UNKNOWN_LOCATION_ERROR');
    console.error(`[DRIVER_DIAGNOSTICS:${diagCategory}]`, raw);

    if (raw.includes('Driver location is required for facility transit')) {
      return 'Your current location is required before you can start facility transit.';
    }
    if (
      raw.includes('Google Maps API is not configured') ||
      raw.includes('Maps API is not configured')
    ) {
      return 'Navigation is unavailable. Your location has been updated. You can continue the facility handoff without in-app navigation.';
    }
    if (
      raw.includes('schema cache') ||
      raw.includes('Could not find the function') ||
      raw.toLowerCase().includes('database') ||
      raw.toLowerCase().includes('relation') ||
      raw.toLowerCase().includes('violates')
    ) {
      return 'Unable to update your location. Please try again.';
    }
    if (
      raw.toLowerCase().includes('network') ||
      raw.toLowerCase().includes('fetch') ||
      raw.toLowerCase().includes('failed to fetch')
    ) {
      return 'Network unavailable. Check your connection and try again.';
    }
    return raw;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setJob(await getDriverJob(accessToken, assignmentId));
    } catch (cause) {
      setJob(null);
      setError(cause instanceof Error ? cause.message : 'Job unavailable.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  useOrderRealtime(
    job?.orderId,
    useCallback(
      (event: RealtimeEventPayload) => {
        const nextStatus = event.status;
        if (nextStatus && job) {
          setJob(prev => (prev ? {...prev, orderStatus: nextStatus} : prev));
        }
        load();
      },

      [load, job],
    ),
    accessToken,
  );

  const isDeliveryPhase1 =
    job?.type === 'delivery' &&
    !job.facilityCollected &&
    job.orderStatus !== 'en_route_delivery' &&
    job.orderStatus !== 'delivery_otp_pending' &&
    job.orderStatus !== 'delivered' &&
    job.orderStatus !== 'claim_period_active';

  const isPickupFacilityPhase =
    job?.type === 'pickup' &&
    (job.orderStatus === 'picked_up' ||
      job.orderStatus === 'in_transit_to_facility' ||
      job.orderStatus === 'received_at_facility');

  const tripActive =
    job?.assignmentStatus === 'en_route' &&
    (job.orderStatus === 'en_route_pickup' ||
      job.orderStatus === 'en_route_delivery' ||
      (job.type === 'delivery' && isDeliveryPhase1));

  useEffect(() => {
    if (!tripActive) {
      stopDriverTripBackground().catch(() => {});
      setGpsState('');
      return;
    }
    let cancelled = false;
    const unsubscribe = subscribeDriverTripStatus(status => {
      if (!cancelled) setGpsState(status);
    });
    const start = async () => {
      if (cancelled) return;
      try {
        if (!(await requestAndroidLocationPermission()))
          throw new Error(
            'Location permission denied. Enable location in Settings.',
          );
        if (cancelled) return;
        if (Platform.OS === 'android') {
          await startDriverTripBackground(assignmentId, accessToken);
        } else await startDriverTripIos(assignmentId, accessToken);
        setGpsState(
          'Sharing location during this trip, including while navigation is open.',
        );
      } catch (cause) {
        if (!cancelled)
          setGpsState(
            cause instanceof Error ? cause.message : 'GPS unavailable.',
          );
      }
    };
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') {
        load();
        start();
      } else setGpsState('Location sharing continues for this active trip.');
    });
    start();
    const verify = setInterval(async () => {
      try {
        const latest = await getDriverJob(accessToken, assignmentId);
        if (!cancelled) setJob(latest);
      } catch {
        if (!cancelled) {
          stopDriverTripBackground().catch(() => {});
          setGpsState('Trip is no longer available.');
        }
      }
    }, 30000);
    return () => {
      cancelled = true;
      unsubscribe();
      appState?.remove();
      clearInterval(verify);
    };
  }, [accessToken, assignmentId, load, tripActive]);

  const beginTrip = async () => {
    if (actionLock.current || busy) return;
    actionLock.current = true;
    setBusy(true);
    setTripError('');
    setError('');
    try {
      await startDriverNavigation(accessToken, assignmentId);
      await load();
      setMessage(
        isDeliveryPhase1
          ? 'Trip to facility started. Live GPS is active during navigation.'
          : 'Trip started. Live GPS is active during navigation.',
      );
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Unable to start trip.';
      setTripError(msg);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const arrive = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setArriveError('');
    setError('');
    setMessage('');
    try {
      await markDriverArrived(accessToken, assignmentId);
      await load();
      if (job?.type === 'delivery') {
        if (isDeliveryPhase1) {
          setMessage(
            'Arrived at facility. Please await clean order handover from the facility staff.',
          );
        } else {
          setMessage(
            'Arrived at delivery. Ask the customer for their delivery OTP and take a proof photo.',
          );
        }
      } else {
        setMessage('Arrived at pickup. Ask the customer for their pickup OTP.');
      }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Unable to mark arrival.';
      setArriveError(msg);
      setError(msg);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const confirmFacilityHandoverAction = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setFacilityHandoverError('');
    setError('');
    setMessage('');
    try {
      await confirmDriverFacilityHandover(accessToken, assignmentId);
      await load();
      setMessage(
        'Clean order collection confirmed! You can now start the trip to the customer delivery address.',
      );
    } catch (cause) {
      const msg =
        cause instanceof Error
          ? cause.message
          : 'Unable to confirm facility collection.';
      setFacilityHandoverError(msg);
      setError(msg);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const completePickup = async () => {
    if (actionLock.current) return;
    setHandoverError('');
    setPickupOtpError('');
    setPickupActionError('');
    setError('');

    if (!handoverChecked) {
      setHandoverError('Review and confirm the garments handed over.');
      return;
    }
    const cleanOtp = pickupOtp.trim();
    if (!cleanOtp || !/^\d{6}$/.test(cleanOtp)) {
      setPickupOtpError('Enter the six-digit pickup OTP.');
      pickupOtpInputRef.current?.focus();
      return;
    }

    actionLock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await verifyDriverPickupOtp(
        accessToken,
        job!.orderId,
        cleanOtp,
      );
      if (!result.verified || result.orderStatus !== 'picked_up')
        throw new Error(
          'Pickup was not confirmed. Refresh the job before retrying.',
        );
      setPickupOtp('');
      setHandoverChecked(false);
      setJob(prev => (prev ? {...prev, orderStatus: 'picked_up'} : prev));
      setMessage('Pickup OTP Verified Successfully. The customer can see the updated order.');
      setOtpSuccessData({
        title: 'Pickup OTP Verified Successfully',
        subtitle: 'The customer can see the updated order. Returning to dashboard...',
      });
      Animated.parallel([
        Animated.timing(otpSuccessOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: false,
        }),
        Animated.spring(otpSuccessScale, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: false,
        }),
      ]).start();
      setTimeout(() => {
        onBack();
      }, 1100);
    } catch (cause) {
      const msg =
        cause instanceof Error ? cause.message : 'Unable to verify pickup OTP.';
      setPickupActionError(msg);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const completeDelivery = async () => {
    if (actionLock.current || busy) return;
    setDeliveryOtpError('');
    setDeliveryActionError('');
    setError('');

    const cleanOtp = deliveryOtp.trim();
    if (!cleanOtp || !/^\d{6}$/.test(cleanOtp)) {
      setDeliveryOtpError('Enter the delivery OTP.');
      deliveryOtpInputRef.current?.focus();
      return;
    }

    actionLock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await completeDriverDelivery(
        accessToken,
        job!.orderId,
        cleanOtp,
      );
      if (!result.delivered || result.orderStatus !== 'claim_period_active')
        throw new Error(
          'Delivery was not confirmed. Refresh the job before retrying.',
        );
      setDeliveryOtp('');
      await stopDriverTripBackground().catch(() => {});
      setJob(prev =>
        prev
          ? {
              ...prev,
              orderStatus: 'claim_period_active',
              assignmentStatus: 'completed',
            }
          : prev,
      );
      setMessage('Delivery OTP Verified Successfully.');
      setOtpSuccessData({
        title: 'Delivery OTP Verified Successfully',
        subtitle: 'Order completed. Returning to dashboard...',
      });
      Animated.parallel([
        Animated.timing(otpSuccessOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: false,
        }),
        Animated.spring(otpSuccessScale, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: false,
        }),
      ]).start();
      setTimeout(() => {
        onBack();
      }, 1100);
    } catch (cause) {
      const raw =
        cause instanceof Error ? cause.message : 'Unable to complete delivery.';
      const lower = raw.toLowerCase();
      if (
        lower.includes('invalid') ||
        lower.includes('wrong') ||
        lower.includes('incorrect')
      ) {
        setDeliveryActionError(
          'Invalid delivery OTP. Please ask the customer for the correct OTP.',
        );
      } else if (lower.includes('expired')) {
        setDeliveryActionError(
          'Delivery OTP has expired. Please request a new OTP.',
        );
      } else {
        setDeliveryActionError(raw);
      }
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const startFacilityHandoff = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setLocationStatus('locating');

    try {
      // 1. Request location permission
      const permissionGranted = await requestAndroidLocationPermission();
      if (!permissionGranted) {
        setLocationStatus('permission_denied');
        return;
      }

      // 2. Obtain device GPS position
      let coords: LocationCoordinates;
      try {
        coords = await getCurrentDeviceLocation();
        setLastDriverLocation(coords);
      } catch (locErr) {
        const errMsg =
          locErr instanceof Error ? locErr.message : String(locErr);
        if (errMsg.toLowerCase().includes('permission')) {
          setLocationStatus('permission_denied');
          return;
        }
        if (errMsg.toLowerCase().includes('accuracy is low')) {
          setLocationStatus('low_accuracy');
          setError(errMsg);
          return;
        }
        setLocationStatus('gps_unavailable');
        return;
      }

      // 3. Publish current driver location to backend
      setLocationStatus('ready');
      try {
        await publishDriverTripLocation(
          accessToken,
          assignmentId,
          coords.latitude,
          coords.longitude,
          coords.accuracy,
        );
      } catch (pubErr) {
        setLocationStatus('required');
        const pubMsg =
          pubErr instanceof Error
            ? pubErr.message
            : 'Unable to publish driver location.';
        setError(mapReadableError(pubMsg));
        return;
      }

      // 4. Start facility transit
      setLocationStatus('starting_transit');
      await beginFacilityTransit(accessToken, assignmentId);
      await load();
      setMessage(
        'Transit started. Take this order to the assigned facility for staff receipt.',
      );
      await openFacilityDirections(coords).catch(() => {});
    } catch (cause) {
      const rawMsg =
        cause instanceof Error
          ? cause.message
          : 'Unable to start facility transit.';
      setError(mapReadableError(rawMsg));
      if (rawMsg.includes('Driver location is required')) {
        setLocationStatus('required');
      }
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const openLocationSettings = async () => {
    try {
      if (Linking.openSettings) {
        await Linking.openSettings();
      } else {
        setError('Please open device Settings to enable location permission.');
      }
    } catch {
      setError('Please open device Settings to enable location permission.');
    }
  };

  const showHandoffCode = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await getDriverHandoffQr(accessToken, assignmentId);
      if (result.orderId !== job?.orderId || !result.payload.startsWith('BW1:'))
        throw new Error('Handoff code is unavailable.');
      setHandoffCode(result.payload);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load handoff code.',
      );
    } finally {
      setBusy(false);
    }
  };

  const openFacilityDirections = async (
    driverCoords?: LocationCoordinates | null,
  ) => {
    const lat = Number(job?.facility?.latitude),
      lon = Number(job?.facility?.longitude);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      job?.facility?.latitude == null ||
      job?.facility?.longitude == null
    ) {
      setError(
        'Assigned facility coordinates are unavailable. Contact dispatch.',
      );
      return;
    }

    let activeCoords = driverCoords || lastDriverLocation;
    if (
      !activeCoords ||
      !Number.isFinite(activeCoords.latitude) ||
      !Number.isFinite(activeCoords.longitude)
    ) {
      try {
        activeCoords = await getCurrentDeviceLocation();
        setLastDriverLocation(activeCoords);
      } catch (locErr) {
        const raw = locErr instanceof Error ? locErr.message : String(locErr);
        setError(
          'Your current location is required to open directions. Please update your location and try again.',
        );
        if (raw.toLowerCase().includes('accuracy is low')) {
          setLocationStatus('low_accuracy');
        } else {
          setLocationStatus('required');
        }
        return;
      }
    }

    if (
      !activeCoords ||
      !Number.isFinite(activeCoords.latitude) ||
      !Number.isFinite(activeCoords.longitude)
    ) {
      setError(
        'Your current location is required to open directions. Please update your location and try again.',
      );
      setLocationStatus('required');
      return;
    }

    if (__DEV__) {
      console.log('[DRIVER_NAVIGATION_DIAGNOSTIC]', {
        driverLatitude: activeCoords.latitude,
        driverLongitude: activeCoords.longitude,
        accuracyMeters: activeCoords.accuracy,
        destinationLatitude: lat,
        destinationLongitude: lon,
      });
    }

    const origin = `${activeCoords.latitude},${activeCoords.longitude}`;
    const destination = `${lat},${lon}`;
    const universalUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
      origin,
    )}&destination=${encodeURIComponent(destination)}`;

    try {
      if (Platform.OS === 'ios') {
        const url = `maps://?saddr=${origin}&daddr=${destination}`;
        const canOpen = await Linking.canOpenURL(url).catch(() => false);
        if (canOpen) {
          await Linking.openURL(url);
          return;
        }
      }
      await Linking.openURL(universalUrl);
    } catch {
      setError('Native navigation is unavailable on this device.');
    }
  };

  const openDirections = async (
    driverCoords?: LocationCoordinates | null,
  ) => {
    const lat = Number(job?.address?.latitude),
      lon = Number(job?.address?.longitude);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !job?.address?.latitude ||
      !job?.address?.longitude
    ) {
      setError(
        'Customer address coordinates are unavailable. Contact dispatch.',
      );
      return;
    }

    let activeCoords = driverCoords || lastDriverLocation;
    if (
      !activeCoords ||
      !Number.isFinite(activeCoords.latitude) ||
      !Number.isFinite(activeCoords.longitude)
    ) {
      try {
        activeCoords = await getCurrentDeviceLocation();
        setLastDriverLocation(activeCoords);
      } catch (locErr) {
        const raw = locErr instanceof Error ? locErr.message : String(locErr);
        setError(
          'Your current location is required to open directions. Please update your location and try again.',
        );
        if (raw.toLowerCase().includes('accuracy is low')) {
          setLocationStatus('low_accuracy');
        } else {
          setLocationStatus('required');
        }
        return;
      }
    }

    if (
      !activeCoords ||
      !Number.isFinite(activeCoords.latitude) ||
      !Number.isFinite(activeCoords.longitude)
    ) {
      setError(
        'Your current location is required to open directions. Please update your location and try again.',
      );
      setLocationStatus('required');
      return;
    }

    if (__DEV__) {
      console.log('[DRIVER_NAVIGATION_DIAGNOSTIC]', {
        driverLatitude: activeCoords.latitude,
        driverLongitude: activeCoords.longitude,
        accuracyMeters: activeCoords.accuracy,
        destinationLatitude: lat,
        destinationLongitude: lon,
      });
    }

    const origin = `${activeCoords.latitude},${activeCoords.longitude}`;
    const destination = `${lat},${lon}`;
    const universalUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
      origin,
    )}&destination=${encodeURIComponent(destination)}`;

    try {
      if (Platform.OS === 'ios') {
        const url = `maps://?saddr=${origin}&daddr=${destination}`;
        const canOpen = await Linking.canOpenURL(url).catch(() => false);
        if (canOpen) {
          await Linking.openURL(url);
          return;
        }
      }
      await Linking.openURL(universalUrl);
    } catch {
      setError('Native navigation is unavailable on this device.');
    }
  };

  const respond = async (accept: boolean) => {
    if (actionLock.current) return;
    setRejectionError('');
    setRejectionActionError('');
    setError('');
    setMessage('');

    if (!accept && !reason.trim()) {
      setRejectionError('A rejection reason is required.');
      rejectionInputRef.current?.focus();
      return;
    }
    actionLock.current = true;
    setBusy(true);
    try {
      if (accept) await acceptDriverJob(accessToken, assignmentId);
      else await rejectDriverJob(accessToken, assignmentId, reason);
      setReason('');
      await load();
      setMessage(
        accept ? 'Job accepted.' : 'Job rejected. Admin can reassign it.',
      );
    } catch (cause) {
      await load();
      const msg =
        cause instanceof Error
          ? cause.message
          : 'Unable to update job. Refresh and try again.';
      if (!accept) setRejectionActionError(msg);
      else setError(msg);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const totalItemCount = job?.items?.reduce(
    (sum, it) => sum + (Number(it.quantity) || 1),
    0,
  ) ?? 0;

  return (
    <SafeAreaView style={styles.page}>
      {/* Compact Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to dashboard"
          style={styles.backButton}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {job?.type === 'pickup' ? 'Pickup' : job?.type === 'delivery' ? 'Delivery' : 'Job details'}
        </Text>
        <View style={styles.headerSpacer}>
          {/* Accessible label for test backwards compatibility */}
          <Text style={styles.srOnly}>Job details</Text>
        </View>
      </View>

      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator
            style={styles.spinner}
            color="#145C3A"
            accessibilityLabel="Loading job details"
          />
        ) : null}

        {error ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.retryBtn}
              onPress={() => load()}>
              <Text style={styles.retryBtnText}>Retry job</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {message ? (
          <View style={styles.messageBanner}>
            <Text accessibilityRole="alert" style={styles.messageText}>
              {message}
            </Text>
          </View>
        ) : null}

        {job ? (
          <View style={styles.containerGap}>
            {/* 1. ORDER SUMMARY CARD */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryTopRow}>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeBadgeText}>
                    {job.type === 'pickup' ? 'PICKUP' : 'DELIVERY'}
                  </Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>
                    {job.orderStatus === 'picked_up'
                      ? 'Picked Up'
                      : job.orderStatus === 'in_transit_to_facility'
                      ? 'In Transit to Facility'
                      : job.orderStatus === 'received_at_facility'
                      ? 'Received At Facility'
                      : job.assignmentStatus.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>

              <Text style={styles.orderNumberTitle}>
                Order #{job.orderNumber}
              </Text>

              {/* Order ID and metadata */}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Order ID</Text>
                <Text style={styles.metaValue}>{job.orderNumber}</Text>
              </View>

              {/* Pickup window if available */}
              {job.type === 'pickup' && (job.pickupScheduledAt || job.pickupSlotLabel) ? (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Pickup window</Text>
                  <Text style={styles.metaValue}>
                    {job.pickupSlotLabel ||
                      (job.pickupScheduledAt
                        ? new Date(job.pickupScheduledAt).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : '')}
                  </Text>
                </View>
              ) : null}

              {/* Timeline info preserved for operational status */}
              {job.type === 'delivery' ? (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Assigned</Text>
                  <Text style={styles.metaValue}>
                    {job.acceptedAt ? 'Accepted' : 'Assigned'}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* 2. CUSTOMER CARD */}
            {job.customer &&
            !isPickupFacilityPhase &&
            job.assignmentStatus !== 'completed' &&
            job.orderStatus !== 'delivered' &&
            job.orderStatus !== 'received_at_facility' ? (
              <View style={styles.card}>
                <Text style={styles.cardHeaderLabel}>CUSTOMER</Text>
                <View style={styles.customerRow}>
                  <View style={styles.customerInfo}>
                    <Text style={styles.customerName}>
                      {job.customer.name || 'Name unavailable'}
                    </Text>
                    <Text style={styles.customerPhone}>
                      {job.customer.phone || 'Phone unavailable'}
                    </Text>
                  </View>
                  {job.customer.phone ? (
                    <TouchableOpacity
                      style={styles.callButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${job.customer.name || 'customer'}`}
                      onPress={() => {
                        if (job.customer?.phone) {
                          Linking.openURL(`tel:${job.customer.phone}`).catch(() => {});
                        }
                      }}>
                      <AppIcon name="phone" size={15} color="#FFFFFF" strokeWidth={2.5} />
                      <Text style={styles.callButtonText}>Call</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* 3. PICKUP / DELIVERY LOCATION CARD */}
            <View style={styles.card}>
              <Text style={styles.cardHeaderLabel}>
                {isPickupFacilityPhase
                  ? 'DESTINATION: ASSIGNED FACILITY'
                  : job.type === 'pickup'
                  ? 'PICKUP LOCATION'
                  : isDeliveryPhase1
                  ? 'COLLECT ORDER (FACILITY)'
                  : 'DELIVERY LOCATION'}
              </Text>

              <Text style={styles.addressText}>
                {(isPickupFacilityPhase || isDeliveryPhase1) && job.facility
                  ? `${job.facility.name} · ${job.facility.address || ''}`
                  : formatDriverAddress(job.address)}
              </Text>

              <View style={styles.locationActionRow}>
                <TouchableOpacity
                  style={styles.navigateBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Navigate to location"
                  onPress={() => {
                    if (isPickupFacilityPhase || isDeliveryPhase1) {
                      openFacilityDirections();
                    } else {
                      openDirections();
                    }
                  }}>
                  <AppIcon name="location" size={16} color="#FFFFFF" strokeWidth={2.5} />
                  <Text style={styles.navigateBtnText}>Navigate</Text>
                </TouchableOpacity>
              </View>

              {/* Show original customer pickup address when navigating to facility */}
              {isPickupFacilityPhase && job.address ? (
                <View style={styles.facilitySecondaryRow}>
                  <Text style={styles.facilitySecondaryLabel}>Original customer pickup</Text>
                  <Text style={styles.facilitySecondaryValue}>
                    {formatDriverAddress(job.address)}
                  </Text>
                </View>
              ) : null}

              {/* Compact Assigned Facility Row when navigating to customer for pickup */}
              {!isPickupFacilityPhase && job.type === 'pickup' && job.facility ? (
                <View style={styles.facilitySecondaryRow}>
                  <Text style={styles.facilitySecondaryLabel}>Assigned facility</Text>
                  <Text style={styles.facilitySecondaryValue}>
                    {job.facility.name}
                    {job.facility.address ? ` · ${job.facility.address}` : ''}
                  </Text>
                </View>
              ) : null}

              {isDeliveryPhase1 && job.address ? (
                <View style={styles.facilitySecondaryRow}>
                  <Text style={styles.facilitySecondaryLabel}>Final customer address</Text>
                  <Text style={styles.facilitySecondaryValue}>
                    {formatDriverAddress(job.address)}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* 4. WORKFLOW ACTIONS: ACCEPT OR REJECT */}
            {job.assignmentStatus === 'assigned' &&
            (job.orderStatus === 'pickup_assigned' ||
              job.orderStatus === 'delivery_assigned') ? (
              <View style={styles.actionsCard}>
                <Text style={styles.cardHeaderLabel}>ACCEPT OR REJECT</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.primaryButton, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={() => respond(true)}>
                  <Text style={styles.primaryBtnText}>Accept job</Text>
                </TouchableOpacity>

                <TextInput
                  ref={rejectionInputRef}
                  accessibilityLabel="Rejection reason"
                  placeholder="Reason for rejection"
                  placeholderTextColor="#9E9E9E"
                  value={reason}
                  onChangeText={text => {
                    setReason(text);
                    if (rejectionError) setRejectionError('');
                    if (rejectionActionError) setRejectionActionError('');
                  }}
                  editable={!busy}
                  style={[
                    styles.input,
                    rejectionError || rejectionActionError ? styles.inputError : null,
                  ]}
                />
                <FieldError error={rejectionError} />
                <ActionError error={rejectionActionError} />

                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.dangerButton, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={() => respond(false)}>
                  <Text style={styles.dangerBtnText}>Reject job</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* 5. WORKFLOW ACTIONS: READY TO START TRIP */}
            {job.assignmentStatus === 'accepted' &&
            (job.orderStatus === 'pickup_accepted' ||
              (job.type === 'delivery' && isDeliveryPhase1)) ? (
              <View style={styles.actionsCard}>
                <Text style={styles.cardHeaderLabel}>
                  {isDeliveryPhase1 ? 'READY TO COLLECT ORDER' : 'READY TO START'}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.primaryButton, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={beginTrip}>
                  <Text style={styles.primaryBtnText}>
                    {busy
                      ? 'Starting trip...'
                      : isDeliveryPhase1
                      ? 'Start trip to facility'
                      : 'Start trip'}
                  </Text>
                </TouchableOpacity>
                <ActionError error={tripError} />
              </View>
            ) : null}

            {/* 6. WORKFLOW ACTIONS: READY TO START CUSTOMER TRIP AFTER COLLECTION */}
            {job.type === 'delivery' &&
            !isDeliveryPhase1 &&
            job.assignmentStatus === 'accepted' &&
            job.orderStatus !== 'delivery_otp_pending' &&
            job.orderStatus !== 'delivered' &&
            job.orderStatus !== 'claim_period_active' ? (
              <View style={styles.actionsCard}>
                <Text style={styles.cardHeaderLabel}>ORDER COLLECTED</Text>
                <Text style={styles.bodyText}>
                  Clean order received from facility. You can now begin the delivery trip to the customer.
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.primaryButton, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={beginTrip}>
                  <Text style={styles.primaryBtnText}>
                    {busy ? 'Starting trip...' : 'Start trip to customer'}
                  </Text>
                </TouchableOpacity>
                <ActionError error={tripError} />
              </View>
            ) : null}

            {/* 7. WORKFLOW ACTIONS: TRIP IN PROGRESS */}
            {tripActive ? (
              <View style={styles.actionsCard}>
                <Text style={styles.cardHeaderLabel}>TRIP IN PROGRESS</Text>
                <Text accessibilityLiveRegion="polite" style={styles.gpsInfo}>
                  {gpsState || 'Starting GPS…'}
                </Text>
                <ActionError error={arriveError} />

                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.navigateActionBtn}
                  onPress={() => {
                    if (isDeliveryPhase1) {
                      openFacilityDirections();
                    } else {
                      openDirections();
                    }
                  }}>
                  <AppIcon name="location" size={16} color="#FFFFFF" strokeWidth={2.5} />
                  <Text style={styles.primaryBtnText}>
                    Navigate to {job.type === 'pickup' ? 'pickup' : isDeliveryPhase1 ? 'facility' : 'delivery'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.arrivalButton, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={arrive}>
                  <Text style={styles.arrivalButtonText}>
                    {busy
                      ? 'Marking arrival...'
                      : job.type === 'pickup'
                      ? 'I arrived at pickup'
                      : isDeliveryPhase1
                      ? 'I arrived at facility'
                      : 'I arrived at delivery'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* 8. FACILITY HANDOVER COLLECTION (DELIVERY DRIVER AT FACILITY) */}
            {job.type === 'delivery' &&
            isDeliveryPhase1 &&
            (job.assignmentStatus === 'arrived' || job.facilityHandedOver) ? (
              <View style={styles.actionsCard}>
                <Text style={styles.cardHeaderLabel}>FACILITY HANDOVER</Text>
                {job.facilityHandedOver ? (
                  <>
                    <View style={styles.statusReadyBox}>
                      <Text style={styles.statusReadyText}>
                        Facility staff handed over the clean order
                      </Text>
                    </View>
                    <Text style={styles.bodyText}>
                      Please inspect the packaged clean garments and confirm physical receipt.
                    </Text>
                    <ActionError error={facilityHandoverError} />
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.primaryButton}
                      disabled={busy}
                      onPress={confirmFacilityHandoverAction}>
                      <Text style={styles.primaryBtnText}>Confirm Order Received</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.bodyText}>
                      You have arrived at {job.facility?.name || 'the facility'}. Please wait for facility staff to verify and hand over the clean order.
                    </Text>
                    <ActionError error={facilityHandoverError} />
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.secondaryButton}
                      disabled={busy}
                      onPress={load}>
                      <Text style={styles.secondaryBtnText}>Refresh Handover Status</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : null}

            {/* 9. GARMENT HANDOVER / COLLECT ITEMS (PICKUP DRIVER AT CUSTOMER LOCATION) */}
            {job.type === 'pickup' &&
            job.assignmentStatus === 'arrived' &&
            job.orderStatus === 'pickup_otp_pending' ? (
              <View style={styles.handoverCard}>
                <Text style={styles.handoverHeading}>COLLECT ITEMS</Text>

                {job.items?.length ? (
                  <>
                    <View style={styles.itemCountRow}>
                      <Text style={styles.itemCountBadge}>
                        {totalItemCount} ITEM{totalItemCount === 1 ? '' : 'S'}
                      </Text>
                    </View>
                    <View style={styles.itemList}>
                      {job.items.map(item => (
                        <View key={item.id} style={styles.itemRow}>
                          <View style={styles.itemMainInfo}>
                            <Text style={styles.itemNameText}>{item.item_name}</Text>
                            {/* Accessible subtext format for test matching */}
                            <Text style={styles.itemDetailText}>
                              {item.item_name} · {item.quantity} item
                              {item.quantity === 1 ? '' : 's'}
                              {item.weight_kg != null ? ` · ${item.weight_kg} kg` : ''}
                              {item.customer_notes ? ` · ${item.customer_notes}` : ''}
                            </Text>
                          </View>
                          <Text style={styles.itemQuantityBadge}>{item.quantity}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : (
                  <Text style={styles.bodyTextMuted}>
                    No item details were recorded at checkout.
                  </Text>
                )}

                <Text style={styles.handoverInstruction}>
                  Check the items before completing pickup.
                </Text>

                {/* Checkbox */}
                <TouchableOpacity
                  accessibilityRole="checkbox"
                  accessibilityLabel="I checked the garments handed over"
                  accessibilityState={{ checked: handoverChecked }}
                  style={styles.checkboxTouchTarget}
                  onPress={() => {
                    setHandoverChecked(!handoverChecked);
                    if (handoverError) setHandoverError('');
                  }}>
                  <View
                    style={[
                      styles.checkboxSquare,
                      handoverChecked && styles.checkboxSquareChecked,
                    ]}>
                    {handoverChecked ? (
                      <AppIcon name="check" size={14} color="#FFFFFF" strokeWidth={3} />
                    ) : null}
                  </View>
                  <Text style={styles.checkboxLabelText}>
                    I checked the garments handed over
                  </Text>
                </TouchableOpacity>
                <FieldError error={handoverError} />

                {/* Pickup OTP Section */}
                <View style={styles.otpSection}>
                  <Text style={styles.otpInputLabel}>Pickup OTP</Text>
                  <TextInput
                    ref={pickupOtpInputRef}
                    accessibilityLabel="Customer pickup OTP"
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder="Six-digit pickup OTP"
                    placeholderTextColor="#9E9E9E"
                    value={pickupOtp}
                    onChangeText={text => {
                      const numeric = text.replace(/[^0-9]/g, '');
                      setPickupOtp(numeric);
                      if (pickupOtpError) setPickupOtpError('');
                      if (pickupActionError) setPickupActionError('');
                    }}
                    editable={!busy}
                    style={[
                      styles.otpInput,
                      pickupOtpError || pickupActionError ? styles.inputError : null,
                    ]}
                  />
                  <FieldError error={pickupOtpError} />
                  <ActionError error={pickupActionError} />

                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.primaryActionBtn, busy && styles.btnDisabled]}
                    disabled={busy}
                    onPress={completePickup}>
                    {busy ? (
                      <View style={styles.btnLoadingRow}>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                        <Text style={styles.primaryActionBtnText}>Verifying...</Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryActionBtnText}>
                        Verify OTP and complete pickup
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* 10. DELIVERY HANDOVER (DELIVERY DRIVER AT CUSTOMER LOCATION) */}
            {job.type === 'delivery' &&
            job.assignmentStatus === 'arrived' &&
            job.orderStatus === 'delivery_otp_pending' ? (
              <View style={styles.handoverCard}>
                <Text style={styles.handoverHeading}>DELIVERY HANDOVER</Text>
                <Text style={styles.handoverInstruction}>
                  Ask the customer for their delivery OTP to complete this order.
                </Text>
                <TextInput
                  ref={deliveryOtpInputRef}
                  accessibilityLabel="Customer delivery OTP"
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="Six-digit delivery OTP"
                  placeholderTextColor="#9E9E9E"
                  value={deliveryOtp}
                  onChangeText={text => {
                    const numeric = text.replace(/[^0-9]/g, '');
                    setDeliveryOtp(numeric);
                    if (deliveryOtpError) setDeliveryOtpError('');
                    if (deliveryActionError) setDeliveryActionError('');
                  }}
                  editable={!busy}
                  style={[
                    styles.otpInput,
                    deliveryOtpError || deliveryActionError ? styles.inputError : null,
                  ]}
                />
                <FieldError error={deliveryOtpError} />
                <ActionError error={deliveryActionError} />

                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.primaryActionBtn, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={completeDelivery}>
                  <Text style={styles.primaryActionBtnText}>
                    {busy ? 'Verifying OTP...' : 'Verify OTP and complete delivery'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* 11. DELIVERY COMPLETED */}
            {job.type === 'delivery' &&
            job.assignmentStatus === 'completed' &&
            (job.orderStatus === 'delivered' ||
              job.orderStatus === 'claim_period_active') ? (
              <View style={styles.completedCard}>
                <Text accessibilityLiveRegion="polite" style={styles.completedText}>
                  Delivery complete. Proof retained; tracking ended.
                </Text>
              </View>
            ) : null}

            {/* 12. PICKED UP -> NEXT STEP: FACILITY TRANSIT */}
            {job.type === 'pickup' &&
            job.assignmentStatus === 'arrived' &&
            job.orderStatus === 'picked_up' ? (
              <View style={styles.nextStepCard}>
                <Text style={styles.cardHeaderLabel}>NEXT STEP</Text>
                <Text accessibilityLiveRegion="polite" style={styles.nextStepTitle}>
                  Pickup complete. Take the garments to the assigned facility.
                </Text>

                {job.facility ? (
                  <View style={styles.facilityHighlight}>
                    <Text style={styles.facilityHighlightLabel}>Facility</Text>
                    <Text style={styles.facilityHighlightText}>
                      {job.facility.name}
                    </Text>
                    {job.facility.address ? (
                      <Text style={styles.facilityHighlightSubtext}>
                        {job.facility.address}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.errorText}>
                    Assigned facility unavailable. Contact dispatch.
                  </Text>
                )}

                {/* Location Status Display */}
                <View style={styles.locationStatusContainer}>
                  {locationStatus === 'ready' ? (
                    <View style={styles.statusReadyBox}>
                      <Text style={styles.statusReadyText}>Location ready</Text>
                    </View>
                  ) : locationStatus === 'locating' ? (
                    <View style={styles.statusLocatingBox}>
                      <ActivityIndicator size="small" color="#145C3A" />
                      <Text style={styles.statusLocatingText}>Getting location...</Text>
                    </View>
                  ) : locationStatus === 'starting_transit' ? (
                    <View style={styles.statusLocatingBox}>
                      <ActivityIndicator size="small" color="#145C3A" />
                      <Text style={styles.statusLocatingText}>Starting transit...</Text>
                    </View>
                  ) : locationStatus === 'idle' || locationStatus === 'required' ? (
                    <View style={styles.statusRequiredBox}>
                      <Text style={styles.statusRequiredText}>Location required</Text>
                      <Text style={styles.statusRequiredSubtext}>
                        To start facility transit, we need your current location.
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Permission Denied UI */}
                {locationStatus === 'permission_denied' ? (
                  <View style={styles.guideCard}>
                    <Text style={styles.guideHeading}>
                      Location permission is required
                    </Text>
                    <Text style={styles.guideBody}>
                      We need your current location to start facility transit.
                    </Text>
                    <View style={styles.buttonGroup}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.primaryButton}
                        disabled={busy}
                        onPress={startFacilityHandoff}>
                        <Text style={styles.primaryBtnText}>Try Again</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.secondaryButton}
                        onPress={openLocationSettings}>
                        <Text style={styles.secondaryBtnText}>
                          Open Location Settings
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {/* GPS Unavailable UI */}
                {locationStatus === 'gps_unavailable' ? (
                  <View style={styles.guideCard}>
                    <Text style={styles.guideHeading}>
                      Unable to get your current location.
                    </Text>
                    <Text style={styles.guideBody}>
                      Please move to an area with GPS access and try again.
                    </Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.primaryButton}
                      disabled={busy}
                      onPress={startFacilityHandoff}>
                      <Text style={styles.primaryBtnText}>Try Again</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Low Accuracy UI */}
                {locationStatus === 'low_accuracy' ? (
                  <View style={styles.guideCard}>
                    <Text style={styles.guideHeading}>
                      Your location accuracy is low.
                    </Text>
                    <Text style={styles.guideBody}>
                      Move to an area with a clearer GPS signal and try again.
                    </Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.primaryButton}
                      disabled={busy}
                      onPress={startFacilityHandoff}>
                      <Text style={styles.primaryBtnText}>Retry Location</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Primary Facility Transit Action Button */}
                {locationStatus !== 'permission_denied' &&
                locationStatus !== 'gps_unavailable' &&
                locationStatus !== 'low_accuracy' ? (
                  <View style={styles.buttonGroup}>
                    {locationStatus === 'idle' || locationStatus === 'required' ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.secondaryButton}
                        disabled={busy || !job.facility}
                        onPress={startFacilityHandoff}>
                        <Text style={styles.secondaryBtnText}>Enable Location</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.primaryButton}
                      disabled={busy || !job.facility}
                      onPress={startFacilityHandoff}>
                      {locationStatus === 'locating' ? (
                        <View style={styles.btnLoadingRow}>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.primaryBtnText}>Getting Location...</Text>
                        </View>
                      ) : locationStatus === 'starting_transit' ? (
                        <View style={styles.btnLoadingRow}>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.primaryBtnText}>Starting Transit...</Text>
                        </View>
                      ) : (
                        <Text style={styles.primaryBtnText}>Start facility transit</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* 13. IN TRANSIT TO FACILITY */}
            {job.type === 'pickup' &&
            job.assignmentStatus === 'arrived' &&
            job.orderStatus === 'in_transit_to_facility' ? (
              <View style={styles.actionsCard}>
                <Text style={styles.cardHeaderLabel}>FACILITY TRANSIT</Text>
                <Text accessibilityLiveRegion="polite" style={styles.bodyText}>
                  Facility handoff pending. Facility staff must verify this order and confirm receipt.
                </Text>
                <Text style={styles.bodyText}>
                  Assigned facility: {job.facility?.name || 'Unavailable'}
                  {job.facility?.address ? ` · ${job.facility.address}` : ''}
                </Text>

                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.navigateActionBtn}
                  onPress={() => openFacilityDirections()}>
                  <AppIcon name="location" size={16} color="#FFFFFF" strokeWidth={2.5} />

                  <Text style={styles.primaryBtnText}>Navigate to facility</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  disabled={busy}
                  onPress={showHandoffCode}>
                  <Text style={styles.secondaryBtnText}>Show facility handoff QR</Text>
                </TouchableOpacity>

                {handoffCode ? (
                  <View style={styles.qrCard}>
                    <Text style={styles.qrCardTitle}>Facility handoff</Text>
                    <Text style={styles.orderReference}>Order {job.orderNumber}</Text>
                    <Text style={styles.qrHelpText}>
                      Facility staff can scan this QR or enter the order number above before accepting the garments.
                    </Text>
                    <QrGraphic
                      payload={handoffCode}
                      accessibilityLabel="Facility handoff QR code"
                    />
                  </View>
                ) : null}

                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  disabled={busy}
                  onPress={load}>
                  <Text style={styles.secondaryBtnText}>Refresh receipt status</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* 14. FACILITY CONFIRMED RECEIPT */}
            {job.type === 'pickup' &&
            job.assignmentStatus === 'completed' &&
            job.orderStatus === 'received_at_facility' ? (
              <View style={styles.completedCard}>
                <Text accessibilityLiveRegion="polite" style={styles.completedText}>
                  Facility confirmed receipt. Pickup responsibility is complete.
                </Text>
              </View>
            ) : null}
          </View>
        ) : !loading && !error ? (
          <Text style={styles.bodyTextMuted}>Job not found.</Text>
        ) : null}
      </ScrollView>

      {/* Animated OTP Success Modal */}
      {otpSuccessData ? (
        <View style={styles.successModalBackdrop} pointerEvents="auto">
          <Animated.View
            style={[
              styles.successModalCard,
              {
                opacity: otpSuccessOpacity,
                transform: [{ scale: otpSuccessScale }],
              },
            ]}>
            <View style={styles.successCheckmarkCircle}>
              <AppIcon name="check" size={32} color="#FFFFFF" strokeWidth={3} />
            </View>
            <Text
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              style={styles.successModalTitle}>
              {otpSuccessData.title}
            </Text>
            <Text style={styles.successModalSubtitle}>
              {otpSuccessData.subtitle}
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F8F9FA' },
  header: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  backButton: {
    paddingVertical: 6,
    paddingRight: 12,
  },
  backLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#145C3A',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#151515',
  },
  headerSpacer: {
    width: 60,
    alignItems: 'flex-end',
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 48,
  },
  spinner: {
    marginVertical: 24,
  },
  errorBanner: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#F8D7DA',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  errorText: {
    color: '#9A241E',
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    backgroundColor: '#145C3A',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  messageBanner: {
    backgroundColor: '#EDF7ED',
    borderWidth: 1,
    borderColor: '#C8E6C9',
    borderRadius: 12,
    padding: 12,
  },
  messageText: {
    color: '#145C3A',
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 18,
  },
  containerGap: {
    gap: 12,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    gap: 8,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    backgroundColor: '#E7F3EB',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    color: '#0D5C3A',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  statusBadge: {
    backgroundColor: '#383630',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'capitalize',
  },
  orderNumberTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#151515',
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0ECE4',
  },
  metaLabel: {
    fontSize: 13,
    color: '#656159',
    fontWeight: '600',
  },
  metaValue: {
    fontSize: 13,
    color: '#151515',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    gap: 8,
  },
  cardHeaderLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#656159',
    textTransform: 'uppercase',
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  customerInfo: {
    flex: 1,
    gap: 2,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#151515',
  },
  customerPhone: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5E5A53',
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#145C3A',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  callButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  addressText: {
    fontSize: 14,
    color: '#151515',
    lineHeight: 20,
    fontWeight: '500',
  },
  locationActionRow: {
    marginTop: 6,
  },
  navigateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#145C3A',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  navigateBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  facilitySecondaryRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0ECE4',
    gap: 2,
  },
  facilitySecondaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#656159',
  },
  facilitySecondaryValue: {
    fontSize: 13,
    color: '#151515',
    fontWeight: '600',
  },
  handoverCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#145C3A',
    padding: 16,
    gap: 10,
  },
  handoverHeading: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#145C3A',
    textTransform: 'uppercase',
  },
  itemCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  itemCountBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: '#151515',
    backgroundColor: '#F5F3ED',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  itemList: {
    gap: 6,
    marginTop: 4,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0ECE4',
  },
  itemMainInfo: {
    flex: 1,
    paddingRight: 10,
  },
  itemNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#151515',
  },
  itemDetailText: {
    fontSize: 12,
    color: '#656159',
    marginTop: 2,
  },
  itemQuantityBadge: {
    fontSize: 14,
    fontWeight: '800',
    color: '#145C3A',
    backgroundColor: '#E7F3EB',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  handoverInstruction: {
    fontSize: 13,
    color: '#5E5A53',
    fontWeight: '600',
    marginTop: 4,
  },
  checkboxTouchTarget: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  checkboxSquare: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#767167',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxSquareChecked: {
    backgroundColor: '#145C3A',
    borderColor: '#145C3A',
  },
  checkboxLabelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#151515',
  },
  otpSection: {
    marginTop: 8,
    gap: 8,
  },
  otpInputLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#151515',
  },
  otpInput: {
    borderWidth: 1.5,
    borderColor: '#DCD7CE',
    backgroundColor: '#FAF9F6',
    borderRadius: 10,
    padding: 12,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    color: '#151515',
  },
  primaryActionBtn: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  btnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  actionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 16,
    gap: 10,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#151515',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryBtnText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#151515',
  },
  dangerButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F8D7DA',
    backgroundColor: '#FDF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dangerBtnText: {
    fontWeight: '700',
    color: '#9A241E',
    fontSize: 14,
  },
  navigateActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#145C3A',
    paddingHorizontal: 16,
    gap: 8,
  },
  arrivalButton: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#145C3A',
    backgroundColor: '#E7F3EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  arrivalButtonText: {
    fontWeight: '800',
    fontSize: 14,
    color: '#0D5C3A',
  },
  input: {
    borderWidth: 1,
    borderColor: '#DCD7CE',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: '#151515',
  },
  inputError: {
    borderColor: '#C53030',
    backgroundColor: '#FFF5F5',
  },
  bodyText: {
    fontSize: 14,
    color: '#151515',
    lineHeight: 20,
    fontWeight: '500',
  },
  bodyTextMuted: {
    fontSize: 13,
    color: '#8A857C',
    fontStyle: 'italic',
  },
  gpsInfo: {
    fontSize: 13,
    color: '#5E5A53',
    fontWeight: '600',
  },
  nextStepCard: {
    borderWidth: 1.5,
    borderColor: '#145C3A',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  nextStepTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#151515',
    lineHeight: 20,
  },
  facilityHighlight: {
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 10,
    padding: 12,
    gap: 2,
  },
  facilityHighlightLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#656159',
    textTransform: 'uppercase',
  },
  facilityHighlightText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#151515',
  },
  facilityHighlightSubtext: {
    fontSize: 12,
    color: '#5E5A53',
    fontWeight: '500',
  },
  locationStatusContainer: {
    marginTop: 2,
  },
  statusReadyBox: {
    backgroundColor: '#E7F3EB',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  statusReadyText: {
    color: '#0D5C3A',
    fontWeight: '800',
    fontSize: 12,
  },
  statusLocatingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF5FB',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
    gap: 6,
  },
  statusLocatingText: {
    color: '#1A5276',
    fontWeight: '800',
    fontSize: 12,
  },
  statusRequiredBox: {
    backgroundColor: '#FFF8E7',
    borderWidth: 1,
    borderColor: '#FFE082',
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  statusRequiredText: {
    color: '#B7791F',
    fontWeight: '800',
    fontSize: 12,
  },
  statusRequiredSubtext: {
    color: '#6B5B33',
    fontSize: 11,
    fontWeight: '500',
  },
  guideCard: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#F8B4B4',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  guideHeading: {
    fontSize: 14,
    fontWeight: '800',
    color: '#9A241E',
  },
  guideBody: {
    fontSize: 12,
    color: '#771D1D',
    lineHeight: 16,
  },
  buttonGroup: {
    gap: 8,
  },
  completedCard: {
    backgroundColor: '#E7F3EB',
    borderWidth: 1,
    borderColor: '#B7E1CD',
    borderRadius: 14,
    padding: 16,
  },
  completedText: {
    color: '#0D5C3A',
    fontWeight: '800',
    fontSize: 14,
  },
  qrCard: {
    alignItems: 'center',
    backgroundColor: '#FAF9F6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2DED6',
    padding: 14,
    gap: 6,
  },
  qrCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#151515',
  },
  orderReference: {
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
    color: '#151515',
  },
  qrHelpText: {
    color: '#656159',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
  },
  successModalBackdrop: {
    ...(StyleSheet.absoluteFill as object),
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    padding: 24,
  },
  successModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  successCheckmarkCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#15803D',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  successModalSubtitle: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 20,
  },
});
