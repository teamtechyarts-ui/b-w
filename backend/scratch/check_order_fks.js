const fs = require('fs');

const content = fs.readFileSync('current_schema.sql', 'utf8');

// Find all foreign keys referencing orders
const ordersFks = [...content.matchAll(/ALTER TABLE (?:ONLY )?["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?\s+ADD CONSTRAINT ["']?([a-zA-Z0-9_]+)["']? FOREIGN KEY \(([^)]+)\) REFERENCES ["']?public["']?\.?["']?orders["']?\(([^)]+)\)([^;]*);/g)];

console.log('=== FOREIGN KEYS REFERENCING orders ===');
ordersFks.forEach(m => {
  const [_, table, fkName, col, refCol, extra] = m;
  const deleteRule = extra.includes('ON DELETE CASCADE') ? 'CASCADE' :
                     extra.includes('ON DELETE SET NULL') ? 'SET NULL' :
                     extra.includes('ON DELETE RESTRICT') ? 'RESTRICT' : 'NO ACTION';
  console.log(`${table}.${col.trim()} -> orders.${refCol.trim()} | [${fkName}] | ON DELETE ${deleteRule}`);
});

// Find all foreign keys referencing driver_assignments
const assignFks = [...content.matchAll(/ALTER TABLE (?:ONLY )?["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?\s+ADD CONSTRAINT ["']?([a-zA-Z0-9_]+)["']? FOREIGN KEY \(([^)]+)\) REFERENCES ["']?public["']?\.?["']?driver_assignments["']?\(([^)]+)\)([^;]*);/g)];

console.log('\n=== FOREIGN KEYS REFERENCING driver_assignments ===');
assignFks.forEach(m => {
  const [_, table, fkName, col, refCol, extra] = m;
  const deleteRule = extra.includes('ON DELETE CASCADE') ? 'CASCADE' :
                     extra.includes('ON DELETE SET NULL') ? 'SET NULL' :
                     extra.includes('ON DELETE RESTRICT') ? 'RESTRICT' : 'NO ACTION';
  console.log(`${table}.${col.trim()} -> driver_assignments.${refCol.trim()} | [${fkName}] | ON DELETE ${deleteRule}`);
});
