const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT_DIR = path.resolve(__dirname, '../..')

const PLATFORMS = {
  desktop: {
    iconCmd: 'yarn icon:desktop',
    buildCmd: 'tauri build',
  },
  win: {
    iconCmd: 'yarn icon:win',
    buildCmd: 'tauri build --bundles nsis msi',
  },
  mac: {
    iconCmd: 'yarn icon:mac',
    buildCmd: 'tauri build --bundles dmg app',
  },
  'mac-universal': {
    iconCmd: 'yarn icon:mac',
    buildCmd: 'tauri build --target universal-apple-darwin',
  },
  linux: {
    iconCmd: 'yarn icon:linux',
    buildCmd: 'tauri build --bundles deb appimage rpm',
  },
  android: {
    iconCmd: 'yarn icon:android && yarn icon:desktop',
    initCmd: 'yarn init:android',
    buildCmd: 'tauri android build',
  },
  ios: {
    iconCmd: 'yarn icon:ios && yarn icon:desktop',
    buildCmd: 'tauri ios build',
  },
}

function runCmd(cmd, description) {
  console.log(`\n=== ${description} ===`)
  console.log('$', cmd)
  try {
    execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit' })
    return true
  } catch (e) {
    console.error(`Failed: ${description}`)
    return false
  }
}

function configureAndroidSigning() {
  const keystoreSrc = path.join(ROOT_DIR, 'keys', 'keystore.properties')
  const keystoreDest = path.join(ROOT_DIR, 'src-tauri', 'gen', 'android', 'keystore.properties')
  const buildGradlePath = path.join(ROOT_DIR, 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts')

  if (fs.existsSync(keystoreSrc)) {
    fs.mkdirSync(path.dirname(keystoreDest), { recursive: true })
    fs.copyFileSync(keystoreSrc, keystoreDest)
    console.log('Copied keystore.properties')
  } else {
    console.warn('Warning: keystore.properties not found in keys/')
    return
  }

  if (!fs.existsSync(buildGradlePath)) {
    console.warn('Warning: build.gradle.kts not found')
    return
  }

  let content = fs.readFileSync(buildGradlePath, 'utf-8')

  // Detect line ending style
  const nl = content.includes('\r\n') ? '\r\n' : '\n'

  // Normalize to \n for processing
  content = content.replace(/\r\n/g, '\n')

  if (!content.includes('import java.io.FileInputStream')) {
    content = content.replace('import java.util.Properties', 'import java.util.Properties\nimport java.io.FileInputStream')
  }

  if (!content.includes('keystoreProperties')) {
    const tauriPropsEndIndex = content.indexOf('}\n\nandroid')
    if (tauriPropsEndIndex !== -1) {
      const insertPos = tauriPropsEndIndex + 1
      content = content.slice(0, insertPos) +
        '\n\nval keystoreProperties = Properties().apply {\n    val propFile = rootProject.file("keystore.properties")\n    if (propFile.exists()) {\n        propFile.inputStream().use { load(it) }\n    }\n}\n' +
        content.slice(insertPos)
    }
  }

  if (!content.includes('signingConfigs')) {
    content = content.replace(
      'buildTypes {\n',
      'signingConfigs {\n        create("release") {\n            keyAlias = keystoreProperties.getProperty("keyAlias", "")\n            keyPassword = keystoreProperties.getProperty("keyPassword", "")\n            storeFile = if (keystoreProperties.getProperty("storeFile").isNullOrEmpty()) null else file(keystoreProperties.getProperty("storeFile"))\n            storePassword = keystoreProperties.getProperty("storePassword", "")\n        }\n    }\n    buildTypes {\n'
    )
  }

  if (!content.includes('signingConfig = signingConfigs.getByName("release")')) {
    content = content.replace(
      'getByName("release") {\n            isMinifyEnabled = true',
      'getByName("release") {\n            isMinifyEnabled = true\n            signingConfig = signingConfigs.getByName("release")'
    )
  }

  // Restore original line endings
  if (nl === '\r\n') {
    content = content.replace(/\n/g, '\r\n')
  }

  fs.writeFileSync(buildGradlePath, content)
  console.log('Configured Android signing in build.gradle.kts')
}

function showHelp() {
  console.log('Commands:')
  console.log('  dev [platform]     - Start development server')
  console.log('  build [platform]   - Build for specified platform')
  console.log('  ship [platform]    - Run tests + build for specified platform')
  console.log()
  console.log('Platforms:')
  console.log('  desktop            - Desktop (current OS)')
  console.log('  win                - Windows')
  console.log('  mac                - macOS')
  console.log('  mac-universal      - macOS universal')
  console.log('  linux              - Linux')
  console.log('  android            - Android')
  console.log('  ios                - iOS')
  console.log()
  console.log('Examples:')
  console.log('  node scripts/build-entry.cjs dev')
  console.log('  node scripts/build-entry.cjs build android')
  console.log('  node scripts/build-entry.cjs ship win')
}

function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  const platform = args[1] || 'desktop'

  if (!command || ['help', '--help', '-h'].includes(command)) {
    showHelp()
    return
  }

  if (!PLATFORMS[platform]) {
    console.error('Unknown platform:', platform)
    console.error('Available:', Object.keys(PLATFORMS).join(', '))
    process.exit(1)
  }

  const config = PLATFORMS[platform]

  if (command === 'dev') {
    runCmd('yarn deps', 'Install dependencies')

    if (platform === 'android') {
      runCmd(config.initCmd, 'Initialize Android')
    }

    runCmd(config.iconCmd, 'Generate icons')

    const devCmd = platform === 'android' ? 'tauri android dev'
      : platform === 'ios' ? 'tauri ios dev'
      : 'tauri dev'
    runCmd(devCmd, `Start ${platform} dev`)
  } else if (command === 'build') {
    runCmd('yarn deps', 'Install dependencies')

    if (platform === 'android') {
      runCmd(config.initCmd, 'Initialize Android')
      configureAndroidSigning()
    }

    runCmd(config.iconCmd, 'Generate icons')
    runCmd(config.buildCmd, `Build ${platform}`)
  } else if (command === 'ship') {
    if (!runCmd('yarn test', 'Run tests')) {
      process.exit(1)
    }
    runCmd('yarn deps', 'Install dependencies')

    if (platform === 'android') {
      runCmd(config.initCmd, 'Initialize Android')
      configureAndroidSigning()
    }

    runCmd(config.iconCmd, 'Generate icons')
    runCmd(config.buildCmd, `Build ${platform}`)
  } else {
    console.error('Unknown command:', command)
    showHelp()
    process.exit(1)
  }
}

main()
