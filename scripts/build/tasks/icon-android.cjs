/**
 * @file icon:android 任务
 * @description 生成 Android 图标。
 * @module scripts/build/tasks/icon-android
 */

const path = require('path');

module.exports = {
  id: 'icon:android',
  description: 'Generate icons: android',
  dependsOn: [],
  conflicts: ['resource:gen-icons'],
  run: { cmd: `node "${path.join(__dirname, '..', 'gen-icons.cjs')}" android` },
};
