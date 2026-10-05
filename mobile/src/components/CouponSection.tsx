import React, {useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {getActiveOffers, validateCoupon} from '../services/growthApi';
import type {CouponResult, Offer} from '../services/growthApi';
import {formatMoney} from '../utils/orderPricing';
import AppIcon from './AppIcon';

type Props = {
  accessToken: string;
  subtotal: number;
  applied: CouponResult | null;
  onChange: (coupon: CouponResult | null) => void;
};

export default function CouponSection({accessToken, subtotal, applied, onChange}: Props) {
  const [code, setCode] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(false);
  const [offersLoading, setOffersLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!accessToken) {
      setOffersLoading(false);
      return;
    }
    getActiveOffers(accessToken)
      .then(value => {
        if (active) setOffers(value || []);
      })
      .catch(() => {
        if (active) setError('Offers could not be loaded. You can still enter a code.');
      })
      .finally(() => {
        if (active) setOffersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken]);

  const apply = async (candidate: string) => {
    const trimmed = candidate.trim().toUpperCase();
    if (!trimmed) {
      setError('Enter a coupon code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await validateCoupon(accessToken, trimmed, subtotal);
      onChange(result);
      setCode(result.code);
    } catch (cause) {
      onChange(null);
      setError(cause instanceof Error ? cause.message : 'Coupon could not be applied.');
    } finally {
      setLoading(false);
    }
  };

  const removeCoupon = () => {
    onChange(null);
    setCode('');
    setError('');
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Coupons & Offers</Text>

      {applied ? (
        <View style={styles.appliedContainer}>
          <View style={styles.appliedRow}>
            <View style={styles.appliedIconCircle}>
              <AppIcon name="check" size={12} color="#059669" />
            </View>
            <View style={styles.appliedInfo}>
              <Text accessibilityLabel="Applied coupon" style={styles.appliedCode}>
                {applied.code} applied
              </Text>
              <Text style={styles.appliedDiscount}>
                ₹{formatMoney(applied.discount)} discount
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Remove coupon"
              style={styles.removeButton}
              onPress={removeCoupon}>
              <Text style={styles.removeButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.inputSection}>
          <Text style={styles.promoLabel}>Promo code</Text>
          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel="Coupon code"
              placeholder="Enter promo code"
              placeholderTextColor="#888"
              value={code}
              onChangeText={val => {
                setCode(val.toUpperCase());
                if (error) setError('');
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Apply coupon"
              disabled={loading}
              onPress={() => apply(code)}
              style={[styles.applyButton, loading && styles.applyButtonDisabled]}>
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.applyButtonText}>Apply</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!applied && (
        <View style={styles.availableSection}>
          <Text style={styles.availableHeading}>AVAILABLE OFFERS</Text>
          {offersLoading ? (
            <ActivityIndicator accessibilityLabel="Loading offers" size="small" style={styles.offersLoader} />
          ) : offers.length === 0 ? (
            <Text style={styles.noOffersText}>No active offers right now.</Text>
          ) : (
            offers.map(offer => {
              const isPercentage = offer.discount_type === 'percentage';
              const discountLabel = isPercentage
                ? `${Number(offer.discount_value)}% OFF`
                : `₹${Number(offer.discount_value).toFixed(2)} OFF`;
              const minOrder = Number(offer.minimum_order_amount || 0);

              return (
                <TouchableOpacity
                  key={offer.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Apply ${offer.coupon_code || offer.name}`}
                  onPress={() => {
                    if (offer.coupon_code) {
                      setCode(offer.coupon_code);
                      apply(offer.coupon_code);
                    }
                  }}
                  style={styles.offerItem}>
                  <View style={styles.offerItemLeft}>
                    <Text style={styles.offerName}>{offer.name}</Text>
                    <Text style={styles.offerSub}>
                      {offer.coupon_code ? `${offer.coupon_code} · ` : ''}
                      {minOrder > 0 ? `Min order ₹${formatMoney(minOrder)}` : 'No min order'}
                    </Text>
                  </View>
                  <View style={styles.offerItemRight}>
                    <Text style={styles.offerDiscountBadge}>{discountLabel}</Text>
                    <Text style={styles.tapToApplyText}>Tap to apply</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2DED6',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  title: {
    fontWeight: '800',
    fontSize: 16,
    color: '#151515',
    marginBottom: 12,
  },
  promoLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#67635B',
    marginBottom: 6,
  },
  inputSection: {
    marginBottom: 4,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0CBC1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#151515',
    backgroundColor: '#FAF9F6',
    minHeight: 44,
  },
  applyButton: {
    backgroundColor: '#151515',
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 76,
  },
  applyButtonDisabled: {
    backgroundColor: '#888',
  },
  applyButtonText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  appliedContainer: {
    backgroundColor: '#EDF9F0',
    borderWidth: 1,
    borderColor: '#A6E3B8',
    borderRadius: 12,
    padding: 12,
  },
  appliedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appliedIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#137333',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  appliedIcon: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 14,
  },
  appliedInfo: {
    flex: 1,
  },
  appliedCode: {
    fontSize: 15,
    fontWeight: '800',
    color: '#13642C',
  },
  appliedDiscount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#188038',
    marginTop: 2,
  },
  removeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D7B4B0',
    backgroundColor: '#FFF',
    minHeight: 36,
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#982C23',
    fontWeight: '800',
    fontSize: 13,
  },
  errorBox: {
    backgroundColor: '#FCEBEB',
    borderWidth: 1,
    borderColor: '#F09999',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  errorText: {
    color: '#A11',
    fontWeight: '700',
    fontSize: 13,
  },
  availableSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EAE7E0',
  },
  availableHeading: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: '#706D67',
    marginBottom: 8,
  },
  offersLoader: {
    paddingVertical: 8,
  },
  noOffersText: {
    fontSize: 13,
    color: '#706D67',
    fontStyle: 'italic',
  },
  offerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0EDE6',
  },
  offerItemLeft: {
    flex: 1,
    paddingRight: 8,
  },
  offerName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#151515',
  },
  offerSub: {
    fontSize: 12,
    color: '#6D685F',
    fontWeight: '600',
    marginTop: 2,
  },
  offerItemRight: {
    alignItems: 'flex-end',
  },
  offerDiscountBadge: {
    fontSize: 13,
    fontWeight: '900',
    color: '#151515',
  },
  tapToApplyText: {
    fontSize: 11,
    color: '#706D67',
    fontWeight: '600',
    marginTop: 2,
  },
});
