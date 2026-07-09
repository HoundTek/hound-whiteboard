/**
 * @file icon:mac 任务
 * @description 生成 macOS 图标。
 * @module scripts/build/tasks/icon-mac
 */

const path = require('path');

module.exports = {
  id: 'icon:mac',
  description: 'Generate icons: mac',
  dependsOn: [],
  run: { cmd: `node "${path.join(__dirname, '..', 'gen-icons.cjs')}" mac` },
};
