/**
 * @file android:signing 任务
 * @description 配置 Android 签名（keystore + build.gradle.kts）。
 * @module scripts/build/tasks/android-signing
 */

const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '../../..');

/**
 * 配置 Android 签名
 * @returns {boolean} 是否成功
 */
function configureAndroidSigning() {
  const keystoreSrc = path.join(ROOT_DIR, 'keys', 'keystore.properties');
  const keystoreDest = path.join(ROOT_DIR, 'src-tauri', 'gen', 'android', 'keystore.properties');
  const buildGradlePath = path.join(ROOT_DIR, 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts');

  if (fs.existsSync(keystoreSrc)) {
    fs.mkdirSync(path.dirname(keystoreDest), { recursive: true });
    fs.copyFileSync(keystoreSrc, keystoreDest);
  } else {
    console.warn('Warning: keystore.properties not found in keys/');
    return false;
  }

  if (!fs.existsSync(buildGradlePath)) {
    console.warn('Warning: build.gradle.kts not found');
    return false;
  }

  let content = fs.readFileSync(buildGradlePath, 'utf-8');
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  content = content.replace(/\r\n/g, '\n');

  if (!content.includes('import java.io.FileInputStream')) {
    content = content.replace('import java.util.Properties', 'import java.util.Properties\nimport java.io.FileInputStream');
  }

  if (!content.includes('keystoreProperties')) {
    const tauriPropsEndIndex = content.indexOf('}\n\nandroid');
    if (tauriPropsEndIndex !== -1) {
      const insertPos = tauriPropsEndIndex + 1;
      content = content.slice(0, insertPos) +
        '\n\nval keystoreProperties = Properties().apply {\n    val propFile = rootProject.file("keystore.properties")\n    if (propFile.exists()) {\n        propFile.inputStream().use { load(it) }\n    }\n}\n' +
        content.slice(insertPos);
    }
  }

  if (!content.includes('signingConfigs')) {
    content = content.replace(
      'buildTypes {\n',
      'signingConfigs {\n        create("release") {\n            keyAlias = keystoreProperties.getProperty("keyAlias", "")\n            keyPassword = keystoreProperties.getProperty("keyPassword", "")\n            storeFile = if (keystoreProperties.getProperty("storeFile").isNullOrEmpty()) null else file(keystoreProperties.getProperty("storeFile"))\n            storePassword = keystoreProperties.getProperty("storePassword", "")\n        }\n    }\n    buildTypes {\n'
    );
  }

  if (!content.includes('signingConfig = signingConfigs.getByName("release")')) {
    content = content.replace(
      'getByName("release") {\n            isMinifyEnabled = true',
      'getByName("release") {\n            isMinifyEnabled = true\n            signingConfig = signingConfigs.getByName("release")'
    );
  }

  if (nl === '\r\n') {
    content = content.replace(/\n/g, '\r\n');
  }

  fs.writeFileSync(buildGradlePath, content);
  return true;
}

module.exports = {
  id: 'android:signing',
  description: 'Configure Android signing',
  dependsOn: ['android:init'],
  run: { fn: configureAndroidSigning },
};
