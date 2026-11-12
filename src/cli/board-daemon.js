/**
 * @file 板 daemon
 * @description 常驻进程持有板（BoardCore + BoardApi + 日志跟随者落盘），经 WebSocket 提供 BoardApi RPC，可选连中继参与协作。
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
  createRemoteRecordIngestor,
  maxSeqBySource,
} from "../host/sync/remote-record-ingestor.js";
import {
  trackRemoteSource,
  resetRemoteSource,
  releaseRemoteChannel,
} from "../host/sync/remote-activity-channels.js";
import {
  parseOperationId,
  validateOperation,
} from "../kernel/hit/operation.js";
import {
  isValidDaemonName,
  resolveDaemonIdentity,
  writeEntry,
  removeEntry,
  readEntry,
  isDaemonAlive,
} from "./daemon-registry.js";
import fs from "node:fs/promises";
import path from "node:path";

/** daemon 描述文件名（写在板目录下，标记板被哪个 daemon 持有） */
const DAEMON_FILE = ".daemon.json";

/** daemon 启动锁文件名（写在板目录下，护住启动窗口，内容为持有者 pid） */
const START_LOCK_FILE = ".daemon-start.lock";

/** 启动锁最大抢锁次数（含 stale 锁回收重试） */
const START_LOCK_MAX_ATTEMPTS = 3;

/** GUI 附属 daemon（gui- 前缀名）无客户端连接的闲置自退出时长（毫秒） */
const GUI_DAEMON_IDLE_EXIT_MS = 60_000;

/**
 * 判定 pid 是否存活
 * @param {number} pid - 进程号
 * @returns {boolean} 是否存活（EPERM 视为存活：进程在但无权发信号）
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * 读启动锁文件中的持有者 pid
 * @param {string} lockPath - 锁文件路径
 * @returns {Promise<number|null>} pid；文件缺失或内容非法时为 null
 */
