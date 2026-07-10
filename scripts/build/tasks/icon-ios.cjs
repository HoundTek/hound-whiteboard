/**
 * @file icon:ios 任务（生成+拷贝两阶段）
 * @description 生成 iOS 图标。
 * @module scripts/build/tasks/icon-ios
 */

const path = require('path');

const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = [
  {
    id: 'icon:generate:ios',
    description: 'icon ios gen',
    dependsOn: ['deps'],
    run: { cmd: `${GEN_CMD} ios --phase=generate` },
  },
  {
    id: 'icon:copy:ios',
    description: 'icon ios copy',
    dependsOn: ['icon:generate:ios', 'ios:init'],
    run: { cmd: `${GEN_CMD} ios --phase=copy` },
  },
];
