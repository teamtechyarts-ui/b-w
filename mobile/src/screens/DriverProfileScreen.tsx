import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {DriverProfile, getDriverProfile, updateDriverName} from '../services/driverProfileApi';

type Props = {accessToken: string; onLogout: () => Promise<void>; onBack?: () => void};

export default function DriverProfileScreen({accessToken, onLogout, onBack}: Props) {
  const [record, setRecord] = useState<DriverProfile | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await getDriverProfile(accessToken);
      setRecord(next); setName(next.profiles.full_name ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Driver profile unavailable.');
    } finally {setLoading(false);}
  }, [accessToken]);
  useEffect(() => {load();}, [load]);
  const save = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const profile = await updateDriverName(accessToken, name);
      setRecord(current => current ? {...current, profiles: profile} : current);
      setSuccess('Profile saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save profile.');
    } finally {setSaving(false);}
  };
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    {onBack ? <TouchableOpacity onPress={onBack}><Text>← Back to dashboard</Text></TouchableOpacity> : null}
    <Text style={styles.title}>Driver profile</Text>
    <Text>Your account is managed by B&W Admin.</Text>
    {loading ? <ActivityIndicator accessibilityLabel="Loading driver profile" /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {success ? <Text accessibilityRole="alert">{success}</Text> : null}
    {!record && !loading ? <TouchableOpacity onPress={() => {load();}}><Text>Retry</Text></TouchableOpacity> : null}
    {record ? <View style={styles.card}>
      <Text style={styles.label}>Full name</Text>
      <TextInput accessibilityLabel="Driver full name" style={styles.input} value={name} onChangeText={setName} maxLength={100} />
      <TouchableOpacity style={styles.button} disabled={saving} onPress={() => {save();}}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save name'}</Text></TouchableOpacity>
      <Text style={styles.label}>Verified phone</Text><Text>{record.profiles.phone ?? 'Unavailable'}</Text>
      <Text style={styles.label}>Availability</Text><Text>{record.is_available ? 'Available' : 'Unavailable'}</Text>
    </View> : null}
    <TouchableOpacity onPress={() => {onLogout();}}><Text style={styles.label}>Log out</Text></TouchableOpacity>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({page: {flex: 1, backgroundColor: '#fff'}, content: {padding: 20, gap: 16}, title: {fontSize: 26, fontWeight: '700'}, label: {fontWeight: '700'}, card: {borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 16, gap: 12}, input: {borderWidth: 1, borderColor: '#bbb', borderRadius: 8, padding: 12}, button: {backgroundColor: '#111', borderRadius: 8, padding: 14}, buttonText: {color: '#fff', textAlign: 'center', fontWeight: '700'}, error: {color: '#a11'}});
