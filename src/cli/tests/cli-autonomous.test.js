/**
 * @file CLI 自治写端到端测试
 * @description 验证布局 v2 离线语义：无 daemon 时写命令 --path 自治直写自己分片；有 daemon 时 --path 自动走 daemon。
 * @module cli/tests/cli-autonomous.test
 * @author Zhou Chenyu
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest, beforeAll, afterAll } from "@jest/globals";

import {
  runCli,
  runCliJson,
  setupCliTestEnv,
  startTestDaemon,
  STROKE_DATA,
  tempBoardDir,
} from "./cli-test-helper.js";

setupCliTestEnv();

/** 测试用的独立 CLI 身份文件路径（避免污染真实身份） */
let identityFile = null;

beforeAll(() => {
  identityFile = path.join(
    os.tmpdir(),
    `hwb-cli-identity-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
  );
  process.env.HWB_CLI_IDENTITY_FILE = identityFile;
});

afterAll(async () => {
  delete process.env.HWB_CLI_IDENTITY_FILE;
  if (identityFile) {
    await fs.rm(identityFile, { force: true });
  }
});

describe("CLI 自治写（布局 v2 离线语义）", () => {
  jest.setTimeout(60000);

  test("无 daemon 时写命令 --path 自治直写分片，daemon 起来后归并可见", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);

      // 自治写：对象 id 带 cli-* 持久身份前缀
      const { stdout: id1 } = await runCli([
        "add",
        "--path",
        dir,
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      expect(id1.trim()).toMatch(/^cli-[0-9a-z]{4}\/1$/);
      // 身份持久化：第二次自治写续号
      const { stdout: id2 } = await runCli([
        "add",
        "--path",
        dir,
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      expect(id2.trim()).toBe(`${id1.trim().split("/")[0]}/2`);

      // 自治写的记录落在 cli-* 自己的流里
      const ops = await runCliJson(["ops", "--path", dir]);
      expect(ops.map((r) => r.source)).toEqual([id1.trim().split("/")[0], id1.trim().split("/")[0]]);
      expect(ops.map((r) => r.type)).toEqual(["add-object", "add-object"]);

      // daemon 起来后直读可见（盘归并）
      daemon = await startTestDaemon("auto-test", dir, { source: "dt" });
      const list = await runCliJson(["list", "--daemon", "auto-test"]);
      expect(list.objects.map((o) => o.id).sort()).toEqual([
        id1.trim(),
        id2.trim(),
      ]);
      await daemon.close();
      daemon = null;

      // daemon 关掉后自治撤销：各撤各的命中 cli-* 最近操作
      await runCli(["undo", "--path", dir]);
      const listAfter = await runCliJson(["list", "--path", dir]);
      expect(listAfter.objects.map((o) => o.id)).toEqual([id1.trim()]);
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("有 daemon 时 --path 写命令自动走持有 daemon", async () => {
    const { dir, cleanup } = tempBoardDir();
    let daemon = null;
    try {
      await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
      daemon = await startTestDaemon("auto-fast", dir, { source: "dsrc" });

      // --path 写命令探测到活 daemon：操作作者为 daemon 身份（经 RPC 串行分配）
      const { stdout: id } = await runCli([
        "add",
        "--path",
        dir,
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
      ]);
      expect(id.trim()).toBe("dsrc/1");
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });
});
