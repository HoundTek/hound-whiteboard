/**
 * @file 板 daemon
 * @description owner/proxy 两态常驻进程：无 owner 时持板落盘，GUI 持盘时把 CLI RPC 代理给 owner。
 * @module cli/board-daemon
 * @author Zhou Chenyu
 */

import { WebSocketServer } from "ws";
import { openBoardSession } from "./board-session.js";
import { t } from "./i18n.js";
import { BOARD_API_ROUTES } from "../kernel/api/board-api-routes.js";
import { createNetworkCoordinator } from "../host/sync/network-coordinator.js";
import { createAmendForwarder } from "../host/sync/amend-forwarder.js";
import {
  isValidDaemonName,
  resolveDaemonIdentity,
  writeEntry,
  removeEntry,
  readEntry,
  isDaemonAlive,
} from "./daemon-registry.js";
import {
  OWNER_FILE,
  OWNER_LOCK_FILE,
  OWNER_TRANSPORT_KINDS,
  createDaemonOwnerClaim,
  ownerClaimToDaemonDescriptor,
} from "../kernel/board/owner-claim.js";
import {
  acquireOwnerLock,
  isOwnerClaimAlive,
  readOwnerClaim,
  releaseOwnerClaim,
  removeOwnerClaimFile,
  writeOwnerClaim,
} from "./board-claim.js";
import { connectOwnerByClaim } from "./owner-client.js";

/** daemon 模式：无 owner 时持板落盘 */
const DAEMON_MODE_OWNER = "owner";
/** daemon 模式：GUI 持盘时代理 CLI RPC */
const DAEMON_MODE_PROXY = "proxy";

/**
 * 创建串行任务队列
 * @returns {{enqueue: Function, drain: Function}} 队列操作面
 *
 * @description
 * 队列保证前一条任务（RPC 的 invoke+落盘）完成后才执行下一条：并发客户端到达的
 * 异步方法（addObject/commitObjects 等内部有真实 await 让出）不会交错执行。
 * 单条失败不中断队列（错误已在任务内转为响应或日志）。
 */
function createQueue() {
  /** @type {Promise<void>} 队列尾链 */
  let tail = Promise.resolve();
  return {
    /**
     * 将任务排入队尾
     * @param {() => Promise<void>} task - 任务
     * @returns {Promise<void>} 任务结果
     */
    enqueue(task) {
      const run = tail.then(task);
      tail = run.catch(() => {});
      return run;
    },
    /**
     * 排空：等待全部已入队任务完成
     * @returns {Promise<void>}
     */
    drain() {
      return tail;
    },
  };
}

/**
 * 读取板目录下的 daemon 描述
 * @param {string} rootPath - 板目录
 * @returns {Promise<Object|null>} daemon 描述；无 daemon owner 或非法时为 null
 */
async function readDaemonDescriptor(rootPath) {
  const claim = await readOwnerClaim(rootPath);
  const daemon = ownerClaimToDaemonDescriptor(claim);
  if (daemon === null) return null;
  return { ...daemon, rootPath };
}

/**
 * 启动板 daemon
 * @param {Object} options - 启动选项
 * @param {string} options.name - daemon 名（注册表唯一标识，不可与存活 daemon 重复）
 * @param {string} options.rootPath - 板目录（必须是既有板）
 * @param {string} [options.source] - 协作身份；省略时按注册表 name→source 映射解析（首启生成持久化）
 * @param {string} [options.boardId] - 中继房间 id；省略时用板目录路径
 * @param {string} [options.relayUrl] - 中继地址；省略时 daemon 不参与协作
 * @param {number} [options.port=0] - 监听端口（0 为随机）
 * @param {string} [options.host="127.0.0.1"] - 监听地址
 * @param {boolean} [options.exitOnZero=true] - 引用归零时是否退出进程
 * @returns {Promise<{name: string, rootPath: string, port: number, source: string, mode: string, close: Function}>} daemon 句柄
 *
 * @description
 * 无活 owner 时进入 owner 模式：写 `.owner.json`、打开 BoardCore 并落盘。
 * 已有活 GUI owner 时进入 proxy 模式：不打开 BoardCore、不写 claim，只把 CLI RPC 转发给 GUI owner。
 * 已有活 daemon owner 时拒绝启动。
 *
 * 启动全程持有板目录 owner 锁（.owner.lock）；所有退出路径（含中途失败）都释放锁。
 */
