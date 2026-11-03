/**
 * @file 板 daemon 端到端测试
 * @description 验证 daemon 持板、RPC 命令执行、描述文件生命周期、僵尸回退与经中继的实时互见。
 * @module cli/tests/board-daemon.test
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startBoardDaemon, readDaemonDescriptor } from "../board-daemon.js";
import { daemonIdentityFile } from "../daemon-registry.js";
import { connectDaemonByPath } from "../daemon-client.js";
import { openBoardSession } from "../board-session.js";
import { createRelayServer } from "../../host/sync/relay-server.js";
import { createNetworkCoordinator } from "../../host/sync/network-coordinator.js";
import { BoardApi } from "../../kernel/api/board-api.js";
import { BoardCore } from "../../kernel/board/board-core.js";
import { createDefaultAomRenderHooks } from "../../kernel/board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../kernel/board/persistence-adapter.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../index.js", import.meta.url));

/** 测试用的独立 daemon 全局引用路径（避免并行测试互相覆盖） */
let refFile = null;

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hwb-daemon-reg-"));
  refFile = path.join(dir, "daemon.json");
  process.env.HWB_DAEMON_DIR = refFile;
  // 子进程语言固定为中文：断言中文文案不随运行环境 LANG 漂移
  process.env.HWB_LANG ??= "zh_CN";
});

afterAll(async () => {
  delete process.env.HWB_DAEMON_DIR;
  if (refFile) {
    await fs.rm(path.dirname(refFile), { recursive: true, force: true });
  }
});

/** 示例笔画数据 */
const STROKE_DATA = {
  points: [
    { x: 10, y: 10, pressure: 0.5 },
    { x: 30, y: 20, pressure: 0.5 },
  ],
  color: "#000",
  width: 2,
};

/**
 * 创建临时板目录并建空板
 * @returns {Promise<{dir: string, cleanup: Function}>} 目录与清理函数
 */
async function tempBoard() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hwb-daemon-test-"));
  const session = await openBoardSession(dir, {
    create: true,
    width: 800,
    height: 600,
  });
  await session.flush();
  await session.close();
  return {
    dir,
    // Windows 下文件句柄释放有延迟，cleanup 重试若干次
    cleanup: async () => {
      for (let i = 0; i < 10; i += 1) {
        try {
          await fs.rm(dir, { recursive: true, force: true });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    },
  };
}

/**
 * 轮询等待条件成立
 * @param {Function} fn - 条件函数
 * @param {number} [timeout=3000] - 超时毫秒数
 * @returns {Promise<void>}
 */
async function waitFor(fn, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitFor 超时");
}

/**
 * 连接 daemon 的 GUI 协作通道
 * @param {number} port - daemon 端口
 * @param {string} source - 协作来源
 * @returns {Promise<Object>} 测试客户端
 */
async function connectCollab(port, source) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  ws.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)));
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.send(JSON.stringify({ type: "join", source }));
  await waitFor(() => messages.some((message) => message.type === "joined"));
  return {
    messages,
    send: (message) => ws.send(JSON.stringify(message)),
    close: () => new Promise((resolve) => {
      ws.addEventListener("close", resolve, { once: true });
      ws.close();
    }),
  };
}

