const fs = require('fs')
const path = require('path')

const src = path.resolve('keys/keystore.properties')
const dest = path.resolve('src-tauri/gen/android/keystore.properties')

if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  console.log('Copied keystore.properties')
} else {
  console.warn('Warning: keystore.properties not found, skipping')
  console.info('Please make sure ./keys is created manually')
}
