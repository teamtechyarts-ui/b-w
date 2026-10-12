const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (/\.(tsx|ts|jsx|js)$/.test(file)) {
      results.push(fullPath);
    }
  });
  return results;
}

const validRoles = new Set([
  'none', 'button', 'link', 'search', 'image', 'keyboardkey', 'text', 'adjustable',
  'imagebutton', 'header', 'summary', 'alert', 'checkbox', 'combobox', 'menu',
  'menubar', 'menuitem', 'progressbar', 'radio', 'radiogroup', 'scrollbar',
  'spinbutton', 'switch', 'tab', 'tabbar', 'tablist', 'timer', 'toolbar', 'grid'
]);

const files = walk(path.join(__dirname, '../../mobile/src'));
const rolesFound = new Map();

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const regex = /accessibilityRole\s*=\s*(?:\{['"]([^'"]+)['"]\}|['"]([^'"]+)['"])/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const role = match[1] || match[2];
    if (!rolesFound.has(role)) rolesFound.set(role, []);
    rolesFound.get(role).push(f);
  }
});

console.log('=== ACCESSIBILITY ROLES FOUND ===');
for (const [role, fileList] of rolesFound.entries()) {
  const isValid = validRoles.has(role);
  console.log(`Role: "${role}" | Valid: ${isValid} | Count: ${fileList.length}`);
  if (!isValid) {
    console.log(`  -> INVALID ROLE "${role}" in files:`, fileList);
  }
}
