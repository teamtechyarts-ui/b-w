import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ProvisionStaffDto } from './dto/provision-staff.dto';
import { getDriverInternalEmail, getFacilityEmployeeInternalEmail, hashDriverPin } from '../auth/driver-pin.util';

@Injectable()
export class StaffService {
  constructor(private readonly supabase: SupabaseService) {}

  private async audit(actorId: string, profileId: string, action: string, detail: Record<string, unknown> = {}) {
    let {error} = await this.supabase.admin.from('admin_staff_action_audit').insert({
      actor_profile_id: actorId, target_profile_id: profileId, action, detail,
    });
    if (error && (action === 'driver_pin_changed' || action === 'facility_employee_pin_changed')) {
      const fallback = await this.supabase.admin.from('admin_staff_action_audit').insert({
        actor_profile_id: actorId, target_profile_id: profileId, action: 'revoke_access',
        detail: {...detail, audit_event: action},
      });
      error = fallback.error;
    }
    // Also record in admin_activity_logs
    await this.supabase.admin.from('admin_activity_logs').insert({
      admin_id: actorId,
      actor_profile_id: actorId,
      entity_type: 'staff',
      entity_id: profileId,
      action,
      metadata: detail,
    }).then(() => {}, () => {});
    if (error) throw new BadRequestException('Staff action audit failed');
  }

  private async requireAdmin(actorId: string) {
    const { data, error } = await this.supabase.admin.from('profile_roles')
      .select('roles(code)').eq('profile_id', actorId);
    if (error || !(data ?? []).some((row: any) => row.roles?.code === 'admin')) {
      throw new ForbiddenException('Admin provisioning required');
    }
  }

  async provision(actorId: string, dto: ProvisionStaffDto) {
    await this.requireAdmin(actorId);

    if (dto.role === 'manager' as any) {
      throw new BadRequestException('Manager role is no longer available');
    }

    let pinHash: string | undefined;
    let internalEmail: string | undefined;

    if (dto.role === 'driver') {
      if (dto.facilityId) {
        throw new BadRequestException('Driver provisioning does not accept a facility');
      }
      if (!dto.pin || !/^\d{6}$/.test(dto.pin)) {
        throw new BadRequestException('Driver PIN is required and must be exactly 6 digits');
      }
      pinHash = hashDriverPin(dto.pin);
      internalEmail = getDriverInternalEmail(dto.phone);
    } else if (dto.role === 'facility_employee') {
      if (!dto.facilityId) throw new BadRequestException('Active facility is required');
      const { data: facility, error } = await this.supabase.admin.from('facilities')
        .select('id,is_active').eq('id', dto.facilityId).maybeSingle();
      if (error || !facility?.is_active) throw new BadRequestException('Active facility is required');
      if (!dto.pin || !/^\d{6}$/.test(dto.pin)) {
        throw new BadRequestException('Facility Employee PIN is required and must be exactly 6 digits');
      }
      pinHash = hashDriverPin(dto.pin);
      internalEmail = getFacilityEmployeeInternalEmail(dto.phone);
    } else {
      throw new BadRequestException('Invalid staff role');
    }

    // Create identity in Supabase Auth
    const createPayload: any = {
      phone: dto.phone,
      phone_confirm: true,
      user_metadata: { full_name: dto.fullName.trim(), bw_staff_provisioning: true },
      email: internalEmail,
      email_confirm: true,
      password: dto.pin,
      app_metadata: {
        ...(dto.role === 'driver' ? { driver_pin_hash: pinHash } : { employee_pin_hash: pinHash }),
        provider: 'phone',
      },
    };

    const { data: created, error: createError } = await this.supabase.admin.auth.admin.createUser(createPayload);
    if (createError || !created.user) throw new ConflictException('Phone already exists or account could not be provisioned');
    const id = created.user.id;
    const db = this.supabase.admin;
    const { error: profileError } = await db.from('profiles').update({
      full_name: dto.fullName.trim(), phone: dto.phone, is_active: false,
    }).eq('id', id);
    if (profileError) throw new BadRequestException('Staff profile setup failed; account remains inactive');
    const { data: role, error: roleError } = await db.from('roles')
      .select('id').eq('code', dto.role).single();
    if (roleError || !role) throw new BadRequestException('Staff role unavailable; account remains inactive');
    const { error: assignmentError } = await db.from('profile_roles')
      .insert({ profile_id: id, role_id: role.id });
    if (assignmentError) throw new BadRequestException('Staff role setup failed; account remains inactive');

    if (dto.role === 'driver') {
      // Attempt insert with driver_pin_hash if column exists, fallback cleanly if not yet applied to remote DB
      const driverWithHash = await db.from('drivers').insert({
        profile_id: id, is_active: true, is_available: false, driver_pin_hash: pinHash,
      }).select('id').single();
      if (driverWithHash.error) {
        const fallback = await db.from('drivers').insert({
          profile_id: id, is_active: true, is_available: false,
        }).select('id').single();
        if (fallback.error || !fallback.data) throw new BadRequestException('Staff record setup failed; account remains inactive');
      }
    } else {
      const facilityEmp = await db.from('facility_employees').insert({
        profile_id: id, facility_id: dto.facilityId, employee_role: dto.role, is_active: true,
      }).select('id').single();
      if (facilityEmp.error || !facilityEmp.data) throw new BadRequestException('Staff record setup failed; account remains inactive');
    }

    const { error: activateError } = await db.from('profiles').update({ is_active: true }).eq('id', id);
    if (activateError) throw new BadRequestException('Staff activation failed; account remains inactive');
    await this.audit(actorId, id, 'provision', {role: dto.role, facilityId: dto.facilityId ?? null});

    return {
      success: true,
      message: dto.role === 'driver' ? 'Driver created successfully' : 'Facility Employee provisioned successfully',
      driver: dto.role === 'driver' ? {
        id,
        fullName: dto.fullName.trim(),
        phone: dto.phone,
        role: 'driver',
        isActive: true,
      } : undefined,
      profileId: id,
      role: dto.role,
      active: true,
    };
  }

