import {BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../supabase/supabase.service';

@Injectable()
export class AdminGrowthService {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() { return this.supabase.admin; }

  private isSchemaCacheError(error: any): boolean {
    return Boolean(
      error?.code === 'PGRST202' ||
      error?.code === 'PGRST204' ||
      error?.code === '42703' ||
      (typeof error?.message === 'string' && (
        error.message.includes('schema cache') ||
        error.message.includes('does not exist') ||
        error.message.includes('Could not find')
      )) ||
      (typeof error?.details === 'string' && (
        error.details.includes('schema cache') ||
        error.details.includes('does not exist') ||
        error.details.includes('Could not find')
      ))
    );
  }

  private async requireAdmin(actorId: string) {
    const { data, error } = await this.db.from('profile_roles')
      .select('roles(code)').eq('profile_id', actorId);
    if (error || !(data ?? []).some((row: any) => row.roles?.code === 'admin')) {
      throw new ForbiddenException('Admin role required');
    }
  }

  private async audit(actorId: string, action: string, entityType: string, entityId: string | null, before: any, after: any) {
    await this.db.from('admin_growth_audit').insert({
      actor_profile_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before_value: before ?? null,
      after_value: after ?? {},
    }).then(() => {}, () => {});
  }

  async overview() {
    let offers: any = await this.db
      .from('offers')
      .select('id,code,coupon_code,name,discount_type,discount_value,minimum_order_amount,maximum_discount,starts_at,expires_at,usage_limit,is_active,eligibility_note')
      .order('name');
    if (offers.error && this.isSchemaCacheError(offers.error)) {
      offers = await this.db
        .from('offers')
        .select('id,code,coupon_code,name,discount_type,discount_value,minimum_order_amount,maximum_discount,starts_at,expires_at,usage_limit,is_active')
        .order('name');
    }

    let packages: any = await this.db
      .from('packages')
      .select('id,name,description,monthly_price,price,validity_days,is_active')
      .order('name');
    if (packages.error && this.isSchemaCacheError(packages.error)) {
      packages = await this.db
        .from('packages')
        .select('id,name,description,monthly_price,price,is_active')
        .order('name');
    }

    const [redemptions, subscriptions, eligibility, services, settings, referrals, loyalty, audit] = await Promise.all([
      this.db.from('offer_redemptions').select('id,offer_id,order_id,discount_amount,created_at,reversed_at').order('created_at', {ascending: false}).limit(200),
      this.db.from('package_subscriptions').select('id,package_id,customer_id,status,amount,expires_at').order('started_at', {ascending: false}).limit(200),
      this.db.from('package_services').select('id,package_id,service_id,usage_limit'),
      this.db.from('services').select('id,name,is_active').eq('is_active', true),
      this.db.from('admin_growth_settings').select('*').eq('id', true).maybeSingle(),
      this.db.from('referrals').select('id,referral_code,status,reward_status,created_at').order('created_at', {ascending: false}).limit(100),
      this.db.from('loyalty_point_transactions').select('id,points,transaction_type,reference_type,created_at').order('created_at', {ascending: false}).limit(100),
      this.db.from('admin_growth_audit').select('id,actor_profile_id,action,entity_type,entity_id,created_at').order('created_at', {ascending: false}).limit(100),
    ]);

    if (offers.error) throw new BadRequestException(`Offers query failed: ${offers.error.message}`);
    if (packages.error) throw new BadRequestException(`Packages query failed: ${packages.error.message}`);
    if (redemptions.error) throw new BadRequestException(`Redemptions query failed: ${redemptions.error.message}`);
    if (subscriptions.error) throw new BadRequestException(`Subscriptions query failed: ${subscriptions.error.message}`);
    if (eligibility.error) throw new BadRequestException(`Eligibility query failed: ${eligibility.error.message}`);
    if (services.error) throw new BadRequestException(`Services query failed: ${services.error.message}`);
    if (referrals.error) throw new BadRequestException(`Referrals query failed: ${referrals.error.message}`);
    if (loyalty.error) throw new BadRequestException(`Loyalty query failed: ${loyalty.error.message}`);
    if (audit.error) throw new BadRequestException(`Audit query failed: ${audit.error.message}`);

    const resolvedSettings = settings.data ?? {
      id: true,
      referral_enabled: true,
      referral_reward_points: 0,
      loyalty_earn_points_per_rupee: 0.01,
      loyalty_points_per_rupee: 10,
      loyalty_minimum_redemption_rupees: 100,
    };

    const offerCounts = await Promise.all(((offers.data as any[]) ?? []).map(async (offer: any) => {
      const [active, all] = await Promise.all([
        this.db.from('offer_redemptions').select('id', {count: 'exact', head: true}).eq('offer_id', offer.id).is('reversed_at', null),
        this.db.from('offer_redemptions').select('id', {count: 'exact', head: true}).eq('offer_id', offer.id),
      ]);
      if (active.error || all.error) throw new BadRequestException('Offer redemption counts unavailable');
      return {redeemedCount: active.count ?? 0, termsLocked: (all.count ?? 0) > 0};
    }));

    const soldCounts = await Promise.all(((packages.data as any[]) ?? []).map(async (pkg: any) => {
      const result = await this.db.from('package_subscriptions').select('id', {count: 'exact', head: true}).eq('package_id', pkg.id);
      if (result.error) throw new BadRequestException('Package sales count unavailable');
      return result.count ?? 0;
    }));

    return {
      offers: ((offers.data as any[]) ?? []).map((offer: any, index: number) => ({
        ...offer,
        eligibility_note: offer.eligibility_note ?? null,
        ...offerCounts[index],
      })),
      redemptions: redemptions.data ?? [],
      packages: ((packages.data as any[]) ?? []).map((pkg: any, index: number) => ({
        ...pkg,
        validity_days: pkg.validity_days ?? 30,
        soldCount: soldCounts[index],
        termsLocked: soldCounts[index] > 0,
      })),
      subscriptions: subscriptions.data ?? [],
      eligibility: eligibility.data ?? [],
      services: services.data ?? [],
      settings: resolvedSettings,
      referrals: referrals.data ?? [],
      loyaltyHistory: loyalty.data ?? [],
      audit: audit.data ?? [],
    };
  }

  private async executeDirectChange(actor: string, action: string, payload: Record<string, any>) {
    await this.requireAdmin(actor);

    if (action === 'create_offer' || action === 'update_offer') {
      const couponCode = String(payload.couponCode || '').trim().toUpperCase();
      const name = String(payload.name || '').trim();
      const discountType = String(payload.discountType || 'fixed');
      const discountValue = Number(payload.discountValue);
      const minimumOrderAmount = Number(payload.minimumOrderAmount ?? 0);
      const maximumDiscount = payload.maximumDiscount != null ? Number(payload.maximumDiscount) : null;
      const startsAt = payload.startsAt ? new Date(payload.startsAt).toISOString() : null;
      const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).toISOString() : null;
      const usageLimit = payload.usageLimit != null ? Number(payload.usageLimit) : null;
      const eligibilityNote = payload.eligibilityNote ? String(payload.eligibilityNote).trim() : null;

      if (!/^[A-Z0-9-]{1,64}$/.test(couponCode) || name.length < 2 || name.length > 120 ||
        !['fixed', 'percentage'].includes(discountType) || !Number.isFinite(discountValue) || discountValue <= 0 ||
        (discountType === 'percentage' && discountValue > 100) || minimumOrderAmount < 0 ||
        (maximumDiscount != null && maximumDiscount < 0) ||
        (startsAt && expiresAt && new Date(expiresAt) <= new Date(startsAt)) ||
        (usageLimit != null && usageLimit < 1)) {
        throw new BadRequestException('Invalid offer parameters');
      }

      if (action === 'update_offer') {
        const id = String(payload.id);
        const { data: before } = await this.db.from('offers').select('*').eq('id', id).single();
        if (!before) throw new NotFoundException('Offer not found');
        const { count: redemptionCount } = await this.db.from('offer_redemptions').select('id', { count: 'exact', head: true }).eq('offer_id', id);
        if ((redemptionCount ?? 0) > 0) {
          throw new ConflictException('Redeemed offer terms are locked; activation may still change');
        }

        const updateData: Record<string, any> = {
          code: couponCode,
          coupon_code: couponCode,
          name,
          discount_type: discountType,
          discount_value: discountValue,
          minimum_order_amount: minimumOrderAmount,
          maximum_discount: maximumDiscount,
          starts_at: startsAt,
          expires_at: expiresAt,
          usage_limit: usageLimit,
        };
        let res = await this.db.from('offers').update({ ...updateData, eligibility_note: eligibilityNote }).eq('id', id).select('*').single();
        if (res.error && this.isSchemaCacheError(res.error)) {
          res = await this.db.from('offers').update(updateData).eq('id', id).select('*').single();
        }
        if (res.error || !res.data) throw new BadRequestException(res.error?.message ?? 'Failed to update offer');
        const offerResult = { ...res.data, eligibility_note: res.data.eligibility_note ?? eligibilityNote };
        await this.audit(actor, 'update_offer', 'offer', id, before, offerResult);
        return offerResult;
      } else {
        const insertData: Record<string, any> = {
          code: couponCode,
          coupon_code: couponCode,
          name,
          discount_type: discountType,
          discount_value: discountValue,
          minimum_order_amount: minimumOrderAmount,
          maximum_discount: maximumDiscount,
          starts_at: startsAt,
          expires_at: expiresAt,
          usage_limit: usageLimit,
          is_active: false,
        };
        let res = await this.db.from('offers').insert({ ...insertData, eligibility_note: eligibilityNote }).select('*').single();
        if (res.error && this.isSchemaCacheError(res.error)) {
          res = await this.db.from('offers').insert(insertData).select('*').single();
        }
        if (res.error || !res.data) throw new BadRequestException(res.error?.message ?? 'Failed to create offer');
        const offerResult = { ...res.data, eligibility_note: res.data.eligibility_note ?? eligibilityNote };
        await this.audit(actor, 'create_offer', 'offer', res.data.id, null, offerResult);
        return offerResult;
      }
    }

    if (action === 'set_offer_active') {
      const id = String(payload.id);
      const { data: before } = await this.db.from('offers').select('*').eq('id', id).single();
      if (!before) throw new NotFoundException('Offer not found');
      const { data, error } = await this.db.from('offers').update({ is_active: Boolean(payload.isActive) }).eq('id', id).select('*').single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to toggle offer status');
      await this.audit(actor, 'set_offer_active', 'offer', id, before, data);
      return data;
    }

    if (action === 'create_package' || action === 'update_package') {
      const name = String(payload.name || '').trim();
      const description = payload.description ? String(payload.description).trim() : null;
      const price = Number(payload.price);
      const validityDays = Number(payload.validityDays ?? 30);

      if (name.length < 2 || name.length > 120 || !Number.isFinite(price) || price <= 0 ||
        !Number.isFinite(validityDays) || validityDays < 1 || validityDays > 3650) {
        throw new BadRequestException('Invalid package parameters');
      }

      if (action === 'update_package') {
        const id = String(payload.id);
        const { data: before } = await this.db.from('packages').select('*').eq('id', id).single();
        if (!before) throw new NotFoundException('Package not found');
        const { count: subscriptionCount } = await this.db.from('package_subscriptions').select('id', { count: 'exact', head: true }).eq('package_id', id);
        if ((subscriptionCount ?? 0) > 0) {
          throw new ConflictException('Sold package terms are locked');
        }

        const updateData: Record<string, any> = {
          name,
          description,
          monthly_price: price,
          price,
        };
        let res = await this.db.from('packages').update({ ...updateData, validity_days: validityDays }).eq('id', id).select('*').single();
        if (res.error && this.isSchemaCacheError(res.error)) {
          res = await this.db.from('packages').update(updateData).eq('id', id).select('*').single();
        }
        if (res.error || !res.data) throw new BadRequestException(res.error?.message ?? 'Failed to update package');
        const packageResult = { ...res.data, validity_days: res.data.validity_days ?? validityDays };
        await this.audit(actor, 'update_package', 'package', id, before, packageResult);
        return packageResult;
      } else {
        const insertData: Record<string, any> = {
          name,
          description,
          monthly_price: price,
          price,
          is_active: false,
        };
        let res = await this.db.from('packages').insert({ ...insertData, validity_days: validityDays }).select('*').single();
        if (res.error && this.isSchemaCacheError(res.error)) {
          res = await this.db.from('packages').insert(insertData).select('*').single();
        }
        if (res.error || !res.data) throw new BadRequestException(res.error?.message ?? 'Failed to create package');
        const packageResult = { ...res.data, validity_days: res.data.validity_days ?? validityDays };
        await this.audit(actor, 'create_package', 'package', res.data.id, null, packageResult);
        return packageResult;
      }
    }

    if (action === 'set_package_active') {
      const id = String(payload.id);
      const { data: before } = await this.db.from('packages').select('*').eq('id', id).single();
      if (!before) throw new NotFoundException('Package not found');
      const { data, error } = await this.db.from('packages').update({ is_active: Boolean(payload.isActive) }).eq('id', id).select('*').single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to toggle package status');
      await this.audit(actor, 'set_package_active', 'package', id, before, data);
      return data;
    }

    if (action === 'set_program_settings') {
      const { data: before } = await this.db.from('admin_growth_settings').select('*').eq('id', true).maybeSingle();
      const settingsPayload = {
        id: true,
        referral_enabled: Boolean(payload.referralEnabled),
        referral_reward_points: Number(payload.referralRewardPoints ?? 0),
        loyalty_earn_points_per_rupee: Number(payload.loyaltyEarnPointsPerRupee ?? 0.01),
        loyalty_points_per_rupee: Number(payload.loyaltyPointsPerRupee ?? 10),
        loyalty_minimum_redemption_rupees: Number(payload.loyaltyMinimumRedemptionRupees ?? 100),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await this.db.from('admin_growth_settings').upsert(settingsPayload).select('*').single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to save growth settings');
      await this.audit(actor, 'set_program_settings', 'settings', null, before, data);
      return data;
    }

    throw new BadRequestException(`Unsupported growth action: ${action}`);
  }

  private async change(actor: string, action: string, payload: object) {
    const {data, error} = await this.db.rpc('admin_growth_change_atomic', {p_actor: actor, p_action: action, p_payload: payload});
    if (error?.code === '42501') throw new ForbiddenException('Admin role required');
    if (error?.code === 'P0002') throw new NotFoundException(error.message);
    if (error && ['23514','23505'].includes(error.code)) throw new ConflictException(error.message);
    if (this.isSchemaCacheError(error)) {
      return this.executeDirectChange(actor, action, payload as Record<string, any>);
    }
    if (error || !data) throw new BadRequestException(error?.message ?? 'Growth change failed');
    return data;
  }

  createOffer(actor: string, payload: object) { return this.change(actor, 'create_offer', payload); }
  updateOffer(actor: string, id: string, payload: object) { return this.change(actor, 'update_offer', {...payload, id}); }
  setOfferActive(actor: string, id: string, isActive: boolean) { return this.change(actor, 'set_offer_active', {id, isActive}); }
  createPackage(actor: string, payload: object) { return this.change(actor, 'create_package', payload); }
  updatePackage(actor: string, id: string, payload: object) { return this.change(actor, 'update_package', {...payload, id}); }
  setPackageActive(actor: string, id: string, isActive: boolean) { return this.change(actor, 'set_package_active', {id, isActive}); }
  setSettings(actor: string, payload: object) { return this.change(actor, 'set_program_settings', payload); }

  async setPackageEligibility(actor: string, packageId: string, serviceId: string, eligible: boolean, usageLimit: number | null) {
    if (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 0)) throw new BadRequestException('Invalid package credit limit');
    const {data, error} = await this.db.rpc('admin_set_package_service_atomic', {
      p_actor_profile_id: actor, p_package_id: packageId, p_service_id: serviceId,
      p_usage_limit: usageLimit, p_eligible: eligible,
    });
    if (error?.code === '42501') throw new ForbiddenException('Admin role required');
    if (error?.code === 'P0002') throw new NotFoundException(error.message);
    if (error?.code === '23514') throw new ConflictException(error.message);
    if (this.isSchemaCacheError(error)) {
      await this.requireAdmin(actor);
      const { data: pkg } = await this.db.from('packages').select('*').eq('id', packageId).single();
      if (!pkg) throw new NotFoundException('Package not found');
      const { count: subs } = await this.db.from('package_subscriptions').select('id', { count: 'exact', head: true }).eq('package_id', packageId);
      if ((subs ?? 0) > 0) throw new ConflictException('Sold package eligibility is locked');

      if (eligible) {
        const { data: srv } = await this.db.from('services').select('*').eq('id', serviceId).eq('is_active', true).single();
        if (!srv) throw new ConflictException('Active service required');
        const { data: upsertData, error: upsertErr } = await this.db.from('package_services').upsert({
          package_id: packageId,
          service_id: serviceId,
          usage_limit: usageLimit,
        }).select('*').single();
        if (upsertErr || !upsertData) throw new BadRequestException(upsertErr?.message ?? 'Failed to update package service');
        await this.audit(actor, 'set_package_eligibility', 'package', packageId, null, upsertData);
        return upsertData;
      } else {
        const { data: before } = await this.db.from('package_services').select('*').eq('package_id', packageId).eq('service_id', serviceId).maybeSingle();
        if (!before) throw new NotFoundException('Package service not found');
        const { error: delErr } = await this.db.from('package_services').delete().eq('id', before.id);
        if (delErr) throw new BadRequestException(delErr.message);
        const res = { id: before.id, eligible: false };
        await this.audit(actor, 'set_package_eligibility', 'package', packageId, before, res);
        return res;
      }
    }
    if (error || !data) throw new BadRequestException(error?.message ?? 'Package eligibility unavailable');
    return data;
  }
}
