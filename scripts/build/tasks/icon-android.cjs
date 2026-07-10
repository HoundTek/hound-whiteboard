/**
 * @file icon:android 任务（生成+拷贝两阶段）
 * @description 生成 Android 图标。
 * @module scripts/build/tasks/icon-android
 */

const path = require('path');

const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = [
  {
    id: 'icon:generate:android',
    description: 'icon android gen',
    dependsOn: ['deps'],
    run: { cmd: `${GEN_CMD} android --phase=generate` },
  },
  {
    id: 'icon:copy:android',
    description: 'icon android copy',
    dependsOn: ['icon:generate:android', 'android:init'],
    run: { cmd: `${GEN_CMD} android --phase=copy` },
  },
];