describe("板 daemon", () => {
  test("RPC 命令执行：增删查与撤销", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-test",
    });
    try {
      const desc = await readDaemonDescriptor(dir);
      expect(desc.port).toBe(daemon.port);
      expect(desc.source).toBe("daemon-test");

      const client = await connectDaemonByPath(dir);
      expect(client).not.toBeNull();
      expect(client.source).toBe("daemon-test");

      const id = await client.api.addObject("StrokeObject", {
        data: { ...STROKE_DATA },
      });
      expect(id).toBe("daemon-test/1");

      const info = await client.api.queryBoardInfo();
      expect(info.records).toBe(1);
      expect(info.objects).toBe(1);

      const data = await client.api.queryObject(id);
      expect(data.id).toBe(id);

      await client.api.deleteObjects([id]);
      let list = await client.api.queryObjectList();
      expect(list.trash).toEqual([id]);

      await client.api.undo();
      list = await client.api.queryObjectList();
      expect(list.objects.map((o) => o.id)).toEqual([id]);
      expect(list.trash).toEqual([]);

      client.close();
    } finally {
      await daemon.close();
      await cleanup();
    }
    // 描述文件随关闭删除
    expect(await readDaemonDescriptor(dir)).toBeNull();
  });

  test("活 daemon 存在时拒绝重复启动；僵尸描述文件回退 null", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-test",
    });
    try {
      await expect(
        startBoardDaemon({ name: "other-dt", rootPath: dir, source: "other" }),
      ).rejects.toThrow("已有 daemon");
    } finally {
      await daemon.close();
    }

    // 僵尸描述文件（无活进程）：客户端连接回退 null
    await fs.writeFile(
      path.join(dir, ".daemon.json"),
      JSON.stringify({ pid: 1, port: 1, source: "ghost" }),
      "utf-8",
    );
    expect(await connectDaemonByPath(dir)).toBeNull();
    await cleanup();
  });

  test("daemon 落盘：关闭后板上数据可经文件模式恢复", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-test",
    });
    const client = await connectDaemonByPath(dir);
    const id = await client.api.addObject("StrokeObject", {
      data: { ...STROKE_DATA },
    });
    client.close();
    await daemon.close();

    // 文件模式重开：daemon 期间的变更已落盘
    const session = await openBoardSession(dir, { source: "cli" });
    expect(session.boardCore.getObjectById(id)).not.toBeNull();
    expect(session.boardCore.operationLog.size).toBe(1);
    await session.close();
    await cleanup();
  });

  test("重复关闭共享同一清理承诺且最终落盘", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-close",
    });
    const client = await connectDaemonByPath(dir);
    const id = await client.api.addObject("StrokeObject", {
      data: { ...STROKE_DATA },
    });
    client.close();

    const first = daemon.close();
    const second = daemon.close();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    const session = await openBoardSession(dir, { source: "cli" });
    expect(session.boardCore.getObjectById(id)).toBeDefined();
    await session.close();
    await cleanup();
  });

  test("非空板 GUI 重连 daemon 只补缺口，已有记录不重复追加", async () => {
    const { dir, cleanup } = await tempBoard();
    const seed = await openBoardSession(dir, { source: "gui" });
    const firstId = await seed.api.addObject("StrokeObject", {
      data: { ...STROKE_DATA },
    });
    await seed.flush();
    await seed.close();

    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon",
    });
    const gui = await openBoardSession(dir, { source: "gui" });
    const client = await connectDaemonByPath(dir);
    let coordinator = null;
    try {
      expect(gui.boardCore.getObjectById(firstId)).toBeDefined();
      const secondId = await gui.api.addObject("StrokeObject", {
        data: { ...STROKE_DATA },
      });
      coordinator = createNetworkCoordinator({
        boardCore: gui.boardCore,
        boardApi: gui.api,
        url: `ws://127.0.0.1:${daemon.port}`,
        boardId: dir,
      });
      await coordinator.connect();
      await waitFor(async () => (await client.api.queryBoardInfo()).records === 2);
      expect((await client.api.queryObject(secondId)).id).toBe(secondId);

      await coordinator.close();
      const thirdId = await gui.api.addObject("StrokeObject", {
        data: { ...STROKE_DATA },
      });
      coordinator = createNetworkCoordinator({
        boardCore: gui.boardCore,
        boardApi: gui.api,
        url: `ws://127.0.0.1:${daemon.port}`,
        boardId: dir,
      });
      await coordinator.connect();
      await waitFor(async () => (await client.api.queryBoardInfo()).records === 3);
      expect((await client.api.queryObject(thirdId)).id).toBe(thirdId);
    } finally {
      await coordinator?.close();
      client.close();
      await gui.close();
      await daemon.close();
      await cleanup();
    }
  }, 15000);

  test("daemon 连中继：CLI 操作与协作端实时互见", async () => {
    const relay = createRelayServer({ port: 0 });
    await relay.ready;
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon",
      relayUrl,
      boardId: "test-room",
    });

    // 协作对端（等价于 GUI 窗口）
    const peerCore = new BoardCore({
      width: 800,
      height: 600,
      source: "peer",
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const peerApi = new BoardApi(peerCore);
    const peerCoordinator = createNetworkCoordinator({
      boardCore: peerCore,
      boardApi: peerApi,
      url: relayUrl,
      boardId: "test-room",
    });

    try {
      await peerCoordinator.connect();

      // CLI → daemon → relay → 对端可见
      const client = await connectDaemonByPath(dir);
      const id = await client.api.addObject("StrokeObject", {
        data: { ...STROKE_DATA },
      });
      await waitFor(() => peerCore.getObjectById(id) != null);
      expect(peerCore.operationLog.size).toBe(1);

      // 对端 → relay → daemon 可见（CLI 查询面同步看到）
      const peerId = await peerApi.addObject("StrokeObject", {
        data: { ...STROKE_DATA },
      });
      await waitFor(async () => {
        const list = await client.api.queryObjectList();
        return list.objects.some((o) => o.id === peerId);
      });

      // CLI 撤销 daemon 侧操作 → 对端同步收敛
      await client.api.undo();
      await waitFor(() => {
        const info = peerApi.queryBoardInfo();
        return info.records === 3 && info.objects === 1;
      });
      expect(peerCore.getObjectById(id)).toBeUndefined();
      expect(peerCore.getObjectById(peerId)).not.toBeNull();

      client.close();
    } finally {
      await peerCoordinator.close();
      await daemon.close();
      await relay.close();
      await cleanup();
    }
  }, 15000);

  test("CLI 子进程按 --daemon 寻址：命令经 daemon 执行且身份属 daemon", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-x",
    });
    try {
      // 无 --source：daemon 模式下身份属 daemon，add 输出 daemon 前缀 id
      const { stdout: idOut } = await execFileAsync(
        process.execPath,
        [
          CLI_PATH,
          "add",
          "--daemon",
          "dt",
          "--type",
          "StrokeObject",
          "--data",
          JSON.stringify(STROKE_DATA),
        ],
        { env: process.env },
      );
      expect(idOut.trim()).toBe("daemon-x/1");

      const { stdout: listOut } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "list", "--daemon", "dt", "--json"],
        { env: process.env },
      );
      const listed = JSON.parse(listOut);
      expect(listed.objects).toEqual([
        { id: "daemon-x/1", type: "StrokeObject" },
      ]);

      await execFileAsync(process.execPath, [CLI_PATH, "undo", "--daemon", "dt"], { env: process.env });
      const { stdout: infoOut } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "info", "--daemon", "dt", "--json"],
        { env: process.env },
      );
      expect(JSON.parse(infoOut).objects).toBe(0);
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 20000);

  test("CLI 按 --daemon 显式寻址操作", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-y",
    });
    try {
      const { stdout: idOut } = await execFileAsync(
        process.execPath,
        [
          CLI_PATH,
          "add",
          "--daemon",
          "dt",
          "--type",
          "StrokeObject",
          "--data",
          JSON.stringify(STROKE_DATA),
        ],
        { env: process.env },
      );
      expect(idOut.trim()).toBe("daemon-y/1");

      const { stdout: listOut } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "list", "--daemon", "dt", "--json"],
        { env: process.env },
      );
      const listed = JSON.parse(listOut);
      expect(listed.objects).toEqual([
        { id: "daemon-y/1", type: "StrokeObject" },
      ]);
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 20000);

  test("show/delete 的对象 id 不误判为 daemon 名", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-z",
    });
    try {
      const { stdout: idOut } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "add", "--daemon", "dt", "--type", "CircleObject", "--data", "{radius: 20}"],
        { env: process.env },
      );
      const id = idOut.trim();
      expect(id).toBe("daemon-z/1");

      const { stdout: showOut } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "show", id, "--daemon", "dt", "--json"],
        { env: process.env },
      );
      expect(JSON.parse(showOut).data.radius).toBe(20);

      await execFileAsync(process.execPath, [CLI_PATH, "delete", id, "--daemon", "dt"], {
        env: process.env,
      });
      const { stdout: listOut } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "list", "--daemon", "dt", "--json"],
        { env: process.env },
      );
      expect(JSON.parse(listOut).trash).toEqual([id]);

      // undo 带显式操作 id：免路径下不误判为板路径；撤销 delete 节点后 trash 清空、对象回 objects
      const { stdout: undoOut } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "undo", "daemon-z/op-2", "--daemon", "dt"],
        { env: process.env },
      );
      expect(undoOut).toContain("撤销 daemon-z/op-2");
      const { stdout: listOut2 } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "list", "--daemon", "dt", "--json"],
        { env: process.env },
      );
      const afterUndo = JSON.parse(listOut2);
      expect(afterUndo.trash).toEqual([]);
      expect(afterUndo.objects.map((o) => o.id)).toEqual([id]);
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 20000);

  test("awareness 在 GUI 双端与 relay 之间双向桥接", async () => {
    const relay = createRelayServer({ port: 0, requestInitMinIntervalMs: 0 });
    await relay.ready;
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon",
      relayUrl,
      boardId: "awareness-room",
    });
    const peerCore = new BoardCore({
      width: 800,
      height: 600,
      source: "peer",
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const peerApi = new BoardApi(peerCore);
    const relayMessages = [];
    const peer = createNetworkCoordinator({
      boardCore: peerCore,
      boardApi: peerApi,
      url: relayUrl,
      boardId: "awareness-room",
      onAwareness: (message) => relayMessages.push(message),
    });
    await peer.connect();
    const gui1 = await connectCollab(daemon.port, "gui-1");
    const gui2 = await connectCollab(daemon.port, "gui-2");
    try {
      gui1.send({ type: "awareness", data: { kind: "cursor", point: { x: 1, y: 2 } } });
      await waitFor(() => relayMessages.some((message) => message.data?.kind === "cursor"));
      await waitFor(() => gui2.messages.some((message) =>
        message.type === "awareness" && message.source === "gui-1"
      ));

      peer.sendAwareness({ kind: "cursor", point: { x: 8, y: 9 } });
      await waitFor(() => gui1.messages.some((message) =>
        message.type === "awareness" && message.source === "peer"
      ));
      await waitFor(() => gui2.messages.some((message) =>
        message.type === "awareness" && message.source === "peer"
      ));
    } finally {
      await gui1.close();
      await gui2.close();
      await peer.close();
      await daemon.close();
      await relay.close();
      await cleanup();
    }
  }, 15000);

  test("daemon 先于中继启动：自动重连后参与协作", async () => {
    // 先占一个空闲端口再释放，模拟中继未启动
    const probe = createRelayServer({ port: 0 });
    await probe.ready;
    const port = probe.port;
    await probe.close();

    const { dir, cleanup } = await tempBoard();
    const relayUrl = `ws://127.0.0.1:${port}`;
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-r",
      relayUrl,
      boardId: "room",
    });
    try {
      // 中继后启动，daemon 应在重试周期内自动连上
      const relay = createRelayServer({ port });
      await relay.ready;
      try {
        await waitFor(() => relay.roomSize("room") >= 1, 15000);

        const client = await connectDaemonByPath(dir);
        const id = await client.api.addObject("StrokeObject", {
          data: { ...STROKE_DATA },
        });

        const peerCore = new BoardCore({
          width: 800,
          height: 600,
          source: "peer",
          aomRenderHooks: createDefaultAomRenderHooks(),
          persistenceAdapter: createDefaultPersistenceAdapter(),
        });
        const peerApi = new BoardApi(peerCore);
        const peerCoordinator = createNetworkCoordinator({
          boardCore: peerCore,
          boardApi: peerApi,
          url: relayUrl,
          boardId: "room",
        });
        await peerCoordinator.connect();
        await waitFor(() => peerCore.getObjectById(id) != null);
        await peerCoordinator.close();
        client.close();
      } finally {
        await relay.close();
      }
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 25000);

  test("daemon 模式 choice 驻留：多次 modify 累积，unchoose --apply 一次提交", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-c",
    });
    try {
      const run = (argv) =>
        execFileAsync(process.execPath, [CLI_PATH, ...argv], {
          env: process.env,
        });
      const { stdout: idOut } = await run([
        "add", "--type", "StrokeObject",
        "--data", "{points:[{x:1,y:1},{x:9,y:9}]}",
        "--position", "10,10",
        "--daemon", "dt"]);
      const id = idOut.trim();

      await run(["choose", id, "--choice", "c1", "--daemon", "dt"]);
      await run(["modify", "--choice", "c1", "--displacement", "5,5", "--daemon", "dt"]);
      await run(["modify", "--choice", "c1", "--displacement", "5,5", "--daemon", "dt"]);

      // 驻留期间静态图未变（修改在 AOM 活动对象上）
      const { stdout: listMid } = await run([
        "ops",
        "--type",
        "modify-object",
        "--json", "--daemon", "dt"]);
      expect(JSON.parse(listMid)).toHaveLength(0);

      await run(["unchoose", "c1", "--apply", "--daemon", "dt"]);
      const { stdout: showOut } = await run(["show", id, "--json", "--daemon", "dt"]);
      expect(JSON.parse(showOut).position).toEqual({ x: 20, y: 20 });

      // 两次 modify 累积为一条 modify-object 记录
      const { stdout: opsOut } = await run([
        "ops",
        "--type",
        "modify-object",
        "--json", "--daemon", "dt"]);
      expect(JSON.parse(opsOut)).toHaveLength(1);

      // buffer 已清
      const { stdout: choicesOut } = await run(["choices", "--json", "--daemon", "dt"]);
      expect(JSON.parse(choicesOut)).toEqual({});

      // discard 放弃：修改还原到选择前状态，不产生 modify 记录
      const { stdout: beforeOut } = await run(["show", id, "--json", "--daemon", "dt"]);
      const beforePos = JSON.parse(beforeOut).position;
      await run(["choose", id, "--choice", "drop", "--daemon", "dt"]);
      await run(["modify", "--choice", "drop", "--displacement", "77,77", "--daemon", "dt"]);
      await run(["unchoose", "drop", "--discard", "--daemon", "dt"]);
      const { stdout: afterOut } = await run(["show", id, "--json", "--daemon", "dt"]);
      expect(JSON.parse(afterOut).position).toEqual(beforePos);
      const { stdout: opsAfter } = await run([
        "ops",
        "--type",
        "modify-object",
        "--json", "--daemon", "dt"]);
      expect(JSON.parse(opsAfter)).toHaveLength(1);
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 25000);

  test("daemon 重启后 choice 从文件种子自愈：modify 重选重建注册表", async () => {
    const { dir, cleanup } = await tempBoard();
    let daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-r",
    });
    const run = (argv) =>
      execFileAsync(process.execPath, [CLI_PATH, ...argv], {
        env: process.env,
      });
    try {
      const { stdout: idOut } = await run([
        "add", "--type", "StrokeObject",
        "--data", "{points:[{x:1,y:1},{x:9,y:9}]}",
        "--position", "10,10",
        "--daemon", "dt"]);
      const id = idOut.trim();
      await run(["choose", id, "--choice", "c1", "--daemon", "dt"]);

      // 注册表权威：驻留中的成员标 active:true
      const before = JSON.parse((await run(["choices", "--json", "--daemon", "dt"])).stdout);
      expect(before.c1).toEqual([{ id, missing: false, active: true }]);

      // 重启 daemon：AOM 注册表随进程丢失，buffer 文件种子仍在
      await daemon.close();
      daemon = await startBoardDaemon({
        rootPath: dir,
        exitOnZero: false,
        name: "dt",
        source: "daemon-r",
      });

      const unrestored = JSON.parse((await run(["choices", "--json", "--daemon", "dt"])).stdout);
      expect(unrestored.c1).toEqual([{ id, missing: false, active: false }]);

      // modify 触发自愈重选：注册表重建，驻留期间修改不入日志
      await run(["modify", "--choice", "c1", "--displacement", "5,5", "--daemon", "dt"]);
      const healed = JSON.parse((await run(["choices", "--json", "--daemon", "dt"])).stdout);
      expect(healed.c1).toEqual([{ id, missing: false, active: true }]);
      const midOps = JSON.parse(
        (await run(["ops", "--type", "modify-object", "--json", "--daemon", "dt"])).stdout,
      );
      expect(midOps).toHaveLength(0);

      await run(["unchoose", "c1", "--apply", "--daemon", "dt"]);
      const shown = JSON.parse((await run(["show", id, "--json", "--daemon", "dt"])).stdout);
      expect(shown.position).toEqual({ x: 15, y: 15 });
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 30000);

  test("并发 RPC addObject：id 不撞号、记录完整", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-c",
    });
    const client1 = await connectDaemonByPath(dir);
    const client2 = await connectDaemonByPath(dir);
    try {
      const calls = [];
      for (let i = 0; i < 5; i++) {
        calls.push(
          client1.api.addObject("StrokeObject", { data: { ...STROKE_DATA } }),
        );
        calls.push(
          client2.api.addObject("StrokeObject", { data: { ...STROKE_DATA } }),
        );
      }
      const ids = await Promise.all(calls);
      expect(new Set(ids).size).toBe(10);
      // 串行队列下全部落盘：记录数与对象数一致
      const records = await client1.api.queryOperations();
      expect(records).toHaveLength(10);
      expect((await client1.api.queryObjectList()).objects).toHaveLength(10);
    } finally {
      client1.close();
      client2.close();
      await daemon.close();
      await cleanup();
    }
  }, 30000);

  test("引用计数：start 幂等/release/stop 与 GUI 连接增减，release 归零自动退出", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-c",
    });
    const run = (argv) =>
      execFileAsync(process.execPath, [CLI_PATH, ...argv], {
        env: process.env,
      });
    try {
      // start 后引用 1
      expect(JSON.parse((await run(["daemon", "status", "--name", "dt", "--json"])).stdout).refCount).toBe(1);
      // 重复 start（幂等）引用 +1、release -1
      await run(["daemon", "start", "--name", "dt", "--path", dir]);
      expect(JSON.parse((await run(["daemon", "status", "--name", "dt", "--json"])).stdout).refCount).toBe(2);
      await run(["daemon", "release", "--name", "dt"]);
      expect(JSON.parse((await run(["daemon", "status", "--name", "dt", "--json"])).stdout).refCount).toBe(1);

      // GUI 长连接：join +1、断开 -1
      const guiCore = new BoardCore({
        width: 800,
        height: 600,
        source: "gui-test",
        aomRenderHooks: createDefaultAomRenderHooks(),
        persistenceAdapter: createDefaultPersistenceAdapter(),
      });
      const guiApi = new BoardApi(guiCore);
      const coord = createNetworkCoordinator({
        boardCore: guiCore,
        boardApi: guiApi,
        url: `ws://127.0.0.1:${daemon.port}`,
        boardId: dir,
      });
      await coord.connect();
      expect(JSON.parse((await run(["daemon", "status", "--name", "dt", "--json"])).stdout).refCount).toBe(2);
      await coord.close();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(JSON.parse((await run(["daemon", "status", "--name", "dt", "--json"])).stdout).refCount).toBe(1);

      // GUI 连着时 release 不会关闭（引用仍 >0）
      const coord2 = createNetworkCoordinator({
        boardCore: guiCore,
        boardApi: guiApi,
        url: `ws://127.0.0.1:${daemon.port}`,
        boardId: dir,
      });
      await coord2.connect();
      await run(["daemon", "release", "--name", "dt"]);
      expect(JSON.parse((await run(["daemon", "status", "--name", "dt", "--json"])).stdout).alive).toBe(true);
      // 创建者引用已 release：GUI 断开 → 归零 → daemon 自动关闭（注册表条目消失）
      await coord2.close();
      await waitFor(async () => {
        try {
          await run(["daemon", "status", "--name", "dt", "--json"]);
          return false;
        } catch {
          return true;
        }
      });
      await expect(run(["daemon", "status", "--name", "dt"])).rejects.toMatchObject({ code: 1 });
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 30000);

  test("协作双向同步：GUI 操作落盘在 daemon，CLI 操作 GUI 可见，undo 跨端一致", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-c",
    });
    const guiCore = new BoardCore({
      width: 800,
      height: 600,
      source: "gui-test",
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const guiApi = new BoardApi(guiCore);
    const coord = createNetworkCoordinator({
      boardCore: guiCore,
      boardApi: guiApi,
      url: `ws://127.0.0.1:${daemon.port}`,
      boardId: dir,
    });
    try {
      await coord.connect();

      // GUI 创建 → daemon 应用并落盘（CLI 侧可见）
      guiApi.createObject("CircleObject", {
        id: "gui/1",
        position: { x: 0, y: 0 },
        data: { radius: 10 },
      });
      await guiApi.commitObjects(["gui/1"]);
      const client = await connectDaemonByPath(dir);
      await waitFor(async () => {
        const info = await client.api.queryBoardInfo();
        return info.objects === 1;
      });
      client.close();

      // CLI add → daemon 广播 → GUI 本地可见
      const client2 = await connectDaemonByPath(dir);
      await client2.api.addObject("CircleObject", { data: { radius: 5 } });
      client2.close();
      await waitFor(async () => guiCore.getAllObjects().length === 2);

      // GUI undo 撤销本端最近操作 → daemon 侧对象减少
      guiApi.undo();
      const client3 = await connectDaemonByPath(dir);
      await waitFor(async () => {
        const info = await client3.api.queryBoardInfo();
        return info.objects === 1;
      });
      client3.close();
    } finally {
      await coord.close();
      await daemon.close();
      await cleanup();
    }
  }, 30000);

  test("close 排空 in-flight RPC：已到达队列的操作不丢", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "dt",
      source: "daemon-c",
    });
    const client = await connectDaemonByPath(dir);
    try {
      // 前 3 个操作等待完成：确认通道与队列工作
      for (let i = 0; i < 3; i++) {
        await client.api.addObject("StrokeObject", {
          data: { ...STROKE_DATA },
        });
      }
      // 再发 3 个不等待响应，给本地回环留送达时间后立即 close：
      // 已入队的操作应被排空落盘，响应在关连接前发出
      const pending = [];
      for (let i = 0; i < 3; i++) {
        pending.push(
          client.api.addObject("StrokeObject", { data: { ...STROKE_DATA } }),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      await daemon.close();
      const ids = await Promise.all(pending);
      expect(ids).toHaveLength(3);

      // 重开板：6 个对象全部落盘
      const session = await openBoardSession(dir, { source: "cli" });
      try {
        expect(session.api.queryObjectList().objects).toHaveLength(6);
        expect(session.api.queryOperations()).toHaveLength(6);
      } finally {
        await session.close();
      }
    } finally {
      client.close();
      await cleanup();
    }
  }, 30000);
});

