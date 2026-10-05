import { ForbiddenException } from '@nestjs/common';
import { StaffService } from './staff.service';

function fixture(admin = true) {
  const calls: Array<{table: string; method: string; value?: unknown}> = [];
  let roleLookups = 0;
  const from = jest.fn((table: string) => {
    const query: any = {};
    for (const method of ['select', 'eq', 'insert', 'update', 'single', 'maybeSingle']) {
      query[method] = jest.fn((value?: unknown) => {
        calls.push({table, method, value});
        return query;
      });
    }
    query.then = (resolve: any) => {
      const data = table === 'profile_roles' ? [{roles: {code: admin && roleLookups++ === 0 ? 'admin' : 'driver'}}]
        : table === 'roles' ? {id: 'role-id'}
        : table === 'drivers' ? {id: 'driver-id', is_active: true, profiles: {id: 'profile-id'}}
        : table === 'profiles' ? {id: 'profile-id'}
        : {id: 'record-id', is_active: true};
      return Promise.resolve({data, error: null}).then(resolve);
    };
    return query;
  });
  const createUser = jest.fn().mockResolvedValue({data: {user: {id: 'new-profile-id'}}, error: null});
  const updateUserById = jest.fn().mockResolvedValue({data: {user: {id: 'profile-id'}}, error: null});
  const service = new StaffService({admin: {from, auth: {admin: {createUser, updateUserById}}}} as any);
  return {service, from, createUser, updateUserById, calls};
}

