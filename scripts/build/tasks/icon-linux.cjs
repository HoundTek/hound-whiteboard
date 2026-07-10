/**
 * @file icon:linux 任务（生成+拷贝两阶段）
 * @description 生成 Linux 图标。
 * @module scripts/build/tasks/icon-linux
 */

const path = require('path');

const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = [
  {
    id: 'icon:generate:linux',
    description: 'icon linux gen',
    dependsOn: ['deps'],
    run: { cmd: `${GEN_CMD} linux --phase=generate` },
  },
  {
    id: 'icon:copy:linux',
    description: 'icon linux copy',
    dependsOn: ['icon:generate:linux'],
    conflicts: ['resource:icons-dir'],
    run: { cmd: `${GEN_CMD} linux --phase=copy` },
  },
];
