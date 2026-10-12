import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {activateAdminStaff, deactivateAdminStaff, FacilityChoice, getAdminStaff, listAdminFacilities, reassignAdminStaffFacility, revokeAdminStaffAccess, StaffDetail, updateDriverAvailability, updateDriverPin} from '../services/adminStaffApi';

type Props = {accessToken: string; profileId: string; onBack: () => void};
export default function AdminStaffDetailScreen({accessToken, profileId, onBack}: Props) {
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [facilities, setFacilities] = useState<FacilityChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Driver PIN change state
  const [showChangePin, setShowChangePin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [person, places] = await Promise.all([getAdminStaff(accessToken, profileId), listAdminFacilities(accessToken)]);
      setDetail(person); setFacilities(places.filter(place => place.is_active));
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Staff profile unavailable.');}
    finally {setLoading(false);}
  }, [accessToken, profileId]);
  useEffect(() => {load();}, [load]);

  const handleToggleAvailability = async (targetState: boolean) => {
    if (saving) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      await updateDriverAvailability(accessToken, profileId, targetState);
      await load();
      setSuccess(targetState ? 'Driver marked as available.' : 'Driver marked as unavailable.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update driver availability.');
    } finally {
      setSaving(false);
    }
  };

  const change = async (action: 'activate' | 'deactivate' | 'revoke', facilityId?: string) => {
    if (saving) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      if (facilityId) await reassignAdminStaffFacility(accessToken, profileId, facilityId);
      else if (action === 'activate') await activateAdminStaff(accessToken, profileId);
      else if (action === 'revoke') await revokeAdminStaffAccess(accessToken, profileId);
      else await deactivateAdminStaff(accessToken, profileId);
      await load(); setSuccess(facilityId ? 'Facility reassigned.' : action === 'activate' ? 'Staff access restored.' : 'Staff access blocked.');
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Staff action failed.');}
    finally {setSaving(false);}
  };

  const handleUpdatePin = async () => {
    setPinError('');
    if (!newPin || !/^\d{6}$/.test(newPin)) {
      setPinError('New PIN must be exactly 6 numeric digits.');
      return;
    }
    if (confirmNewPin !== newPin) {
      setPinError('PIN confirmation does not match.');
      return;
    }
    setSavingPin(true);
    try {
      await updateDriverPin(accessToken, profileId, newPin.trim());
      setSuccess('Staff permanent PIN updated successfully.');
      setShowChangePin(false);
      setNewPin('');
      setConfirmNewPin('');
      await load();
    } catch (cause) {
      setPinError(cause instanceof Error ? cause.message : 'Failed to update PIN.');
    } finally {
      setSavingPin(false);
    }
  };

  const staff = detail?.staff;
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <TouchableOpacity accessibilityRole="button" onPress={onBack}><Text style={styles.link}>← Staff</Text></TouchableOpacity>
    <Text style={styles.title}>Staff profile</Text>
    <TouchableOpacity accessibilityRole="button" onPress={() => {load();}}><Text style={styles.link}>Refresh staff</Text></TouchableOpacity>
    {loading ? <ActivityIndicator accessibilityLabel="Loading staff profile" /> : null}
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><TouchableOpacity onPress={() => {load();}}><Text style={styles.link}>Retry profile</Text></TouchableOpacity></> : null}
    {success ? <Text accessibilityRole="alert" style={styles.successText}>{success}</Text> : null}
    {!loading && staff ? <>
      <View style={styles.card}><Text style={styles.bold}>{staff.profiles?.full_name || 'Staff'}</Text>
        <Text>Phone: {staff.profiles?.phone || 'Not provided'}</Text>
        <Text>Role: {staff.role.replace(/_/g, ' ')}</Text>
        <Text>Access: {staff.profiles?.is_active ? 'Active' : 'Disabled'}</Text>
        <Text>Facility: {staff.facilities?.name || 'Not assigned'}</Text>
        {staff.role === 'driver' ? (
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4}}>
            <Text>Availability: <Text style={styles.bold}>{staff.is_available ? 'Available' : 'Unavailable'}</Text></Text>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={saving}
              onPress={() => handleToggleAvailability(!staff.is_available)}>
              <Text style={styles.link}>{staff.is_available ? 'Set Unavailable' : 'Set Available'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {staff.role === 'driver' || staff.role === 'facility_employee' ? (
        <View style={styles.card}>
          <Text style={styles.heading}>
            {staff.role === 'driver' ? 'Driver Access PIN' : 'Facility Employee Access PIN'}
          </Text>
          <Text style={styles.subtext}>
            Permanent credential used for staff sign in. No SMS OTP required.
          </Text>
          <View style={styles.pinRow}>
            <Text style={styles.bold}>Staff Credentials</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => { setShowChangePin(!showChangePin); setPinError(''); }}>
              <Text style={styles.link}>{showChangePin ? 'Cancel' : 'Change PIN'}</Text>
            </TouchableOpacity>
          </View>
          {showChangePin ? (
            <View style={styles.changePinForm}>
              {pinError ? <Text accessibilityRole="alert" style={styles.error}>{pinError}</Text> : null}
              <TextInput
                placeholder="New 6-digit PIN"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                value={newPin}
                onChangeText={text => setNewPin(text.replace(/\D/g, '').slice(0, 6))}
                style={styles.pinTextInput}
              />
              <TextInput
                placeholder="Confirm New 6-digit PIN"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                value={confirmNewPin}
                onChangeText={text => setConfirmNewPin(text.replace(/\D/g, '').slice(0, 6))}
                style={styles.pinTextInput}
              />
              <TouchableOpacity
                accessibilityRole="button"
                disabled={savingPin || !newPin || !confirmNewPin}
                onPress={handleUpdatePin}
                style={[styles.submitPinBtn, (savingPin || !newPin || !confirmNewPin) && styles.disabledBtn]}>
                {savingPin ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitPinBtnText}>Update PIN</Text>}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      {staff.profiles?.is_active ? <>
        <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => {change('deactivate');}}><Text style={styles.link}>Deactivate staff</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => {change('revoke');}}><Text style={styles.link}>Revoke access and require Admin re-enable</Text></TouchableOpacity>
      </> : <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => {change('activate');}}><Text style={styles.link}>Re-enable staff</Text></TouchableOpacity>}
      {staff.role === 'facility_employee' || staff.role === 'manager' ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Assigned Facility</Text>
          <Text>
            Current facility: <Text style={styles.bold}>{staff.facilities?.name || 'Not assigned'}</Text>
            {staff.facilities?.is_active === false ? ' (Inactive)' : staff.facilities?.is_active ? ' (Active)' : ''}
          </Text>
          <Text style={styles.subtext}>
            Reassigning moves this employee's operational scope to another active facility.
          </Text>
          <Text style={[styles.bold, {marginTop: 6}]}>Change Facility:</Text>
          {facilities.filter(place => place.id !== staff.facility_id).length ? (
            <View style={{gap: 8, marginTop: 4}}>
              {facilities.filter(place => place.id !== staff.facility_id).map(place => (
                <TouchableOpacity
                  key={place.id}
                  accessibilityRole="button"
                  disabled={saving}
                  style={styles.reassignFacilityBtn}
                  onPress={() => {change('deactivate', place.id);}}
                >
                  <Text style={styles.reassignFacilityBtnText}>Move to {place.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={styles.subtext}>No other active facilities available for reassignment.</Text>
          )}
        </View>
      ) : null}
      <Text style={styles.heading}>Workload and history</Text>
      {detail?.workload.length ? detail.workload.map(item => <Text key={item.id}>Order {item.order_id} · {item.status || item.current_status || 'Recorded'}</Text>) : <Text>No assignments or Facility operations yet.</Text>}
      <Text style={styles.heading}>Admin action audit</Text>
      {detail?.audit.length ? detail.audit.map(item => <Text key={item.id}>{item.action.replace(/_/g, ' ')} · {new Date(item.created_at).toLocaleString('en-IN')}</Text>) : <Text>No Admin actions recorded.</Text>}
    </> : null}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#fff'},
  content: {padding: 20, gap: 12},
  title: {fontSize: 25, fontWeight: '700'},
  heading: {fontSize: 19, fontWeight: '700'},
  card: {padding: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, gap: 6},
  bold: {fontWeight: '700'},
  link: {fontWeight: '700', color: '#0284C7'},
  error: {color: '#a11'},
  successText: {color: '#047857', fontWeight: '600'},
  subtext: {fontSize: 13, color: '#666'},
  pinRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4},
  changePinForm: {gap: 8, marginTop: 10, backgroundColor: '#F8FAFC', padding: 12, borderRadius: 8},
  pinTextInput: {borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, backgroundColor: '#fff', fontSize: 16, letterSpacing: 3},
  submitPinBtn: {backgroundColor: '#111827', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 4},
  submitPinBtnText: {color: '#fff', fontWeight: '700'},
  disabledBtn: {opacity: 0.5},
  reassignFacilityBtn: {backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#D1D5DB', padding: 10, borderRadius: 8, alignItems: 'center'},
  reassignFacilityBtnText: {color: '#1F2937', fontWeight: '700'},
});
