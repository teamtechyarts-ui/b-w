import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AppIcon from '../components/AppIcon';
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
import {
  chooseDeliveryPhoto,
  completeDriverDelivery,
  uploadDeliveryPhoto,
} from '../services/driverDeliveryApi';
import QrGraphic from '../components/QrGraphic';
import type { LocationCoordinates } from '../types/location';

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
  const [deliveryPhotoPath, setDeliveryPhotoPath] = useState('');
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const [lastDriverLocation, setLastDriverLocation] =
    useState<LocationCoordinates | null>(null);
  const actionLock = useRef(false);

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

  const isDeliveryPhase1 =
    job?.type === 'delivery' &&
    !job.facilityCollected &&
    job.orderStatus !== 'en_route_delivery' &&
    job.orderStatus !== 'delivery_otp_pending' &&
    job.orderStatus !== 'delivered' &&
    job.orderStatus !== 'claim_period_active';

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
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
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
      setError(
        cause instanceof Error ? cause.message : 'Unable to start trip.',
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const arrive = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
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
      setError(
        cause instanceof Error ? cause.message : 'Unable to mark arrival.',
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const confirmFacilityHandoverAction = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await confirmDriverFacilityHandover(accessToken, assignmentId);
      await load();
      setMessage(
        'Clean order collection confirmed! You can now start the trip to the customer delivery address.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to confirm facility collection.',
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const completePickup = async () => {
    if (actionLock.current) return;
    if (!handoverChecked) {
      setError('Review and confirm the garments handed over.');
      return;
    }
    if (!/^\d{6}$/.test(pickupOtp.trim())) {
      setError('Enter the six-digit pickup OTP.');
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await verifyDriverPickupOtp(
        accessToken,
        job!.orderId,
        pickupOtp,
      );
      if (!result.verified || result.orderStatus !== 'picked_up')
        throw new Error(
          'Pickup was not confirmed. Refresh the job before retrying.',
        );
      setPickupOtp('');
      setHandoverChecked(false);
      await load();
      setMessage('Pickup completed. The customer can see the updated order.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to verify pickup OTP.',
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const selectDeliveryPhoto = async (source: 'camera' | 'library') => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const photo = await chooseDeliveryPhoto(source);
      if (!photo) return;
      const path = await uploadDeliveryPhoto(accessToken, job!.orderId, photo);
      setDeliveryPhotoPath(path);
      setMessage(
        'Delivery photograph uploaded. Verify the customer OTP to complete delivery.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to upload delivery photograph.',
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const completeDelivery = async () => {
    if (actionLock.current) return;
    if (!/^\d{6}$/.test(deliveryOtp.trim())) {
      setError('Enter the six-digit delivery OTP.');
      return;
    }
    if (!deliveryPhotoPath) {
      setError('Take and upload a delivery photograph first.');
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await completeDriverDelivery(
        accessToken,
        job!.orderId,
        deliveryOtp,
        deliveryPhotoPath,
      );
      if (!result.delivered || result.orderStatus !== 'claim_period_active')
        throw new Error(
          'Delivery was not confirmed. Refresh the job before retrying.',
        );
      setDeliveryOtp('');
      setDeliveryPhotoPath('');
      await stopDriverTripBackground();
      await load();
      setMessage(
        'Delivery complete. Proof was retained and customer tracking has ended.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to complete delivery.',
      );
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
    if (!accept && !reason.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
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
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to update job. Refresh and try again.',
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button">
          <Text style={styles.link}>← Back to dashboard</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>ASSIGNMENT</Text>
        <Text style={styles.title}>Job details</Text>

        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading job details" />
        ) : null}

        {error ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                load();
              }}
            >
              <Text style={styles.link}>Retry job</Text>
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
            {/* 1. STATUS CARD */}
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <Text style={styles.typeBadge}>
                  {job.type === 'pickup' ? 'PICKUP' : 'DELIVERY'}
                </Text>
                <Text style={styles.statusBadgeText}>
                  {job.orderStatus === 'picked_up'
                    ? 'Picked Up'
                    : job.orderStatus === 'received_at_facility'
                    ? 'Received At Facility'
                    : job.assignmentStatus.replace(/_/g, ' ')}
                </Text>
              </View>
              <Text style={styles.orderNumberTitle}>
                Order #{job.orderNumber}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Order ID</Text>
                <Text style={styles.metaValue}>{job.orderNumber}</Text>
              </View>
            </View>

            {/* 2. DESTINATION / CUSTOMER / FACILITY CARD */}
            {job.type === 'pickup' ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionHeading}>CUSTOMER PICKUP</Text>
                <Text style={styles.subHeading}>Pickup address</Text>
                <Text style={styles.bodyText}>
                  {formatDriverAddress(job.address)}
                </Text>

                {job.customer &&
                job.assignmentStatus !== 'completed' &&
                job.orderStatus !== 'delivered' &&
                job.orderStatus !== 'received_at_facility' ? (
                  <View style={styles.customerSubSection}>
                    <Text style={styles.subHeading}>Customer contact</Text>
                    <Text style={styles.bodyText}>
                      {job.customer.name || 'Name unavailable'}
                    </Text>
                    <Text style={styles.bodyTextSecondary}>
                      {job.customer.phone || 'Phone unavailable'}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : isDeliveryPhase1 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionHeading}>
                  COLLECT ORDER (PRIMARY DESTINATION)
                </Text>
                <Text style={styles.subHeading}>Assigned Facility</Text>
                {job.facility ? (
                  <View style={styles.facilityHighlight}>
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
                  <Text style={styles.bodyTextMuted}>Facility details unavailable</Text>
                )}
                <Text style={styles.bodyTextMuted}>
                  Clean order must be collected from the facility before starting customer delivery.
                </Text>
              </View>
            ) : (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionHeading}>CUSTOMER DELIVERY</Text>
                <Text style={styles.subHeading}>Delivery address</Text>
                <Text style={styles.bodyText}>
                  {formatDriverAddress(job.address)}
                </Text>

                {job.customer &&
                job.assignmentStatus !== 'completed' &&
                job.orderStatus !== 'delivered' ? (
                  <View style={styles.customerSubSection}>
                    <Text style={styles.subHeading}>Customer contact</Text>
                    <Text style={styles.bodyText}>
                      {job.customer.name || 'Name unavailable'}
                    </Text>
                    <Text style={styles.bodyTextSecondary}>
                      {job.customer.phone || 'Phone unavailable'}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* 3. SECONDARY FACILITY / CUSTOMER INFO CARD */}
            {job.type === 'pickup' ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionHeading}>ASSIGNED FACILITY</Text>
                <Text style={styles.subHeading}>Assigned facility</Text>
                {job.facility ? (
                  <Text style={styles.bodyText}>
                    {job.facility.name}
                    {job.facility.address ? ` · ${job.facility.address}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.bodyTextMuted}>Facility unavailable</Text>
                )}
              </View>
            ) : isDeliveryPhase1 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionHeading}>
                  FINAL DESTINATION (LOCKED UNTIL COLLECTION)
                </Text>
                <Text style={styles.subHeading}>Customer delivery address</Text>
                <Text style={styles.bodyText}>
                  {formatDriverAddress(job.address)}
                </Text>
                <Text style={styles.bodyTextMuted}>
                  Customer route and OTP verification will unlock after you confirm receipt of the clean garments at the facility.
                </Text>
              </View>
            ) : (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionHeading}>FACILITY COLLECTION COMPLETED</Text>
                {job.facility ? (
                  <Text style={styles.bodyText}>
                    Collected from {job.facility.name}
                    {job.facilityCollectedAt ? ` at ${new Date(job.facilityCollectedAt).toLocaleTimeString()}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.bodyText}>Clean order collected</Text>
                )}
              </View>
            )}

            {/* 4. JOB TIMELINE */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionHeading}>JOB TIMELINE</Text>
              <View style={styles.timelineList}>
                <View style={styles.timelineRow}>
                  <Text style={styles.timelineLabel}>Assigned</Text>
                  <Text style={styles.timelineValue}>
                    {new Date(job.assignedAt).toLocaleString()}
                  </Text>
                </View>
                {job.acceptedAt ? (
                  <View style={styles.timelineRow}>
                    <Text style={styles.timelineLabel}>Accepted</Text>
                    <Text style={styles.timelineValue}>
                      {new Date(job.acceptedAt).toLocaleString()}
                    </Text>
                  </View>
                ) : null}
                {job.completedAt ? (
                  <View style={styles.timelineRow}>
                    <Text style={styles.timelineLabel}>Completed</Text>
                    <Text style={styles.timelineValue}>
                      {new Date(job.completedAt).toLocaleString()}
                    </Text>
                  </View>
                ) : null}
                {job.pickupScheduledAt ? (
                  <View style={styles.timelineRow}>
                    <Text style={styles.timelineLabel}>
                      {job.type === 'pickup' ? 'Pickup' : 'Delivery'}
                    </Text>
                    <Text style={styles.timelineValue}>
                      {new Date(job.pickupScheduledAt).toLocaleString()}{' '}
                      {job.pickupSlotLabel ?? ''}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* 5. WORKFLOW ACTIONS & NEXT STEPS */}
            {job.assignmentStatus === 'assigned' &&
            (job.orderStatus === 'pickup_assigned' ||
              job.orderStatus === 'delivery_assigned') ? (
              <View style={styles.actionsCard}>
                <Text style={styles.sectionHeading}>ACCEPT OR REJECT</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.primaryButton}
                  disabled={busy}
                  onPress={() => {
                    respond(true);
                  }}
                >
                  <Text style={styles.primaryText}>Accept job</Text>
                </TouchableOpacity>
                <TextInput
                  accessibilityLabel="Rejection reason"
                  placeholder="Reason for rejection"
                  value={reason}
                  onChangeText={setReason}
                  editable={!busy}
                  style={styles.input}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.dangerButton}
                  disabled={busy}
                  onPress={() => {
                    respond(false);
                  }}
                >
                  <Text style={styles.dangerText}>Reject job</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* READY TO START TRIP */}
            {job.assignmentStatus === 'accepted' &&
            (job.orderStatus === 'pickup_accepted' ||
              (job.type === 'delivery' && isDeliveryPhase1)) ? (
              <View style={styles.actionsCard}>
                <Text style={styles.sectionHeading}>
                  {isDeliveryPhase1 ? 'READY TO COLLECT ORDER' : 'READY TO START'}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.primaryButton}
                  disabled={busy}
                  onPress={() => {
                    beginTrip();
                  }}
                >
                  <Text style={styles.primaryText}>
                    {isDeliveryPhase1 ? 'Start trip to facility' : 'Start trip'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* READY TO START CUSTOMER TRIP AFTER COLLECTION */}
            {job.type === 'delivery' &&
            !isDeliveryPhase1 &&
            job.assignmentStatus === 'accepted' &&
            job.orderStatus !== 'delivery_otp_pending' &&
            job.orderStatus !== 'delivered' &&
            job.orderStatus !== 'claim_period_active' ? (
              <View style={styles.actionsCard}>
                <Text style={styles.sectionHeading}>ORDER COLLECTED</Text>
                <Text style={styles.bodyText}>
                  Clean order received from facility. You can now begin the delivery trip to the customer.
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.primaryButton}
                  disabled={busy}
                  onPress={() => {
                    beginTrip();
                  }}
                >
                  <Text style={styles.primaryText}>Start trip to customer</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* TRIP IN PROGRESS */}
            {tripActive ? (
              <View style={styles.actionsCard}>
                <Text style={styles.sectionHeading}>TRIP IN PROGRESS</Text>
                <Text accessibilityLiveRegion="polite" style={styles.gpsInfo}>
                  {gpsState || 'Starting GPS…'}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.navigationButton}
                  onPress={() => {
                    if (isDeliveryPhase1) {
                      openFacilityDirections();
                    } else {
                      openDirections();
                    }
                  }}
                >
                  <Text style={styles.primaryText}>
                    Navigate to {job.type === 'pickup' ? 'pickup' : isDeliveryPhase1 ? 'facility' : 'delivery'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  disabled={busy}
                  onPress={() => {
                    arrive();
                  }}
                >
                  <Text style={styles.secondaryText}>
                    {job.type === 'pickup'
                      ? 'I arrived at pickup'
                      : isDeliveryPhase1
                      ? 'I arrived at facility'
                      : 'I arrived at delivery'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* FACILITY HANDOVER COLLECTION (DELIVERY DRIVER AT FACILITY) */}
            {job.type === 'delivery' &&
            isDeliveryPhase1 &&
            (job.assignmentStatus === 'arrived' || job.facilityHandedOver) ? (
              <View style={styles.actionsCard}>
                <Text style={styles.sectionHeading}>FACILITY HANDOVER</Text>
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
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.primaryButton}
                      disabled={busy}
                      onPress={confirmFacilityHandoverAction}
                    >
                      <Text style={styles.primaryText}>Confirm Order Received</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.bodyText}>
                      You have arrived at {job.facility?.name || 'the facility'}. Please wait for facility staff to verify and hand over the clean order.
                    </Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.secondaryButton}
                      disabled={busy}
                      onPress={load}
                    >
                      <Text style={styles.secondaryText}>Refresh Handover Status</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : null}

            {job.type === 'pickup' &&
            job.assignmentStatus === 'arrived' &&
            job.orderStatus === 'pickup_otp_pending' ? (
              <View style={styles.actionsCard}>
                <Text style={styles.sectionHeading}>GARMENT HANDOVER</Text>
                <Text style={styles.heading}>Garment handover</Text>
                <Text style={styles.bodyText}>
                  Review the customer’s listed items, then ask for the pickup
                  OTP. Completion is recorded only after the OTP is verified.
                </Text>
                {job.items?.length ? (
                  <View style={styles.itemList}>
                    {job.items.map(item => (
                      <View key={item.id} style={styles.itemRow}>
                        <Text style={styles.bodyText}>
                          {item.item_name} · {item.quantity} item
                          {item.quantity === 1 ? '' : 's'}
                          {item.weight_kg != null
                            ? ` · ${item.weight_kg} kg`
                            : ''}
                          {item.customer_notes
                            ? ` · ${item.customer_notes}`
                            : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.bodyTextMuted}>
                    No item details were recorded at checkout.
                  </Text>
                )}
                <TouchableOpacity
                  accessibilityRole="checkbox"
                  accessibilityLabel="I checked the garments handed over"
                  accessibilityState={{ checked: handoverChecked }}
                  style={styles.checkboxRow}
                  onPress={() => setHandoverChecked(!handoverChecked)}
                >
                  <View style={[styles.checkboxBox, handoverChecked && styles.checkboxBoxChecked]}>
                    {handoverChecked ? <AppIcon name="check" size={12} color="#FFFFFF" /> : null}
                  </View>
                  <Text style={styles.checkboxText}>
                    I checked the garments handed over
                  </Text>
                </TouchableOpacity>
                <TextInput
                  accessibilityLabel="Customer pickup OTP"
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="Six-digit pickup OTP"
                  value={pickupOtp}
                  onChangeText={setPickupOtp}
                  editable={!busy}
                  style={styles.input}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.primaryButton}
                  disabled={busy}
                  onPress={() => {
                    completePickup();
                  }}
                >
                  <Text style={styles.primaryText}>
                    Verify OTP and complete pickup
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {job.type === 'delivery' &&
            job.assignmentStatus === 'arrived' &&
            job.orderStatus === 'delivery_otp_pending' ? (
              <View style={styles.actionsCard}>
                <Text style={styles.sectionHeading}>DELIVERY HANDOVER</Text>
                <Text style={styles.heading}>Delivery handover</Text>
                <Text style={styles.bodyText}>
                  Ask the customer for their delivery OTP. A delivery photograph
                  is required before completion.
                </Text>
                <View style={styles.buttonGroup}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.secondaryButton}
                    disabled={busy}
                    onPress={() => {
                      selectDeliveryPhoto('camera');
                    }}
                  >
                    <Text style={styles.secondaryText}>
                      {deliveryPhotoPath
                        ? 'Retake delivery photo'
                        : 'Take delivery photo'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.secondaryButton}
                    disabled={busy}
                    onPress={() => {
                      selectDeliveryPhoto('library');
                    }}
                  >
                    <Text style={styles.secondaryText}>
                      Choose photo from phone
                    </Text>
                  </TouchableOpacity>
                </View>
                {deliveryPhotoPath ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={styles.successBadgeText}
                  >
                    Delivery photograph uploaded
                  </Text>
                ) : (
                  <Text style={styles.bodyTextMuted}>
                    No delivery photograph uploaded.
                  </Text>
                )}
                <TextInput
                  accessibilityLabel="Customer delivery OTP"
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="Six-digit delivery OTP"
                  value={deliveryOtp}
                  onChangeText={setDeliveryOtp}
                  editable={!busy}
                  style={styles.input}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.primaryButton}
                  disabled={busy}
                  onPress={() => {
                    completeDelivery();
                  }}
                >
                  <Text style={styles.primaryText}>
                    Verify OTP and complete delivery
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {job.type === 'delivery' &&
            job.assignmentStatus === 'completed' &&
            (job.orderStatus === 'delivered' ||
              job.orderStatus === 'claim_period_active') ? (
              <View style={styles.completedCard}>
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.completedText}
                >
                  Delivery complete. Proof retained; tracking ended.
                </Text>
              </View>
            ) : null}

            {/* PICKED UP -> NEXT STEP: FACILITY TRANSIT */}
            {job.type === 'pickup' &&
            job.assignmentStatus === 'arrived' &&
            job.orderStatus === 'picked_up' ? (
              <View style={styles.nextStepCard}>
                <Text style={styles.sectionHeading}>NEXT STEP</Text>
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.nextStepTitle}
                >
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
                  <Text style={styles.error}>
                    Assigned facility unavailable. Contact dispatch.
                  </Text>
                )}

                {/* Location Status Display */}
                <View style={styles.locationStatusContainer}>
                  {locationStatus === 'ready' ? (
                    <View style={styles.statusReadyBox}>
                      <Text style={styles.statusReadyText}>
                        Location ready
                      </Text>
                    </View>
                  ) : locationStatus === 'locating' ? (
                    <View style={styles.statusLocatingBox}>
                      <ActivityIndicator size="small" color="#145C3A" />
                      <Text style={styles.statusLocatingText}>
                        Getting location...
                      </Text>
                    </View>
                  ) : locationStatus === 'starting_transit' ? (
                    <View style={styles.statusLocatingBox}>
                      <ActivityIndicator size="small" color="#145C3A" />
                      <Text style={styles.statusLocatingText}>
                        Starting transit...
                      </Text>
                    </View>
                  ) : locationStatus === 'idle' || locationStatus === 'required' ? (
                    <View style={styles.statusRequiredBox}>
                      <Text style={styles.statusRequiredText}>
                        Location required
                      </Text>
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
                        onPress={startFacilityHandoff}
                      >
                        <Text style={styles.primaryText}>Try Again</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.secondaryButton}
                        onPress={openLocationSettings}
                      >
                        <Text style={styles.secondaryText}>
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
                      onPress={startFacilityHandoff}
                    >
                      <Text style={styles.primaryText}>Try Again</Text>
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
                      onPress={startFacilityHandoff}
                    >
                      <Text style={styles.primaryText}>Retry Location</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Primary Action Button */}
                {locationStatus !== 'permission_denied' &&
                locationStatus !== 'gps_unavailable' &&
                locationStatus !== 'low_accuracy' ? (
                  <View style={styles.buttonGroup}>
                    {locationStatus === 'idle' || locationStatus === 'required' ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.secondaryButton}
                        disabled={busy || !job.facility}
                        onPress={startFacilityHandoff}
                      >
                        <Text style={styles.secondaryText}>
                          Enable Location
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.primaryButton}
                      disabled={busy || !job.facility}
                      onPress={startFacilityHandoff}
                    >
                      {locationStatus === 'locating' ? (
                        <View style={styles.buttonRow}>
                          <ActivityIndicator size="small" color="#fff" />
                          <Text style={styles.primaryText}>
                            Getting Location...
                          </Text>
                        </View>
                      ) : locationStatus === 'starting_transit' ? (
                        <View style={styles.buttonRow}>
                          <ActivityIndicator size="small" color="#fff" />
                          <Text style={styles.primaryText}>
                            Starting Transit...
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.primaryText}>
                          Start facility transit
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}

            {job.type === 'pickup' &&
            job.assignmentStatus === 'arrived' &&
            job.orderStatus === 'in_transit_to_facility' ? (
              <View style={styles.actionsCard}>
                <Text style={styles.sectionHeading}>FACILITY TRANSIT</Text>
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.bodyText}
                >
                  Facility handoff pending. Facility staff must verify this
                  order and confirm receipt.
                </Text>
                <Text style={styles.bodyText}>
                  Assigned facility: {job.facility?.name || 'Unavailable'}
                  {job.facility?.address ? ` · ${job.facility.address}` : ''}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.navigationButton}
                  onPress={() => {
                    openFacilityDirections();
                  }}
                >
                  <Text style={styles.primaryText}>Navigate to facility</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  disabled={busy}
                  onPress={() => {
                    showHandoffCode();
                  }}
                >
                  <Text style={styles.secondaryText}>
                    Show facility handoff QR
                  </Text>
                </TouchableOpacity>
                {handoffCode ? (
                  <View style={styles.qrCard}>
                    <Text style={styles.heading}>Facility handoff</Text>
                    <Text style={styles.orderReference}>
                      Order {job.orderNumber}
                    </Text>
                    <Text style={styles.help}>
                      Facility staff can scan this QR or enter the order number
                      above before accepting the garments.
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
                  onPress={() => {
                    load();
                  }}
                >
                  <Text style={styles.secondaryText}>
                    Refresh receipt status
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {job.type === 'pickup' &&
            job.assignmentStatus === 'completed' &&
            job.orderStatus === 'received_at_facility' ? (
              <View style={styles.completedCard}>
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.completedText}
                >
                  Facility confirmed receipt. Pickup responsibility is
                  complete.
                </Text>
              </View>
            ) : null}
          </View>
        ) : !loading && !error ? (
          <Text style={styles.bodyTextMuted}>Job not found.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F6F2' },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '800',
    color: '#67635B',
    marginTop: 4,
  },
  title: { fontSize: 28, fontWeight: '900', color: '#151515' },
  heading: { fontSize: 17, fontWeight: '900', color: '#151515' },
  sectionHeading: {
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: '800',
    color: '#767167',
    marginBottom: 4,
  },
  subHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8A857B',
    marginTop: 4,
  },
  bodyText: { fontSize: 15, color: '#222', lineHeight: 22, fontWeight: '500' },
  bodyTextSecondary: { fontSize: 14, color: '#5E5A53', fontWeight: '500' },
  bodyTextMuted: { fontSize: 14, color: '#8A857B' },
  link: { fontWeight: '800', color: '#151515', fontSize: 14 },
  error: { color: '#9A241E', fontWeight: '700', fontSize: 14 },
  errorBanner: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#F8B4B4',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  messageBanner: {
    backgroundColor: '#EBF5FB',
    borderWidth: 1,
    borderColor: '#AED6F1',
    borderRadius: 12,
    padding: 12,
  },
  messageText: { color: '#1A5276', fontWeight: '700', fontSize: 14 },
  containerGap: { gap: 14 },
  statusCard: {
    borderWidth: 1,
    borderColor: '#E2DED6',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    backgroundColor: '#E7F3EB',
    color: '#0D5C3A',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  statusBadgeText: {
    fontWeight: '800',
    textTransform: 'capitalize',
    color: '#4A4640',
    fontSize: 13,
  },
  orderNumberTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#151515',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EBE7DF',
  },
  metaLabel: { fontSize: 13, color: '#767167', fontWeight: '600' },
  metaValue: { fontSize: 13, color: '#151515', fontWeight: '700' },
  sectionCard: {
    borderWidth: 1,
    borderColor: '#E2DED6',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  customerSubSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EBE7DF',
    gap: 2,
  },
  timelineList: { gap: 8, marginTop: 4 },
  timelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineLabel: { fontSize: 13, color: '#767167', fontWeight: '600' },
  timelineValue: { fontSize: 13, color: '#151515', fontWeight: '700' },
  actionsCard: {
    borderWidth: 1,
    borderColor: '#E2DED6',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  nextStepCard: {
    borderWidth: 2,
    borderColor: '#D4CEBF',
    backgroundColor: '#FAF9F5',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  nextStepTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#151515',
    lineHeight: 22,
  },
  facilityHighlight: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  facilityHighlightLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#767167',
    textTransform: 'uppercase',
  },
  facilityHighlightText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#151515',
  },
  facilityHighlightSubtext: {
    fontSize: 13,
    color: '#5E5A53',
    fontWeight: '500',
  },
  locationStatusContainer: { marginTop: 2 },
  statusReadyBox: {
    backgroundColor: '#E7F3EB',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  statusReadyText: { color: '#0D5C3A', fontWeight: '800', fontSize: 13 },
  statusLocatingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF5FB',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    gap: 6,
  },
  statusLocatingText: { color: '#1A5276', fontWeight: '800', fontSize: 13 },
  statusRequiredBox: {
    backgroundColor: '#FFF8E7',
    borderWidth: 1,
    borderColor: '#FFE082',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  statusRequiredText: { color: '#B7791F', fontWeight: '800', fontSize: 13 },
  statusRequiredSubtext: { color: '#6B5B33', fontSize: 12, fontWeight: '500' },
  guideCard: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#F8B4B4',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  guideHeading: { fontSize: 15, fontWeight: '800', color: '#9A241E' },
  guideBody: { fontSize: 13, color: '#771D1D', lineHeight: 18 },
  buttonGroup: { gap: 10 },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#151515',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryText: { fontWeight: '800', fontSize: 15, color: '#151515' },
  navigationButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#145C3A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dangerButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B94A40',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dangerText: { fontWeight: '800', color: '#9A241E', fontSize: 15 },
  completedCard: {
    backgroundColor: '#E7F3EB',
    borderWidth: 1,
    borderColor: '#B7E1CD',
    borderRadius: 14,
    padding: 16,
  },
  completedText: { color: '#0D5C3A', fontWeight: '800', fontSize: 15 },
  gpsInfo: { fontSize: 13, color: '#5E5A53', fontWeight: '600' },
  itemList: { gap: 6, marginVertical: 4 },
  itemRow: {
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EBE7DF',
  },
  checkboxRow: {
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#767167',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxBoxChecked: {
    backgroundColor: '#151515',
    borderColor: '#151515',
  },
  checkboxText: { fontSize: 15, fontWeight: '700', color: '#151515' },
  input: {
    borderWidth: 1,
    borderColor: '#CFCAC0',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
  },
  successBadgeText: {
    color: '#0D5C3A',
    fontWeight: '800',
    fontSize: 13,
  },
  qrCard: {
    alignItems: 'center',
    backgroundColor: '#F3F0E9',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  orderReference: { fontSize: 16, fontWeight: '900', textAlign: 'center' },
  help: { color: '#666159', textAlign: 'center', fontSize: 13 },
});
