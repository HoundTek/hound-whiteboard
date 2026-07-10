/**
 * @file build:desktop-platforms 元任务
 * @description 构建全部桌面平台（Windows + macOS + Linux）。
 * @module scripts/build/tasks/build-desktop-platforms
 */

module.exports = {
  id: 'build:desktop-platforms',
  description: 'build desktop all',
  dependsOn: [
    'build:desktop',
    'build:win',
    'build:mac',
    'build:mac-universal',
    'build:linux',
  ],
};
