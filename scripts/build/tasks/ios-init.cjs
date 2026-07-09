/**
 * @file ios:init 任务
 * @description 初始化 iOS 项目。
 * @module scripts/build/tasks/ios-init
 */

module.exports = {
  id: 'ios:init',
  description: 'Initialize iOS',
  dependsOn: [],
  run: { cmd: 'yarn tauri ios init' },
};
