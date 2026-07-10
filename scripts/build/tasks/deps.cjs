/**
 * @file deps 任务
 * @description 安装项目依赖。
 * @module scripts/build/tasks/deps
 */

module.exports = {
  id: 'deps',
  description: 'install deps',
  dependsOn: [],
  run: { cmd: 'yarn deps' },
};
