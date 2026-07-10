/**
 * @file icon:win 任务（生成+拷贝两阶段）
 * @description 生成 Windows 图标。
 * @module scripts/build/tasks/icon-win
 */

const path = require('path');

const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = [
  {
    id: 'icon:generate:win',
    description: 'icon win gen',
    dependsOn: ['deps'],
    run: { cmd: `${GEN_CMD} win --phase=generate` },
  },
  {
    id: 'icon:copy:win',
    description: 'icon win copy',
    dependsOn: ['icon:generate:win'],
    conflicts: ['resource:icons-dir'],
    run: { cmd: `${GEN_CMD} win --phase=copy` },
  },
];