async function startBoardDaemon(options) {
  const rootPath = options?.rootPath;
  if (typeof rootPath !== "string" || rootPath.trim() === "") {
    throw new Error(t("err.boardPathMissing"));
  }
  const releaseOwnerLock = await acquireOwnerLock(rootPath);
  try {
    return await startBoardDaemonLocked(options);
  } finally {
    await releaseOwnerLock();
  }
}

/**
 * 持锁执行 daemon 启动（startBoardDaemon 的内层，调用方必须已持有 owner 锁）
 * @param {Object} options - 启动选项（同 startBoardDaemon）
 * @returns {Promise<Object>} daemon 句柄
 * @private
 */
async function startBoardDaemonLocked(options) {
  const name = options?.name;
  if (!isValidDaemonName(name)) {
    throw new Error(t("err.invalidDaemonName", { name }));
  }
  const rootPath = options?.rootPath;
  if (typeof rootPath !== "string" || rootPath.trim() === "") {
    throw new Error(t("err.boardPathMissing"));
  }

  // name 查重：注册表同名且存活的 daemon 拒绝启动；僵尸条目可覆盖
  const registered = await readEntry(name);
  if (registered !== null && (await isDaemonAlive(registered.port))) {
    throw new Error(
      `daemon ${name} 已在运行（板目录 ${registered.rootPath}，端口 ${registered.port}）。`,
    );
  }

  // 板目录占用：活 daemon owner 拒绝启动；活 GUI owner 进入 proxy 模式
  const existingClaim = await readOwnerClaim(rootPath);
  const existingLive =
    existingClaim !== null && (await isOwnerClaimAlive(existingClaim));
  let mode = DAEMON_MODE_OWNER;
  if (existingLive) {
    if (existingClaim.transport.kind === OWNER_TRANSPORT_KINDS.DAEMON) {
      throw new Error(
        `板目录已有 daemon 在运行（端口 ${existingClaim.transport.port}，身份 ${existingClaim.source}）。`,
      );
    }
    if (existingClaim.transport.kind !== OWNER_TRANSPORT_KINDS.GUI) {
      throw new Error(
        `板目录已被其他持有者认领（pid ${existingClaim.pid}，身份 ${existingClaim.source}）。`,
      );
    }
    mode = DAEMON_MODE_PROXY;
  }

  // 身份解析：显式 --source 优先；否则按注册表 name→source 映射（首启生成持久化）
  const source =
    typeof options.source === "string" && options.source !== ""
      ? options.source
      : await resolveDaemonIdentity(name);

  let closed = false;
  /** @type {Promise<void>|null} 共享关闭承诺 */
  let closePromise = null;
  /** @type {Object|null} owner 模式的板会话 */
  let session = null;
  /** @type {Object|null} proxy 模式的 GUI owner RPC 会话 */
  let ownerSession = null;
  /** @type {Object|null} owner 模式的 daemon claim */
  let claim = null;
  /** @type {Object|null} 注册表镜像条目 */
  let desc = null;
  /** @type {number} 创建者引用 */
  let ownerRefs = 1;
  /** @type {Object|null} relay 协调器 */
  let coordinator = null;
  /** @type {Object|null} amend 转发器 */
  let amendForwarder = null;
  /** @type {ReturnType<typeof setTimeout>|null} relay 重连定时器 */
  let relayRetryTimer = null;
  /** @type {Promise<void>} 注册表镜像写队列 */
  let refSyncTail = Promise.resolve();
  let wss = null;
  let port = null;

  const queue = createQueue();
  const totalRefs = () => ownerRefs;

  /**
   * 把 refCount 镜像进注册表
   * @returns {Promise<void>}
   */
  const syncRefCount = () => {
    if (desc === null || closed) return refSyncTail;
    refSyncTail = refSyncTail
      .then(() => writeEntry({ ...desc, refCount: totalRefs() }))
      .catch(() => {});
    return refSyncTail;
  };

  /**
   * 关闭并退出进程（引用归零或强制停机共用）
   * @returns {void}
   */
  const closeAndExit = () => {
    void (async () => {
      await close();
      if (options.exitOnZero !== false) {
        process.exit(0);
      }
    })();
  };

  /**
   * 引用归零检查
   * @returns {void}
   */
  const checkZeroAndExit = () => {
    if (ownerRefs === 0) closeAndExit();
  };

  /**
   * 确保 proxy 模式有一条可用的 owner RPC 会话
   * @returns {Promise<Object>} owner 会话
   * @throws {Error} owner 不存在或连接/鉴权失败时
   */
  const ensureProxySession = async () => {
    if (ownerSession !== null) return ownerSession;
    const latestClaim = await readOwnerClaim(rootPath);
    if (
      latestClaim === null ||
      latestClaim.transport.kind !== OWNER_TRANSPORT_KINDS.GUI ||
      !(await isOwnerClaimAlive(latestClaim))
    ) {
      throw new Error("板目录 owner 已不可用");
    }
    const next = await connectOwnerByClaim(latestClaim, { rootPath, source });
    if (next === null) {
      throw new Error("无法连接 GUI owner RPC");
    }
    ownerSession = next;
    return ownerSession;
  };

  /**
   * 连中继（仅 owner 模式）；失败降级单机并每 3s 重试
   * @returns {Promise<void>}
   */
  const connectRelay = async () => {
    if (closed || session === null) return;
    const next = createNetworkCoordinator({
      boardCore: session.boardCore,
      boardApi: session.api,
      url: options.relayUrl,
      boardId: options.boardId ?? rootPath,
      onAwareness: () => {},
      onDisconnect: () => scheduleRelayRetry(),
    });
    try {
      await next.connect();
      if (closed) {
        await next.close();
        return;
      }
      coordinator = next;
      amendForwarder?.close();
      amendForwarder = createAmendForwarder({
        boardCore: session.boardCore,
        sendAwareness: (data) => coordinator?.sendAwareness(data),
      });
      relayRetryTimer = null;
      console.log(
        `[daemon] 已连接中继：${options.relayUrl}（房间 ${options.boardId ?? rootPath}）`,
      );
    } catch {
      await next.close();
      scheduleRelayRetry();
    }
  };

  /**
   * 调度 relay 重连
   * @returns {void}
   */
  const scheduleRelayRetry = () => {
    if (closed || relayRetryTimer !== null) return;
    relayRetryTimer = setTimeout(() => {
      relayRetryTimer = null;
      void connectRelay();
    }, 3000);
  };

  try {
    if (mode === DAEMON_MODE_OWNER) {
      session = await openBoardSession(rootPath, { source });
      if (options.relayUrl) {
        try {
          await connectRelay();
          if (coordinator === null) {
            console.warn(`[daemon] 中继连接失败，按单机模式运行并每 3s 重试`);
          }
        } catch (error) {
          console.warn(
            `[daemon] 中继连接失败（${error?.message ?? error}），按单机模式运行并每 3s 重试`,
          );
        }
      }
    }

    wss = new WebSocketServer({
      port: options.port ?? 0,
      host: options.host ?? "127.0.0.1",
    });
    await new Promise((resolve, reject) => {
      wss.once("listening", resolve);
      wss.once("error", reject);
    });
    port = wss.address().port;

    desc = {
      name,
      rootPath,
      pid: process.pid,
      port,
      source,
      boardId: options.boardId ?? null,
      mode,
      refCount: totalRefs(),
      startedAt: new Date().toISOString(),
    };

    if (mode === DAEMON_MODE_OWNER) {
      claim = createDaemonOwnerClaim({
        name,
        pid: process.pid,
        source,
        boardId: options.boardId ?? null,
        host: options.host ?? "127.0.0.1",
        port,
      });
      await writeOwnerClaim(rootPath, claim);
    } else {
      await ensureProxySession();
    }
    await writeEntry(desc);
  } catch (error) {
    if (wss !== null) {
      await new Promise((resolve) => wss.close(resolve)).catch(() => {});
    }
    amendForwarder?.close();
    if (coordinator !== null) {
      await coordinator.close().catch(() => {});
    }
    if (session !== null) {
      await session.close().catch(() => {});
    }
    ownerSession?.close();
    if (claim !== null) {
      removeOwnerClaimFile(rootPath).catch(() => {});
    }
    throw error;
  }

  /**
   * 关闭 daemon
   * @returns {Promise<void>}
   */
  const close = () => {
    if (closePromise !== null) return closePromise;
    closed = true;
    closePromise = (async () => {
      await queue.drain();
      if (relayRetryTimer !== null) {
        clearTimeout(relayRetryTimer);
        relayRetryTimer = null;
      }
      amendForwarder?.close();
      if (coordinator !== null) {
        await coordinator.close();
      }
      ownerSession?.close();
      ownerSession = null;
      for (const ws of wss.clients) {
        try {
          ws.terminate();
        } catch {
          /* 忽略单个客户端关闭失败 */
        }
      }
      await new Promise((resolve) => wss.close(resolve));
      if (session !== null) {
        await session.flush();
        await session.close();
      }
      await refSyncTail;
      if (claim !== null) {
        try {
          await releaseOwnerClaim(rootPath, claim.ownerId);
        } finally {
          await removeEntry(name);
        }
      } else {
        await removeEntry(name);
      }
    })();
    return closePromise;
  };

  wss.on("connection", (ws) => {
    if (closed) {
      ws.terminate();
      return;
    }
    ws.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message?.route === "daemon-shutdown") {
        ws.send(JSON.stringify({ id: message.id, ok: true, result: null }));
        closeAndExit();
        return;
      }
      if (closed) {
        if (typeof message?.id === "number" && typeof message?.route === "string") {
          ws.send(
            JSON.stringify({ id: message.id, ok: false, error: "daemon 正在关闭" }),
          );
        }
        return;
      }
      if (message?.route === "daemon-hold") {
        ownerRefs += 1;
        void syncRefCount();
        ws.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: { refCount: totalRefs() },
          }),
        );
        return;
      }
      if (message?.route === "daemon-release") {
        ownerRefs = Math.max(0, ownerRefs - 1);
        void syncRefCount();
        ws.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: { refCount: totalRefs() },
          }),
        );
        checkZeroAndExit();
        return;
      }
      if (typeof message?.id === "number" && typeof message?.route === "string") {
        queue.enqueue(() =>
          mode === DAEMON_MODE_PROXY
            ? handleProxyRpc(ws, message, ensureProxySession, source, () => {
                ownerSession?.close();
                ownerSession = null;
              })
            : handleOwnerRpc(session, ws, message),
        );
      }
    });
  });

  return { name, rootPath, port, source, mode, close };
}

