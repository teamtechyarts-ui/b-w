const fs = require('fs');
const content = fs.readFileSync('backend/current_schema.sql', 'utf8');
const tables = [...content.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?/g)].map(m => m[1]);
console.log('Tables containing otp or reset or token:', tables.filter(t => t.includes('otp') || t.includes('reset') || t.includes('token') || t.includes('challenge') || t.includes('auth')));