describe("daemon 身份持久化", () => {
  test("首启生成 daemon-* 身份并写入身份映射文件", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "id-first",
    });
    try {
      expect(daemon.source).toMatch(/^daemon-[0-9a-z]{4}$/);
      const text = await fs.readFile(daemonIdentityFile("id-first"), "utf-8");
      expect(JSON.parse(text).source).toBe(daemon.source);
    } finally {
      await daemon.close();
      await cleanup();
    }
  });

  test("停止后重启同名 daemon 身份不变（stop 删注册表条目不影响身份映射）", async () => {
    const { dir, cleanup } = await tempBoard();
    const first = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "id-stable",
    });
    const firstSource = first.source;
    await first.close();
    const second = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "id-stable",
    });
    try {
      expect(second.source).toBe(firstSource);
    } finally {
      await second.close();
      await cleanup();
    }
  });

  test("不同 name 分配不同身份", async () => {
    const { dir: dirA, cleanup: cleanupA } = await tempBoard();
    const { dir: dirB, cleanup: cleanupB } = await tempBoard();
    const daemonA = await startBoardDaemon({
      rootPath: dirA,
      exitOnZero: false,
      name: "id-distinct-a",
    });
    const daemonB = await startBoardDaemon({
      rootPath: dirB,
      exitOnZero: false,
      name: "id-distinct-b",
    });
    try {
      expect(daemonA.source).not.toBe(daemonB.source);
    } finally {
      await daemonA.close();
      await daemonB.close();
      await cleanupA();
      await cleanupB();
    }
  });

  test("显式 source 优先于身份映射", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "id-explicit",
      source: "explicit-src",
    });
    try {
      expect(daemon.source).toBe("explicit-src");
    } finally {
      await daemon.close();
      await cleanup();
    }
  });
});

