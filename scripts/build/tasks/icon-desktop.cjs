/**
 * @file icon:desktop 任务（生成+拷贝两阶段）
 * @description 生成桌面端通用图标。
 * @module scripts/build/tasks/icon-desktop
 */

const path = require('path');

const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = [
  {
    id: 'icon:generate:desktop',
    description: 'icon desktop gen',
    dependsOn: ['deps'],
    run: { cmd: `${GEN_CMD} desktop --phase=generate` },
  },
  {
    id: 'icon:copy:desktop',
    description: 'icon desktop copy',
    dependsOn: ['icon:generate:desktop'],
    conflicts: ['resource:icons-dir'],
    run: { cmd: `${GEN_CMD} desktop --phase=copy` },
  },
];
