/**
 * @file CLI 查询命令端到端测试
 * @description 以子进程驱动 CLI 验证查询类命令契约：create 持久化、ops 过滤、tree 打印与错误退出。
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

describe("CLI 查询命令", () => {
  jest.setTimeout(60000);

  test("create 创建空板并持久化板配置", async () => {
    const { dir, cleanup } = tempBoardDir();
    try {
      const info = await runCliJson([
        "create",
        "--path",
        dir,
        "--chunk-width",
        "800",
        "--chunk-height",
        "600",
      ]);
      expect(info.boardConfig).toEqual({ width: 800, height: 600 });
      expect(info.objects).toBe(0);
      expect(info.records).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("ops 打印操作记录明细，支持过滤与 limit", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("inspect-test", dir, { source: "cli" });
      const { stdout: id } = await runCli([
        "add",
        "--daemon",
        "inspect-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      await runCli(["delete", id.trim(), "--daemon", "inspect-test"]);

      const all = await runCliJson(["ops", "--path", dir]);
      expect(all.map((r) => r.type)).toEqual(["add-object", "delete-object"]);
      expect(all[0].id).toBe("cli/op-1");
      expect(all[1].parentId).toBe("cli/op-1");

      const limited = await runCliJson(["ops", "--path", dir, "--limit", "1"]);
      expect(limited).toHaveLength(1);
      expect(limited[0].type).toBe("delete-object");

      const filtered = await runCliJson([
        "ops",
        "--path",
        dir,
        "--type",
        "add-object",
      ]);
      expect(filtered).toHaveLength(1);
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("tree 以缩进树打印活动链、HEAD 与已撤销分支", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("inspect-test", dir, { source: "cli" });
      const { stdout: emptyOut } = await runCli(["tree", "--path", dir]);
      expect(emptyOut).toContain("（空树）");

      await runCli([
        "add",
        "--daemon",
        "inspect-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      await runCli([
        "add",
        "--daemon",
        "inspect-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      await runCli(["undo", "cli/op-2", "--daemon", "inspect-test"]);

      const { stdout } = await runCli(["tree", "--path", dir]);
      expect(stdout).toContain("cli/op-1  add-object  [HEAD]");
      expect(stdout).toContain("  cli/op-2  add-object  [已撤销]");
      expect(stdout).toContain("重做栈：cli/op-2");
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("打开不存在的板报错退出", async () => {
    const { dir, cleanup } = tempBoardDir();
    try {
      await expect(runCli(["list", "--path", dir])).rejects.toMatchObject({
        code: 1,
      });
    } finally {
      cleanup();
    }
  });

  test("双流分片板上 ops 与 tree 输出跨流一致且重开不变", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemonA = null;
    let daemonB = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      // 两个不同身份的 daemon 顺序持板各写一条记录（各自源流）
      daemonA = await startTestDaemon("inspect-shard-a", dir, { source: "sa" });
      await runCli([
        "add",
        "--daemon",
        "inspect-shard-a",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      await daemonA.close();
      daemonA = null;
      daemonB = await startTestDaemon("inspect-shard-b", dir, { source: "sb" });
      await runCli([
        "add",
        "--daemon",
        "inspect-shard-b",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      await daemonB.close();
      daemonB = null;

      const ops1 = await runCliJson(["ops", "--path", dir]);
      expect(ops1.map((r) => r.id)).toEqual(["sa/op-1", "sb/op-1"]);
      // 直读重开（每次调用完整走恢复路径）输出不变
      const ops2 = await runCliJson(["ops", "--path", dir]);
      expect(ops2).toEqual(ops1);

      const { stdout: tree1 } = await runCli(["tree", "--path", dir]);
      expect(tree1).toContain("sa/op-1");
      expect(tree1).toContain("sb/op-1");
      const { stdout: tree2 } = await runCli(["tree", "--path", dir]);
      expect(tree2).toBe(tree1);
    } finally {
      if (daemonA) await daemonA.close();
      if (daemonB) await daemonB.close();
      cleanup();
    }
  });
});
