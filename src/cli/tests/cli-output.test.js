/**
 * @file CLI --json 输出契约测试
 * @description 验证 --json 模式 stdout 为纯 JSON、默认模式为人类可读文本，add 默认保持裸 id。
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

/** 命令执行器：同一块板上按序执行 */
class BoardRunner {
  /**
   * 建板并跑完一组命令
   * @returns {Promise<void>}
   */
  static async setup() {
    const { dir, cleanup } = tempBoardDir();
    await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
    const daemon = await startTestDaemon("output-test", dir, { source: "cli" });
    const { stdout: id } = await runCli([
      "add",
      "--daemon",
      "output-test",
      "--type",
      "CircleObject",
      "--data",
      "{radius: 20}",
    ]);
    return { dir, id: id.trim(), cleanup, daemon };
  }
}

describe("CLI --json 输出契约", () => {
  jest.setTimeout(60000);

  test("--json 模式下各命令 stdout 均为纯 JSON", async () => {
    const { dir, id, cleanup, daemon } = await BoardRunner.setup();
    try {
      await runCli(["choose", id, "--choice", "c1", "--daemon", "output-test"]);
      // 顺序语义：add 创建 cli/2 → delete 删除 → undo 撤销删除 → redo 重做删除；
      // modify 与 unchoose 操作的是未被删除的 cli/1
      const commands = [
        ["info"],
        ["list"],
        ["show", id],
        ["ops"],
        ["tree"],
        ["choices"],
        ["add", "--type", "CircleObject", "--data", "{radius: 1}"],
        ["delete", "cli/2"],
        ["undo"],
        ["redo"],
        ["modify", id, "--displacement", "5,5"],
        ["unchoose", "c1", "--apply"],
      ];
      for (const argv of commands) {
        const { stdout } = await runCli([...argv, "--json", "--daemon", "output-test"]);
        // 整个 stdout 可被 JSON.parse 完整消费：无杂音、无多余行
        const parsed = JSON.parse(stdout);
        expect(parsed).not.toBeUndefined();
      }
    } finally {
      await daemon.close();
      cleanup();
    }
  });

  test("默认模式为人类可读文本", async () => {
    const { dir, id, cleanup, daemon } = await BoardRunner.setup();
    try {
      const { stdout: infoOut } = await runCli(["info", "--daemon", "output-test"]);
      expect(infoOut).toContain("板配置：800×600");

      const { stdout: listOut } = await runCli(["list", "--daemon", "output-test"]);
      expect(listOut).toContain("对象：");
      expect(listOut).toContain(id);

      const { stdout: opsOut } = await runCli(["ops", "--daemon", "output-test"]);
      expect(opsOut).toMatch(/^cli\/op-1\s+add-object\s+cli\s+\d+/m);

      // 人类可读输出不应被误当成 JSON
      expect(() => JSON.parse(infoOut)).toThrow();
    } finally {
      await daemon.close();
      cleanup();
    }
  });

  test("add 默认输出裸 id，--json 输出对象", async () => {
    const { dir, cleanup, daemon } = await BoardRunner.setup();
    try {
      const { stdout } = await runCli([
        "add",
        "--daemon",
        "output-test",
        "--type",
        "CircleObject",
        "--data",
        "{radius: 3}",
      ]);
      expect(stdout.trim()).toMatch(/^cli\/\d+$/);

      const { stdout: jsonOut } = await runCli([
        "add",
        "--daemon",
        "output-test",
        "--type",
        "CircleObject",
        "--data",
        "{radius: 4}",
        "--json",
      ]);
      expect(JSON.parse(jsonOut).id).toMatch(/^cli\/\d+$/);
    } finally {
      await daemon.close();
      cleanup();
    }
  });

  test("tree --json 输出回溯树原始结构", async () => {
    const { dir, cleanup, daemon } = await BoardRunner.setup();
    try {
      const { stdout } = await runCli(["tree", "--daemon", "output-test", "--json"]);
      const tree = JSON.parse(stdout);
      expect(Array.isArray(tree.nodes)).toBe(true);
      expect(tree.nodes[0].id).toBe("cli/op-1");
      expect(Array.isArray(tree.redoStack)).toBe(true);
    } finally {
      await daemon.close();
      cleanup();
    }
  });
});
