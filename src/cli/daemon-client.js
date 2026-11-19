/**
 * @file daemon / owner RPC 客户端
 * @description 按 daemon name、板目录描述或 owner claim 连接 WebSocket RPC；提供与 BoardApi 同契约的会话面。
 * @module cli/daemon-client
 * @author Zhou Chenyu
 */

import { readDaemonDescriptor } from "./board-daemon.js";
import { readEntry, isEntryAlive } from "./daemon-registry.js";
import { t } from "./i18n.js";

/** 单次调用的超时毫秒数 */
const INVOKE_TIMEOUT_MS = 10000;
/** 连接 daemon / owner 的超时毫秒数 */
const CONNECT_TIMEOUT_MS = 5000;

/**
 * 建立并等待 WebSocket 连接
 * @param {string} url - WS 地址
 * @returns {Promise<WebSocket|null>} 已连接 socket；超时或失败时为 null
 */
function openSocket(url) {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* 忽略 */
      }
      resolve(null);
    }, CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * 发送 token 首帧并等待鉴权结果
 * @param {WebSocket} ws - 已连接 socket
 * @param {string} token - owner token
 * @returns {Promise<boolean>} 是否鉴权成功
 */
function authenticate(ws, token) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      resolve(ok);
    };
    const onMessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message?.ok === true) finish(true);
      else if (message?.ok === false) finish(false);
    };
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.send(JSON.stringify({ token }));
  });
}

/**
 * 创建 RPC 会话面
 * @param {{ url: string, token?: string, source?: string, rootPath?: string }} options - 连接选项
 * @returns {Promise<Object|null>} 会话面（api/source/rootPath/close）；连不上或鉴权失败时为 null
 *
 * @description
 * 无 token 时按 daemon 协议直连；有 token 时先发 `{token}` 并等待 `{ok:true}`。
 * 每次请求携带调用方 source，owner 端据此切换 HitCommitter。
 */
async function createRpcSession({ url, token, source, rootPath }) {
  const ws = await openSocket(url);
  if (!ws) return null;
  if (typeof token === "string" && token !== "") {
    const authenticated = await authenticate(ws, token);
    if (!authenticated) {
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      return null;
    }
  }

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const entry = pending.get(message?.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) {
      entry.resolve(message.result);
    } else {
      entry.reject(new Error(message.error ?? "RPC 调用失败"));
    }
  });

  /**
   * 发送一次 RPC 调用
   * @param {string} route - route 名
   * @param {Object} [params={}] - 参数
   * @returns {Promise<*>} 结果
   */
  function invoke(route, params = {}) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC 调用超时：${route}`));
      }, INVOKE_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      const request = { id, route, params };
      if (typeof source === "string" && source !== "") {
        request.source = source;
      }
      ws.send(JSON.stringify(request));
    });
  }

  return {
    source,
    rootPath,
    api: {
      addObject: (type, props) => invoke("addObject", { type, props }),
      deleteObjects: (ids) => invoke("deleteObjects", { objectIds: ids }),
      undo: (targetNodeId) =>
        invoke("undo", targetNodeId != null ? { targetNodeId } : {}),
      redo: () => invoke("redo", {}),
      queryBoardInfo: () => invoke("queryBoardInfo", {}),
      queryObjectList: () => invoke("queryObjectList", {}),
      queryObject: (objectId) => invoke("queryObject", { objectId }),
      queryOperations: (options) => invoke("queryOperations", options ?? {}),
      queryUndoTree: () => invoke("queryUndoTree", {}),
      queryObjects: (ids) => invoke("queryObjects", { ids }),
      queryObjectDetails: (ids) => invoke("queryObjectDetails", { ids }),
      queryChoices: () => invoke("queryChoices", {}),
      addActiveObjects: (ids, options) =>
        invoke("addActiveObjects", { objectIds: ids, options }),
      discardActiveObjects: (ids, options) =>
        invoke("discardActiveObjects", { objectIds: ids, options }),
      commitObjects: (ids, options) =>
        invoke("commitObjects", { objectIds: ids, options }),
      modifyObject: (objectId, patch) =>
        invoke("modifyObject", { objectId, patch }),
      modifyObjects: (patches) => invoke("modifyObjects", { patches }),
      beginSupra: (key) => invoke("beginSupra", { key }),
      endSupra: (key) => invoke("endSupra", { key }),
      abortSupra: (key) => invoke("abortSupra", { key }),
      queryOpenMols: () => invoke("queryOpenMols", {}),
      shutdown: () => invoke("daemon-shutdown", {}),
      hold: () => invoke("daemon-hold", {}),
      release: () => invoke("daemon-release", {}),
    },
    close() {
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
    },
  };
}

/**
 * 连接一个 daemon 描述对象
 * @param {Object} desc - daemon 描述（含 port/source/rootPath）
 * @returns {Promise<Object|null>} 会话面（api/source/rootPath/close）；连不上时为 null
 *
 * @description
 * 会话面 api 的方法与 BoardApi 同契约，经 RPC 转发；rootPath 为 daemon 持有的板目录
 * （choice buffer 等板目录侧文件操作凭此定位）。
 */
async function connectDescriptor(desc) {
  return createRpcSession({
    url: `ws://127.0.0.1:${desc.port}`,
    source: desc.source,
    rootPath: desc.rootPath,
  });
}

/**
 * 按 daemon name 连接（注册表寻址）
 * @param {string} name - daemon 名
 * @returns {Promise<Object|null>} 会话面；注册表无条目或连不上时为 null
 */
async function connectDaemonByName(name) {
  const desc = await readEntry(name);
  if (desc === null) return null;
  const session = await connectDescriptor(desc);
  if (session === null) return null;
  return session;
}

/**
 * 连接板目录的持有 daemon（板目录 .owner.json 的 daemon transport 寻址）
 * @param {string} rootPath - 板目录
 * @returns {Promise<Object|null>} 会话面；板无持有 daemon 或连不上时为 null
 */
async function connectDaemonByPath(rootPath) {
  const desc = await readDaemonDescriptor(rootPath);
  if (desc === null) return null;
  const session = await connectDescriptor(desc);
  if (session === null) return null;
  return session;
}

/**
 * 停止一个 daemon（发 daemon-shutdown route，等待其清理退出）
 * @param {string} name - daemon 名
 * @returns {Promise<boolean>} 是否成功停止
 * @throws {Error} 注册表无该 daemon 或已不存活时
 *
 * @description
 * daemon 收到停机指令后排空 in-flight RPC、清理描述与注册表条目后退出；
 * 客户端等待注册表条目消失确认停机完成。
 */
async function shutdownDaemon(name) {
  const desc = await readEntry(name);
  if (desc === null) {
    throw new Error(t("err.daemonNotRegistered", { name }));
  }
  if (!(await isEntryAlive(desc))) {
    throw new Error(
      t("err.daemonStoppedUnreachable", { name, port: desc.port }),
    );
  }
  const session = await connectDescriptor(desc);
  if (session === null) {
    throw new Error(t("err.daemonConnectFailed", { name, port: desc.port }));
  }
  try {
    await session.api.shutdown();
  } finally {
    session.close();
  }
  // 等待 daemon 清理注册表条目（异步清理，轮询确认）
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await readEntry(name)) === null) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export {
  createRpcSession,
  connectDaemonByName,
  connectDaemonByPath,
  shutdownDaemon,
};
