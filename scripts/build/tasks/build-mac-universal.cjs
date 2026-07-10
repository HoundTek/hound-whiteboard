/**
 * @file build:mac-universal 任务
 * @description 构建 macOS Universal Binary（x86_64 + arm64）。
 * @module scripts/build/tasks/build-mac-universal
 */

module.exports = {
  id: 'build:mac-universal',
  description: 'build mac uni',
  dependsOn: ['icon:copy:mac'],
  conflicts: ['resource:cargo-build'],
  run: { cmd: 'tauri build --target universal-apple-darwin' },
};
