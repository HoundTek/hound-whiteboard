/**
 * @file build:android 任务
 * @description 构建 Android APK/AAB。
 * @module scripts/build/tasks/build-android
 */

module.exports = {
  id: 'build:android',
  description: 'build android',
  dependsOn: ['android:signing', 'icon:copy:android', 'icon:copy:common'],
  conflicts: ['resource:cargo-build'],
  run: { cmd: 'tauri android build' },
};
