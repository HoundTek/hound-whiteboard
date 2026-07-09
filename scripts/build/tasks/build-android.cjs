/**
 * @file build:android 任务
 * @description 构建 Android APK/AAB。
 * @module scripts/build/tasks/build-android
 */

module.exports = {
  id: 'build:android',
  description: 'Build Android',
  dependsOn: ['deps', 'android:init', 'android:signing', 'icon:android', 'icon:desktop'],
  run: { cmd: 'tauri android build' },
};
