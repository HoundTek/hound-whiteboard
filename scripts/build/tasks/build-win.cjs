/**
 * @file build:win 任务
 * @description 构建 Windows（nsis + msi）。
 * @module scripts/build/tasks/build-win
 */

module.exports = {
  id: 'build:win',
  description: 'build win',
  dependsOn: ['icon:copy:win'],
  conflicts: ['resource:cargo-build'],
  run: { cmd: 'tauri build' },
};
