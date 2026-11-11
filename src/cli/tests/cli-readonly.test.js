/**
 * @file CLI 只读命令不落盘端到端测试
 * @description 验证 info/list/show/ops/tree 等读命令不重写板文件：以盘上内容为指纹种子的首 flush 全部跳过。
 * @author Zhou Chenyu
 */

import fs from "node:fs/promises";
import path from "node:path";
import { jest } from "@jest/globals";

import {
  runCli,
  setupCliTestEnv,
  startTestDaemon,
  STROKE_DATA,
  tempBoardDir,
} from "./cli-test-helper.js";

setupCliTestEnv();

/**
 * 递归读取板目录全部文件内容
 * @param {string} root - 板目录
 * @returns {Promise<Object<string, string>>} 相对路径到内容的映射
 */
async function snapshotBoard(root) {
  const out = {};
  const walk = async (dir, prefix) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        out[rel] = await fs.readFile(full, "utf-8");
      }
    }
  };
  await walk(root, "");
  return out;
}

describe("CLI 只读命令", () => {
  jest.setTimeout(60000);

  test("读命令不重写板文件", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--width", "800", "--height", "600"]);
      daemon = await startTestDaemon("readonly-test", dir, { source: "cli" });
      const { stdout: id } = await runCli([
        "add",
        "--daemon",
        "readonly-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      await runCli(["add", "--daemon", "readonly-test", "--type", "CircleObject", "--data", "{radius: 20}"]);

      const before = await snapshotBoard(dir);
      expect(before["board.json"]).toBeDefined();

      await runCli(["info", "--path", dir]);
      await runCli(["list", "--path", dir]);
      await runCli(["show", id.trim(), "--path", dir]);
      await runCli(["ops", "--path", dir]);
      await runCli(["tree", "--path", dir]);

      const after = await snapshotBoard(dir);
      expect(after).toEqual(before);
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("inspect 输出对象诊断详情", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--width", "800", "--height", "600"]);
      daemon = await startTestDaemon("readonly-multi", dir, { source: "cli" });
      const ids = [];
      for (let i = 0; i < 2; i++) {
        const { stdout } = await runCli([
          "add",
          "--daemon",
          "readonly-multi",
          "--type",
          "CircleObject",
          "--data",
          "{radius: 10}",
        ]);
        ids.push(stdout.trim());
      }

      const { stdout } = await runCli([
        "inspect",
        ...ids,
        "--daemon",
        "readonly-multi",
        "--json",
      ]);
      const details = JSON.parse(stdout);
      expect(details.map((item) => item.id)).toEqual(ids);
      // 详情比摘要多带诊断字段
      for (const detail of details) {
        expect(detail.data).toBeDefined();
        expect(detail.property).toBeDefined();
        expect(typeof detail.loadedCount).toBe("number");
        expect(Array.isArray(detail.coveredChunkIds)).toBe(true);
      }
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("写命令后板文件正常更新", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--width", "800", "--height", "600"]);
      daemon = await startTestDaemon("readonly-test", dir, { source: "cli" });
      await runCli([
        "add",
        "--daemon",
        "readonly-test",
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      const before = await snapshotBoard(dir);

      // 读一轮后 add：对象、日志段与元数据都应变化
      await runCli(["info", "--path", dir]);
      await runCli([
        "add",
        "--daemon",
        "readonly-test",
        "--type",
        "CircleObject",
        "--data",
        "{radius: 5}",
      ]);

      const after = await snapshotBoard(dir);
      expect(Object.keys(after).length).toBeGreaterThan(
        Object.keys(before).length,
      );
      // 布局 v2：board.json 创建后只读；写命令的计数与时间水位落 meta/<source>.json 分片
      expect(after["board.json"]).toBe(before["board.json"]);
      expect(after["meta/cli.json"]).toBeDefined();
      expect(after["meta/cli.json"]).not.toBe(before["meta/cli.json"]);
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });
});
