/**
 * @file icon:desktop 任务
 * @description 生成桌面端通用图标。
 * @module scripts/build/tasks/icon-desktop
 */

const path = require('path');

module.exports = {
  id: 'icon:desktop',
  description: 'Generate icons: desktop',
  dependsOn: [],
  conflicts: ['resource:gen-icons'],
  run: { cmd: `node "${path.join(__dirname, '..', 'gen-icons.cjs')}" desktop` },
};
