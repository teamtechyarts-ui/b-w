const fs = require('fs');

const migrationFiles = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql'));
let allSql = fs.readFileSync('current_schema.sql', 'utf8') + '\n';
migrationFiles.forEach(f => {
  allSql += fs.readFileSync(`supabase/migrations/${f}`, 'utf8') + '\n';
});

console.log('=== CHECKING ALL REFERENCES TO orders IN ENTIRE CODEBASE/MIGRATIONS ===');
const orderRefs = [...allSql.matchAll(/REFERENCES (?:public\.)?orders\s*\(([^)]+)\)([^;,\n]*)/gi)];
orderRefs.forEach(m => console.log(m[0]));

console.log('\n=== CHECKING ALL REFERENCES TO driver_assignments IN ENTIRE CODEBASE/MIGRATIONS ===');
const assignRefs = [...allSql.matchAll(/REFERENCES (?:public\.)?driver_assignments\s*\(([^)]+)\)([^;,\n]*)/gi)];
assignRefs.forEach(m => console.log(m[0]));
