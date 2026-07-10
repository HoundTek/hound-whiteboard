/**
 * @file icon:common 任务（生成+拷贝两阶段）
 * @description 生成所有平台共享的基础图标，输出到 src-tauri/icons。
 * @module scripts/build/tasks/icon-common
 */

const path = require('path');

const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = [
  {
    id: 'icon:generate:common',
    description: 'icon common gen',
    dependsOn: ['deps'],
    run: { cmd: `${GEN_CMD} common --phase=generate` },
  },
  {
    id: 'icon:copy:common',
    description: 'icon common copy',
    dependsOn: ['icon:generate:common'],
    conflicts: ['resource:icons-dir'],
    run: { cmd: `${GEN_CMD} common --phase=copy` },
  },
];
