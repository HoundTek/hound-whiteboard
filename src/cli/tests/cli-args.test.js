/**
 * @file CLI 参数与通用标志测试
 * @description 验证 --version/-h/--help、未知命令报错与 --key=value 参数形式。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";

import {
  runCli,
  setupCliTestEnv,
  startTestDaemon,
  STROKE_DATA,
  tempBoardDir,
} from "./cli-test-helper.js";

setupCliTestEnv();

describe("CLI 通用标志", () => {
  jest.setTimeout(60000);

  test("--version 输出包版本号并成功退出", async () => {
    const { stdout } = await runCli(["--version"]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("-h / --help 打印用法并成功退出", async () => {
    const { stdout: h } = await runCli(["-h"]);
    expect(h).toContain("用法：hwb");
    const { stdout: help } = await runCli(["--help"]);
    expect(help).toContain("用法：hwb");
  });

  test("未知命令报错退出码 1", async () => {
    const { dir, cleanup } = tempBoardDir();
    try {
      await expect(
        runCli(["bogus", "--path", dir]),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      cleanup();
    }
  });

  test("--key=value 形式与 --key value 等价", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", `--path=${dir}`, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("args-test", dir, { source: "cli" });
      const { stdout: id } = await runCli([
        "add",
        `--daemon=args-test`,
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      expect(id.trim()).toMatch(/^cli\/\d+$/);
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });
});
