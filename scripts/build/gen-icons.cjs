const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const scriptDir = __dirname
const rootDir = path.resolve(scriptDir, '../..')
const configPath = path.join(scriptDir, 'icon-config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

function findSource(candidates) {
  for (const name of candidates) {
    const p = path.join(rootDir, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

function isPlatformInitialized(platformCfg) {
  if (!platformCfg.needsInit) return true
  const checkPath = path.join(rootDir, platformCfg.initCheckPath)
  return fs.existsSync(checkPath)
}

function generateDesktop(platform = 'desktop') {
  const cfg = config.platforms[platform]
  const source = findSource(cfg.source)
  if (!source) {
    console.error('Error: No source icon found. Tried:', cfg.source.join(', '))
    return false
  }

  console.log('Source:', path.relative(rootDir, source))
  console.log('Output:', path.relative(rootDir, path.join(rootDir, cfg.output)))

  const tempDir = path.join(rootDir, config.tempDir)
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.mkdirSync(tempDir, { recursive: true })

  const cmd = `yarn tauri icon "${source}" --output "${tempDir}"`
  console.log('$', cmd)
  try {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' })
  } catch (e) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    return false
  }

  const outputDir = path.join(rootDir, cfg.output)
  fs.mkdirSync(outputDir, { recursive: true })

  const keepSet = new Set(cfg.filesToKeep)
  const tempEntries = fs.readdirSync(tempDir, { withFileTypes: true })
  for (const entry of tempEntries) {
    if (entry.isFile() && keepSet.has(entry.name)) {
      const src = path.join(tempDir, entry.name)
      const dest = path.join(outputDir, entry.name)
      fs.copyFileSync(src, dest)
      console.log('  Copied:', entry.name)
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true })
  console.log('  Cleaned temp directory')

  const sourceMarker = path.join(outputDir, '.icon-source')
  fs.writeFileSync(sourceMarker, JSON.stringify({
    platform: platform,
    source: path.basename(source),
    timestamp: new Date().toISOString(),
  }, null, 2))
  console.log('  Marked source:', path.basename(source))

  return true
}

function generateMobile(platform) {
  const cfg = config.platforms[platform]
  if (!isPlatformInitialized(cfg)) {
    console.warn(`Skip: ${platform} not initialized. Run "${cfg.initCommand}" first.`)
    return null
  }

  const source = findSource(cfg.source)
  if (!source) {
    console.error('Error: No source icon found. Tried:', cfg.source.join(', '))
    return false
  }

  console.log('Source:', path.relative(rootDir, source))
  console.log('Output:', path.relative(rootDir, path.join(rootDir, cfg.output)))

  const tempDir = path.join(rootDir, config.tempDir)
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.mkdirSync(tempDir, { recursive: true })

  const cmd = `yarn tauri icon "${source}" --output "${tempDir}"`
  console.log('$', cmd)
  try {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' })
  } catch (e) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    return false
  }

  const platformDirInTemp = path.join(tempDir, platform)
  if (!fs.existsSync(platformDirInTemp)) {
    console.error(`Error: ${platform} directory not found in temp output`)
    fs.rmSync(tempDir, { recursive: true, force: true })
    return false
  }

  const outputDir = path.join(rootDir, cfg.output)
  fs.mkdirSync(outputDir, { recursive: true })

  const entries = fs.readdirSync(platformDirInTemp, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('mipmap')) continue

    const src = path.join(platformDirInTemp, entry.name)
    const dest = path.join(outputDir, entry.name)
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true })
    }
    fs.cpSync(src, dest, { recursive: true })
    console.log('  Copied dir:', entry.name)
  }

  const valuesDirInTemp = path.join(tempDir, 'android', 'values')
  if (fs.existsSync(valuesDirInTemp)) {
    const icBgSrc = path.join(valuesDirInTemp, 'ic_launcher_background.xml')
    if (fs.existsSync(icBgSrc)) {
      const valuesDirDest = path.join(outputDir, 'values')
      fs.mkdirSync(valuesDirDest, { recursive: true })
      const icBgDest = path.join(valuesDirDest, 'ic_launcher_background.xml')
      fs.copyFileSync(icBgSrc, icBgDest)
      console.log('  Copied:', 'values/ic_launcher_background.xml')
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true })
  console.log('  Cleaned temp directory')

  return true
}

function generateIcon(platform) {
  console.log(`=== ${platform} ===`)

  let ok
  if (['desktop', 'mac', 'win', 'linux'].includes(platform)) {
    ok = generateDesktop(platform)
  } else {
    ok = generateMobile(platform)
  }

  if (ok === null) {
    console.log(`~ ${platform} skipped`)
    return 'skipped'
  } else if (ok) {
    console.log(`✓ ${platform} icons generated`)
    return true
  } else {
    console.error(`✗ Failed to generate ${platform} icons`)
    return false
  }
}

function main() {
  const args = process.argv.slice(2)
  let targets = args.length > 0 ? args : ['desktop']

  if (targets.includes('all')) {
    targets = Object.keys(config.platforms)
  }

  console.log('Generating icons for:', targets.join(', '))
  console.log()

  let stats = { success: 0, skipped: 0, failed: 0 }
  for (const target of targets) {
    if (!config.platforms[target]) {
      console.error('Unknown platform:', target)
      console.error('Supported:', Object.keys(config.platforms).join(', '))
      process.exit(1)
    }
    const result = generateIcon(target)
    if (result === 'skipped') {
      stats.skipped++
    } else if (result) {
      stats.success++
    } else {
      stats.failed++
    }
  }

  console.log('=== Summary ===')
  console.log(`Success: ${stats.success}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`)

  if (stats.failed === 0) {
    console.log('All done!')
  } else {
    console.warn('Some platforms failed.')
    process.exit(1)
  }
}

main()
