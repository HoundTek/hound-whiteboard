/**
 * @file icon:linux 任务
 * @description 生成 Linux 图标。
 * @module scripts/build/tasks/icon-linux
 */

const path = require('path');

module.exports = {
  id: 'icon:linux',
  description: 'Generate icons: linux',
  dependsOn: [],
  conflicts: ['resource:gen-icons'],
  run: { cmd: `node "${path.join(__dirname, '..', 'gen-icons.cjs')}" linux` },
};
