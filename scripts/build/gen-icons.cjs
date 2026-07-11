const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const scriptDir = __dirname
const rootDir = path.resolve(scriptDir, '../..')
const configPath = path.join(scriptDir, 'icon-config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

function findSource(candidates) {
  for (const name of candidates) {
    const p = path.join(rootDir, 'icons', name)
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
  const ok1 = generateDesktopGenerate(platform);
  if (!ok1) return false;
  return generateDesktopCopy(platform);
}

/**
 * 阶段1：生成图标到临时目录（可并行，无输出目录冲突）
 * @param {string} platform - 平台名
 * @returns {boolean}
 */
function generateDesktopGenerate(platform) {
  const cfg = config.platforms[platform];
  const source = findSource(cfg.source);
  if (!source) {
    console.error('Error: No source icon found. Tried:', cfg.source.join(', '));
    return false;
  }

  console.log('Source:', path.relative(rootDir, source));

  const tempDir = path.join(rootDir, config.tempDir, platform);
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const cmd = `yarn tauri icon "${source}" --output "${tempDir}"`;
  console.log('$', cmd);
  try {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return false;
  }

  console.log('  Generated to:', path.relative(rootDir, tempDir));
  return true;
}

/**
 * 阶段2：从临时目录拷贝到输出目录并清理
 * @param {string} platform - 平台名
 * @returns {boolean}
 */
function generateDesktopCopy(platform) {
  const cfg = config.platforms[platform];
  const tempDir = path.join(rootDir, config.tempDir, platform);

  if (!fs.existsSync(tempDir)) {
    console.error('Error: Temp directory not found:', path.relative(rootDir, tempDir));
    return false;
  }

  const outputDir = path.join(rootDir, cfg.output);
  console.log('Output:', path.relative(rootDir, outputDir));
  fs.mkdirSync(outputDir, { recursive: true });

  const keepSet = new Set(cfg.filesToKeep);
  const tempEntries = fs.readdirSync(tempDir, { withFileTypes: true });
  for (const entry of tempEntries) {
    if (entry.isFile() && keepSet.has(entry.name)) {
      const src = path.join(tempDir, entry.name);
      const dest = path.join(outputDir, entry.name);
      fs.copyFileSync(src, dest);
      console.log('  Copied:', entry.name);
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('  Cleaned temp directory');

  const source = findSource(cfg.source);
  if (source) {
    const sourceMarker = path.join(outputDir, '.icon-source');
    fs.writeFileSync(sourceMarker, JSON.stringify({
      platform: platform,
      source: path.basename(source),
      timestamp: new Date().toISOString(),
    }, null, 2));
    console.log('  Marked source:', path.basename(source));
  }

  return true;
}

function generateMobile(platform) {
  const ok1 = generateMobileGenerate(platform);
  if (ok1 === null) return null;
  if (!ok1) return false;
  return generateMobileCopy(platform);
}

/**
 * 阶段1：生成移动端图标到临时目录
 * @param {string} platform - 平台名
 * @returns {boolean|null} null=跳过, false=失败, true=成功
 */
function generateMobileGenerate(platform) {
  const cfg = config.platforms[platform];
  if (!isPlatformInitialized(cfg)) {
    console.warn(`Skip: ${platform} not initialized. Run "${cfg.initCommand}" first.`);
    return null;
  }

  const source = findSource(cfg.source);
  if (!source) {
    console.error('Error: No source icon found. Tried:', cfg.source.join(', '));
    return false;
  }

  console.log('Source:', path.relative(rootDir, source));

  const tempDir = path.join(rootDir, config.tempDir, platform);
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const cmd = `yarn tauri icon "${source}" --output "${tempDir}"`;
  console.log('$', cmd);
  try {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return false;
  }

  console.log('  Generated to:', path.relative(rootDir, tempDir));
  return true;
}

/**
 * 阶段2：从临时目录拷贝移动端图标到输出目录并清理
 * @param {string} platform - 平台名
 * @returns {boolean}
 */
function generateMobileCopy(platform) {
  const cfg = config.platforms[platform];
  const tempDir = path.join(rootDir, config.tempDir, platform);

  if (!fs.existsSync(tempDir)) {
    console.error('Error: Temp directory not found:', path.relative(rootDir, tempDir));
    return false;
  }

  const outputDir = path.join(rootDir, cfg.output);
  console.log('Output:', path.relative(rootDir, outputDir));
  fs.mkdirSync(outputDir, { recursive: true });

  const platformDirInTemp = tempDir;
  if (!fs.existsSync(platformDirInTemp)) {
    console.error(`Error: ${platform} directory not found in temp output`);
    fs.rmSync(tempDir, { recursive: true, force: true });
    return false;
  }

  const entries = fs.readdirSync(platformDirInTemp, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('mipmap')) continue;

    const src = path.join(platformDirInTemp, entry.name);
    const dest = path.join(outputDir, entry.name);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.cpSync(src, dest, { recursive: true });
    console.log('  Copied dir:', entry.name);
  }

  const valuesDirInTemp = path.join(tempDir, 'values');
  if (fs.existsSync(valuesDirInTemp)) {
    const icBgSrc = path.join(valuesDirInTemp, 'ic_launcher_background.xml');
    if (fs.existsSync(icBgSrc)) {
      const valuesDirDest = path.join(outputDir, 'values');
      fs.mkdirSync(valuesDirDest, { recursive: true });
      const icBgDest = path.join(valuesDirDest, 'ic_launcher_background.xml');
      fs.copyFileSync(icBgSrc, icBgDest);
      console.log('  Copied:', 'values/ic_launcher_background.xml');
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('  Cleaned temp directory');

  return true;
}

/** 桌面端平台列表 */
const DESKTOP_PLATFORMS = ['desktop', 'mac', 'win', 'linux', 'common'];

/**
 * 按阶段分派图标的生成
 * @param {string} platform - 平台名
 * @param {'full'|'generate'|'copy'} phase - 执行阶段
 * @returns {boolean|null|'skipped'}
 */
function generateIcon(platform, phase = 'full') {
  console.log(`=== ${platform} (${phase}) ===`);

  let ok;
  const isDesktop = DESKTOP_PLATFORMS.includes(platform);

  if (phase === 'generate') {
    ok = isDesktop ? generateDesktopGenerate(platform) : generateMobileGenerate(platform);
  } else if (phase === 'copy') {
    ok = isDesktop ? generateDesktopCopy(platform) : generateMobileCopy(platform);
  } else {
    ok = isDesktop ? generateDesktop(platform) : generateMobile(platform);
  }

  if (ok === null) {
    console.log(`~ ${platform} skipped`);
    return 'skipped';
  } else if (ok) {
    console.log(`✓ ${platform} ${phase} done`);
    return true;
  } else {
    console.error(`✗ Failed to ${phase} ${platform} icons`);
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);

  let phase = 'full';
  let targets = [];

  for (const arg of args) {
    if (arg === '--phase=generate' || arg === '--phase=copy') {
      phase = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      targets.push(arg);
    }
  }

  if (targets.length === 0) targets = ['desktop'];

  if (targets.includes('all')) {
    targets = Object.keys(config.platforms);
  }

  console.log('Generating icons for:', targets.join(', '), phase !== 'full' ? `(phase: ${phase})` : '');
  console.log();

  let stats = { success: 0, skipped: 0, failed: 0 };
  for (const target of targets) {
    if (!config.platforms[target]) {
      console.error('Unknown platform:', target);
      console.error('Supported:', Object.keys(config.platforms).join(', '));
      process.exit(1);
    }
    const result = generateIcon(target, phase);
    if (result === 'skipped') {
      stats.skipped++;
    } else if (result) {
      stats.success++;
    } else {
      stats.failed++;
    }
  }

  console.log('=== Summary ===');
  console.log(`Success: ${stats.success}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`);

  if (stats.failed === 0) {
    console.log('All done!');
  } else {
    console.warn('Some platforms failed.');
    process.exit(1);
  }
}

main()
