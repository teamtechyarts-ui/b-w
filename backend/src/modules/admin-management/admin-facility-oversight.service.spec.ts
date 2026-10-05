import {NotFoundException} from '@nestjs/common';
import {AdminFacilityOversightService} from './admin-facility-oversight.service';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const old = new Date(Date.now() - 25 * 3600000).toISOString();
const data: Record<string, any[]> = {
  facilities: [{id: a, name: 'A Facility', is_active: true}, {id: b, name: 'B Facility', is_active: true}],
  orders: [{id: 'order-a', order_number: 'BW-A', facility_id: a, current_status: 'processing', created_at: old, updated_at: old},
    {id: 'order-b', order_number: 'BW-B', facility_id: b, current_status: 'ready_for_delivery', created_at: old, updated_at: old}],
  facility_order_operations: [{id: 'op-a', order_id: 'order-a', facility_id: a, operation_type: 'washing', status: 'started',
    started_at: old, rewash_cycle: 0}],
  facility_intake_discrepancies: [{id: 'dis-a', order_id: 'order-a', status: 'open', kind: 'missing', notes: 'Missing item'}],
  facility_qc_decisions: [{id: 'qc-b', order_id: 'order-b', approved: false, cycle_number: 0}],
  facility_packings: [], facility_employees: [{id: 'employee-a', facility_id: a, profile_id: 'staff-a', is_active: true}],
  profiles: [{id: 'staff-a', is_active: true}], facility_machines: [{id: 'machine-a', facility_id: a, status: 'active', capacity_kg: 10}],
  garment_inspections: [], order_status_history: [], order_qr_codes: [{id: 'qr-a', order_id: 'order-a', is_active: true}],
  qr_scan_logs: [{id: 'scan-a', qr_code_id: 'qr-a', scan_action: 'facility_intake', scanned_at: old}],
};
const fixture = () => {
  const selectedColumns: Record<string, string[]> = {};
  const from = jest.fn((table: string) => {
    const filters: Array<{column: string; value: string}> = [];
    const query: any = {
      select: (cols: string) => {
        if (!selectedColumns[table]) selectedColumns[table] = [];
        selectedColumns[table].push(cols);
        return query;
      },
      eq: (column: string, value: string) => {filters.push({column, value}); return query;},
      maybeSingle: async () => ({data: data[table]?.find(row => filters.every(filter => row[filter.column] === filter.value)) ?? null, error: null}),
      range: async () => ({data: (data[table] ?? []).filter(row => filters.every(filter => row[filter.column] === filter.value)), error: null}),
    };
    return query;
  });
  return {service: new AdminFacilityOversightService({admin: {from}} as any), from, selectedColumns};
};

