const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT_DIR = path.resolve(__dirname, '..')

const CLEAN_TARGETS = {
  target: 'src-tauri/target',
  gen: 'src-tauri/gen',
  icons: 'src-tauri/icons',
  temp: 'temp-icon-gen',
}

const ALL_SAFE = ['target', 'gen', 'icons', 'temp']

function removeDir(dirPath) {
  if (!fs.existsSync(dirPath)) return true

  if (process.platform === 'win32') {
    try {
      execSync(`rmdir /s /q "${dirPath}"`, { stdio: 'pipe' })
      return true
    } catch (e) {
    }
  }

  try {
    fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    return true
  } catch (e) {
    return false
  }
}

function showStatus() {
  const iconSourcePath = path.join(ROOT_DIR, 'src-tauri/icons/.icon-source')
  if (fs.existsSync(iconSourcePath)) {
    const info = JSON.parse(fs.readFileSync(iconSourcePath, 'utf-8'))
    console.log('=== Current Icon Status ===')
    console.log(`Platform: ${info.platform}`)
    console.log(`Source: ${info.source}`)
    console.log(`Generated: ${new Date(info.timestamp).toLocaleString()}`)
  } else {
    console.log('=== Current Icon Status ===')
    console.log('No icon source marker found. Run "yarn icon" to generate icons.')
  }
}

function showHelp() {
  console.log('=== Clean Script ===')
  console.log()
  console.log('Usage: node scripts/clean.cjs [targets...]')
  console.log()
  console.log('Targets:')
  console.log('  target     - Clean Rust build artifacts (src-tauri/target)')
  console.log('  gen        - Clean mobile generated files (src-tauri/gen)')
  console.log('  icons      - Clean icon files (src-tauri/icons)')
  console.log('  temp       - Clean temporary icon generation directory')
  console.log()
  console.log('Special commands:')
  console.log('  all        - Clean all targets: target + gen + icons + temp')
  console.log('  status     - Show current icon source status')
  console.log('  help       - Show this help message')
  console.log()
  console.log('Note: Cleaning icons will break builds until you run "yarn icon" again.')
}

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    args.push('all')
  }

  if (args.includes('help')) {
    showHelp()
    return
  }

  if (args.includes('status')) {
    showStatus()
    return
  }

  let targets = args

  if (targets.includes('all')) {
    targets = ALL_SAFE
  }

  targets = [...new Set(targets)]

  let stats = { removed: 0, skipped: 0, failed: 0 }

  for (const target of targets) {
    const dir = CLEAN_TARGETS[target]
    if (!dir) {
      console.error('Unknown target:', target)
      console.error('Run "yarn clean:help" for available targets.')
      process.exit(1)
    }

    const absPath = path.join(ROOT_DIR, dir)
    if (!fs.existsSync(absPath)) {
      console.log('Skip:', dir)
      stats.skipped++
      continue
    }

    if (target === 'icons') {
      console.warn('WARNING: Cleaning icons will break builds until you run "yarn icon" again.')
    }

    const ok = removeDir(absPath)
    if (ok) {
      console.log('Removed:', dir)
      stats.removed++
    } else {
      console.warn('Failed:', dir)
      stats.failed++
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Removed: ${stats.removed}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`)

  if (stats.failed > 0) {
    console.warn('Some directories could not be removed.')
    process.exit(1)
  }
}

main()
