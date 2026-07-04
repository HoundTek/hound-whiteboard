/**
 * @file Uniform Board API
 * @description
 * 通过 postMessage 与 Core Worker 通信，以真正异步的方式暴露 BoardApi 接口。
 * @module core/bridges/board-api
 * @author Zhou Chenyu
 */

/**
 * 判断值是否为可用的 RPC 端点
 * @param {*} endpoint - 待判断的端点对象
 * @returns {boolean} 是否满足 postMessage/addEventListener/removeEventListener 接口
 */
function isRpcEndpoint(endpoint) {
  return Boolean(
    endpoint &&
    typeof endpoint.postMessage === "function" &&
    typeof endpoint.addEventListener === "function" &&
    typeof endpoint.removeEventListener === "function",
  );
}

/**
 * 生成 RPC 消息 id
 * @returns {string} 新的消息 id
 */
function createRpcMessageId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

/**
 * 创建带错误码的 RPC Error
 * @param {string} message - 错误信息
 * @param {string} [code="RPC_ERROR"] - 错误码
 * @returns {Error} 带 code 字段的 Error 实例
 */
function createRpcError(message, code = "RPC_ERROR") {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * BoardApi RPC 实现
 * @class
 * @description
 * 通过 postMessage 与 Core Worker 通信，以真正异步的方式暴露 BoardApi 接口。
 * @author Zhou Chenyu
 */
class BoardApiRpc {
  /**
   * RPC 通信端点
   * @type {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }}
   */
  #endpoint;

  /**
   * 未完成的 RPC 请求表
   * @type {Map<string, { resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout> | null, method: string }>}
   */
  #pending;

  /**
   * 默认 RPC 超时时间
   * @type {number}
   */
  #timeoutMs;

  /**
   * ready 消息是否已到达
   * @type {boolean}
   */
  #ready;

  /**
   * ready Promise 的 resolve 函数
   * @type {Function | null}
   */
  #resolveReady;

  /**
   * ready Promise 的 reject 函数
   * @type {Function | null}
   */
  #rejectReady;

  /**
   * 等待 Worker ready 的 Promise
   * @type {Promise<void>}
   */
  #readyPromise;

  /**
   * 绑定后的消息监听器
   * @type {(event: MessageEvent | { data?: any }) => void}
   */
  #messageListener;

  /**
   * @param {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }} endpoint - Worker 或 MessagePort 端点
   * @param {{ timeoutMs?: number }} [options={}] - RPC 配置选项
   */
  constructor(endpoint, options = {}) {
    if (!isRpcEndpoint(endpoint)) {
      throw new TypeError(
        "BoardApiRpc requires an endpoint with postMessage/addEventListener/removeEventListener.",
      );
    }

    this.#endpoint = endpoint;
    this.#pending = new Map();
    this.#timeoutMs = options.timeoutMs ?? 5000;
    this.#ready = false;
    this.#resolveReady = null;
    this.#rejectReady = null;
    this.#readyPromise = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#readyPromise.catch(() => {});
    this.#messageListener = this.#handleEndpointMessage.bind(this);
    this.#endpoint.addEventListener("message", this.#messageListener);
  }

  /**
   * 当前 Worker 是否已发送 ready 消息
   * @returns {boolean} 是否已 ready
   */
  isReady() {
    return this.#ready;
  }

  /**
   * 等待 Worker 发送 ready 消息
   * @param {number} [timeoutMs=this.#timeoutMs] - 等待超时时间
   * @returns {Promise<void>} ready 后 resolve
   */
  waitUntilReady(timeoutMs = this.#timeoutMs) {
    if (this.#ready) {
      return Promise.resolve();
    }

    if (!(timeoutMs > 0)) {
      return this.#readyPromise;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(createRpcError("Worker ready timeout.", "RPC_READY_TIMEOUT"));
      }, timeoutMs);

      this.#readyPromise
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 处理端点消息
   * @param {MessageEvent | { data?: any }} event - 端点消息事件
   * @returns {void}
   */
  #handleEndpointMessage(event) {
    const message = event?.data;
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "ready") {
      this.#ready = true;
      this.#resolveReady?.();
      this.#resolveReady = null;
      this.#rejectReady = null;
      return;
    }

    if (message.type !== "rpc-response") {
      return;
    }

    const pendingEntry = this.#pending.get(message.msgId);
    if (!pendingEntry) {
      return;
    }

    if (pendingEntry.timer) {
      clearTimeout(pendingEntry.timer);
    }
    this.#pending.delete(message.msgId);

    if (message.error) {
      pendingEntry.reject(
        createRpcError(
          message.error.message ?? `RPC failed: ${pendingEntry.method}`,
          message.error.code ?? "RPC_ERROR",
        ),
      );
      return;
    }

    pendingEntry.resolve(message.result);
  }

  /**
   * 发送一条 RPC 请求
   * @param {string} method - RPC 方法名
   * @param {Record<string, any>} [params={}] - RPC 参数
   * @param {number} [timeoutMs=this.#timeoutMs] - 超时时间
   * @returns {Promise<any>} RPC 响应结果
   */
  #call(method, params = {}, timeoutMs = this.#timeoutMs) {
    const msgId = createRpcMessageId();

    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.#pending.delete(msgId);
              reject(createRpcError(`RPC timeout: ${method}`, "RPC_TIMEOUT"));
            }, timeoutMs)
          : null;

      this.#pending.set(msgId, {
        resolve,
        reject,
        timer,
        method,
      });

      this.#endpoint.postMessage({
        type: "rpc",
        msgId,
        method,
        params,
      });
    });
  }

  /**
   * 在 Worker 中创建 BoardCore
   * @param {{ width?: number, height?: number, rootPath?: string }} [options={}] - Board 初始化选项
   * @returns {Promise<{ ok: boolean }>} 创建结果
   */
  async createBoard(options = {}) {
    return this.#call("createBoard", options);
  }

  /**
   * 销毁 Worker 中的 BoardCore
   * @returns {Promise<{ ok: boolean }>} 销毁结果
   */
  async destroyBoard() {
    return this.#call("destroyBoard", {});
  }

  /**
   * 在 Core 侧创建对象实例，注册到 AOM 动态图
   * @param {string} type - 对象类型名（如 "StrokeObject" | "CircleObject"）
   * @param {import("../shared/board-api-types.js").CreateObjectProps} props - 创建属性
   * @returns {Promise<number>} 新对象的 objectId
   */
  async createObject(type, props) {
    return this.#call("createObject", { type, props });
  }

  /**
   * 修改单个对象的几何/样式属性
   * @param {number} objectId - 对象 id
   * @param {import("../shared/board-api-types.js").ObjectPatch} patch - 修改 patch
   * @returns {Promise<void>}
   */
  async modifyObject(objectId, patch) {
    return this.#call("modifyObject", { objectId, patch });
  }

  /**
   * 批量修改多个对象
   * @param {import("../shared/board-api-types.js").ObjectPatchEntry[]} patches - 批量 patch
   * @returns {Promise<void>}
   */
  async modifyObjects(patches) {
    return this.#call("modifyObjects", { patches });
  }

  /**
   * 向对象的列表属性追加元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {any[]} items - 追加的元素集合
   * @returns {Promise<void>}
   */
  async appendListItem(objectId, key, items) {
    return this.#call("appendListItem", { objectId, key, items });
  }

  /**
   * 替换对象列表属性中指定索引的元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @param {any} item - 新元素
   * @returns {Promise<void>}
   */
  async replaceListItem(objectId, key, index, item) {
    return this.#call("replaceListItem", { objectId, key, index, item });
  }

  /**
   * 删除对象列表属性中指定索引的元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @returns {Promise<void>}
   */
  async removeListItem(objectId, key, index) {
    return this.#call("removeListItem", { objectId, key, index });
  }

  /**
   * 永久删除对象集合
   * @param {number[]} objectIds - 要删除的对象 id 列表
   * @returns {Promise<void>}
   */
  async deleteObjects(objectIds) {
    return this.#call("deleteObjects", { objectIds });
  }

  /**
   * 将 AOM 动态图中的对象写回静态图
   * @param {number[]} objectIds - 要提交的对象 id 列表
   * @returns {Promise<void>}
   */
  async commitObjects(objectIds) {
    return this.#call("commitObjects", { objectIds });
  }

  /**
   * 将对象加入 AOM 动态图
   * @param {number[]} objectIds - 对象 id 列表
   * @returns {Promise<void>}
   */
  async addActiveObjects(objectIds) {
    return this.#call("addActiveObjects", { objectIds });
  }

  /**
   * 将对象从 AOM 动态图移除
   * @param {number[]} objectIds - 对象 id 列表
   * @returns {Promise<void>}
   */
  async discardActiveObjects(objectIds) {
    return this.#call("discardActiveObjects", { objectIds });
  }

  /**
   * 按 id 查询对象摘要
   * @param {number[]} ids - 对象 id 列表
   * @returns {Promise<import("../shared/types.js").ObjectSummary[]>} 对象摘要列表
   */
  async queryObjects(ids) {
    return this.#call("queryObjects", { ids });
  }

  /**
   * 按区块查询对象 id
   * @param {number[]} chunkIds - 区块 id 列表
   * @returns {Promise<number[]>} 对象 id 列表
   */
  async queryChunkObjects(chunkIds) {
    return this.#call("queryChunkObjects", { chunkIds });
  }

  /**
   * 在合并视图上执行命中查询
   * @param {import("../range/range.js").Range | import("./types.js").Rect} range - 命中范围
   * @param {string} [mode] - 命中模式
   * @returns {Promise<number[]>} 命中的 objectId 列表
   */
  async hitTest(range, mode) {
    return this.#call("hitTest", { range, mode });
  }

  /**
   * 在 Core 侧创建 MonitorCore 实例
   * @param {import("../shared/board-api-types.js").CreateMonitorOptions} options - 创建参数
   * @returns {Promise<void>}
   */
  async createMonitor(options) {
    return this.#call("createMonitor", { options });
  }

  /**
   * 销毁 Core 侧的 MonitorCore 实例
   * @param {string | number} monitorId - monitor 标识
   * @returns {Promise<void>}
   */
  async destroyMonitor(monitorId) {
    return this.#call("destroyMonitor", { monitorId });
  }

  /**
   * 执行撤销
   * @returns {Promise<void>}
   */
  async undo() {
    return this.#call("undo", {});
  }

  /**
   * 执行重做
   * @returns {Promise<void>}
   */
  async redo() {
    return this.#call("redo", {});
  }

  /**
   * 销毁 RPC 端点绑定并拒绝所有未完成请求
   * @param {string} [reason="BoardApiRpc destroyed."] - 销毁原因
   * @returns {void}
   */
  destroy(reason = "BoardApiRpc destroyed.") {
    this.#endpoint.removeEventListener("message", this.#messageListener);

    if (!this.#ready) {
      this.#rejectReady?.(createRpcError(reason, "RPC_DESTROYED"));
      this.#resolveReady = null;
      this.#rejectReady = null;
    }

    for (const [msgId, pendingEntry] of this.#pending) {
      if (pendingEntry.timer) {
        clearTimeout(pendingEntry.timer);
      }
      pendingEntry.reject(createRpcError(reason, "RPC_DESTROYED"));
      this.#pending.delete(msgId);
    }
  }
}

export { BoardApiRpc };