describe("GUI 附属 daemon 闲置自退出", () => {
  test("gui- 前缀 daemon 无客户端连接，闲置超时自动关闭", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "gui-idle-exit",
      source: "daemon-c",
      idleExitMs: 100,
    });
    try {
      expect(await readDaemonDescriptor(dir)).not.toBeNull();
      // 仅剩 spawn 创建者引用且无客户端：超时自退出（.daemon.json 被清理）
      await waitFor(async () => (await readDaemonDescriptor(dir)) === null);
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 30000);

  test("客户端接入取消闲置计时，断开后重新计时", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "gui-idle-cancel",
      source: "daemon-c",
      idleExitMs: 200,
    });
    const guiCore = new BoardCore({
      width: 800,
      height: 600,
      source: "gui-test",
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const coord = createNetworkCoordinator({
      boardCore: guiCore,
      boardApi: new BoardApi(guiCore),
      url: `ws://127.0.0.1:${daemon.port}`,
      boardId: dir,
    });
    try {
      await coord.connect();
      // 超过闲置时长仍存活（join 取消了倒计时）
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(await readDaemonDescriptor(dir)).not.toBeNull();
      // 断开后重新计时，超时自退出
      await coord.close();
      await waitFor(async () => (await readDaemonDescriptor(dir)) === null);
    } finally {
      await coord.close();
      await daemon.close();
      await cleanup();
    }
  }, 30000);

  test("CLI hold 占住（创建者引用 >1）时闲置不退出", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "gui-idle-hold",
      source: "daemon-c",
      idleExitMs: 100,
    });
    const run = (argv) =>
      execFileAsync(process.execPath, [CLI_PATH, ...argv], {
        env: process.env,
      });
    try {
      // 重复 start（幂等）：创建者引用 +1 → 2
      await run(["daemon", "start", "--name", "gui-idle-hold", "--path", dir]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await readDaemonDescriptor(dir)).not.toBeNull();
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 30000);

  test("非 gui- 前缀名不启用闲置自退出", async () => {
    const { dir, cleanup } = await tempBoard();
    const daemon = await startBoardDaemon({
      rootPath: dir,
      exitOnZero: false,
      name: "cli-no-idle-exit",
      source: "daemon-c",
    });
    try {
      // 未传 idleExitMs 且非 gui- 前缀：短等不自退出（默认 60s 仅属 gui- 前缀）
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await readDaemonDescriptor(dir)).not.toBeNull();
    } finally {
      await daemon.close();
      await cleanup();
    }
  }, 30000);
});
