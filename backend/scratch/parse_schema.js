const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const content = fs.readFileSync('current_schema.sql', 'utf8');

// Find all CREATE TABLE statements
const tableMatches = [...content.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?/g)];
const tables = [...new Set(tableMatches.map(m => m[1]))];
console.log('=== ALL TABLES IN current_schema.sql (' + tables.length + ') ===');
console.log(tables.join(', '));

// Find all ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY
const fkMatches = [...content.matchAll(/ALTER TABLE (?:ONLY )?["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?\s+ADD CONSTRAINT ["']?([a-zA-Z0-9_]+)["']? FOREIGN KEY \(([^)]+)\) REFERENCES ["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?\(([^)]+)\)([^;]*);/g)];

console.log('\n=== TOTAL FOREIGN KEYS FOUND: ' + fkMatches.length + ' ===');
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
    deleteRule,
    extra: extra.trim()
  };
});

fks.forEach(fk => {
  console.log(`${fk.table}.${fk.column} -> ${fk.referencedTable}.${fk.referencedColumn} | [${fk.fkName}] | ON DELETE ${fk.deleteRule}`);
});

// Also find foreign keys referencing auth.users
const authFkMatches = [...content.matchAll(/ALTER TABLE (?:ONLY )?["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?\s+ADD CONSTRAINT ["']?([a-zA-Z0-9_]+)["']? FOREIGN KEY \(([^)]+)\) REFERENCES ["']?auth["']?\.?["']?users["']?\(([^)]+)\)([^;]*);/g)];
console.log('\n=== FOREIGN KEYS TO auth.users: ' + authFkMatches.length + ' ===');
authFkMatches.forEach(m => {
  const [_, table, fkName, col, refCol, extra] = m;
  const deleteRule = extra.includes('ON DELETE CASCADE') ? 'CASCADE' :
                     extra.includes('ON DELETE SET NULL') ? 'SET NULL' :
                     extra.includes('ON DELETE RESTRICT') ? 'RESTRICT' : 'NO ACTION';
  console.log(`${table}.${col.replace(/["'\s]/g, '')} -> auth.users.${refCol.replace(/["'\s]/g, '')} | [${fkName}] | ON DELETE ${deleteRule}`);
});
