const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse backend/.env
const envPath = path.resolve(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const k = trimmed.substring(0, idx).trim();
      let v = trimmed.substring(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.substring(1, v.length - 1);
      }
      env[k] = v;
    }
  }
});

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Service Role Key in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runPreDeletionAudit() {
  console.log('========================================================================');
  console.log('   BRIGHT & WHITE LAUNDRY PLATFORM - COMPREHENSIVE RESET AUDIT          ');
  console.log('========================================================================\n');

  // 1. Fetch Supabase Auth users
  console.log('>>> [1] Inspecting Supabase Auth Users (auth.users)...');
  const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authErr) {
    console.error('Failed to list auth users:', authErr);
  }
  const authUsers = authData ? authData.users : [];
  console.log(`Total Auth Users in Supabase Auth: ${authUsers.length}`);

  // 2. Fetch Roles & Permissions
  console.log('\n>>> [2] Inspecting Roles & System Permissions...');
  const { data: roles } = await supabase.from('roles').select('*');
  const { data: profileRoles } = await supabase.from('profile_roles').select('*, roles(*)');
  console.log(`Roles configured (${roles?.length || 0}):`, roles?.map(r => `${r.name} (${r.id})`));

  // 3. Fetch Profiles
  console.log('\n>>> [3] Inspecting User Profiles (profiles)...');
  const { data: profiles, error: profErr } = await supabase.from('profiles').select('*');
  if (profErr) console.error('Error fetching profiles:', profErr);
  console.log(`Total Profiles: ${profiles?.length || 0}`);

  // Map profile roles
  const profileRoleMap = {};
  (profileRoles || []).forEach(pr => {
    if (!profileRoleMap[pr.profile_id]) profileRoleMap[pr.profile_id] = [];
    profileRoleMap[pr.profile_id].push(pr.roles?.name || pr.role_id);
  });

  const adminProfiles = [];
  const driverProfiles = [];
  const facilityProfiles = [];
  const customerProfiles = [];
  const otherProfiles = [];

  (profiles || []).forEach(p => {
    const rolesList = profileRoleMap[p.id] || [];
    const isAdm = rolesList.includes('admin') || rolesList.includes('super_admin');
    const isDrv = rolesList.includes('driver');
    const isFac = rolesList.includes('facility_employee') || rolesList.includes('facility_operator') || rolesList.includes('facility_manager');
    const isCust = rolesList.includes('customer') || (!isAdm && !isDrv && !isFac);

    const userSummary = {
      id: p.id,
      email: p.email,
      phone: p.phone,
      fullName: p.full_name,
      roles: rolesList,
      isActive: p.is_active,
      createdAt: p.created_at
    };

    if (isAdm) adminProfiles.push(userSummary);
    else if (isDrv) driverProfiles.push(userSummary);
    else if (isFac) facilityProfiles.push(userSummary);
    else if (isCust) customerProfiles.push(userSummary);
    else otherProfiles.push(userSummary);
  });

  console.log('\n--- Profiles Categorization ---');
  console.log(`Admins (MUST PRESERVE): ${adminProfiles.length}`);
  adminProfiles.forEach(a => console.log(`  - [ADMIN] ${a.email || a.phone || a.id} | Name: ${a.fullName} | ID: ${a.id}`));

  console.log(`Drivers (Targeted for reset): ${driverProfiles.length}`);
  driverProfiles.forEach(d => console.log(`  - [DRIVER] ${d.email || d.phone || d.id} | Name: ${d.fullName} | ID: ${d.id}`));

  console.log(`Facility Employees (Targeted for reset): ${facilityProfiles.length}`);
  facilityProfiles.forEach(f => console.log(`  - [FACILITY] ${f.email || f.phone || f.id} | Name: ${f.fullName} | ID: ${f.id}`));

  console.log(`Customers / App Users (Targeted for reset): ${customerProfiles.length}`);
  customerProfiles.forEach(c => console.log(`  - [CUSTOMER] ${c.email || c.phone || c.id} | Name: ${c.fullName} | ID: ${c.id}`));

  if (otherProfiles.length > 0) {
    console.log(`Other Profiles: ${otherProfiles.length}`);
    otherProfiles.forEach(o => console.log(`  - [OTHER] ${o.email || o.phone || o.id} | Roles: ${o.roles.join(',')}`));
  }

  // Cross reference with Auth Users
  console.log('\n--- Supabase Auth Users Cross-Reference ---');
  const adminAuthIds = new Set(adminProfiles.map(a => a.id));
  const nonAdminAuthUsers = authUsers.filter(u => !adminAuthIds.has(u.id));
  const adminAuthUsers = authUsers.filter(u => adminAuthIds.has(u.id));

  console.log(`Admin Auth Accounts (MUST PRESERVE): ${adminAuthUsers.length}`);
  adminAuthUsers.forEach(u => console.log(`  - [ADMIN AUTH] ${u.email || u.phone} (ID: ${u.id})`));
  console.log(`Non-Admin Auth Accounts (Targeted if auth cleanup approved): ${nonAdminAuthUsers.length}`);
  nonAdminAuthUsers.forEach(u => console.log(`  - [USER AUTH] ${u.email || u.phone || 'no-contact'} (ID: ${u.id})`));

  // 4. Inspect Facilities
  console.log('\n>>> [4] Inspecting Facilities (facilities)...');
  const { data: facilities } = await supabase.from('facilities').select('*');
  console.log(`Total Facilities: ${facilities?.length || 0}`);
  (facilities || []).forEach(f => console.log(`  - Facility: ${f.name} (ID: ${f.id}) | Code: ${f.code} | Active: ${f.is_active}`));

  // 5. Inspect Drivers Table
  console.log('\n>>> [5] Inspecting Drivers Table (drivers)...');
  const { data: drivers } = await supabase.from('drivers').select('*');
  console.log(`Total Drivers in 'drivers' table: ${drivers?.length || 0}`);
  (drivers || []).forEach(d => console.log(`  - Driver ID: ${d.id} | Profile ID: ${d.profile_id} | Active: ${d.is_active}`));

  // 6. Inspect Facility Employees Table
  console.log('\n>>> [6] Inspecting Facility Employees Table (facility_employees)...');
  const { data: facEmps } = await supabase.from('facility_employees').select('*');
  console.log(`Total Facility Employees in 'facility_employees' table: ${facEmps?.length || 0}`);
  (facEmps || []).forEach(fe => console.log(`  - Emp ID: ${fe.id} | Facility ID: ${fe.facility_id} | Profile ID: ${fe.profile_id} | Active: ${fe.is_active}`));

  // 7. Inspect Customers Table
  console.log('\n>>> [7] Inspecting Customers Table (customers)...');
  const { data: customers } = await supabase.from('customers').select('*');
  console.log(`Total Records in 'customers' table: ${customers?.length || 0}`);

  // 8. Inspect Orders Table
  console.log('\n>>> [8] Inspecting Orders Table (orders)...');
  const { data: orders } = await supabase.from('orders').select('id, order_number, customer_id, facility_id, status, created_at');
  console.log(`Total Orders in 'orders' table: ${orders?.length || 0}`);
  (orders || []).forEach(o => console.log(`  - Order ${o.order_number} (${o.id}) | Status: ${o.status}`));

  // 9. Inspect all 58 database tables for live row counts
  console.log('\n>>> [9] Querying Live Row Counts Across ALL Database Tables...');
  const schemaPath = path.resolve(__dirname, '..', 'current_schema.sql');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const tableMatches = [...schemaContent.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?/g)];
  const allKnownTables = [...new Set(tableMatches.map(m => m[1]))].sort();

  const tableCounts = {};
  for (const tbl of allKnownTables) {
    try {
      const { count, error } = await supabase.from(tbl).select('*', { count: 'exact', head: true });
      if (error) {
        tableCounts[tbl] = { count: 0, error: error.message };
      } else {
        tableCounts[tbl] = { count: count || 0, error: null };
      }
    } catch (e) {
      tableCounts[tbl] = { count: 0, error: e.message };
    }
  }

  // Print table counts
  console.log('\nTable Counts:');
  for (const [tbl, info] of Object.entries(tableCounts)) {
    if (info.error) {
      console.log(`  ${tbl.padEnd(35)} : ERROR (${info.error})`);
    } else {
      console.log(`  ${tbl.padEnd(35)} : ${info.count} rows`);
    }
  }

  // 10. Parse foreign keys and dependency graph
  console.log('\n>>> [10] Parsing Foreign Key Dependencies from current_schema.sql...');
  const fkMatches = [...schemaContent.matchAll(/ALTER TABLE (?:ONLY )?["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?\s+ADD CONSTRAINT ["']?([a-zA-Z0-9_]+)["']? FOREIGN KEY \(([^)]+)\) REFERENCES ["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?\(([^)]+)\)([^;]*);/g)];
  
  const fks = fkMatches.map(m => {
    const [_, table, fkName, col, refTable, refCol, extra] = m;
    const cleanedCol = col.replace(/["'\s]/g, '');
    const cleanedRefCol = refCol.replace(/["'\s]/g, '');
    const deleteRule = extra.includes('ON DELETE CASCADE') ? 'CASCADE' :
                       extra.includes('ON DELETE SET NULL') ? 'SET NULL' :
                       extra.includes('ON DELETE RESTRICT') ? 'RESTRICT' : 'NO ACTION';
    return {
      table,
      column: cleanedCol,
      referencedTable: refTable,
      referencedColumn: cleanedRefCol,
      fkName,
      deleteRule
    };
  });

  // Group FKs by referenced table
  const referencingTables = {};
  fks.forEach(fk => {
    if (!referencingTables[fk.referencedTable]) referencingTables[fk.referencedTable] = [];
    referencingTables[fk.referencedTable].push(fk);
  });

  console.log('\nKey Dependent Tables:');
  ['orders', 'drivers', 'facilities', 'customers', 'facility_employees', 'profiles'].forEach(target => {
    console.log(`\nTables referencing '${target}':`);
    const refs = referencingTables[target] || [];
    refs.forEach(r => {
      console.log(`  - ${r.table}.${r.column} -> ${r.referencedTable}.${r.referencedColumn} [ON DELETE ${r.deleteRule}]`);
    });
  });

  // 11. Create a restorable JSON backup of all existing records in affected tables
  console.log('\n>>> [11] Generating Complete Pre-Deletion Backup Archive...');
  const backupDir = path.resolve(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `pre_reset_operational_backup_${timestamp}.json`);

  const backupData = {
    timestamp: new Date().toISOString(),
    supabaseUrl: supabaseUrl,
    summary: {
      totalAuthUsers: authUsers.length,
      adminCount: adminProfiles.length,
      driverCount: driverProfiles.length,
      facilityEmployeeCount: facilityProfiles.length,
      customerCount: customerProfiles.length
    },
    authUsers: authUsers,
    tables: {}
  };

  for (const tbl of allKnownTables) {
    if (tableCounts[tbl] && tableCounts[tbl].count > 0) {
      const { data, error } = await supabase.from(tbl).select('*');
      if (!error && data) {
        backupData.tables[tbl] = data;
        console.log(`  Backed up ${data.length} records from '${tbl}'`);
      }
    }
  }

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`\n>>> Backup successfully saved to: ${backupFile} (${(fs.statSync(backupFile).size / 1024).toFixed(2)} KB)`);

  return {
    adminProfiles,
    driverProfiles,
    facilityProfiles,
    customerProfiles,
    authUsers,
    tableCounts,
    fks,
    referencingTables,
    backupFile
  };
}

runPreDeletionAudit()
  .then(() => {
    console.log('\nAudit complete.');
  })
  .catch(err => {
    console.error('Audit failed:', err);
  });
