/**
 * @file build:all 元任务
 * @description 构建全部平台（桌面 + 移动端）。
 * @module scripts/build/tasks/build-all
 */

module.exports = {
  id: 'build:all',
  description: 'build all',
  dependsOn: [
    'build:desktop',
    'build:win',
    'build:mac',
    'build:mac-universal',
    'build:linux',
    'build:android',
    'build:ios',
  ],
};
