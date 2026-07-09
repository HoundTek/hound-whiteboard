/**
 * @file icon:win 任务
 * @description 生成 Windows 图标。
 * @module scripts/build/tasks/icon-win
 */

const path = require('path');

module.exports = {
  id: 'icon:win',
  description: 'Generate icons: win',
  dependsOn: [],
  conflicts: ['resource:gen-icons'],
  run: { cmd: `node "${path.join(__dirname, '..', 'gen-icons.cjs')}" win` },
};
