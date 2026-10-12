const fs = require('fs');
const content = fs.readFileSync('backend/current_schema.sql', 'utf8');
const fns = [...content.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?/g)].map(m => m[1]);
console.log('Public functions count:', fns.length);
console.log('Matching functions:', fns.filter(f => f.includes('exec') || f.includes('sql') || f.includes('admin') || f.includes('reset') || f.includes('cleanup') || f.includes('delete')));
