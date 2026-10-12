import {apiRequest} from './api';

export type AdminOffer = {id: string; coupon_code: string; name: string; discount_type: 'fixed' | 'percentage';
  discount_value: number | string; minimum_order_amount: number | string; maximum_discount: number | string | null;
  starts_at: string | null; expires_at: string | null; usage_limit: number | null; is_active: boolean;
  eligibility_note: string | null; redeemedCount: number; termsLocked: boolean};
export type AdminGrowthOffer = AdminOffer;

export type AdminPackage = {id: string; name: string; description: string | null; price: number | string;
  validity_days: number | null; is_active: boolean; soldCount: number; termsLocked: boolean};
export type AdminGrowthSettings = {referral_enabled: boolean; referral_reward_points: number;
  loyalty_earn_points_per_rupee: number | string; loyalty_points_per_rupee: number;
  loyalty_minimum_redemption_rupees: number | string};
export type AdminGrowthOverview = {offers: AdminOffer[]; redemptions: Array<{id: string; offer_id: string; discount_amount: number | string; reversed_at: string | null}>;
  packages: AdminPackage[]; subscriptions: Array<{id: string; package_id: string; status: string; amount: number | string; expires_at: string}>;
  eligibility: Array<{id: string; package_id: string; service_id: string; usage_limit: number | null}>;
  services: Array<{id: string; name: string}>; settings: AdminGrowthSettings;
  referrals: Array<{id: string; status: string; reward_status: string}>;
  loyaltyHistory: Array<{id: string; points: number; transaction_type: string}>;
  audit: Array<{id: string; action: string; entity_type: string; created_at: string}>};
export type OfferInput = {couponCode: string; name: string; discountType: 'fixed' | 'percentage'; discountValue: number;
  minimumOrderAmount: number; maximumDiscount: number | null; startsAt: string | null; expiresAt: string | null;
  usageLimit: number | null; eligibilityNote: string};
export type PackageInput = {name: string; description: string; price: number; validityDays: number};
const base = '/admin/growth';
export const getAdminGrowth = (token: string) => apiRequest<AdminGrowthOverview>(base, {accessToken: token});
export const createAdminOffer = (token: string, input: OfferInput) => apiRequest<AdminOffer>(`${base}/offers`, {accessToken: token, method: 'POST', body: input});
export const updateAdminOffer = (token: string, id: string, input: OfferInput) => apiRequest<AdminOffer>(`${base}/offers/${encodeURIComponent(id)}`, {accessToken: token, method: 'PATCH', body: input});
export const setAdminOfferActive = (token: string, id: string, isActive: boolean) => apiRequest(`${base}/offers/${encodeURIComponent(id)}/active`, {accessToken: token, method: 'PATCH', body: {isActive}});
export const createAdminPackage = (token: string, input: PackageInput) => apiRequest<AdminPackage>(`${base}/packages`, {accessToken: token, method: 'POST', body: input});
export const updateAdminPackage = (token: string, id: string, input: PackageInput) => apiRequest<AdminPackage>(`${base}/packages/${encodeURIComponent(id)}`, {accessToken: token, method: 'PATCH', body: input});
export const setAdminPackageActive = (token: string, id: string, isActive: boolean) => apiRequest(`${base}/packages/${encodeURIComponent(id)}/active`, {accessToken: token, method: 'PATCH', body: {isActive}});
export const setAdminPackageEligibility = (token: string, packageId: string, serviceId: string, eligible: boolean, usageLimit: number | null) =>
  apiRequest(`${base}/packages/${encodeURIComponent(packageId)}/services/${encodeURIComponent(serviceId)}`, {accessToken: token, method: 'PATCH', body: {eligible, usageLimit}});
export const setAdminGrowthSettings = (token: string, input: {referralEnabled: boolean; referralRewardPoints: number;
  loyaltyEarnPointsPerRupee: number; loyaltyPointsPerRupee: number; loyaltyMinimumRedemptionRupees: number}) =>
  apiRequest(`${base}/settings`, {accessToken: token, method: 'PATCH', body: input});
