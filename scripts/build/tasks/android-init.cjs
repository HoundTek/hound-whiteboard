/**
 * @file android:init 任务
 * @description 初始化 Android 项目。
 * @module scripts/build/tasks/android-init
 */

module.exports = {
  id: 'android:init',
  description: 'Initialize Android',
  dependsOn: [],
  run: { cmd: 'yarn init:android' },
};
