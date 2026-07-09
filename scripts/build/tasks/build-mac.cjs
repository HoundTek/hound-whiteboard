/**
 * @file build:mac 任务
 * @description 构建 macOS（dmg + app bundle）。
 * @module scripts/build/tasks/build-mac
 */

module.exports = {
  id: 'build:mac',
  description: 'Build macOS',
  dependsOn: ['deps', 'icon:mac'],
  run: { cmd: 'tauri build --bundles dmg app' },
};
