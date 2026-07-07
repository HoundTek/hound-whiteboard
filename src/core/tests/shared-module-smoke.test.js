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
  "../shared/range/index.js",
  "../utils/math.js",
  "../utils/math-algorithm.js",
  "../utils/chain.js",
  "../shared/components/renderer/render-scheduler.js",
  "../shared/components/renderer/renderer.js",
  "../shared/components/renderer/dirty-rect-strategy-shared.js",
  "../shared/types/types.js",
  "../shared/types/board-api-types.js",
  "../shared/types/message-types.js",
];

describe("Shared module smoke test", () => {
  test.each(SHARED_MODULE_PATHS)(
    "%s 应可在 Node 环境中导入",
    async (modulePath) => {
      await expect(import(modulePath)).resolves.toBeDefined();
    },
  );
});
