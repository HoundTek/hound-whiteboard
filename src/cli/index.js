#!/usr/bin/env node
/**
 * @file Hound Whiteboard CLI 入口
 * @description 命令行前端：读命令直读板文件或经 daemon 查询；写命令经 daemon 执行，daemon 不在时按 --path 自治直写（布局 v2 分片）。
 * @module cli/index
 * @author Zhou Chenyu
 */

import { openBoardSession } from "./board-session.js";
import {
  connectDaemonByName,
  connectDaemonByPath,
  shutdownDaemon,
} from "./daemon-client.js";
import { resolveCliIdentity } from "./cli-identity.js";
import {
  isValidDaemonName,
  readEntry,
  removeEntry,
  isEntryAlive,
  listEntries,
} from "./daemon-registry.js";
import { readDaemonDescriptor, isDaemonAlive } from "./board-daemon.js";
import { resolveBoardPath } from "./board-path.js";
import { parseArgv } from "./args.js";
import { initI18n, t } from "./i18n.js";
import { formatOverview, formatCommandHelp, resolveTopicName } from "./help.js";
import { COMMANDS, READ_COMMANDS, WRITE_COMMANDS, cmdExport, cmdImport } from "./commands.js";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 包版本号（读 package.json，供 --version 输出）
 * @type {string}
 */
const VERSION = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
).version;

/**
 * daemon 进程入口（spawn detached 的目标）
 * @type {string}
 */
const START_DAEMON_PATH = fileURLToPath(new URL("./start-daemon.js", import.meta.url));

/** 等待后台 daemon 就绪的超时毫秒数 */
const START_READY_TIMEOUT_MS = 15000;

/**
 * 等待后台 daemon 就绪（注册表条目出现且端口可连通）
 * @param {string} name - daemon 名
 * @returns {Promise<boolean>} 是否就绪
 */
