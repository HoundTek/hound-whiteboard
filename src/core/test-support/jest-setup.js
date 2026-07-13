/**
 * @file Jest 全局测试 setup
 * @description
 * 默认将 console.error 视为测试失败，防止 handler 错误被静默吞掉后形成假绿灯。
 * 需要显式允许 console.error 的测试可调用 allowConsoleError()。
 * @module core/test-support/jest-setup
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";

let consoleErrorAllowed = false;

beforeEach(() => {
  consoleErrorAllowed = false;
  jest.spyOn(console, "error").mockImplementation(() => {
    // 静默记录调用，在 afterEach 中检查
  });
});

afterEach(() => {
  const spy = console.error;
  const calls = spy?.mock?.calls ?? [];
  if (!consoleErrorAllowed && calls.length > 0) {
    const messages = calls
      .map((args) =>
        args
          .map((a) => (typeof a === "string" ? a : String(a)))
          .join(" "),
      )
      .join("\n");
    spy.mockRestore();
    throw new Error(
      `Unexpected console.error (${calls.length} call(s)):\n${messages}`,
    );
  }
  spy?.mockRestore?.();
});

/**
 * 允许当前测试中出现的 console.error 调用
 * @returns {void}
 */
global.allowConsoleError = () => {
  consoleErrorAllowed = true;
};
