/**
 * @file build:mobile 元任务
 * @description 构建移动端（Android + iOS）。
 * @module scripts/build/tasks/build-mobile
 */

module.exports = {
  id: 'build:mobile',
  description: 'build mobile',
  dependsOn: ['build:android', 'build:ios'],
};
