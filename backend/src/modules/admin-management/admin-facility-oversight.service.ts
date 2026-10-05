import {BadRequestException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../supabase/supabase.service';

const ACTIVE = new Set(['in_transit_to_facility', 'received_at_facility', 'verification', 'processing',
  'quality_check', 'rework_required', 'ready_for_delivery']);
const STAGES = ['washing', 'drying', 'ironing', 'folding', 'packaging'];
// Monitoring indicators, not contractual SLA commitments.
const AGE_WARNING_HOURS = 4;
const STUCK_HOURS = 24;

@Injectable()
export class AdminFacilityOversightService {
  private readonly logger = new Logger(AdminFacilityOversightService.name);
  constructor(private readonly supabase: SupabaseService) {}
  private get db() { return this.supabase.admin; }

  private async rows(table: string, columns: string, filter?: {column: string; value: string}): Promise<any[]> {
    const result: any[] = [];
    for (let offset = 0; ; offset += 500) {
      let query: any = this.db.from(table).select(columns);
      if (filter) query = query.eq(filter.column, filter.value);
      const {data, error} = await query.range(offset, offset + 499);
      if (error) {
        this.logger.error(`Unable to load Facility table ${table}: ${error.message || JSON.stringify(error)}`);
        throw new BadRequestException(`Unable to load Facility ${table}`);
      }
      result.push(...(data ?? []));
      if (!data || data.length < 500) return result;
    }
  }

  private async snapshot() {
    const [facilities, orders, operations, discrepancies, qc, packings, employees, profiles, machines] = await Promise.all([
      this.rows('facilities', 'id,name,address,is_active,created_at'),
      this.rows('orders', 'id,order_number,facility_id,current_status,created_at,updated_at'),
      this.rows('facility_order_operations', 'id,order_id,facility_id,operation_type,current_status,started_at,completed_at,received_at,ready_for_delivery_at'),
      this.rows('facility_intake_discrepancies', 'id,order_id,status'),
      this.rows('facility_qc_decisions', 'id,order_id,approved,cycle_number'),
      this.rows('facility_packings', 'id,order_id,facility_id,packed_at'),
      this.rows('facility_employees', 'id,facility_id,profile_id,is_active'),
      this.rows('profiles', 'id,is_active'),
      this.rows('facility_machines', 'id,facility_id,capacity_kg,status'),
    ]);
    return {facilities, orders, operations, discrepancies, qc, packings, employees, profiles, machines};
  }

  private summarize(facility: any, source: Awaited<ReturnType<AdminFacilityOversightService['snapshot']>>) {
    const orders = source.orders.filter(order => order.facility_id === facility.id);
    const active = orders.filter(order => ACTIVE.has(order.current_status));
    const ids = new Set(orders.map(order => order.id));
    const ops = source.operations.filter(operation => ids.has(operation.order_id));
    const profileActive = new Set(source.profiles.filter(profile => profile.is_active).map(profile => profile.id));
    const machines = source.machines.filter(machine => machine.facility_id === facility.id && machine.status === 'active');
    const now = Date.now();
    const ages = active.map(order => ({orderId: order.id, hours: Math.max(0, (now - Date.parse(order.updated_at || order.created_at)) / 3600000)}));
    return {id: facility.id, name: facility.name, address: facility.address, isActive: facility.is_active,
      workload: active.length, received: active.filter(order => order.current_status === 'received_at_facility').length,
      verification: active.filter(order => order.current_status === 'verification').length,
      openDiscrepancies: source.discrepancies.filter(row => ids.has(row.order_id) && row.status === 'open').length,
      stages: Object.fromEntries(STAGES.map(stage => [stage, ops.filter(row => row.operation_type === stage &&
        active.some(order => order.id === row.order_id) && !row.completed_at).length])),
      qcFailures: source.qc.filter(row => ids.has(row.order_id) && !row.approved).length,
      rewashCycles: source.qc.filter(row => ids.has(row.order_id) && !row.approved).length,
      packed: source.packings.filter(row => ids.has(row.order_id)).length,
      ready: active.filter(order => order.current_status === 'ready_for_delivery').length,
      ageWarnings: ages.filter(row => row.hours >= AGE_WARNING_HOURS).length,
      stuckOrders: ages.filter(row => row.hours >= STUCK_HOURS).length,
      oldestActiveHours: Math.round(Math.max(0, ...ages.map(row => row.hours)) * 10) / 10,
      activeStaff: source.employees.filter(row => row.facility_id === facility.id && row.is_active && profileActive.has(row.profile_id)).length,
      activeMachines: machines.length,
      installedMachineCapacityKg: machines.reduce((sum, row) => sum + Number(row.capacity_kg || 0), 0),
    };
  }

  async list() {
    const source = await this.snapshot();
    return {monitoring: {ageWarningHours: AGE_WARNING_HOURS, stuckHours: STUCK_HOURS, contractualSla: false},
      facilities: source.facilities.map(facility => this.summarize(facility, source)).sort((a, b) => a.name.localeCompare(b.name))};
  }

  async facility(id: string) {
    const source = await this.snapshot();
    const facility = source.facilities.find(row => row.id === id);
    if (!facility) throw new NotFoundException('Facility not found');
    const orders = source.orders.filter(order => order.facility_id === id).sort((a, b) =>
      Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at));
    const now = Date.now();
    return {summary: this.summarize(facility, source), orders: orders.map(order => {
      const operation = source.operations.filter(row => row.order_id === order.id)
        .sort((a, b) => Date.parse(b.started_at || b.received_at || '') - Date.parse(a.started_at || a.received_at || ''))[0];
      const ageHours = Math.max(0, (now - Date.parse(order.updated_at || order.created_at)) / 3600000);
      return {...order, latestStage: operation?.operation_type ?? null, processingAgeHours: Math.round(ageHours * 10) / 10,
        ageWarning: ACTIVE.has(order.current_status) && ageHours >= AGE_WARNING_HOURS,
        stuck: ACTIVE.has(order.current_status) && ageHours >= STUCK_HOURS,
        openDiscrepancies: source.discrepancies.filter(row => row.order_id === order.id && row.status === 'open').length};
    })};
  }

  async listLocations() {
    const [facilities, orders, pincodeRows] = await Promise.all([
      this.rows('facilities', 'id,name,address,latitude,longitude,is_active,created_at,updated_at,service_radius_meters').catch(async () => {
        return this.rows('facilities', 'id,name,address,latitude,longitude,is_active,created_at,updated_at');
      }),
      this.rows('orders', 'id,facility_id'),
      this.rows('facility_service_pincodes', 'id,facility_id,pincode').catch(() => []),
    ]);
    return facilities.map((facility: any) => {
      const orderCount = orders.filter((o: any) => o.facility_id === facility.id).length;
      const pincodes = pincodeRows
        .filter((p: any) => p.facility_id === facility.id)
        .map((p: any) => p.pincode)
        .sort();
      return {
        id: facility.id,
        name: facility.name,
        address: facility.address ?? null,
        latitude: facility.latitude !== null && facility.latitude !== undefined ? Number(facility.latitude) : null,
        longitude: facility.longitude !== null && facility.longitude !== undefined ? Number(facility.longitude) : null,
        serviceRadiusMeters: facility.service_radius_meters ? Number(facility.service_radius_meters) : 10000,
        isActive: Boolean(facility.is_active),
        pincodes,
        createdAt: facility.created_at,
        updatedAt: facility.updated_at,
        orderCount,
      };
    }).sort((a: any, b: any) => a.name.localeCompare(b.name));
  }

  async getFacilityPincodes(facilityId: string) {
    const {data: facility, error: facErr} = await this.db
      .from('facilities')
      .select('id, name')
      .eq('id', facilityId)
      .maybeSingle();
    if (facErr || !facility) throw new NotFoundException('Facility not found');

    const {data, error} = await this.db
      .from('facility_service_pincodes')
      .select('id, pincode, created_at')
      .eq('facility_id', facilityId)
      .order('pincode', {ascending: true});
    if (error) throw new BadRequestException('Unable to load facility pincodes');
    return (data || []).map((row: any) => row.pincode);
  }

  async addFacilityPincode(actorId: string, facilityId: string, rawPincode: string) {
    const pincode = rawPincode?.trim();
    if (!pincode || !/^\d{6}$/.test(pincode)) {
      throw new BadRequestException('Pincode must be exactly 6 numeric digits');
    }

    const {data: facility, error: facErr} = await this.db
      .from('facilities')
      .select('id, name')
      .eq('id', facilityId)
      .maybeSingle();
    if (facErr || !facility) throw new NotFoundException('Facility not found');

    const {data: existing} = await this.db
      .from('facility_service_pincodes')
      .select('id, pincode')
      .eq('facility_id', facilityId)
      .eq('pincode', pincode)
      .maybeSingle();

    if (existing) {
      return {success: true, facilityId, pincode, message: 'Pincode already configured'};
    }

    const {error: insErr} = await this.db
      .from('facility_service_pincodes')
      .insert({facility_id: facilityId, pincode});

    if (insErr) {
      if (insErr.code === '23505' || insErr.message?.includes('duplicate key')) {
        return {success: true, facilityId, pincode, message: 'Pincode already configured'};
      }
      throw new BadRequestException(insErr.message || 'Failed to add serviceable pincode');
    }

    return {success: true, facilityId, pincode, message: `Pincode ${pincode} added successfully`};
  }

  async removeFacilityPincode(actorId: string, facilityId: string, rawPincode: string) {
    const pincode = rawPincode?.trim();
    if (!pincode || !/^\d{6}$/.test(pincode)) {
      throw new BadRequestException('Pincode must be exactly 6 numeric digits');
    }

    const {data: facility, error: facErr} = await this.db
      .from('facilities')
      .select('id, name')
      .eq('id', facilityId)
      .maybeSingle();
    if (facErr || !facility) throw new NotFoundException('Facility not found');

    const {error: delErr} = await this.db
      .from('facility_service_pincodes')
      .delete()
      .eq('facility_id', facilityId)
      .eq('pincode', pincode);

    if (delErr) {
      throw new BadRequestException(delErr.message || 'Failed to remove serviceable pincode');
    }

    return {success: true, facilityId, pincode, message: `Pincode ${pincode} removed successfully`};
  }

  async createLocation(actorId: string, dto: {name: string; address?: string; latitude?: number | null; longitude?: number | null; serviceRadiusMeters?: number; isActive?: boolean}) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Location name is required');
    }
    const insertObj: any = {
      name: dto.name.trim(),
      address: dto.address?.trim() || null,
      latitude: dto.latitude !== undefined && dto.latitude !== null ? Number(dto.latitude) : null,
      longitude: dto.longitude !== undefined && dto.longitude !== null ? Number(dto.longitude) : null,
      is_active: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
      service_radius_meters: dto.serviceRadiusMeters ? Number(dto.serviceRadiusMeters) : 10000,
    };
    if (insertObj.latitude !== null && insertObj.longitude !== null) {
      insertObj.location = `POINT(${insertObj.longitude} ${insertObj.latitude})`;
    }
    let {data, error} = await this.db.from('facilities').insert(insertObj).select('*').single();
    if (error && (error.message?.includes('service_radius_meters') || error.code === '42703')) {
      delete insertObj.service_radius_meters;
      const retry = await this.db.from('facilities').insert(insertObj).select('*').single();
      data = retry.data;
      error = retry.error;
    }
    if (error || !data) {
      throw new BadRequestException(error?.message || 'Failed to create facility location');
    }
    return {
      id: data.id,
      name: data.name,
      address: data.address,
      latitude: data.latitude !== null && data.latitude !== undefined ? Number(data.latitude) : null,
      longitude: data.longitude !== null && data.longitude !== undefined ? Number(data.longitude) : null,
      serviceRadiusMeters: data.service_radius_meters ? Number(data.service_radius_meters) : (dto.serviceRadiusMeters ?? 10000),
      isActive: Boolean(data.is_active),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async updateLocation(actorId: string, id: string, dto: {name?: string; address?: string; latitude?: number | null; longitude?: number | null; serviceRadiusMeters?: number; isActive?: boolean}) {
    const {data: existing, error: findError} = await this.db
      .from('facilities')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (findError || !existing) {
      throw new NotFoundException('Facility location not found');
    }
    const updateObj: any = {};
    if (dto.name !== undefined) updateObj.name = dto.name.trim();
    if (dto.address !== undefined) updateObj.address = dto.address.trim() || null;
    if (dto.latitude !== undefined) updateObj.latitude = dto.latitude !== null ? Number(dto.latitude) : null;
    if (dto.longitude !== undefined) updateObj.longitude = dto.longitude !== null ? Number(dto.longitude) : null;
    if (dto.serviceRadiusMeters !== undefined) updateObj.service_radius_meters = Number(dto.serviceRadiusMeters);
    if (dto.isActive !== undefined) updateObj.is_active = Boolean(dto.isActive);

    const lat = updateObj.latitude !== undefined ? updateObj.latitude : existing.latitude;
    const lng = updateObj.longitude !== undefined ? updateObj.longitude : existing.longitude;
    if (lat !== null && lng !== null && lat !== undefined && lng !== undefined) {
      updateObj.location = `POINT(${lng} ${lat})`;
    } else if (updateObj.latitude === null || updateObj.longitude === null) {
      updateObj.location = null;
    }

    let {data, error} = await this.db.from('facilities').update(updateObj).eq('id', id).select('*').single();
    if (error && (error.message?.includes('service_radius_meters') || error.code === '42703')) {
      delete updateObj.service_radius_meters;
      const retry = await this.db.from('facilities').update(updateObj).eq('id', id).select('*').single();
      data = retry.data;
      error = retry.error;
    }
    if (error || !data) {
      throw new BadRequestException(error?.message || 'Failed to update facility location');
    }
    return {
      id: data.id,
      name: data.name,
      address: data.address,
      latitude: data.latitude !== null && data.latitude !== undefined ? Number(data.latitude) : null,
      longitude: data.longitude !== null && data.longitude !== undefined ? Number(data.longitude) : null,
      serviceRadiusMeters: data.service_radius_meters ? Number(data.service_radius_meters) : (dto.serviceRadiusMeters ?? 10000),
      isActive: Boolean(data.is_active),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async deleteLocation(actorId: string, id: string) {
    const {data: existing, error: findError} = await this.db
      .from('facilities')
      .select('id, name')
      .eq('id', id)
      .maybeSingle();
    if (findError || !existing) {
      throw new NotFoundException('Facility location not found');
    }
    const {count, error: countErr} = await this.db
      .from('orders')
      .select('id', {count: 'exact', head: true})
      .eq('facility_id', id);

    if (!countErr && count && count > 0) {
      await this.db.from('facilities').update({is_active: false}).eq('id', id);
      return {
        id,
        deleted: false,
        archived: true,
        message: `Location "${existing.name}" has ${count} historical orders and was deactivated/archived to preserve order records.`,
      };
    }

    const {error: delError} = await this.db.from('facilities').delete().eq('id', id);
    if (delError) {
      await this.db.from('facilities').update({is_active: false}).eq('id', id);
      return {
        id,
        deleted: false,
        archived: true,
        message: `Location "${existing.name}" was deactivated/archived.`,
      };
    }
    return {
      id,
      deleted: true,
      archived: false,
      message: `Location "${existing.name}" deleted successfully.`,
    };
  }

  async order(facilityId: string, orderId: string) {
    const {data: order, error} = await this.db.from('orders')
      .select('id,order_number,facility_id,current_status,created_at,updated_at').eq('id', orderId).eq('facility_id', facilityId).maybeSingle();
    if (error || !order) throw new NotFoundException('Order not found at this Facility');
    const [operations, inspections, discrepancies, qc, packings, history, qr] = await Promise.all([
      this.rows('facility_order_operations', 'id,operation_type,current_status,started_at,completed_at,received_at,ready_for_delivery_at,performed_by,notes', {column: 'order_id', value: orderId}),
      this.rows('garment_inspections', 'id,order_item_id,counted_quantity,weight_kg,condition_notes,created_at', {column: 'order_id', value: orderId}),
      this.rows('facility_intake_discrepancies', 'id,kind,status,expected_quantity,counted_quantity,notes,resolution_notes,created_at,resolved_at', {column: 'order_id', value: orderId}),
      this.rows('facility_qc_decisions', 'id,cycle_number,approved,rewash_required,defect_code,reason,created_at', {column: 'order_id', value: orderId}),
      this.rows('facility_packings', 'id,parcel_id,packed_at,notes,packed_by', {column: 'order_id', value: orderId}),
      this.rows('order_status_history', 'id,from_status,to_status,reason,created_at', {column: 'order_id', value: orderId}),
      this.rows('order_qr_codes', 'id,is_active,created_at', {column: 'order_id', value: orderId}),
    ]);
    const scans = qr.length ? await this.rows('qr_scan_logs', 'id,qr_code_id,scanner_profile_id,scan_action,scanned_at',
      {column: 'qr_code_id', value: qr[0].id}) : [];
    return {order, operations, inspections, discrepancies, qc, packings, history, qr: qr.map(row => ({...row, scans}))};
  }
}

