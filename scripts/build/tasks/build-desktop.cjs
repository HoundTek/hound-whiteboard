/**
 * @file build:desktop 任务
 * @description 构建桌面端（默认 target）。
 * @module scripts/build/tasks/build-desktop
 */

module.exports = {
  id: 'build:desktop',
  description: 'build desktop',
  dependsOn: ['icon:copy:desktop'],
  conflicts: ['resource:cargo-build'],
  run: { cmd: 'tauri build' },
};
