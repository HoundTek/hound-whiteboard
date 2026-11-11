/**
 * @file CLI daemon 引用计数端到端测试
 * @description 验证 start 幂等 +1、release 归零退出、stop 强制关闭、GUI 连接引用归属与单一持板约束。
 * @author Zhou Chenyu
 */

import fs from "node:fs";
import path from "node:path";
import { jest } from "@jest/globals";
import { createNetworkCoordinator } from "../../host/sync/network-coordinator.js";
import { BoardCore } from "../../kernel/board/board-core.js";
import { BoardApi } from "../../kernel/api/board-api.js";
import { createDefaultAomRenderHooks } from "../../kernel/board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../kernel/board/persistence-adapter.js";

import {
  runCli,
  runCliJson,
  setupCliTestEnv,
  startTestDaemon,
  tempBoardDir,
} from "./cli-test-helper.js";

setupCliTestEnv();

/** 本文件统一的 daemon 名 */
const DAEMON = "ref-test";

describe("CLI daemon 引用计数", () => {
  jest.setTimeout(60000);

  /** 起进程内 daemon 并建板 */
  async function setup() {
    const { dir, cleanup } = tempBoardDir();
    await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
    const daemon = await startTestDaemon(DAEMON, dir, { source: "cli" });
    return { dir, daemon, cleanup };
  }

  /** 模拟 GUI 长连接（coordinator 直连 daemon 协作通道） */
  function makeGui(port, boardId) {
    const core = new BoardCore({
      width: 800,
      height: 600,
      source: "gui-test",
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const api = new BoardApi(core);
    const coord = createNetworkCoordinator({
      boardCore: core,
      boardApi: api,
      url: `ws://127.0.0.1:${port}`,
      boardId,
    });
    return { core, api, coord };
  }

  test("start 幂等：同名同板重复 start 引用 +1，不报错", async () => {
    const { dir, daemon, cleanup } = await setup();
    try {
      expect((await runCliJson(["daemon", "status", "--name", DAEMON])).refCount).toBe(1);
      // 重复 start（同 name 同 path）→ 幂等 +1，daemon 不重启
      const { stdout } = await runCli(["daemon", "start", "--name", DAEMON, "--path", dir]);
      expect(stdout).toContain("引用 +1（当前 2）");
      expect((await runCliJson(["daemon", "status", "--name", DAEMON])).refCount).toBe(2);
      // 引用 2 时 release 一次不关闭
      await runCli(["daemon", "release", "--name", DAEMON]);
      expect((await runCliJson(["daemon", "status", "--name", DAEMON])).alive).toBe(true);
      // release 归零：daemon 自动关闭（注册表条目消失）
      await runCli(["daemon", "release", "--name", DAEMON]);
      await expect(runCli(["daemon", "status", "--name", DAEMON])).rejects.toMatchObject({ code: 1 });
    } finally {
      await daemon.close();
      cleanup();
    }
  });

  test("start 冲突：同名换板报错、同板换名报错", async () => {
    const { dir, daemon, cleanup } = await setup();
    const { dir: other, cleanup: otherCleanup } = tempBoardDir();
    try {
      await runCli(["create", "--path", other, "--chunk-width", "800", "--chunk-height", "600"]);
      // 同名不同板
      await expect(
        runCli(["daemon", "start", "--name", DAEMON, "--path", other]),
      ).rejects.toThrow("同一 name 只能指向一块板");
      // 同板不同名
      await expect(
        runCli(["daemon", "start", "--name", "other-name", "--path", dir]),
      ).rejects.toThrow("板目录已有 daemon 在运行");
    } finally {
      otherCleanup();
      await daemon.close();
      cleanup();
    }
  });

  test("GUI 连接引用：join +1、断开 -1、连着时 release 杀不掉、断开归零关闭", async () => {
    const { dir, daemon, cleanup } = await setup();
    try {
      const info = await runCliJson(["daemon", "status", "--name", DAEMON]);
      const gui = makeGui(info.port, dir);
      await gui.coord.connect();
      expect((await runCliJson(["daemon", "status", "--name", DAEMON])).refCount).toBe(2);

      // GUI 连着时 release：释放创建者引用，daemon 仍活（GUI 引用还在）
      await runCli(["daemon", "release", "--name", DAEMON]);
      expect((await runCliJson(["daemon", "status", "--name", DAEMON])).alive).toBe(true);

      // GUI 断开：创建者已 release 且无客户端 → 归零自动关闭
      await gui.coord.close();
      await expect(runCli(["daemon", "status", "--name", DAEMON])).rejects.toMatchObject({ code: 1 });
    } finally {
      await daemon.close();
      cleanup();
    }
  });

  test("GUI 断开不误杀：创建者引用保留时 daemon 常驻", async () => {
    const { dir, daemon, cleanup } = await setup();
    try {
      const info = await runCliJson(["daemon", "status", "--name", DAEMON]);
      const gui = makeGui(info.port, dir);
      await gui.coord.connect();
      await gui.coord.close();
      await new Promise((resolve) => setTimeout(resolve, 300));
      // 创建者引用（1）保留：daemon 仍活且引用回 1
      const status = await runCliJson(["daemon", "status", "--name", DAEMON]);
      expect(status.alive).toBe(true);
      expect(status.refCount).toBe(1);
    } finally {
      await daemon.close();
      cleanup();
    }
  });

  test("stop 强制关闭：引用 >0 时也无条件关闭；重启后引用重置", async () => {
    const { dir, daemon, cleanup } = await setup();
    try {
      // 引用 2 时 stop 仍无条件关闭
      await runCli(["daemon", "start", "--name", DAEMON, "--path", dir]);
      expect((await runCliJson(["daemon", "status", "--name", DAEMON])).refCount).toBe(2);
      await runCli(["daemon", "stop", "--name", DAEMON]);
      await expect(runCli(["daemon", "status", "--name", DAEMON])).rejects.toMatchObject({ code: 1 });

      // 同名重启：引用重置 1
      await runCli(["daemon", "start", "--name", DAEMON, "--path", dir]);
      expect((await runCliJson(["daemon", "status", "--name", DAEMON])).refCount).toBe(1);
      await runCli(["daemon", "stop", "--name", DAEMON]);
      await expect(runCli(["daemon", "status", "--name", DAEMON])).rejects.toMatchObject({ code: 1 });
    } finally {
      await daemon.close();
      cleanup();
    }
  });
});
