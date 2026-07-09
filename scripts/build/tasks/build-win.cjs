/**
 * @file build:win 任务
 * @description 构建 Windows（bundle targets 由 tauri.conf.json 控制）。
 * @module scripts/build/tasks/build-win
 */

module.exports = {
  id: 'build:win',
  description: 'Build Windows',
  dependsOn: ['deps', 'icon:win'],
  run: { cmd: 'tauri build' },
};
