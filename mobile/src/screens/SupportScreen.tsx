import React, {useState} from 'react';
import {Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Config from 'react-native-config';
import TermsAndConditionsModal from '../components/TermsAndConditionsModal';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';

const FAQ = [
  {question: 'Where is my order?', answer: 'Open Your Orders and select an order to see its status and any available driver tracking.'},
  {question: 'How do I cancel?', answer: 'Eligible orders show Cancel Order in Order Details. A reason is required.'},
  {question: 'How do I raise a claim?', answer: 'Open a delivered order. The Claims section shows the claim window and lets you add a description and photo.'},
  {question: 'Where is my refund?', answer: 'Payment and refund status appear in Order Details. Approval is handled by the support team.'},
];
type Props = {
  onBack: () => void;
  onOrders: () => void;
  initialTermsVisible?: boolean;
  initialPrivacyVisible?: boolean;
  onPrivacy?: () => void;
};
export default function SupportScreen({
  onBack,
  onOrders,
  initialTermsVisible = false,
  initialPrivacyVisible = false,
  onPrivacy,
}: Props) {
  const [termsVisible, setTermsVisible] = useState(initialTermsVisible);
  const [privacyVisible, setPrivacyVisible] = useState(initialPrivacyVisible);
  const [error, setError] = useState('');
  const phone = Config.SUPPORT_PHONE?.trim();
  const whatsapp = Config.SUPPORT_WHATSAPP?.replace(/\D/g, '');
  const email = Config.SUPPORT_EMAIL?.trim();
  const open = async (url: string) => {
    setError('');
    try {if (!await Linking.canOpenURL(url)) throw new Error('This contact option is unavailable on your device.'); await Linking.openURL(url);}
    catch (cause) {setError(cause instanceof Error ? cause.message : 'Unable to open contact option.');}
  };
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <TouchableOpacity onPress={onBack}><Text style={styles.link}>← Back</Text></TouchableOpacity>
    <Text style={styles.title}>Help & support</Text>
    <Text>For help with a specific order, open its details and use Order Help.</Text>
    <TouchableOpacity style={styles.card} onPress={onOrders}><Text style={styles.link}>Your orders →</Text></TouchableOpacity>
    <Text style={styles.heading}>Contact</Text>
    {phone ? <TouchableOpacity onPress={() => {open(`tel:${phone}`);}} style={styles.card}><Text style={styles.link}>Call support</Text></TouchableOpacity> : null}
    {whatsapp ? <TouchableOpacity onPress={() => {open(`https://wa.me/${whatsapp}`);}} style={styles.card}><Text style={styles.link}>WhatsApp support</Text></TouchableOpacity> : null}
    {email ? <TouchableOpacity onPress={() => {open(`mailto:${email}`);}} style={styles.card}><Text style={styles.link}>Email support</Text></TouchableOpacity> : null}
    {!phone && !whatsapp && !email ? <Text>Direct contact details are not configured. Please use Order Help for order-specific requests.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Text style={styles.heading}>Frequently asked questions</Text>
    {FAQ.map(entry => <View key={entry.question} style={styles.card}><Text style={styles.question}>{entry.question}</Text><Text>{entry.answer}</Text></View>)}
    <Text style={styles.heading}>Legal & Policies</Text>
    <TouchableOpacity style={styles.card} onPress={() => setTermsVisible(true)}><Text style={styles.link}>Terms & Conditions →</Text></TouchableOpacity>
    <TouchableOpacity style={styles.card} onPress={() => onPrivacy ? onPrivacy() : setPrivacyVisible(true)}><Text style={styles.link}>Privacy Policy →</Text></TouchableOpacity>
    <TermsAndConditionsModal visible={termsVisible} onClose={() => setTermsVisible(false)} />
    <PrivacyPolicyModal visible={privacyVisible} onClose={() => setPrivacyVisible(false)} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({page: {flex: 1, backgroundColor: '#fff'}, content: {padding: 20, gap: 14}, title: {fontSize: 24, fontWeight: '700'}, heading: {fontSize: 18, fontWeight: '700', marginTop: 10}, card: {borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 14, gap: 6}, question: {fontWeight: '700'}, link: {fontWeight: '700'}, error: {color: '#a11'}});
