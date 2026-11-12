/**
 * @file CLI choice/modify 命令端到端测试
 * @description 以子进程驱动 CLI 验证命名 buffer 与对象修改契约：choice 生命周期、自动成链与增量换算。
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

describe("CLI choice/modify 命令", () => {
  jest.setTimeout(60000);

  test("choose/choices/unchoose：命名 buffer 生命周期", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("choice-test", dir, { source: "cli" });
      const { stdout: id1 } = await runCli([
        "add", "--daemon", "choice-test", "--type", "StrokeObject", "--data", STROKE_DATA,
      ]);
      const { stdout: id2 } = await runCli([
        "add", "--daemon", "choice-test", "--type", "StrokeObject", "--data", STROKE_DATA,
      ]);

      await runCli(["choose", id1.trim(), id2.trim(), "--choice", "c1", "--daemon", "choice-test"]);
      const choices = await runCliJson(["choices", "--path", dir]);
      expect(choices.c1.map((m) => m.id)).toEqual([id1.trim(), id2.trim()]);

      // 对象移 choice：从 c1 摘出进 c2，c1 只剩 id1
      await runCli(["choose", id2.trim(), "--choice", "c2", "--daemon", "choice-test"]);
      const after = await runCliJson(["choices", "--path", dir]);
      expect(after.c1.map((m) => m.id)).toEqual([id1.trim()]);
      expect(after.c2.map((m) => m.id)).toEqual([id2.trim()]);

      await runCli(["unchoose", "c2", "--discard", "--daemon", "choice-test"]);
      const final = await runCliJson(["choices", "--path", dir]);
      expect(final.c2).toBeUndefined();
      expect(final.c1).toHaveLength(1);

      // 缺 --apply/--discard 报错
      await expect(
        runCli(["unchoose", "c1", "--daemon", "choice-test"]),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("modify 单对象未选中自动成链；choice 增量逐对象换算；多对象 choice 禁全量", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("choice-test", dir, { source: "cli" });
      const { stdout: id1 } = await runCli([
        "add", "--daemon", "choice-test", "--type", "StrokeObject", "--data", STROKE_DATA,
        "--position", "10,10",
      ]);
      const { stdout: id2 } = await runCli([
        "add", "--daemon", "choice-test", "--type", "StrokeObject", "--data", STROKE_DATA,
        "--position", "20,20",
      ]);

      // 单对象未选中：自动链，position 全量 + 一条记录
      await runCli(["modify", id1.trim(), "--position", "100,50", "--daemon", "choice-test"]);
      const shown = await runCliJson(["show", id1.trim(), "--path", dir]);
      expect(shown.position).toEqual({ x: 100, y: 50 });
      const opsAfterSingle = await runCliJson(["ops", "--path", dir]);
      // add ×2 + 超分子链（choose/modify/unchoose 简并为一个节点）
      expect(opsAfterSingle.filter((r) => r.type === "modify-object")).toHaveLength(1);

      // 超分子合并：树只多一个聚合节点（花括号包裹），成员类型拼接展示
      const { stdout: treeOut } = await runCli(["tree", "--path", dir]);
      expect(treeOut).toContain("cli/op-3  {choose+modify+unchoose}  [HEAD]");
      expect(treeOut).not.toContain("choose-object");

      // choice 增量：两对象各自平移（daemon 模式驻留 AOM，提交前静态图不变）
      await runCli(["choose", id1.trim(), id2.trim(), "--choice", "mv", "--daemon", "choice-test"]);
      await runCli(["modify", "--choice", "mv", "--displacement", "5,-5", "--daemon", "choice-test"]);

      await expect(
        runCli(["modify", "--choice", "mv", "--position", "0,0", "--daemon", "choice-test"]),
      ).rejects.toMatchObject({ code: 1 });

      // 单对象 choice 允许全量（驻留）
      await runCli(["choose", id2.trim(), "--choice", "solo", "--daemon", "choice-test"]);
      await runCli(["modify", "--choice", "solo", "--position", "7,7", "--daemon", "choice-test"]);
      // 驻留修改经 unchoose --apply 一次性提交：mv 已只剩 id1，solo 提交 id2
      await runCli(["unchoose", "mv", "--apply", "--daemon", "choice-test"]);
      await runCli(["unchoose", "solo", "--apply", "--daemon", "choice-test"]);
      const moved1 = await runCliJson(["show", id1.trim(), "--path", dir]);
      const moved2 = await runCliJson(["show", id2.trim(), "--path", dir]);
      expect(moved1.position).toEqual({ x: 105, y: 45 });
      expect(moved2.position).toEqual({ x: 7, y: 7 });
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("choose 非法名字报错；choose 记录携带 choice 名", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("choice-test", dir, { source: "cli" });
      const { stdout: id1 } = await runCli([
        "add", "--daemon", "choice-test", "--type", "StrokeObject", "--data", STROKE_DATA,
      ]);
      const id = id1.trim();

      // 非法名字：含 "/" 或以 "~" 开头（与线路形态和匿名桶保留字冲突）
      await expect(
        runCli(["choose", id, "--choice", "a/b", "--daemon", "choice-test"]),
      ).rejects.toMatchObject({ code: 1 });
      await expect(
        runCli(["choose", id, "--choice", "~x", "--daemon", "choice-test"]),
      ).rejects.toMatchObject({ code: 1 });

      // 命名 choose 的日志记录携带 choice
      await runCli(["choose", id, "--choice", "named", "--daemon", "choice-test"]);
      await runCli(["unchoose", "named", "--discard", "--daemon", "choice-test"]);
      const ops = await runCliJson(["ops", "--type", "choose-object", "--path", dir]);
      const namedRecord = ops.find((r) => r.payload.objectId === id);
      expect(namedRecord.payload.choice).toBe("named");
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });
});