describe('9H Admin Facility oversight', () => {
  it('aggregates cross-Facility workload, discrepancy, stage, age, staff, and installed capacity without writes', async () => {
    const {service, from, selectedColumns} = fixture();
    const result = await service.list();
    expect(result.facilities[0]).toMatchObject({id: a, workload: 1, openDiscrepancies: 1,
      stages: {washing: 1}, stuckOrders: 1, activeStaff: 1, installedMachineCapacityKg: 10});
    expect(result.facilities[1]).toMatchObject({id: b, workload: 1, ready: 1, qcFailures: 1});
    expect(result.monitoring.contractualSla).toBe(false);
    expect(from).toHaveBeenCalledWith('facility_order_operations');

    // Schema contract verification: must NOT query non-existent columns like rewash_cycle, started_by, completed_by
    const opCols = selectedColumns['facility_order_operations'] || [];
    expect(opCols.length).toBeGreaterThan(0);
    for (const cols of opCols) {
      expect(cols).not.toContain('rewash_cycle');
      expect(cols).not.toContain('started_by');
      expect(cols).not.toContain('completed_by');
    }
  });

  it('handles empty facility_order_operations gracefully', async () => {
    const emptyFixture = () => {
      const from = jest.fn((table: string) => {
        const query: any = {
          select: () => query,
          eq: () => query,
          range: async () => ({
            data: table === 'facilities' ? data.facilities : table === 'orders' ? data.orders : [],
            error: null,
          }),
        };
        return query;
      });
      return new AdminFacilityOversightService({admin: {from}} as any);
    };
    const s = emptyFixture();
    const result = await s.list();
    expect(result.facilities).toHaveLength(2);
    expect(result.facilities[0].stages.washing).toBe(0);
  });

  it('throws BadRequestException when query fails and preserves error', async () => {
    const failingFixture = () => {
      const from = jest.fn((table: string) => {
        const query: any = {
          select: () => query,
          eq: () => query,
          range: async () => {
            if (table === 'facility_order_operations') {
              return {data: null, error: {message: 'column rewash_cycle does not exist', code: '42703'}};
            }
            return {data: [], error: null};
          },
        };
        return query;
      });
      return new AdminFacilityOversightService({admin: {from}} as any);
    };
    const s = failingFixture();
    await expect(s.list()).rejects.toThrow('Unable to load Facility facility_order_operations');
  });

  it('limits Facility drill-down to the selected Facility', async () => {
    const {service} = fixture();
    expect((await service.facility(a)).orders.map(row => row.id)).toEqual(['order-a']);
    await expect(service.facility('missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.order(a, 'order-b')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns QR scan audit without exposing the secure QR token', async () => {
    const {service} = fixture();
    const result = await service.order(a, 'order-a');
    expect(result.qr[0].scans[0].scan_action).toBe('facility_intake');
    expect(JSON.stringify(result)).not.toContain('secure_token');
    expect(result.operations).toHaveLength(1);
  });

  it('lists locations with coordinates and service radius', async () => {
    const {service} = fixture();
    const locations = await service.listLocations();
    expect(locations).toHaveLength(2);
    expect(locations[0]).toMatchObject({id: a, name: 'A Facility', serviceRadiusMeters: 10000, isActive: true});
  });

  it('creates, updates and deactivates/deletes a location', async () => {
    const dbFacilities: any[] = [{id: a, name: 'A Facility', is_active: true}];
    const dbOrders: any[] = [{id: 'ord-1', facility_id: a}];
    const from = jest.fn((table: string) => {
      let filterCol = '';
      let filterVal = '';
      const query: any = {
        select: () => query,
        eq: (col: string, val: any) => { filterCol = col; filterVal = val; return query; },
        maybeSingle: async () => ({ data: dbFacilities.find(f => f[filterCol] === filterVal) ?? null, error: null }),
        single: async () => ({ data: dbFacilities[0], error: null }),
        insert: (obj: any) => {
          const item = { id: 'new-id', ...obj };
          dbFacilities.push(item);
          return { select: () => ({ single: async () => ({ data: item, error: null }) }) };
        },
        update: (obj: any) => ({
          eq: (col: string, val: any) => {
            const t = dbFacilities.find(f => f[col] === val);
            if (t) Object.assign(t, obj);
            return {
              select: () => ({
                single: async () => ({ data: t, error: null }),
              }),
              then: (resolve: any) => resolve({ data: t, error: null }),
            };
          },
        }),
        delete: () => ({ eq: (col: string, val: any) => Promise.resolve({ error: null }) }),
        range: async () => ({ data: table === 'facilities' ? dbFacilities : table === 'orders' ? dbOrders : [], error: null }),
        then: (resolve: any) => {
          if (table === 'orders') {
            const matches = dbOrders.filter(o => !filterCol || o[filterCol] === filterVal);
            return resolve({ data: matches, count: matches.length, error: null });
          }
          return resolve({ data: table === 'facilities' ? dbFacilities : [], count: 0, error: null });
        },
      };
      return query;
    });

    const service = new AdminFacilityOversightService({admin: {from}} as any);

    // Create
    const created = await service.createLocation('admin-1', {
      name: 'Banjara Hills Facility',
      address: 'Road No 12, Banjara Hills',
      latitude: 17.385044,
      longitude: 78.486671,
      serviceRadiusMeters: 10000,
    });
    expect(created.name).toBe('Banjara Hills Facility');
    expect(created.latitude).toBe(17.385044);
    expect(created.serviceRadiusMeters).toBe(10000);

    // Update
    const updated = await service.updateLocation('admin-1', a, {
      name: 'Central Facility Prime',
      serviceRadiusMeters: 15000,
    });
    expect(updated.name).toBe('Central Facility Prime');
    expect(updated.serviceRadiusMeters).toBe(15000);

    // Delete with existing orders -> archives
    const deleted = await service.deleteLocation('admin-1', a);
    expect(deleted.archived).toBe(true);
  });
});

