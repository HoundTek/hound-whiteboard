/**
 * @file RPC Board API
 * @description
 * 通过 postMessage 与 Core Worker 通信，以真正异步的方式暴露 BoardApi 接口。
 * @module host/bridges/board-api-rpc
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
   * 当前帧内待合并发送的 RPC 条目缓冲
   * @type {Map<string, { method: string, objectId: string, patch?: Object, key?: string, items?: any[], index?: number, item?: any }>}
   */
  #batchBuffer;

  /**
   * 当前是否已有待 flush 的微任务
   * @type {boolean}
   */
  #batchPending;

  /**
   * 下一个批处理消息 id
   * @type {number}
   */
  #nextBatchId;

  /**
   * 批处理错误订阅者集合
   * @type {Set<Function>}
   */
  #batchErrorHandlers;

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
    this.#readyPromise.catch(() => { });
    this.#messageListener = this.#handleEndpointMessage.bind(this);
    this.#batchBuffer = new Map();
    this.#batchPending = false;
    this.#nextBatchId = 1;
    this.#batchErrorHandlers = new Set();
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

    if (message.type === "rpc-batch-error") {
      const errors = Array.isArray(message.errors) ? message.errors : [];
      for (const handler of this.#batchErrorHandlers) {
        try {
          handler(errors, message.batchId);
        } catch {
          // 订阅者异常不应中断消息分发
        }
      }
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
    // flush 失败（如端点已断开）必须立即 reject，避免请求悬挂到超时
    try {
      this.#flushBatchNow();
    } catch (error) {
      return Promise.reject(
        createRpcError(
          `Batch flush failed before ${method}: ${error?.message ?? String(error)}`,
          "RPC_FLUSH_ERROR",
        ),
      );
    }

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
   * @param {number} [timeoutMs] - 超时时间（缺省用实例默认；持久化首开含 daemon 拉起，应放宽）
   * @returns {Promise<{ ok: boolean }>} 创建结果
   */
  async createBoard(options = {}, timeoutMs) {
    return this.#call("createBoard", options, timeoutMs);
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
   * @param {import("../../kernel/types/board-api-types.js").CreateObjectProps} props - 创建属性
   * @returns {Promise<string>} 新对象的 objectId
   */
  async createObject(type, props) {
    return this.#call("createObject", { type, props });
  }

  /**
   * 修改单个对象的几何/样式属性
   * @description
   * fire-and-forget 批写：同帧合并入队即 resolve，不代表 Core 已应用；
   * Core 侧失败经 onBatchError 旁路上报。需要确认语义请改用 modifyObjects。
   * @param {string} objectId - 对象 id
   * @param {import("../../kernel/types/board-api-types.js").ObjectPatch} patch - 修改 patch
   * @returns {Promise<void>} 入队后 resolve
   */
  async modifyObject(objectId, patch) {
    const batchKey = `modifyObject:${objectId}`;
    const existing = this.#batchBuffer.get(batchKey);
    if (existing) {
      existing.patch = this.#mergePatches(existing.patch, patch);
    } else {
      this.#batchBuffer.set(batchKey, {
        method: "modifyObject",
        objectId,
        patch: { ...patch },
      });
    }
    this.#scheduleBatchFlush();
    return Promise.resolve();
  }

  /**
   * 批量修改多个对象
   * @param {import("../../kernel/types/board-api-types.js").ObjectPatchEntry[]} patches - 批量 patch
   * @returns {Promise<void>}
   */
  async modifyObjects(patches) {
    return this.#call("modifyObjects", { patches });
  }

  /**
   * 向对象的列表属性追加元素
   * @description
   * fire-and-forget 批写：同帧合并入队即 resolve，不代表 Core 已应用，语义同 modifyObject。
   * @param {string} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {any[]} items - 追加的元素集合
   * @returns {Promise<void>} 入队后 resolve
   */
  async appendListItem(objectId, key, items) {
    const batchKey = `appendListItem:${objectId}:${key}`;
    const existing = this.#batchBuffer.get(batchKey);
    if (existing) {
      existing.items.push(...items);
    } else {
      this.#batchBuffer.set(batchKey, {
        method: "appendListItem",
        objectId,
        key,
        items: [...items],
      });
    }
    this.#scheduleBatchFlush();
    return Promise.resolve();
  }

  /**
   * 替换对象列表属性中指定索引的元素
   * @description
   * fire-and-forget 批写：同帧合并入队即 resolve，不代表 Core 已应用，语义同 modifyObject。
   * @param {string} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @param {any} item - 新元素
   * @returns {Promise<void>} 入队后 resolve
   */
  async replaceListItem(objectId, key, index, item) {
    const batchKey = `replaceListItem:${objectId}:${key}:${index}`;
    this.#batchBuffer.set(batchKey, {
      method: "replaceListItem",
      objectId,
      key,
      index,
      item,
    });
    this.#scheduleBatchFlush();
    return Promise.resolve();
  }

  /**
   * 删除对象列表属性中指定索引的元素
   * @description
   * fire-and-forget 批写：同帧合并入队即 resolve，不代表 Core 已应用，语义同 modifyObject。
   * @param {string} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @returns {Promise<void>} 入队后 resolve
   */
  async removeListItem(objectId, key, index) {
    const batchKey = `removeListItem:${objectId}:${key}:${index}`;
    this.#batchBuffer.set(batchKey, {
      method: "removeListItem",
      objectId,
      key,
      index,
    });
    this.#scheduleBatchFlush();
    return Promise.resolve();
  }

  /**
   * 永久删除对象集合
   * @param {string[]} objectIds - 要删除的对象 id 列表
   * @param {Object} [options] - 删除选项（supraKey 指定超分子）
   * @returns {Promise<void>}
   */
  async deleteObjects(objectIds, options) {
    return this.#call("deleteObjects", { objectIds, options });
  }

  /**
   * 将 AOM 动态图中的对象写回静态图
   * @param {string[]} objectIds - 要提交的对象 id 列表
   * @param {Object} [options] - 提交选项（supraKey 指定超分子）
   * @returns {Promise<string[]>} 实际提交的对象 id 列表
   */
  async commitObjects(objectIds, options) {
    return this.#call("commitObjects", { objectIds, options });
  }

  /**
   * 将对象加入 AOM 动态图
   * @param {string[]} objectIds - 对象 id 列表
   * @param {Object} [options] - 选择选项（supraKey 指定超分子）
   * @returns {Promise<void>}
   */
  async addActiveObjects(objectIds, options) {
    return this.#call("addActiveObjects", { objectIds, options });
  }

  /**
   * 将对象从 AOM 动态图移除
   * @param {string[]} objectIds - 对象 id 列表
   * @param {Object} [options] - 选项（supraKey 指定超分子）
   * @returns {Promise<void>}
   */
  async discardActiveObjects(objectIds, options) {
    return this.#call("discardActiveObjects", { objectIds, options });
  }

  /**
   * 按 id 查询对象摘要
   * @param {string[]} ids - 对象 id 列表
   * @returns {Promise<import("../../kernel/types/types.js").ObjectSummary[]>} 对象摘要列表
   */
  async queryObjects(ids) {
    return this.#call("queryObjects", { ids });
  }

  /**
   * 按 id 查询对象详情
   * @description 返回体含几何数据快照，仅用于调试与命令行诊断。
   * @param {string[]} ids - 对象 id 列表
   * @returns {Promise<Object[]>} 对象详情列表
   */
  async queryObjectDetails(ids) {
    return this.#call("queryObjectDetails", { ids });
  }

  /**
   * 列出本端的命名选择
   * @returns {Promise<{ name: string, ids: string[] }[]>} 命名选择列表
   */
  async queryChoices() {
    return this.#call("queryChoices", {});
  }

  /**
   * 列出全部远程命名选择（awareness 查询面）
   * @returns {Promise<{ source: string, name: string|undefined, ids: string[] }[]>} 远程选择列表
   */
  async queryRemoteChoices() {
    return this.#call("queryRemoteChoices", {});
  }

  /**
   * 上报 UI 侧对象 id 池计数（随板元数据持久化）
   * @param {string} source - 来源标识
   * @param {number} counter - 已分配的最大计数
   * @returns {Promise<boolean>} 是否成功
   */
  async reportObjectIdCounter(source, counter) {
    return this.#call("reportObjectIdCounter", { source, counter });
  }

  /**
   * 读取 UI 侧对象 id 池计数表（重开板后续种）
   * @returns {Promise<Object<string, number>>} 各来源已分配的最大计数
   */
  async getObjectIdCounters() {
    return this.#call("getObjectIdCounters", {});
  }

  /**
   * 按区块查询对象 id
   * @param {number[]} chunkIds - 区块 id 列表
   * @returns {Promise<string[]>} 对象 id 列表
   */
  async queryChunkObjects(chunkIds) {
    return this.#call("queryChunkObjects", { chunkIds });
  }

  /**
   * 在合并视图上执行命中查询
   * @param {import("../../kernel/range/range.js").Range | import("../../kernel/types/types.js").Rect} range - 命中范围
   * @param {string} [mode] - 命中模式
   * @returns {Promise<string[]>} 命中的 objectId 列表
   */
  async hitTest(range, mode) {
    return this.#call("hitTest", { range, mode });
  }

  /**
   * 按橡皮轨迹擦除命中对象的数据
   * @description
   * 轨迹段有序且语义不可交换，不进批处理合并；
   * 作为非批处理 #call 会先同步清空批处理队列保序。
   * @param {{ points: Array<{x: number, y: number}>, radius: number, source?: string }} payload - 轨迹段、橡皮半径与来源标识
   * @returns {Promise<{ modified: string[], created: string[], deleted: string[] }>} 受影响对象 id 三组
   */
  async eraseData(payload, options) {
    return this.#call("eraseData", { ...payload, options });
  }

  /**
   * 在 Core 侧创建 ViewportCore 实例
   * @param {import("../../kernel/types/board-api-types.js").CreateViewportOptions} options - 创建参数
   * @returns {Promise<void>}
   */
  async createViewport(options) {
    return this.#call("createViewport", { options });
  }

  /**
   * 销毁 Core 侧的 ViewportCore 实例
   * @param {string | number} viewportId - viewport 标识
   * @returns {Promise<void>}
   */
  async destroyViewport(viewportId) {
    return this.#call("destroyViewport", { viewportId });
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
   * 开启一个超分子
   * @param {string} key - 超分子 key（调用方提供的会话标识）
   * @returns {Promise<void>}
   */
  async beginSupra(key) {
    return this.#call("beginSupra", { key });
  }

  /**
   * 闭合一个超分子
   * @param {string} key - 超分子 key
   * @returns {Promise<void>}
   */
  async endSupra(key) {
    return this.#call("endSupra", { key });
  }

  /**
   * 中止一个超分子（丢弃未闭合分子并逐个撤销已物化成员）
   * @param {string} key - 超分子 key
   * @returns {Promise<void>}
   */
  async abortSupra(key) {
    return this.#call("abortSupra", { key });
  }

  /**
   * 开启一个增量式分子（手势 begin）
   * @param {string[]} objectIds - 分子覆盖的对象 id 列表
   * @param {Object} [options] - 选项（supraKey 指定归属超分子；create 标记创建型分子）
   * @returns {Promise<string>} 分子 id
   */
  async beginMol(objectIds, options) {
    return this.#call("beginMol", { objectIds, options });
  }

  /**
   * 对进行中的分子施加增量修正（手势的每帧）
   * @description
   * fire-and-forget 批写：同帧同分子合并入队即 resolve，不代表 Core 已应用；
   * Core 侧失败经 onBatchError 旁路上报。确认式调用（endMol 等）发出前会先 flush 保序。
   * @param {string} molId - 分子 id
   * @param {Object<string, import("../../kernel/types/board-api-types.js").ObjectPatch>} patchesByObject - 对象 id -> 修改 patch
   * @returns {Promise<void>} 入队后 resolve
   */
  async amendMol(molId, patchesByObject) {
    const batchKey = `amendMol:${molId}`;
    const existing = this.#batchBuffer.get(batchKey);
    if (existing) {
      for (const [objectId, patch] of Object.entries(patchesByObject ?? {})) {
        existing.patchesByObject[objectId] = existing.patchesByObject[objectId]
          ? this.#mergePatches(existing.patchesByObject[objectId], patch)
          : { ...patch };
      }
    } else {
      const merged = {};
      for (const [objectId, patch] of Object.entries(patchesByObject ?? {})) {
        merged[objectId] = { ...patch };
      }
      this.#batchBuffer.set(batchKey, {
        method: "amendMol",
        molId,
        patchesByObject: merged,
      });
    }
    this.#scheduleBatchFlush();
    return Promise.resolve();
  }

  /**
   * 定稿一个增量式分子（end-amend 物化上链）
   * @param {string} molId - 分子 id
   * @returns {Promise<boolean>} 分子是否曾在进行中
   */
  async endMol(molId) {
    return this.#call("endMol", { molId });
  }

  /**
   * 中止一个增量式分子（丢弃 amend 流，实例还原到手势起点）
   * @param {string} molId - 分子 id
   * @returns {Promise<boolean>} 分子是否曾在进行中
   */
  async abortMol(molId) {
    return this.#call("abortMol", { molId });
  }

  /**
   * 查询本端未闭合的增量式分子清单（断线重连对账用）
   * @returns {Promise<Array<Object>>} 未闭合分子清单
   */
  async queryOpenMols() {
    return this.#call("queryOpenMols", {});
  }

  /**
   * 计算对象状态的确定性校验和（已驻留口径，同步 digest 用）
   * @returns {Promise<string>} 状态校验和
   */
  async queryStateHash() {
    return this.#call("queryStateHash", {});
  }

  /**
   * 计算活动链的确定性校验和（驻留无关，同步 digest 用）
   * @returns {Promise<string>} 活动链校验和
   */
  async queryChainHash() {
    return this.#call("queryChainHash", {});
  }

  /**
   * 查询时间回溯树结构（活动链、HEAD、可重做栈与节点视图）
   * @returns {Promise<Object>} 树结构
   */
  async queryUndoTree() {
    return this.#call("queryUndoTree", {});
  }

  /**
   * 从本端日志重放派生对象状态并对齐活体（效果层分歧自愈）
   * @returns {Promise<{ repaired: boolean, fixedIds: string[] }>} 修复结果
   */
  async repairStateFromLog() {
    return this.#call("repairStateFromLog", {});
  }

  /**
   * 发送调试请求到 Worker（fire-and-forget，不等待响应）
   * @param {string} query - 调试查询名（如 "chunkLoadState"）
   * @param {Record<string, any>} [extra={}] - 附加参数
   * @returns {void}
   */
  requestDebug(query, extra = {}) {
    this.#endpoint.postMessage({
      type: "debug-request",
      query,
      ...extra,
    });
  }

  /**
   * 强制 flush 当前批处理缓冲
   * @description
   * resolve 时机为缓冲消息已写入传输层，不代表 Core 已应用；
   * 用于页面隐藏前或关键读取前确保批写不滞留。
   * @returns {Promise<void>} 缓冲写入传输层后 resolve
   */
  flush() {
    this.#flushBatchNow();
    return Promise.resolve();
  }

  /**
   * 订阅批处理条目失败回执
   * @description
   * rpc-batch 为 fire-and-forget，单条目失败时 Worker 以 rpc-batch-error 回传，
   * 由本方法注册的订阅者接收；全部成功时不产生任何回传消息。
   * @param {(errors: Array<{ index: number, method: string, code: string, message: string }>, batchId: number) => void} handler - 错误处理器
   * @returns {Function} 取消订阅函数
   */
  onBatchError(handler) {
    this.#batchErrorHandlers.add(handler);
    return () => this.#batchErrorHandlers.delete(handler);
  }

  /**
   * 销毁 RPC 端点绑定并拒绝所有未完成请求
   * @param {string} [reason="BoardApiRpc destroyed."] - 销毁原因
   * @returns {void}
   */
  destroy(reason = "BoardApiRpc destroyed.") {
    this.#endpoint.removeEventListener("message", this.#messageListener);
    this.#batchErrorHandlers.clear();

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

  /**
   * 合并两次 modifyObject 的 patch
   * @param {Object} existing - 已有 patch
   * @param {Object} next - 新增 patch
   * @returns {Object} 合并后的 patch
   * @private
   */
  #mergePatches(existing, next) {
    const merged = { ...existing };

    if (next.position != null) {
      merged.position = next.position;
    }
    if (next.transform != null) {
      merged.transform = next.transform;
    }
    if (next.property != null) {
      merged.property = { ...(merged.property ?? {}), ...next.property };
    }
    if (next.data != null) {
      merged.data = { ...(merged.data ?? {}), ...next.data };
    }
    if (next.append != null) {
      // append 是增量：同 key 合并 items 按序累积（后帧覆盖会永久丢点）
      const existingAppend = merged.append;
      merged.append =
        existingAppend != null && existingAppend.key === next.append.key
          ? {
            key: next.append.key,
            items: [
              ...(existingAppend.items ?? []),
              ...(next.append.items ?? []),
            ],
          }
          : { key: next.append.key, items: [...(next.append.items ?? [])] };
    }

    return merged;
  }

  /**
   * 安排下一次微任务 flush
   * @returns {void}
   * @private
   */
  #scheduleBatchFlush() {
    if (this.#batchPending) {
      return;
    }

    this.#batchPending = true;
    Promise.resolve().then(() => this.#flushBatchNow());
  }

  /**
   * 同步 flush 当前批处理缓冲
   * @returns {void}
   * @private
   */
  #flushBatchNow() {
    if (this.#batchBuffer.size === 0) {
      return;
    }

    const entries = [...this.#batchBuffer.values()];
    this.#batchBuffer.clear();
    this.#batchPending = false;

    // 入队时已是目标形状（method + 各自参数字段），直接发送
    this.#endpoint.postMessage({
      type: "rpc-batch",
      batchId: this.#nextBatchId++,
      items: entries,
    });
  }
}

export { BoardApiRpc };
