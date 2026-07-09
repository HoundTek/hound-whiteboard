/**
 * @file build:mac-universal 任务
 * @description 构建 macOS Universal Binary（x86_64 + arm64）。
 * @module scripts/build/tasks/build-mac-universal
 */

module.exports = {
  id: 'build:mac-universal',
  description: 'Build macOS Universal',
  dependsOn: ['deps', 'icon:mac'],
  run: { cmd: 'tauri build --target universal-apple-darwin' },
};