describe('Admin operational provisioning', () => {
  const driver = {phone: '+16505550102', fullName: 'Development Driver', role: 'driver' as const, pin: '123456'};

  it('rejects a Driver or Facility actor before creating a privileged account', async () => {
    const f = fixture(false);
    await expect(f.service.provision('driver-actor', driver)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.deactivate('driver-actor', 'other-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.createUser).not.toHaveBeenCalled();
  });

  it('creates a Driver inactive first, assigns only the driver role, then activates', async () => {
    const f = fixture();
    await f.service.provision('admin-actor', driver);
    expect(f.createUser).toHaveBeenCalledWith(expect.objectContaining({
      phone: driver.phone, phone_confirm: true,
      user_metadata: expect.objectContaining({bw_staff_provisioning: true}),
    }));
    expect(f.calls.filter(call => call.table === 'customers')).toHaveLength(0);
    const profileUpdates = f.calls.filter(call => call.table === 'profiles' && call.method === 'update');
    expect(profileUpdates[0].value).toEqual(expect.objectContaining({is_active: false}));
    expect(profileUpdates[1].value).toEqual({is_active: true});
    expect(f.calls.some(call => call.table === 'drivers' && call.method === 'insert')).toBe(true);
  });

  it('allows Admin to update driver PIN securely with hash and audit', async () => {
    const f = fixture();
    const result = await f.service.changeDriverPin('admin-actor', 'driver-profile-id', '654321');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Driver PIN updated successfully');
    expect(f.updateUserById).toHaveBeenCalledWith('driver-profile-id', expect.objectContaining({
      password: '654321',
      app_metadata: expect.objectContaining({provider: 'phone'}),
    }));
    expect(f.calls.some(call => call.table === 'admin_staff_action_audit' && call.method === 'insert')).toBe(true);
  });

  it('requires an active facility for staff and never creates an Auth user otherwise', async () => {
    const f = fixture();
    await expect(f.service.provision('admin-actor', {phone: driver.phone, fullName: driver.fullName, role: 'facility_employee'})).rejects.toThrow('Active facility');
    expect(f.createUser).not.toHaveBeenCalled();
  });

  it('provisions Facility Employee with active facility and 6-digit PIN', async () => {
    const f = fixture();
    const result = await f.service.provision('admin-actor', {
      phone: '+919876543210',
      fullName: 'Suresh Kumar',
      role: 'facility_employee',
      facilityId: 'facility-id',
      pin: '654321',
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Facility Employee provisioned successfully');
    expect(f.createUser).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+919876543210',
      email: 'facility.919876543210@brightwhite.internal',
      password: '654321',
      app_metadata: expect.objectContaining({
        employee_pin_hash: expect.stringMatching(/^pbkdf2:/),
        provider: 'phone',
      }),
    }));
    expect(f.calls.some(call => call.table === 'facility_employees' && call.method === 'insert')).toBe(true);
  });

  it('rejects Facility Employee provisioning when PIN is missing or invalid', async () => {
    const f = fixture();
    await expect(f.service.provision('admin-actor', {
      phone: '+919876543210',
      fullName: 'Suresh Kumar',
      role: 'facility_employee',
      facilityId: 'facility-id',
      pin: '123',
    })).rejects.toThrow('Facility Employee PIN is required and must be exactly 6 digits');
  });

  it('rejects Manager role from active provisioning', async () => {
    const f = fixture();
    await expect(f.service.provision('admin-actor', {
      phone: '+919876543210',
      fullName: 'Manager Name',
      role: 'manager' as any,
      facilityId: 'facility-id',
      pin: '123456',
    })).rejects.toThrow('Manager role is no longer available');
  });

  it('allows Admin to update facility employee PIN securely with hash and audit', async () => {
    const f = fixture();
    let lastEq: any = null;
    f.from.mockImplementation((table: string) => {
      const query: any = {};
      for (const method of ['select', 'eq', 'insert', 'update', 'single', 'maybeSingle']) {
        query[method] = jest.fn((field?: unknown, value?: unknown) => {
          if (method === 'eq') lastEq = value !== undefined ? value : field;
          f.calls.push({table, method, value: value !== undefined ? value : field});
          return query;
        });
      }
      query.then = (resolve: any) => {
        const data = table === 'profile_roles'
          ? (lastEq === 'admin-actor' ? [{roles: {code: 'admin'}}] : [{roles: {code: 'facility_employee'}}])
          : table === 'facility_employees' ? {id: 'emp-id', is_active: true, facility_id: 'facility-1'}
          : table === 'profiles' ? {id: 'emp-profile-id', phone: '+919876543210', is_active: true}
          : {id: 'record-id', is_active: true};
        return Promise.resolve({data, error: null}).then(resolve);
      };
      return query;
    });

    const result = await f.service.changeStaffPin('admin-actor', 'emp-profile-id', '987654');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Facility employee PIN updated successfully');
    expect(f.updateUserById).toHaveBeenCalledWith('emp-profile-id', expect.objectContaining({
      password: '987654',
      email: 'facility.919876543210@brightwhite.internal',
      app_metadata: expect.objectContaining({
        employee_pin_hash: expect.stringMatching(/^pbkdf2:/),
        provider: 'phone',
      }),
    }));
    expect(f.calls.some(call => call.table === 'admin_staff_action_audit' && call.method === 'insert')).toBe(true);
  });

  it('deactivates access and availability without deleting historical Driver rows', async () => {
    const f = fixture();
    await f.service.deactivate('admin-actor', 'driver-profile-id');
    expect(f.calls).toContainEqual({table: 'profiles', method: 'update', value: {is_active: false}});
    expect(f.calls).toContainEqual({table: 'drivers', method: 'update', value: {is_active: false, is_available: false}});
    expect(f.calls.some(call => call.method === 'delete')).toBe(false);
    expect(f.updateUserById).toHaveBeenCalledWith('driver-profile-id', {ban_duration: '876000h'});
    expect(f.calls.some(call => call.table === 'admin_staff_action_audit' && call.method === 'insert')).toBe(true);
  });

  it('re-enables staff using existing records and lifts the login ban', async () => {
    const f = fixture();
    await f.service.activate('admin-actor', 'driver-profile-id');
    expect(f.updateUserById).toHaveBeenCalledWith('driver-profile-id', {ban_duration: 'none'});
    expect(f.calls.some(call => call.method === 'delete')).toBe(false);
  });

  it('requires Admin for staff search, detail and facility reassignment', async () => {
    const f = fixture(false);
    await expect(f.service.list('driver-actor')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.detail('driver-actor', 'other-id')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.reassignFacility('driver-actor', 'other-id', 'facility-id')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
