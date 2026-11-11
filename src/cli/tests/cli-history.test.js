/**
 * @file CLI 历史命令端到端测试
 * @description 以子进程驱动 CLI 验证 undo/redo/delete 契约：显式节点撤销、trash 迁移与跨进程持久化。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";

import {
  runCli,
  runCliJson,
  setupCliTestEnv,
  startTestDaemon,
  STROKE_DATA,
  tempBoardDir,
} from "./cli-test-helper.js";

setupCliTestEnv();

describe("CLI 历史命令", () => {
  jest.setTimeout(60000);

  test("undo 带显式操作 id：撤销指定节点，info 输出 chain", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("hist-test", dir, { source: "cli" });
      const { stdout: id1 } = await runCli([
        "add",
        "--daemon",
        "hist-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      const { stdout: id2 } = await runCli([
        "add",
        "--daemon",
        "hist-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      expect(id1.trim()).toBe("cli/1");
      expect(id2.trim()).toBe("cli/2");

      // info 输出活动链节点列表
      const info = await runCliJson(["info", "--path", dir]);
      expect(info.chain).toEqual(["cli/op-1", "cli/op-2"]);

      // 显式撤销 op-1（非本端最近节点也支持）
      const { stdout: undoOut } = await runCli(["undo", "cli/op-1", "--daemon", "hist-test"]);
      expect(undoOut).toContain("撤销 cli/op-1");
      const listed = await runCliJson(["list", "--path", dir]);
      expect(listed.objects.map((o) => o.id)).toEqual(["cli/2"]);

      // 显式撤销不在活动链上的 id 报无可撤销
      const { stdout: badOut } = await runCli(["undo", "cli/op-999", "--daemon", "hist-test"]);
      expect(badOut).toContain("无可撤销目标");
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("undo 跨进程持久化：撤销后重开对象不复活", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("hist-test", dir, { source: "cli" });
      await runCli([
        "add",
        "--daemon",
        "hist-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      await runCli(["undo", "--daemon", "hist-test"]);

      // 新进程重开：撤销效果已落盘，对象不复活
      const listed = await runCliJson(["list", "--path", dir]);
      expect(listed.objects).toEqual([]);

      await runCli(["redo", "--daemon", "hist-test"]);
      const relisted = await runCliJson(["list", "--path", dir]);
      expect(relisted.objects).toEqual([
        { id: "cli/1", type: "StrokeObject" },
      ]);
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("delete 将对象移入 trash 且可撤销恢复", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("hist-test", dir, { source: "cli" });
      await runCli([
        "add",
        "--daemon",
        "hist-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      await runCli(["delete", "cli/1", "--daemon", "hist-test"]);

      const listed = await runCliJson(["list", "--path", dir]);
      expect(listed.objects).toEqual([]);
      expect(listed.trash).toEqual(["cli/1"]);

      await runCli(["undo", "--daemon", "hist-test"]);
      const relisted = await runCliJson(["list", "--path", dir]);
      expect(relisted.objects).toEqual([
        { id: "cli/1", type: "StrokeObject" },
      ]);
      expect(relisted.trash).toEqual([]);
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });
});