async function waitDaemonReady(name) {
  const deadline = Date.now() + START_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const desc = await readEntry(name);
    if (desc !== null && (await isEntryAlive(desc))) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * daemon start 子命令：后台 spawn 并等待就绪
 * @param {Object} flags - 标志
 * @returns {Promise<void>}
 */
async function runDaemonStart(flags) {
  const name = flags.name;
  const rootPath = resolveBoardPath(flags.path);
  if (!isValidDaemonName(name)) {
    throw new Error(t("err.invalidDaemonName", { name }));
  }
  // 分支 1：同名存活 daemon → 幂等引用 +1（同板）或报错（换板）
  const registered = await readEntry(name);
  if (registered !== null && (await isEntryAlive(registered))) {
    if (registered.rootPath !== rootPath) {
      throw new Error(
        t("err.daemonHoldsOtherBoard", { name, path: registered.rootPath }),
      );
    }
    // 重复 start 同板 = 引用 +1（误操作安全：不会因重复 start 报错，也不会被一次 release 误关）
    const session = await connectDaemonByName(name);
    if (session !== null) {
      try {
        const result = await session.api.hold();
        console.log(t("out.daemonRefUp", { name, refCount: result.refCount }));
      } finally {
        session.close();
      }
      return;
    }
    // 探活与连接之间 daemon 可能刚好退出，留下僵尸条目。
    // 端口仍通说明是真实连接故障，应当报错；端口已断则清掉条目按新建流程重来
    if (await isEntryAlive(registered)) {
      throw new Error(
        t("err.daemonConnectFailed", { name, port: registered.port }),
      );
    }
    await removeEntry(name);
  }
  // 分支 2：新创建（含僵尸覆盖）
  // 板必须已存在（create 建板）；board.json 是板的标志文件
  try {
    await access(path.join(rootPath, "board.json"));
  } catch {
    throw new Error(
      t("err.boardNotFoundWithHint", { path: rootPath, boardDir: t("ph.boardDir") }),
    );
  }
  // 板占用检查：同一板目录只能被一个活 daemon 持有（同 name 同板已在上方分支处理）
  const existing = await readDaemonDescriptor(rootPath);
  if (existing && (await isDaemonAlive(existing.port))) {
    throw new Error(t("err.boardOccupied", { port: existing.port }));
  }
  const childArgs = [
    START_DAEMON_PATH,
    "--name",
    name,
    "--path",
    rootPath,
  ];
  if (typeof flags.source === "string" && flags.source !== "") {
    childArgs.push("--source", flags.source);
  }
  if (typeof flags.relay === "string" && flags.relay !== "") {
    childArgs.push("--relay", flags.relay);
  }
  if (typeof flags["board-id"] === "string" && flags["board-id"] !== "") {
    childArgs.push("--board-id", flags["board-id"]);
  }
  if (typeof flags.port === "string" && flags.port !== "") {
    childArgs.push("--port", flags.port);
  }
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (!(await waitDaemonReady(name))) {
    throw new Error(
      t("err.daemonStartTimeout", { name, ms: START_READY_TIMEOUT_MS }),
    );
  }
  const desc = await readEntry(name);
  console.log(
    t("out.daemonStarted", {
      name,
      path: desc.rootPath,
      port: desc.port,
      source: desc.source,
    }),
  );
}

/**
 * daemon status 子命令
 * @param {Object} flags - 标志
 * @returns {Promise<void>}
 */
async function runDaemonStatus(flags) {
  if (typeof flags.name === "string" && flags.name !== "") {
    const desc = await readEntry(flags.name);
    if (desc === null) throw new Error(t("err.daemonNotRunning", { name: flags.name }));
    const alive = await isEntryAlive(desc);
    if (flags.json === true) {
      console.log(JSON.stringify({ ...desc, alive }, null, 2));
    } else {
      console.log(
        t("out.daemonStatusLine", {
          name: desc.name,
          status: alive ? t("out.statusAlive") : t("out.statusZombie"),
          refCount: desc.refCount ?? 1,
          path: desc.rootPath,
          port: desc.port,
          source: desc.source,
          startedAt: desc.startedAt,
        }),
      );
    }
    return;
  }
  const entries = await listEntries();
  const out = [];
  for (const desc of entries) {
    const alive = await isEntryAlive(desc);
    if (flags.json === true) {
      out.push({ ...desc, alive });
    } else {
      console.log(
        t("out.daemonStatusLine", {
          name: desc.name,
          status: alive ? t("out.statusAlive") : t("out.statusZombie"),
          refCount: desc.refCount ?? 1,
          path: desc.rootPath,
          port: desc.port,
          source: desc.source,
          startedAt: desc.startedAt,
        }),
      );
    }
  }
  if (flags.json === true) {
    console.log(JSON.stringify(out, null, 2));
  } else if (entries.length === 0) {
    console.log(t("out.noDaemons"));
  }
}

/**
 * daemon 子命令分发
 * @param {string[]} args - 位置参数（子命令名）
 * @param {Object} flags - 标志
 * @returns {Promise<void>}
 */
async function runDaemonCommand(args, flags) {
  const sub = args[0];
  switch (sub) {
    case "start":
      await runDaemonStart(flags);
      return;
    case "stop": {
      const name = flags.name;
      if (!isValidDaemonName(name)) {
        throw new Error(t("err.daemonStopNeedName", { name: t("ph.name") }));
      }
      const ok = await shutdownDaemon(name);
      if (!ok) {
        throw new Error(t("err.daemonStopTimeout", { name }));
      }
      console.log(t("out.daemonStopped", { name }));
      return;
    }
    case "release": {
      const name = flags.name;
      if (!isValidDaemonName(name)) {
        throw new Error(t("err.daemonReleaseNeedName", { name: t("ph.name") }));
      }
      const session = await connectDaemonByName(name);
      if (session === null) {
        throw new Error(t("err.daemonUnavailable", { name }));
      }
      let refCountAfter;
      try {
        const result = await session.api.release();
        refCountAfter = result.refCount;
      } finally {
        session.close();
      }
      console.log(t("out.daemonRefDown", { name, refCount: refCountAfter }));
      if (refCountAfter === 0) {
        // 归零自动退出：等待注册表条目消失确认
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if ((await readEntry(name)) === null) {
            console.log(t("out.daemonExited", { name }));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(t("err.daemonExitTimeout", { name }));
      }
      return;
    }
    case "status":
      await runDaemonStatus(flags);
      return;
    default:
      throw new Error(t("err.unknownDaemonSub", { sub }));
  }
}

/**
 * CLI 主流程：解析 → 寻址 → 执行命令
 * @returns {Promise<void>}
 */
async function main() {
  initI18n();
  const parsed = parseArgv(process.argv.slice(2));
  const { command, args, flags } = parsed;
  if (command === "--version" || flags.version === true) {
    console.log(VERSION);
    process.exit(0);
  }
  // help 路由：help <主题> / <命令> --help 打单命令帮助；无命令打总览
  if (command === "help") {
    if (args.length === 0) {
      console.log(formatOverview());
      process.exit(0);
    }
    const topic = resolveTopicName(args);
    const text = formatCommandHelp(topic);
    if (text === null) {
      console.error(t("err.unknownHelpTopic", { topic: args.join(" ") }));
      process.exit(1);
    }
    console.log(text);
    process.exit(0);
  }
  if (command === "-h" || command === "--help" || (flags.help === true && !command)) {
    console.log(formatOverview());
    process.exit(0);
  }
  if (flags.help === true) {
    const topic = resolveTopicName(
      command === "daemon" ? ["daemon", args[0]] : [command],
    );
    const text = formatCommandHelp(topic);
    if (text === null) {
      console.error(t("err.unknownHelpTopic", { topic: command }));
      process.exit(1);
    }
    console.log(text);
    process.exit(0);
  }
  const spec = COMMANDS[command];
  if (!spec) {
    if (command === "daemon") {
      try {
        await runDaemonCommand(args, flags);
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      return;
    }
    if (command === "export") {
      // 离线导出：不接 daemon，直读板文件打包
      try {
        await cmdExport(flags);
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      return;
    }
    if (command === "import") {
      // 离线导入：解压校验建板，不接 daemon
      try {
        await cmdImport(args, flags);
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      return;
    }
    console.log(formatOverview());
    if (command) {
      console.error(t("err.unknownCommand", { command }));
    }
    process.exit(!command ? 0 : 1);
  }

  const isRead = READ_COMMANDS.has(command);
  if (command === "create") {
    // 离线建板：不经 daemon，直开会话创建
    const board = resolveBoardPath(flags.path);
    const session = await openBoardSession(board, {
      create: true,
      // 区块边长决定盘上区块划分，只在建板时生效
      width: Number(flags["chunk-width"] ?? 0) || undefined,
      height: Number(flags["chunk-height"] ?? 0) || undefined,
      source: flags.source ?? "cli",
    });
    session.rootPath = board;
    try {
      await spec.run(session, args, flags);
      await session.flush();
    } finally {
      await session.close();
    }
    return;
  }
  const hasName = typeof flags.daemon === "string" && flags.daemon !== "";
  const hasPath = typeof flags.path === "string" && flags.path !== "";
  if (hasName && hasPath) {
    console.error(t("err.daemonPathConflict"));
    process.exit(1);
  }
  if (!hasName && !hasPath) {
    console.error(
      isRead
        ? t("err.missingTargetRead", { name: t("ph.name"), boardDir: t("ph.boardDir") })
        : t("err.missingTargetWrite", {
            command,
            name: t("ph.name"),
            boardDir: t("ph.boardDir"),
          }),
    );
    process.exit(1);
  }

  if (hasPath) {
    const board = resolveBoardPath(flags.path);
    if (isRead) {
      // 直读板文件：不接 daemon，指纹种子保证 flush 零写盘
      const session = await openBoardSession(board, {
        create: false,
        source: flags.source ?? "cli",
        writeMeta: false,
      });
      session.rootPath = board;
      try {
        await spec.run(session, args, flags);
        await session.flush();
      } finally {
        await session.close();
      }
      return;
    }
    // 写命令：优先走持有 daemon（快路径）；无 daemon 则自治直写自己分片（布局 v2 离线语义）
    const live = await connectDaemonByPath(board);
    if (live !== null) {
      live.mode = "daemon";
      try {
        await spec.run(live, args, flags);
      } finally {
        live.close();
      }
      return;
    }
    const session = await openBoardSession(board, {
      create: false,
      source: flags.source ?? (await resolveCliIdentity()),
    });
    session.rootPath = board;
    session.mode = "file";
    try {
      await spec.run(session, args, flags);
      await session.flush();
    } finally {
      await session.close();
    }
    return;
  }

  const session = await connectDaemonByName(flags.daemon);
  if (session === null) {
    console.error(
      t("err.daemonUnavailableWithHint", {
        name: flags.daemon,
        boardDir: t("ph.boardDir"),
      }),
    );
    process.exit(1);
  }
  session.mode = "daemon";
  try {
    await spec.run(session, args, flags);
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
