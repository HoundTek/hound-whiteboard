/**
 * @file build:linux 任务
 * @description 构建 Linux（deb + appimage + rpm）。
 * @module scripts/build/tasks/build-linux
 */

module.exports = {
  id: 'build:linux',
  description: 'build linux',
  dependsOn: ['icon:copy:linux'],
  conflicts: ['resource:cargo-build'],
  run: { cmd: 'tauri build' },
};
