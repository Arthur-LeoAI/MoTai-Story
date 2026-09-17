const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = ['server.js'];
for (const directory of ['src', 'public', 'desktop', 'scripts']) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:js|cjs)$/.test(entry.name)) files.push(path.join(directory, entry.name));
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
