/**
 * @file build:desktop 任务
 * @description 构建桌面端（默认 target）。
 * @module scripts/build/tasks/build-desktop
 */

module.exports = {
  id: 'build:desktop',
  description: 'Build desktop',
  dependsOn: ['deps', 'icon:desktop'],
  run: { cmd: 'tauri build' },
};
