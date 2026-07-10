/**
 * @file android:init 任务
 * @description 初始化 Android 项目。
 * @module scripts/build/tasks/android-init
 */

module.exports = {
  id: 'android:init',
  description: 'android init',
  dependsOn: [],
  conflicts: ['resource:tauri-cli'],
  run: { cmd: 'yarn init:android' },
};
