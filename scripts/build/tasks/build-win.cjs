/**
 * @file build:win 任务
 * @description 构建 Windows（nsis + msi）。
 * @module scripts/build/tasks/build-win
 */

module.exports = {
  id: 'build:win',
  description: 'Build Windows',
  dependsOn: ['deps', 'icon:win'],
  run: { cmd: 'tauri build --bundles nsis msi' },
};
