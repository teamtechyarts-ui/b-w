const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Auto-detect and set JAVA_HOME
const candidateJavaHomes = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  'C:\\Program Files\\Java\\jdk-17',
  'C:\\Program Files\\Microsoft\\jdk-17'
].filter(Boolean);

const foundJavaHome = candidateJavaHomes.find(dir => fs.existsSync(dir));
if (foundJavaHome) {
  process.env.JAVA_HOME = foundJavaHome;
}

// Auto-detect and set ANDROID_HOME
const candidateAndroidHomes = [
  process.env.ANDROID_HOME,
  path.join(process.env.USERPROFILE || 'C:\\Users\\yashw', 'AppData', 'Local', 'Android', 'Sdk')
].filter(Boolean);

const foundAndroidHome = candidateAndroidHomes.find(dir => fs.existsSync(dir));
if (foundAndroidHome) {
  process.env.ANDROID_HOME = foundAndroidHome;
}

// Prepend java and adb to PATH
const extraPaths = [];
if (process.env.JAVA_HOME) {
  extraPaths.push(path.join(process.env.JAVA_HOME, 'bin'));
}
if (process.env.ANDROID_HOME) {
  extraPaths.push(path.join(process.env.ANDROID_HOME, 'platform-tools'));
  extraPaths.push(path.join(process.env.ANDROID_HOME, 'emulator'));
}

if (extraPaths.length > 0) {
  process.env.PATH = extraPaths.join(path.delimiter) + path.delimiter + (process.env.PATH || '');
}

console.log('🤖 Starting Android Build with Environment:');
console.log('   JAVA_HOME   :', process.env.JAVA_HOME);
console.log('   ANDROID_HOME:', process.env.ANDROID_HOME);
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(npxCmd, ['react-native', 'run-android', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
  cwd: path.resolve(__dirname, '..')
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
