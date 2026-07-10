/**
 * @file icon:mac 任务（生成+拷贝两阶段）
 * @description 生成 macOS 图标。
 * @module scripts/build/tasks/icon-mac
 */

const path = require('path');

const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = [
  {
    id: 'icon:generate:mac',
    description: 'icon mac gen',
    dependsOn: ['deps'],
    run: { cmd: `${GEN_CMD} mac --phase=generate` },
  },
  {
    id: 'icon:copy:mac',
    description: 'icon mac copy',
    dependsOn: ['icon:generate:mac'],
    conflicts: ['resource:icons-dir'],
    run: { cmd: `${GEN_CMD} mac --phase=copy` },
  },
];
