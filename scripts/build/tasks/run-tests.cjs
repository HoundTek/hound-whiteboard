/**
 * @file test 任务
 * @description 运行测试套件。
 * @module scripts/build/tasks/run-tests
 */

module.exports = {
  id: 'test',
  description: 'test',
  dependsOn: [],
  run: { cmd: 'yarn test' },
};
