/**
 * @file icon:ios 任务
 * @description 生成 iOS 图标。
 * @module scripts/build/tasks/icon-ios
 */

const path = require('path');

module.exports = {
  id: 'icon:ios',
  description: 'Generate icons: ios',
  dependsOn: [],
  run: { cmd: `node "${path.join(__dirname, '..', 'gen-icons.cjs')}" ios` },
};
