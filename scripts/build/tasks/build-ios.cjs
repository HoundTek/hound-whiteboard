/**
 * @file build:ios 任务
 * @description 构建 iOS。
 * @module scripts/build/tasks/build-ios
 */

module.exports = {
  id: 'build:ios',
  description: 'build ios',
  dependsOn: ['icon:copy:ios', 'icon:copy:common'],
  conflicts: ['resource:cargo-build'],
  run: { cmd: 'tauri ios build' },
};
