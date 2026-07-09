/**
 * @file build:linux 任务
 * @description 构建 Linux（deb + appimage + rpm）。
 * @module scripts/build/tasks/build-linux
 */

module.exports = {
  id: 'build:linux',
  description: 'Build Linux',
  dependsOn: ['deps', 'icon:linux'],
  run: { cmd: 'tauri build --bundles deb appimage rpm' },
};
