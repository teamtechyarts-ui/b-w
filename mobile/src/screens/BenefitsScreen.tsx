import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {getActiveOffers} from '../services/growthApi';
import type {Offer} from '../services/growthApi';

type Props = {accessToken: string; onBack: () => void};

export default function BenefitsScreen({accessToken, onBack}: Props) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState('');

  const refreshOffers = useCallback(async () => {
    setOffersLoading(true);
    setOffersError('');
    try {
      setOffers(await getActiveOffers(accessToken));
    } catch (cause) {
      setOffersError(cause instanceof Error ? cause.message : 'Offers are unavailable.');
    } finally {
      setOffersLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    refreshOffers();
  }, [refreshOffers]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={onBack}>
          <Text style={styles.link}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Coupons & Offers</Text>

        <View style={styles.card}>
          <Text style={styles.title}>Available Coupons</Text>
          <Text style={styles.description}>
            Apply a promotional coupon during checkout to save on your laundry orders.
          </Text>

          {offersLoading ? (
            <ActivityIndicator accessibilityLabel="Loading offers" />
          ) : null}

          {offersError ? (
            <View>
              <Text style={styles.error}>{offersError}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={refreshOffers}>
                <Text style={styles.link}>Retry offers</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!offersLoading && !offersError && !offers.length ? (
            <Text style={styles.emptyText}>No offers are available right now.</Text>
          ) : null}

          {offers.map(offer => {
            const isPercentage = offer.discount_type === 'percentage';
            const discount = isPercentage
              ? `${Number(offer.discount_value)}% OFF`
              : `₹${Number(offer.discount_value).toFixed(2)} OFF`;
            const minOrder =
              Number(offer.minimum_order_amount || 0) > 0
                ? ` on orders from ₹${Number(offer.minimum_order_amount).toFixed(2)}`
                : '';
            const maxDiscount =
              offer.maximum_discount != null
                ? ` · Max savings ₹${Number(offer.maximum_discount).toFixed(2)}`
                : '';

            return (
              <View key={offer.id} style={styles.offerItem}>
                <View style={styles.offerItemHeader}>
                  <Text style={styles.subtitle}>{offer.name}</Text>
                  {offer.coupon_code ? (
                    <Text selectable style={styles.codeBadge}>
                      {offer.coupon_code}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.discountText}>
                  {discount}
                  {minOrder}
                  {maxDiscount}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#FAF9F6'},
  content: {padding: 20, gap: 16},
  heading: {fontSize: 26, fontWeight: '900', color: '#151515'},
  card: {padding: 18, borderWidth: 1, borderColor: '#E2DED6', borderRadius: 16, backgroundColor: '#FFF', gap: 12},
  title: {fontSize: 18, fontWeight: '800', color: '#151515'},
  description: {fontSize: 14, color: '#6D685F'},
  subtitle: {fontWeight: '800', fontSize: 15, color: '#151515'},
  offerItem: {
    borderTopWidth: 1,
    borderTopColor: '#EAE7E0',
    paddingTop: 12,
    marginTop: 4,
  },
  offerItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  codeBadge: {
    backgroundColor: '#151515',
    color: '#FFF',
    fontWeight: '900',
    fontSize: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  discountText: {
    fontSize: 13,
    color: '#555149',
    fontWeight: '600',
  },
  link: {fontWeight: '800', color: '#151515', minHeight: 30, justifyContent: 'center'},
  error: {color: '#A11', fontWeight: '700'},
  emptyText: {color: '#6D685F', fontStyle: 'italic'},
});
