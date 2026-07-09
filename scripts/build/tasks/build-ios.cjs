/**
 * @file build:ios 任务
 * @description 构建 iOS。
 * @module scripts/build/tasks/build-ios
 */

module.exports = {
  id: 'build:ios',
  description: 'Build iOS',
  dependsOn: ['deps', 'icon:ios', 'icon:desktop'],
  run: { cmd: 'tauri ios build' },
};
