import {BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../supabase/supabase.service';

type CategoryInput = {name?: string; description?: string; isActive?: boolean};
type ServiceInput = {name?: string; description?: string; pricingUnit?: string; categoryId?: string | null; isActive?: boolean};

@Injectable()
export class AdminCatalogueService {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() { return this.supabase.admin; }

  private async requireAdmin(actorId: string) {
    const { data, error } = await this.db.from('profile_roles')
      .select('roles(code)').eq('profile_id', actorId);
    if (error || !(data ?? []).some((row: any) => row.roles?.code === 'admin')) {
      throw new ForbiddenException('Admin role required');
    }
  }

  private async audit(actorId: string, action: string, entityId: string, before: any, after: any) {
    await this.db.from('admin_catalogue_audit').insert({
      actor_profile_id: actorId,
      action,
      entity_id: entityId,
      before_value: before ?? null,
      after_value: after ?? {},
    }).then(() => {}, () => {});
  }

  private isSchemaCacheError(error: any): boolean {
    return (
      error?.code === 'PGRST202' ||
      (typeof error?.message === 'string' && error.message.includes('schema cache')) ||
      (typeof error?.details === 'string' && error.details.includes('schema cache'))
    );
  }

  async overview() {
    const now = new Date().toISOString();
    const [categories, services, prices, policies, eligibility, packages, subscriptions, audit] = await Promise.all([
      this.db.from('service_categories').select('id,name,description,is_active').order('name'),
      this.db.from('services').select('id,category_id,name,description,pricing_unit,is_active').order('name'),
      this.db.from('service_prices').select('id,service_id,facility_id,price,effective_from,effective_to')
        .lte('effective_from', now).or(`effective_to.is.null,effective_to.gt.${now}`).order('effective_from', {ascending: false}),
      this.db.from('checkout_pricing_policies').select('id,pickup_delivery_fee,free_delivery_threshold,gst_rate_percent,minimum_order_amount,effective_from')
        .lte('effective_from', now).order('effective_from', {ascending: false}).limit(1).maybeSingle(),
      this.db.from('package_services').select('package_id,service_id,usage_limit'),
      this.db.from('packages').select('id,name,is_active').order('name'),
      this.db.from('package_subscriptions').select('package_id'),
      this.db.from('admin_catalogue_audit').select('id,actor_profile_id,action,entity_id,created_at')
        .order('created_at', {ascending: false}).limit(100),
    ]);
    if (categories.error || services.error || prices.error || policies.error || eligibility.error || packages.error || subscriptions.error || audit.error || !policies.data)
      throw new BadRequestException('Unable to load commercial configuration');
    return {categories: categories.data ?? [], services: services.data ?? [], prices: prices.data ?? [],
      policy: {pickupDeliveryFee: Number(policies.data.pickup_delivery_fee),
        freeDeliveryThreshold: Number(policies.data.free_delivery_threshold),
        gstRatePercent: Number(policies.data.gst_rate_percent), minimumOrderAmount: Number(policies.data.minimum_order_amount),
        effectiveFrom: policies.data.effective_from},
      packageEligibility: eligibility.data ?? [],
      packages: (packages.data ?? []).map(row => ({...row, isLocked: (subscriptions.data ?? []).some(sub => sub.package_id === row.id)})),
      audit: audit.data ?? []};
  }

  private async executeDirectChange(actorId: string, action: string, payload: Record<string, any>) {
    await this.requireAdmin(actorId);

    if (action === 'create_category') {
      const name = String(payload.name || '').trim();
      const desc = typeof payload.description === 'string' ? payload.description.trim() : null;
      if (!name || name.length > 100) throw new BadRequestException('Valid category name required');
      const { data, error } = await this.db.from('service_categories').insert({ name, description: desc || null }).select('*').single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to create category');
      await this.audit(actorId, 'create_category', data.id, null, data);
      return data;
    }

    if (action === 'update_category') {
      const id = payload.id as string;
      const { data: before } = await this.db.from('service_categories').select('*').eq('id', id).single();
      if (!before) throw new NotFoundException('Category not found');
      const updateObj: Record<string, any> = {};
      if (payload.name !== undefined) {
        const name = String(payload.name).trim();
        if (!name || name.length > 100) throw new BadRequestException('Valid category name required');
        updateObj.name = name;
      }
      if (payload.description !== undefined) {
        updateObj.description = typeof payload.description === 'string' ? payload.description.trim() || null : null;
      }
      if (payload.isActive !== undefined) {
        updateObj.is_active = Boolean(payload.isActive);
      }
      const { data, error } = await this.db.from('service_categories').update(updateObj).eq('id', id).select('*').single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to update category');
      await this.audit(actorId, 'update_category', id, before, data);
      return data;
    }

    if (action === 'create_service') {
      const name = String(payload.name || '').trim();
      const pricingUnit = String(payload.pricingUnit || '').trim();
      const desc = typeof payload.description === 'string' ? payload.description.trim() : null;
      const categoryId = payload.categoryId ? String(payload.categoryId) : null;
      if (!name || name.length > 120) throw new BadRequestException('Valid service name required');
      if (!pricingUnit || pricingUnit.length > 30) throw new BadRequestException('Pricing unit required');
      const { data, error } = await this.db.from('services').insert({
        name,
        pricing_unit: pricingUnit,
        description: desc || null,
        category_id: categoryId || null,
      }).select('*').single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to create service');
      await this.audit(actorId, 'create_service', data.id, null, data);
      return data;
    }

    if (action === 'update_service') {
      const id = payload.id as string;
      const { data: before } = await this.db.from('services').select('*').eq('id', id).single();
      if (!before) throw new NotFoundException('Service not found');
      const updateObj: Record<string, any> = {};
      if (payload.name !== undefined) updateObj.name = String(payload.name).trim();
      if (payload.pricingUnit !== undefined) updateObj.pricing_unit = String(payload.pricingUnit).trim();
      if (payload.description !== undefined) updateObj.description = typeof payload.description === 'string' ? payload.description.trim() || null : null;
      if (payload.categoryId !== undefined) updateObj.category_id = payload.categoryId ? String(payload.categoryId) : null;
      if (payload.isActive !== undefined) updateObj.is_active = Boolean(payload.isActive);
      const { data, error } = await this.db.from('services').update(updateObj).eq('id', id).select('*').single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to update service');
      await this.audit(actorId, 'update_service', id, before, data);
      return data;
    }

    if (action === 'set_price') {
      const serviceId = payload.serviceId as string;
      const price = Number(payload.price);
      const facilityId = payload.facilityId ? String(payload.facilityId) : null;
      const now = new Date().toISOString();
      let closeQuery = this.db.from('service_prices').update({ effective_to: now }).eq('service_id', serviceId).lte('effective_from', now).is('effective_to', null);
      if (facilityId) closeQuery = closeQuery.eq('facility_id', facilityId);
      else closeQuery = closeQuery.is('facility_id', null);
      await closeQuery;

      const { data, error } = await this.db.from('service_prices').insert({
        service_id: serviceId,
        facility_id: facilityId,
        price,
        effective_from: now,
      }).select('*').single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to set service price');
      await this.audit(actorId, 'set_price', data.id, null, data);
      return data;
    }

    throw new BadRequestException('Unsupported catalogue action');
  }

  private async change(actorId: string, action: string, payload: Record<string, unknown>) {
    const {data, error} = await this.db.rpc('admin_catalogue_change_atomic', {
      p_actor_profile_id: actorId, p_action: action, p_payload: payload,
    });
    if (error?.code === '42501') throw new ForbiddenException('Admin role required');
    if (error?.code === 'P0002') throw new NotFoundException('Catalogue record not found');
    if (error && ['23514', '23505'].includes(error.code)) throw new ConflictException(error.message);
    if (error && this.isSchemaCacheError(error)) {
      return this.executeDirectChange(actorId, action, payload);
    }
    if (error || !data) throw new BadRequestException(error?.message ?? 'Unable to update catalogue');
    return data;
  }

  createCategory(actor: string, input: CategoryInput) { return this.change(actor, 'create_category', input); }
  updateCategory(actor: string, id: string, input: CategoryInput) { return this.change(actor, 'update_category', {...input, id}); }
  createService(actor: string, input: ServiceInput) { return this.change(actor, 'create_service', input); }
  updateService(actor: string, id: string, input: ServiceInput) { return this.change(actor, 'update_service', {...input, id}); }
  setPrice(actor: string, serviceId: string, input: {price: number; facilityId?: string | null}) {
    if (!Number.isFinite(input.price) || input.price < 0 || input.price > 9999999999.99 ||
      Math.abs(Math.round(input.price * 100) - input.price * 100) > 0.000001) throw new BadRequestException('Invalid service price');
    return this.change(actor, 'set_price', {...input, serviceId});
  }

  setPolicy(actor: string, input: {pickupDeliveryFee: number; freeDeliveryThreshold: number; gstRatePercent: number; minimumOrderAmount: number}) {
    for (const number of [input.pickupDeliveryFee, input.freeDeliveryThreshold, input.gstRatePercent, input.minimumOrderAmount]) {
      if (!Number.isFinite(number) || number < 0 || Math.abs(Math.round(number * 100) - number * 100) > 0.000001)
        throw new BadRequestException('Invalid pricing policy');
    }
    if (input.gstRatePercent > 100) throw new BadRequestException('Invalid GST rate');

    return (async () => {
      const {data, error} = await this.db.rpc('admin_set_checkout_policy_atomic', {
        p_actor_profile_id: actor, p_fee: input.pickupDeliveryFee, p_free_threshold: input.freeDeliveryThreshold,
        p_gst_rate: input.gstRatePercent, p_minimum_order: input.minimumOrderAmount,
      });
      if (error?.code === '42501') throw new ForbiddenException('Admin role required');
      if (error && this.isSchemaCacheError(error)) {
        await this.requireAdmin(actor);
        const now = new Date().toISOString();
        const { data: policyData, error: policyErr } = await this.db.from('checkout_pricing_policies').insert({
          pickup_delivery_fee: input.pickupDeliveryFee,
          free_delivery_threshold: input.freeDeliveryThreshold,
          gst_rate_percent: input.gstRatePercent,
          minimum_order_amount: input.minimumOrderAmount,
          effective_from: now,
          created_by: actor,
        }).select('*').single();
        if (policyErr || !policyData) throw new BadRequestException(policyErr?.message ?? 'Failed to update checkout policy');
        await this.audit(actor, 'set_policy', policyData.id, null, policyData);
        return policyData;
      }
      if (error || !data) throw new BadRequestException(error?.message ?? 'Unable to update checkout policy');
      return data;
    })();
  }

  setPackageEligibility(actor: string, packageId: string, serviceId: string, eligible: boolean, usageLimit: number | null) {
    if (!Number.isSafeInteger(usageLimit) && usageLimit !== null || (usageLimit !== null && usageLimit < 0))
      throw new BadRequestException('Invalid package usage limit');

    return (async () => {
      const {data, error} = await this.db.rpc('admin_set_package_service_atomic', {
        p_actor_profile_id: actor, p_package_id: packageId, p_service_id: serviceId,
        p_usage_limit: usageLimit, p_eligible: eligible,
      });
      if (error?.code === '42501') throw new ForbiddenException('Admin role required');
      if (error?.code === '23514') throw new ConflictException(error.message);
      if (error?.code === 'P0002') throw new NotFoundException(error.message);
      if (error && this.isSchemaCacheError(error)) {
        await this.requireAdmin(actor);
        let resData: any;
        if (eligible) {
          const res = await this.db.from('package_services').upsert({
            package_id: packageId,
            service_id: serviceId,
            usage_limit: usageLimit,
          }).select('*').single();
          resData = res.data;
        } else {
          await this.db.from('package_services').delete().eq('package_id', packageId).eq('service_id', serviceId);
          resData = { package_id: packageId, service_id: serviceId, eligible: false };
        }
        await this.audit(actor, 'set_package_eligibility', packageId, null, resData);
        return resData;
      }
      if (error || !data) throw new BadRequestException(error?.message ?? 'Unable to update package eligibility');
      return data;
    })();
  }
}
