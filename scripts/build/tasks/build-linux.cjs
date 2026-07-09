/**
 * @file build:linux 任务
 * @description 构建 Linux（bundle targets 由 tauri.conf.json 控制）。
 * @module scripts/build/tasks/build-linux
 */

module.exports = {
  id: 'build:linux',
  description: 'Build Linux',
  dependsOn: ['deps', 'icon:linux'],
  run: { cmd: 'tauri build' },
};