/**
 * 分发 owner 模式的 RPC 消息
 * @param {Object} session - 板会话
 * @param {Object} ws - WebSocket 连接
 * @param {Object} message - RPC 消息
 * @returns {Promise<void>}
 * @private
 */
async function handleOwnerRpc(session, ws, message) {
  const { id, route, params } = message ?? {};
  const entry = BOARD_API_ROUTES[route];
  if (!entry) {
    ws.send(JSON.stringify({ id, ok: false, error: `未知 route：${route}` }));
    return;
  }
  try {
    const result = await entry.invoke(session.api, params ?? {});
    if (entry.flush === "sync" || entry.flush === "async") {
      await session.flush();
    }
    ws.send(JSON.stringify({ id, ok: true, result: result ?? null }));
  } catch (error) {
    ws.send(
      JSON.stringify({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * 分发 proxy 模式的 RPC 消息
 * @param {Object} ws - WebSocket 连接
 * @param {Object} message - RPC 消息
 * @param {Function} ensureProxySession - 获取/重连 owner 会话
 * @param {string} source - daemon 身份（请求未携带 source 时使用）
 * @param {Function} onFailure - 请求失败时重置 owner 会话
 * @returns {Promise<void>}
 * @private
 */
async function handleProxyRpc(
  ws,
  message,
  ensureProxySession,
  source,
  onFailure,
) {
  const { id, route, params, source: requestSource } = message ?? {};
  try {
    const ownerSession = await ensureProxySession();
    const result = await ownerSession.invoke(
      route,
      params ?? {},
      requestSource ?? source,
    );
    ws.send(JSON.stringify({ id, ok: true, result: result ?? null }));
  } catch (error) {
    onFailure?.();
    ws.send(
      JSON.stringify({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export {
  startBoardDaemon,
  readDaemonDescriptor,
  OWNER_FILE,
  OWNER_LOCK_FILE,
  acquireOwnerLock,
  isDaemonAlive,
};