async function readStartLockPid(lockPath) {
  try {
    const text = await fs.readFile(lockPath, "utf-8");
    const pid = Number.parseInt(text.trim(), 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * 抢 daemon 启动锁（板目录 .daemon-start.lock，O_EXCL 创建，内容为持有者 pid）
 * @param {string} rootPath - 板目录
 * @returns {Promise<() => Promise<void>>} 释放函数（幂等）
 * @throws {Error} 锁被活进程持有、或多次回收 stale 锁后仍被占用时
 *
 * @description
 * 锁只护「占用检查 → 写 .daemon.json → 写注册表」启动窗口：两个进程同时 start
 * 同一板目录时只有一个能进入，另一个报错；启动完成后的互斥由既有存活探测承担。
 * 锁已存在时读 pid 判活：活进程（含 EPERM）拒绝启动；死 pid（ESRCH）或内容
 * 不可读按崩溃残留的 stale 锁处理，回收后重试。
 */
async function acquireStartLock(rootPath) {
  const lockPath = path.join(rootPath, START_LOCK_FILE);
  for (let attempt = 0; attempt < START_LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let holderPid = await readStartLockPid(lockPath);
      if (holderPid === null) {
        // 持有者刚创建锁尚未写入 pid 的窗口：稍候重读一次再按 stale 处理
        await new Promise((resolve) => setTimeout(resolve, 50));
        holderPid = await readStartLockPid(lockPath);
      }
      if (holderPid !== null && isPidAlive(holderPid)) {
        throw new Error(
          `另一进程（pid ${holderPid}）正在启动该板目录的 daemon，请稍后重试。`,
        );
      }
      // stale 锁（持有进程已死或内容不可读）：回收后重试
      await fs.rm(lockPath, { force: true });
    }
  }
  throw new Error(t("err.daemonStartLockContention"));
}

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
 * 读取板目录下的 daemon 描述文件
 * @param {string} rootPath - 板目录
 * @returns {Promise<Object|null>} 描述；不存在或非法时为 null
 */
async function readDaemonDescriptor(rootPath) {
  try {
    const text = await fs.readFile(path.join(rootPath, DAEMON_FILE), "utf-8");
    const desc = JSON.parse(text);
    if (typeof desc?.port !== "number" || typeof desc?.source !== "string") {
      return null;
    }
    return desc;
  } catch {
    return null;
  }
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
 * @param {number} [options.idleExitMs] - 闲置自退出时长（毫秒）；缺省时 gui- 前缀名取 60s，其余名不启用
 * @returns {Promise<{name: string, rootPath: string, port: number, source: string, close: Function}>} daemon 句柄
 *
 * @description
 * 启动后登记注册表（~/.hound-whiteboard/daemons/<name>.json）并在板目录写入
 * `.daemon.json`（name/pid/port/source/boardId）。name 与存活 daemon 重复、
 * 板目录已被其它活 daemon 持有时拒绝启动。
 *
 * 启动全程持有板目录启动锁（.daemon-start.lock），「占用检查 → 写 .daemon.json →
 * 写注册表」窗口内两个并发 start 只有一个能进入；所有退出路径（含中途失败）都释放锁。
 */
async function startBoardDaemon(options) {
  const rootPath = options?.rootPath;
  if (typeof rootPath !== "string" || rootPath.trim() === "") {
    throw new Error(t("err.boardPathMissing"));
  }
  const releaseStartLock = await acquireStartLock(rootPath);
  try {
    return await startBoardDaemonLocked(options);
  } finally {
    await releaseStartLock();
  }
}

/**
 * 持锁执行 daemon 启动（startBoardDaemon 的内层，调用方必须已持有启动锁）
 * @param {Object} options - 启动选项（同 startBoardDaemon）
 * @returns {Promise<{name: string, rootPath: string, port: number, source: string, close: Function}>} daemon 句柄
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
  // 板目录占用检查：同一板目录只能被一个活 daemon 持有
  const existing = await readDaemonDescriptor(rootPath);
  if (existing && (await isDaemonAlive(existing.port))) {
    throw new Error(
      `板目录已有 daemon 在运行（端口 ${existing.port}，身份 ${existing.source}）。`,
    );
  }

  // 身份解析：显式 --source 优先；否则按注册表 name→source 映射（首启生成持久化，
  // 重启/停止后身份稳定）。daemon 不继承 GUI 身份（分片存储身份唯一化前提），
  // 也不回退设备身份（node 进程无 localStorage，设备身份在 daemon 内无法持久化）
  const source =
    typeof options.source === "string" && options.source !== ""
      ? options.source
      : await resolveDaemonIdentity(name);

  /**
   * 协作客户端表（WS 连接 → 来源标识；GUI 直连协作通道）
   * @type {Map<Object, string>}
   */
  const collabClients = new Map();

  // 日志流落盘判定：直连协作客户端的流由其自写（布局 v2 各写端只写自己的流），
  // daemon 落自己与 relay 远端来源的流
  const session = await openBoardSession(rootPath, {
    source,
    persistStream: (s) => ![...collabClients.values()].includes(s),
  });
  const collabIngestor = createRemoteRecordIngestor({
    boardCore: session.boardCore,
    boardApi: session.api,
    onReject: (error, record) => {
      console.warn(`[daemon] 隔离无法接入的记录 ${record.id}：${error.message}`);
    },
  });

  // 可选连中继：失败降级单机并每 3s 自动重试（中继可能后于 daemon 启动）；断线后同周期自动重连
  let coordinator = null;
  let amendForwarder = null;
  let relayRetryTimer = null;
  /**
   * daemon 已关闭：关闭后到达的 onDisconnect 不得再调度重试
   * @type {boolean}
   */
  let closed = false;
  /**
   * 共享关闭承诺，保证重复触发等待同一次清理
   * @type {Promise<void>|null}
   */
  let closePromise = null;
  const scheduleRelayRetry = () => {
    if (closed) return;
    if (relayRetryTimer !== null) return;
    relayRetryTimer = setTimeout(() => {
      relayRetryTimer = null;
      void connectRelay();
    }, 3000);
  };
  const connectRelay = async () => {
    if (closed) return;
    const next = createNetworkCoordinator({
      boardCore: session.boardCore,
      boardApi: session.api,
      url: options.relayUrl,
      boardId: options.boardId ?? rootPath,
      onAwareness: ({ source: remoteSource, data }) => {
        collabBroadcast({ type: "awareness", source: remoteSource, data });
      },
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
        sendAwareness: (data) => {
          coordinator?.sendAwareness(data);
          collabBroadcast({ type: "awareness", source, data });
        },
      });
      relayRetryTimer = null;
      console.log(
        `[daemon] 已连接中继：${options.relayUrl}（房间 ${options.boardId ?? rootPath}）`,
      );
    } catch {
      // 失败实例的日志订阅已挂上：清理后再调度重试，避免累积空转订阅
      await next.close();
      scheduleRelayRetry();
    }
  };
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

  const wss = new WebSocketServer({
    port: options.port ?? 0,
    host: options.host ?? "127.0.0.1",
  });
  await new Promise((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  const port = wss.address().port;

  // RPC 串行队列：并发客户端的写操作经队列逐个执行，invoke 与落盘不交错
  const queue = createQueue();

  /**
   * 创建者引用（start/hold 递增，release 递减；归零且无客户端连接时自动退出）
   * @type {number}
   */
  let ownerRefs = 1;

  /**
   * 客户端引用（GUI 协作长连接数，join/leave 自动管理）
   * @type {number}
   */
  let clientRefs = 0;

  /**
   * 闲置自退出时长（毫秒）；null 表示不启用
   * @description GUI spawn 的 daemon（`gui-` 前缀名，见 core-worker 的 guiDaemonNameFromPath）
   * 是 GUI 会话的附属物：GUI 异常关闭或宿主进程被杀时创建者引用来不及 release，
   * 无客户端连接的 daemon 空转无意义，闲置超时自退出兜底（仅剩 spawn 创建者引用时生效；
   * CLI hold 占住的不退）。join 接入即取消，断连后重新计时。
   * @type {number|null}
   */
  const idleExitMs =
    typeof options.idleExitMs === "number" && options.idleExitMs > 0
      ? options.idleExitMs
      : name.startsWith("gui-")
        ? GUI_DAEMON_IDLE_EXIT_MS
        : null;

  /**
   * 闲置自退出计时器
   * @type {ReturnType<typeof setTimeout>|null}
   */
  let idleExitTimer = null;

  /**
   * 取消闲置自退出计时
   * @returns {void}
   */
  const cancelIdleExit = () => {
    if (idleExitTimer !== null) {
      clearTimeout(idleExitTimer);
      idleExitTimer = null;
    }
  };

  /**
   * 评估并排定闲置自退出（无客户端且仅剩 spawn 创建者引用时启动倒计时）
   * @returns {void}
   */
  const scheduleIdleExit = () => {
    cancelIdleExit();
    if (idleExitMs === null || closed) return;
    if (clientRefs !== 0 || ownerRefs > 1) return;
    idleExitTimer = setTimeout(() => {
      idleExitTimer = null;
      // 到期复核：期间有客户端接入或 CLI hold 占住则不退
      if (closed || clientRefs !== 0 || ownerRefs > 1) return;
      console.log(
        `[daemon] 无客户端连接闲置 ${Math.round(idleExitMs / 1000)}s（GUI 会话已消失），自动退出`,
      );
      closeAndExit();
    }, idleExitMs);
  };

  /** @type {Function|null} 协作广播的本地记录订阅 */
  let unsubscribeCollabAppend = null;
  /** @type {Function|null} 协作广播的 activity 订阅 */
  let unsubscribeCollabActivity = null;
  /** @type {ReturnType<typeof setInterval>|null} 协作 digest 周期 */
  let collabDigestTimer = null;
  /** @type {Object|null} 注册表镜像条目（refCount 变化时更新） */
  let desc = null;

  /**
   * 把 refCount 镜像进注册表（status 展示用）
   * @returns {Promise<void>}
   */
  /** 总引用数（status 展示与归零判定） */
  const totalRefs = () => ownerRefs + clientRefs;

  /** 注册表镜像写队列（close 时先排空再删除条目，避免飞行中的写回复活条目） */
  let refSyncTail = Promise.resolve();

  const syncRefCount = () => {
    if (desc === null || closed) return refSyncTail;
    refSyncTail = refSyncTail
      .then(() => writeEntry({ ...desc, refCount: totalRefs() }))
      .catch(() => {});
    return refSyncTail;
  };

  /**
   * 引用归零检查：无创建者引用且无客户端连接时关闭退出
   * @returns {void}
   */
  const checkZeroAndExit = () => {
    if (ownerRefs === 0 && clientRefs === 0) {
      closeAndExit();
    }
  };

  /**
   * 广播消息给全部协作客户端（可排除来源，relay 房间语义）
   * @param {Object} message - 消息体
   * @param {?string} [exceptSource=null] - 排除的来源
   * @returns {void}
   */
  const collabBroadcast = (message, exceptSource = null) => {
    for (const [clientWs, clientSource] of collabClients) {
      if (clientSource === exceptSource) continue;
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify(message));
      }
    }
  };

  /**
   * 挂协作广播订阅（首个协作客户端 join 时）
   * @returns {void}
   */
  const attachCollabSubscriptions = () => {
    if (unsubscribeCollabAppend !== null) return;
    // 本端（含经 applyRemoteOperations 接入的）记录推送给协作客户端；
    // 来源为对端自己的记录不回环（对端 ingest 按来源去重）
    unsubscribeCollabAppend = session.boardCore.operationLog.onAppend((record) => {
      // 不按来源排除：同 source 重开会话的历史补发不能被误杀；
      // 回环记录由客户端 log.has 去重（见 ingestRecords）
      collabBroadcast({ type: "records", source, records: [record] });
    });
    unsubscribeCollabActivity = session.boardCore.activityEventBus.on(
      "activity",
      (event) => {
        const eventSource = event?.source ?? null;
        collabBroadcast(
          { type: "aom", source: eventSource ?? source, event },
          eventSource,
        );
      },
    );
    collabDigestTimer = setInterval(() => {
      collabBroadcast({
        type: "digest",
        source,
        digest: localDigest(),
      });
    }, 30000);
  };

  /**
   * 卸协作广播订阅（最后协作客户端离开时）
   * @returns {void}
   */
  const detachCollabSubscriptions = () => {
    unsubscribeCollabAppend?.();
    unsubscribeCollabAppend = null;
    unsubscribeCollabActivity?.();
    unsubscribeCollabActivity = null;
    if (collabDigestTimer !== null) {
      clearInterval(collabDigestTimer);
      collabDigestTimer = null;
    }
  };

  /**
   * 移除协作客户端（断开时：引用 -1，空表卸订阅）
   * @param {Object} ws - 连接
   * @returns {void}
   */
  const removeCollabClient = (ws) => {
    if (!collabClients.has(ws)) return;
    collabClients.delete(ws);
    releaseRemoteChannel(session.boardCore, session.api, ws);
    clientRefs = Math.max(0, clientRefs - 1);
    // 并发写注册表可能失败（tmp 冲突），镜像失败不影响进程内权威计数
    void syncRefCount().catch(() => {});
    if (collabClients.size === 0) {
      detachCollabSubscriptions();
    }
    scheduleIdleExit();
    checkZeroAndExit();
  };

  /**
   * 计算本端状态摘要（协作 digest 用，与协调器同款）
   * @returns {{logSize: number, head: ?string, objects: number, stateHash: string, openMols: number}} 摘要
   */
  const localDigest = () => ({
    logSize: session.boardCore.operationLog.size,
    head: session.boardCore.undoTree.head?.shareId ?? null,
    objects: session.boardCore.getAllObjects().length,
    chainHash: session.api.queryChainHash(),
    stateHash: session.api.queryStateHash(),
    fullResidency: session.boardCore.isFullResidency(),
    openMols: session.api.queryOpenMols().length,
  });

  /**
   * 计算本端各来源已连续追加的最大序号
   * @returns {Object<string, number>} 来源到最大序号的映射
   */
  const localLastSeen = () =>
    Object.fromEntries(maxSeqBySource(session.boardCore.operationLog.toJSON()));

  /**
   * 按请求方 lastSeen 过滤缺口记录（无 lastSeen 为全量）
   * @param {Object} [lastSeen] - 请求方各来源最大序号
   * @returns {Object[]} 缺口记录
   */
  const filterGapRecords = (lastSeen) => {
    const all = session.boardCore.operationLog.toJSON();
    if (!lastSeen || typeof lastSeen !== "object") return all;
    return all.filter((record) => {
      const parsed = parseOperationId(record.id);
      if (parsed === null) return false;
      return parsed.n > (lastSeen[record.source] ?? 0);
    });
  };

  /**
   * 处理协作 digest：日志落后时补缺口，派生链分歧时本地重建
   * @param {Object} digest - 对端摘要
   * @param {Object} ws - 对端连接
   * @returns {void}
   */
  const handleCollabDigest = (digest, ws) => {
    if (!digest || typeof digest.logSize !== "number") return;
    const local = localDigest();
    if (digest.logSize > local.logSize) {
      ws.send(
        JSON.stringify({
          type: "request-init",
          source,
          lastSeen: localLastSeen(),
          openMols: session.api.queryOpenMols(),
        }),
      );
      return;
    }
    if (digest.logSize === local.logSize && digest.head !== local.head) {
      ws.send(
        JSON.stringify({
          type: "request-init",
          source,
          lastSeen: localLastSeen(),
          openMols: session.api.queryOpenMols(),
        }),
      );
      return;
    }
    if (
      typeof digest.chainHash === "string" &&
      digest.logSize === local.logSize &&
      digest.head === local.head &&
      digest.chainHash !== local.chainHash
    ) {
      session.api.repairChainFromLog();
    }
  };

  /**
   * 处理协作消息（GUI 直连通道，relay 房间协议的单客户端版）
   * @param {Object} ws - 连接
   * @param {Object} message - 已解析消息
   * @returns {Promise<void>}
   */
  const handleCollabMessage = async (ws, message) => {
    switch (message.type) {
      case "join": {
        if (collabClients.has(ws)) return;
        if (typeof message.source !== "string" || message.source === "") return;
        resetRemoteSource(session.boardCore, session.api, message.source);
        collabClients.set(ws, message.source);
        clientRefs += 1;
        cancelIdleExit();
        await syncRefCount();
        ws.send(
          JSON.stringify({
            type: "joined",
            source: message.source,
            peers: [source],
          }),
        );
        // 老成员向新成员要缺口（relay 的 peer-joined 语义）
        ws.send(
          JSON.stringify({
            type: "request-init",
            source,
            lastSeen: localLastSeen(),
            openMols: session.api.queryOpenMols(),
          }),
        );
        attachCollabSubscriptions();
        return;
      }
      case "records": {
        if (!Array.isArray(message.records)) return;
        const validRecords = message.records.filter(
          (record) => validateOperation(record).length === 0,
        );
        for (const record of validRecords) {
          trackRemoteSource(session.boardCore, ws, record.source);
        }
        collabIngestor.ingest(validRecords);
        await session.flush();
        // 桥接进 relay 房间（若 daemon 连了中继）：GUI 的操作对远端可见
        coordinator?.sendRecords(validRecords);
        return;
      }
      case "aom": {
        if (message.event === undefined || message.event === null) return;
        const remoteSource = message.source ?? "collab";
        trackRemoteSource(session.boardCore, ws, remoteSource);
        session.api.applyRemoteActivity(message.event, remoteSource);
        return;
      }
      case "awareness": {
        if (message.data === undefined || message.data === null) return;
        const remoteSource = message.source ?? collabClients.get(ws) ?? "collab";
        coordinator?.sendAwareness(message.data);
        collabBroadcast(
          { type: "awareness", source: remoteSource, data: message.data },
          remoteSource,
        );
        return;
      }
      case "request-init": {
        const records = filterGapRecords(message.lastSeen);
        // 增量请求无缺口时不回应（降噪）；全量请求总是回应
        if (message.lastSeen && records.length === 0) return;
        ws.send(
          JSON.stringify({
            type: "respond-init",
            to: message.source,
            records,
            openMols: session.api.queryOpenMols(),
          }),
        );
        return;
      }
      case "respond-init": {
        if (Array.isArray(message.records) && message.records.length > 0) {
          for (const record of message.records) {
            trackRemoteSource(session.boardCore, ws, record?.source);
          }
          collabIngestor.ingest(message.records);
          await session.flush();
        }
        return;
      }
      case "digest":
        handleCollabDigest(message.digest, ws);
        return;
      default:
        return;
    }
  };

  /**
   * 关闭并退出进程（引用归零或强制停机共用；exitOnZero 关闭时只清理不退出，测试内嵌场景用）
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
        // 强制停机：响应后异步关闭（close 内部排空既有 RPC），不入队列避免自死锁
        ws.send(JSON.stringify({ id: message.id, ok: true, result: null }));
        closeAndExit();
        return;
      }
      if (closed) {
        if (typeof message?.id === "number" && typeof message?.route === "string") {
          ws.send(JSON.stringify({ id: message.id, ok: false, error: "daemon 正在关闭" }));
        }
        return;
      }
      if (message?.route === "daemon-hold") {
        // 创建者引用 +1（CLI 显式占住，防止 release 归零退出）
        ownerRefs += 1;
        cancelIdleExit();
        void syncRefCount();
        ws.send(JSON.stringify({ id: message.id, ok: true, result: { refCount: totalRefs() } }));
        return;
      }
      if (message?.route === "daemon-release") {
        // 创建者引用 -1；无引用且无客户端连接时自动退出
        ownerRefs = Math.max(0, ownerRefs - 1);
        void syncRefCount();
        ws.send(JSON.stringify({ id: message.id, ok: true, result: { refCount: totalRefs() } }));
        scheduleIdleExit();
        checkZeroAndExit();
        return;
      }
      if (typeof message?.id === "number" && typeof message?.route === "string") {
        queue.enqueue(() => handleRpcMessage(session, ws, message));
        return;
      }
      if (message?.type !== undefined) {
        // 协作消息（GUI 直连）：与 RPC 共用串行队列，invoke 与落盘不交错
        queue.enqueue(() => handleCollabMessage(ws, message));
      }
    });
    ws.on("close", () => removeCollabClient(ws));
    ws.on("error", () => removeCollabClient(ws));
  });

  desc = {
    name,
    rootPath,
    pid: process.pid,
    port,
    source,
    boardId: options.boardId ?? null,
    refCount: totalRefs(),
    startedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(rootPath, DAEMON_FILE),
    JSON.stringify(desc, null, 2),
    "utf-8",
  );
  // 注册表登记：CLI 按 name 定位 daemon
  await writeEntry(desc);

  // GUI 附属 daemon：启动即排闲置自退出（覆盖 spawn 后无人接入的孤儿场景，
  // 如 GUI 侧开板超时回退内存模式）；首个客户端 join 时取消
  scheduleIdleExit();

  const close = () => {
    if (closePromise !== null) return closePromise;
    closed = true;
    closePromise = (async () => {
      // 停止接收新任务后，再排空已接收的 RPC 与协作消息
      await queue.drain();
      detachCollabSubscriptions();
      collabIngestor.close();
      cancelIdleExit();
      if (relayRetryTimer !== null) {
        clearTimeout(relayRetryTimer);
        relayRetryTimer = null;
      }
      for (const ws of wss.clients) {
        try {
          // terminate 立即终止（close 是握手式，未完成握手的连接会让 wss.close 回调挂起）
          ws.terminate();
        } catch {
          /* 忽略单个客户端关闭失败 */
        }
      }
      await new Promise((resolve) => wss.close(resolve));
      amendForwarder?.close();
      if (coordinator) {
        await coordinator.close();
      }
      await session.flush();
      await session.close();
      // 排空镜像写再删除条目：飞行中的 writeEntry 会让条目复活
      await refSyncTail;
      await fs.rm(path.join(rootPath, DAEMON_FILE), { force: true });
      await removeEntry(name);
    })();
    return closePromise;
  };

  return { name, rootPath, port, source, close };
}

/**
 * 分发一条 RPC 消息（BoardApi routes + flush 落盘）
 * @param {Object} session - 板会话
 * @param {Object} ws - WebSocket 连接
 * @param {Object} message - 已解析的 RPC 消息（id 为 number、route 为 string 已校验）
 * @returns {Promise<void>}
 * @private
 */
async function handleRpcMessage(session, ws, message) {
  const { id, route, params } = message ?? {};
  const entry = BOARD_API_ROUTES[route];
  if (!entry) {
    ws.send(JSON.stringify({ id, ok: false, error: `未知 route：${route}` }));
    return;
  }
  try {
    const result = await entry.invoke(session.api, params ?? {});
    if (entry.flush === "sync" || entry.flush === "async") {
      // 响应前落盘：daemon 崩溃不丢操作；读命令直读时也能读到最新数据
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

export {
  startBoardDaemon,
  readDaemonDescriptor,
  DAEMON_FILE,
  START_LOCK_FILE,
  acquireStartLock,
  isDaemonAlive,
};
