/** @jest-environment node */

/**
 * @file shared module smoke test
 * @description 验证共享模块在 Node 环境下可被 import，且无 DOM/Worker/Tauri IPC 隐式依赖。
 * @module core/tests/shared-module-smoke.test
 * @author Zhou Chenyu
 */

/**
 * 共享模块导入路径集合
 * @type {string[]}
 */
const SHARED_MODULE_PATHS = [
  "../range/index.js",
  "../utils/math.js",
  "../utils/math-algorithm.js",
  "../utils/chain.js",
  "../components/renderer/render-scheduler.js",
  "../components/renderer/renderer.js",
  "../components/renderer/dirty-rect-strategy-shared.js",
  "../shared/types.js",
  "../shared/board-api-types.js",
  "../shared/message-types.js",
];

describe("Shared module smoke test", () => {
  test.each(SHARED_MODULE_PATHS)(
    "%s 应可在 Node 环境中导入",
    async (modulePath) => {
      await expect(import(modulePath)).resolves.toBeDefined();
    },
  );
});
