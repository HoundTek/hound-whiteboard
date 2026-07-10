/**
 * @file build:mac 任务
 * @description 构建 macOS（dmg + app bundle）。
 * @module scripts/build/tasks/build-mac
 */

module.exports = {
  id: 'build:mac',
  description: 'build mac',
  dependsOn: ['icon:copy:mac'],
  conflicts: ['resource:cargo-build'],
  run: { cmd: 'tauri build' },
};