  async changeStaffPin(actorId: string, profileId: string, newPin: string) {
    await this.requireAdmin(actorId);
    if (!newPin || !/^\d{6}$/.test(newPin)) {
      throw new BadRequestException('Staff PIN must be exactly 6 digits');
    }

    const db = this.supabase.admin;
    const { data: profile, error: profileErr } = await db
      .from('profiles').select('id, phone, full_name, is_active').eq('id', profileId).maybeSingle();
    if (profileErr || !profile) {
      throw new NotFoundException('Staff account not found');
    }

    const { data: roles, error: roleError } = await db
      .from('profile_roles').select('roles(code)').eq('profile_id', profileId);
    const roleCodes = (roles ?? []).map((r: any) => r.roles?.code);
    const isDriver = roleCodes.includes('driver');
    const isFacilityEmployee = roleCodes.includes('facility_employee');

    if (!isDriver && !isFacilityEmployee) {
      throw new BadRequestException('Target staff member is neither a driver nor a facility employee');
    }

    const pinHash = hashDriverPin(newPin);
    const internalEmail = isDriver
      ? getDriverInternalEmail(profile.phone || '')
      : getFacilityEmployeeInternalEmail(profile.phone || '');

    if (isDriver) {
      const { data: driver, error: driverErr } = await db
        .from('drivers').select('id, is_active').eq('profile_id', profileId).maybeSingle();
      if (driverErr || !driver) {
        throw new NotFoundException('Driver operational record not found');
      }

      // Update Supabase Auth user credentials
      const { error: authUpdateErr } = await db.auth.admin.updateUserById(profileId, {
        password: newPin,
        email: internalEmail,
        email_confirm: true,
        app_metadata: { driver_pin_hash: pinHash, provider: 'phone' },
      });
      if (authUpdateErr) {
        throw new BadRequestException('Failed to update driver authentication credentials');
      }

      try {
        await db.from('drivers').update({ driver_pin_hash: pinHash }).eq('profile_id', profileId);
      } catch {
        // Column may not exist on remote DB
      }

      await this.audit(actorId, profileId, 'driver_pin_changed', {
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Driver PIN updated successfully',
        profileId,
      };
    } else {
      const { data: employee, error: empErr } = await db
        .from('facility_employees').select('id, facility_id, is_active').eq('profile_id', profileId).maybeSingle();
      if (empErr || !employee) {
        throw new NotFoundException('Facility employee record not found');
      }

      // Update Supabase Auth user credentials
      const { error: authUpdateErr } = await db.auth.admin.updateUserById(profileId, {
        password: newPin,
        email: internalEmail,
        email_confirm: true,
        app_metadata: { employee_pin_hash: pinHash, provider: 'phone' },
      });
      if (authUpdateErr) {
        throw new BadRequestException('Failed to update facility employee authentication credentials');
      }

      await this.audit(actorId, profileId, 'facility_employee_pin_changed', {
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Facility employee PIN updated successfully',
        profileId,
      };
    }
  }

  async changeDriverPin(actorId: string, profileId: string, newPin: string) {
    return this.changeStaffPin(actorId, profileId, newPin);
  }

  async deactivate(actorId: string, profileId: string) {
    await this.requireAdmin(actorId);
    const db = this.supabase.admin;
    const { data: roles, error: roleError } = await db.from('profile_roles')
      .select('roles(code)').eq('profile_id', profileId);
    if (roleError || !(roles ?? []).some((row: any) =>
      ['driver', 'facility_employee', 'manager'].includes(row.roles?.code))) {
      throw new NotFoundException('Operational account not found');
    }
    // Revoke application access first; retain all historical foreign keys.
    const { data: profile, error: profileError } = await db.from('profiles')
      .update({ is_active: false }).eq('id', profileId).select('id').maybeSingle();
    if (profileError || !profile) throw new NotFoundException('Operational account not found');
    const {error: banError} = await db.auth.admin.updateUserById(profileId, {ban_duration: '876000h'});
    if (banError) throw new BadRequestException('Account access blocked; login revocation failed');
    const { error: driverError } = await db.from('drivers').update({
      is_active: false, is_available: false,
    }).eq('profile_id', profileId);
    const { error: facilityError } = await db.from('facility_employees')
      .update({ is_active: false }).eq('profile_id', profileId);
    if (driverError || facilityError) throw new BadRequestException('Account access blocked; operational status update failed');
    await this.audit(actorId, profileId, 'deactivate');
    return { profileId, active: false };
  }

  async activate(actorId: string, profileId: string) {
    await this.requireAdmin(actorId);
    const db = this.supabase.admin;
    const { data: roles, error: roleError } = await db.from('profile_roles')
      .select('roles(code)').eq('profile_id', profileId);
    if (roleError || roles?.length !== 1) throw new NotFoundException('Operational account not found');
    const code = (roles[0] as any).roles?.code;
    if (!['driver', 'facility_employee', 'manager'].includes(code)) {
      throw new NotFoundException('Operational account not found');
    }
    const table = code === 'driver' ? 'drivers' : 'facility_employees';
    const { data: record, error: recordError } = await db.from(table)
      .select(code === 'driver' ? 'id' : 'id,facility_id').eq('profile_id', profileId).maybeSingle();
    if (recordError || !record) throw new NotFoundException('Operational record not found');
    if (code !== 'driver') {
      const {data: facility, error: facilityError} = await db.from('facilities')
        .select('id,is_active').eq('id', (record as any).facility_id).maybeSingle();
      if (facilityError || !facility?.is_active) throw new BadRequestException('Active facility is required');
    }
    const { error: statusError } = await db.from(table).update({ is_active: true })
      .eq('profile_id', profileId);
    if (statusError) throw new BadRequestException('Unable to reactivate operational record');
    const {error: unbanError} = await db.auth.admin.updateUserById(profileId, {ban_duration: 'none'});
    if (unbanError) throw new BadRequestException('Unable to restore staff login');
    const { error: profileError } = await db.from('profiles').update({ is_active: true })
      .eq('id', profileId);
    if (profileError) throw new BadRequestException('Unable to reactivate account');
    await this.audit(actorId, profileId, 'activate');
    return { profileId, active: true };
  }

  async updateDriverAvailability(actorId: string, profileId: string, isAvailable: boolean) {
    await this.requireAdmin(actorId);
    const { data: driver, error: dErr } = await this.supabase.admin.from('drivers')
      .update({ is_available: isAvailable, is_online: isAvailable, updated_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .select('id,profile_id,is_active,is_available').maybeSingle();
    if (dErr || !driver) throw new NotFoundException('Driver account not found');
    await this.audit(actorId, profileId, isAvailable ? 'set_driver_available' : 'set_driver_unavailable');
    return driver;
  }

  async revokeAccess(actorId: string, profileId: string) {
    const result = await this.deactivate(actorId, profileId);
    await this.audit(actorId, profileId, 'revoke_access');
    return {...result, accessRevoked: true};
  }

  async facilities(actorId: string) {
    await this.requireAdmin(actorId);
    const {data, error} = await this.supabase.admin.from('facilities')
      .select('id,name,is_active').order('name').limit(200);
    if (error) throw new BadRequestException('Unable to load facilities');
    return data ?? [];
  }

  async list(actorId: string, search = '', role = '', status = '') {
    await this.requireAdmin(actorId);
    if (search.length > 100 || !['', 'driver', 'manager', 'facility_employee'].includes(role) ||
        !['', 'active', 'inactive'].includes(status)) throw new BadRequestException('Invalid staff filter');
    const db = this.supabase.admin;
    const [drivers, facilityStaff] = await Promise.all([
      db.from('drivers').select('id,profile_id,is_active,is_available,profiles(id,full_name,phone,is_active,created_at)').limit(500),
      db.from('facility_employees').select('id,profile_id,facility_id,employee_role,is_active,profiles(id,full_name,phone,is_active,created_at),facilities(id,name)').limit(500),
    ]);
    if (drivers.error || facilityStaff.error) throw new BadRequestException('Unable to load staff');
    const rows = [
      ...(drivers.data ?? []).map((record: any) => ({...record, role: 'driver', facility_id: null, facilities: null})),
      ...(facilityStaff.data ?? []).map((record: any) => ({...record, role: record.employee_role})),
    ];
    const term = search.trim().toLowerCase();
    return rows.filter((row: any) =>
      (!term || [row.profiles?.full_name, row.profiles?.phone].some(value => String(value ?? '').toLowerCase().includes(term))) &&
      (!role || row.role === role) &&
      (!status || Boolean(row.profiles?.is_active) === (status === 'active')),
    );
  }

  async detail(actorId: string, profileId: string) {
    await this.requireAdmin(actorId);
    const db = this.supabase.admin;
    const staff = (await this.list(actorId)).find((row: any) => row.profile_id === profileId);
    if (!staff) throw new NotFoundException('Operational account not found');
    const [audit, workload] = await Promise.all([
      db.from('admin_staff_action_audit').select('id,action,detail,created_at,actor_profile_id')
        .eq('target_profile_id', profileId).order('created_at', {ascending: false}).limit(100),
      staff.role === 'driver'
        ? db.from('driver_assignments').select('id,order_id,assignment_type,status,assigned_at,completed_at')
          .eq('driver_id', staff.id).order('assigned_at', {ascending: false}).limit(100)
        : db.from('facility_order_operations').select('id,order_id,current_status,received_at,ready_for_delivery_at')
          .eq('facility_id', staff.facility_id).order('received_at', {ascending: false}).limit(100),
    ]);
    if (audit.error || workload.error) throw new BadRequestException('Unable to load staff history');
    return {staff, audit: audit.data ?? [], workload: workload.data ?? []};
  }

  async reassignFacility(actorId: string, profileId: string, facilityId: string) {
    await this.requireAdmin(actorId);
    const db = this.supabase.admin;
    const [facility, staff] = await Promise.all([
      db.from('facilities').select('id,is_active').eq('id', facilityId).maybeSingle(),
      db.from('facility_employees').select('id,facility_id,is_active,employee_role')
        .eq('profile_id', profileId).maybeSingle(),
    ]);
    if (facility.error || !facility.data?.is_active) throw new BadRequestException('Active facility required');
    if (staff.error || !staff.data) throw new NotFoundException('Facility staff not found');
    if (staff.data.facility_id === facilityId) throw new ConflictException('Staff is already assigned to this facility');
    const {data, error} = await db.from('facility_employees').update({facility_id: facilityId})
      .eq('profile_id', profileId).eq('facility_id', staff.data.facility_id).select('id').maybeSingle();
    if (error || !data) throw new ConflictException('Facility assignment changed; refresh and retry');
    await this.audit(actorId, profileId, 'reassign_facility', {fromFacilityId: staff.data.facility_id, toFacilityId: facilityId});
    return {profileId, facilityId};
  }

  async driverProfile(profileId: string) {
    const { data, error } = await this.supabase.admin.from('drivers')
      .select('id,is_active,is_available,max_concurrent_jobs,profiles(id,full_name,phone,avatar_path,is_active)')
      .eq('profile_id', profileId).maybeSingle();
    if (error || !data?.is_active) throw new NotFoundException('Active driver profile not found');
    return data;
  }

  async updateDriverName(profileId: string, fullName: string) {
    await this.driverProfile(profileId);
    const { data, error } = await this.supabase.admin.from('profiles')
      .update({ full_name: fullName.trim() }).eq('id', profileId)
      .select('id,full_name,phone,avatar_path').single();
    if (error) throw new BadRequestException('Unable to update driver profile');
    return data;
  }
}
