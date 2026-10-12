const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(__dirname, '..', 'current_schema.sql');
const content = fs.readFileSync(schemaPath, 'utf8');

// Search for admin_assignment_audit
const matches = [...content.matchAll(/.*admin_assignment_audit.*/g)];
console.log('=== MATCHES FOR admin_assignment_audit ===');
matches.forEach(m => console.log(m[0]));

// Search for admin_activity_logs
const matchesAct = [...content.matchAll(/.*admin_activity_logs.*/g)];
console.log('\n=== MATCHES FOR admin_activity_logs ===');
matchesAct.forEach(m => console.log(m[0]));
