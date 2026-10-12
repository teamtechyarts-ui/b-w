const fs = require('fs');

const content = fs.readFileSync('current_schema.sql', 'utf8');

// Find all CREATE TRIGGER statements
const triggerMatches = [...content.matchAll(/CREATE TRIGGER\s+["']?([a-zA-Z0-9_]+)["']?\s+(BEFORE|AFTER|INSTEAD OF)\s+([^ON]+)ON\s+["']?public["']?\.?["']?([a-zA-Z0-9_]+)["']?\s+FOR EACH ROW\s+EXECUTE FUNCTION\s+([^;]+);/g)];

console.log(`=== TRIGGERS FOUND IN SCHEMA (${triggerMatches.length}) ===`);
triggerMatches.forEach(m => {
  const [_, name, timing, events, table, func] = m;
  console.log(`Trigger: ${name} on public.${table} | ${timing} ${events.trim()} -> ${func.trim()}`);
});
