/**
 * @file 日志跟随者
 * @description 订阅操作日志增长，合批后将新记录落为日志段，并把对象文件与板元数据对齐到当前白板状态。
 * @module kernel/store/journaler
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

/**
 * 创建日志跟随者
 * @param {Object} params - 参数
 * @param {import("../board/board-core.js").BoardCore} params.boardCore - 白板核心
 * @param {ReturnType<import("./session-store.js").createSessionStore>} params.store - 会话存储
 * @param {() => Object} [params.collectMeta] - 附加板元数据收集器（flush 时并入 board.json）
 * @param {(source: string) => boolean} [params.persistStream] - 日志流落盘判定（默认全落；GUI 只落本端流，daemon 不落直连客户端的流）
 * @param {boolean} [params.writeMeta=true] - 是否写本端元数据分片 meta/<source>.json（读会话置 false 保持零写盘）
 * @param {boolean} [params.removeMissing=true] - 是否移除「既非活动亦非 trash」的对象文件（部分驻留的 GUI 必须关闭，否则会误删未加载对象的文件）
 * @returns {Object} 跟随者操作面
 *
 * @description
 * 记录经 append 事件入队，微任务合批后自动落盘；flush 可显式等待排空。
 * 对象文件按当前白板状态调和（序列化比对，仅写差异），撤销/重做/远端记录引起的任何状态迁移统一收敛。
 * 写权仲裁（布局 v2）：远程活动对象（AOM isRemoteActive）不写不移除——写权属活动方；
 * 元数据按 source 分片（meta/<source>.json），board.json 创建时写一次后只读。
 */
/**
 * 按键排序的 JSON 序列化（键序无关的内容指纹）
 * @param {*} value - 任意可序列化值
 * @returns {string} 排序后的 JSON 文本
 */
function stringifySorted(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stringifySorted).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stringifySorted(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function createJournaler({ boardCore, store, collectMeta, persistStream, writeMeta = true, removeMissing = true }) {
  /** @type {(() => void)|null} 追加事件退订函数 */
  let unsubscribe = null;

  /** @type {Object[]} 待落盘记录队列 */
  let pendingRecords = [];

  /** @type {boolean} 是否已排定微任务 flush */
  let flushScheduled = false;

  /** @type {Promise<void>} flush 串行链 */
  let flushing = Promise.resolve();

  /** @type {{nextSegmentSeqBySource: Map<string, number>, lastTime: number, flushedSources: Set<string>}} 各源流的下一段序号、最新时间标记与本会话已代写的来源 */
  let state = {
    nextSegmentSeqBySource: new Map(),
    lastTime: 0,
    flushedSources: new Set(),
  };

  /** @type {?string} 已落盘板元数据的排序指纹（比对相同则跳过重写） */
  const lastMetaJson = new Map();

  /**
   * 已落盘对象的内容指纹
   * @type {Map<string, {location: "objects"|"trash", json: string}>}
   */
  const lastSync = new Map();

  /**
   * 已落盘区块元数据的内容指纹
   * @type {Map<number, string>}
   */
  const lastChunkSync = new Map();

  /**
   * 归一化 trash 条目（层位边集合转数组，使其可 JSON 序列化）
   * @param {Object} entry - trash 条目
   * @returns {Object} 归一化后的条目
   */
  const normalizeTrashEntry = (entry) => ({
    data: entry.data,
    chunks: (entry.chunks ?? []).map((c) => ({
      chunkId: c.chunkId,
      below: [...c.below],
      above: [...c.above],
    })),
  });

  /**
   * 将对象文件对齐到当前白板状态
   * @returns {Promise<void>}
   * @throws {Error} 对象写入或移除失败时抛出
   *
   * @description
   * 活动对象写入 objects/，trash 对象写入 trash/；内容或位置有变化才落盘；
   * 既非活动亦非 trash（如撤销新增）的对象从盘上移除（removeMissing 关闭时跳过——
   * 部分驻留的写端无法区分「未加载」与「已消失」）。
   * 远程活动对象（写权属活动方）整条跳过，不写不移除。
   */
  const reconcileObjects = async () => {
    const aom = boardCore.activeObjectManager;
    const liveIds = new Set();
    for (const obj of boardCore.getAllObjects()) {
      if (aom?.isRemoteActive?.(obj.id)) continue;
      const data = obj.serialize();
      const json = JSON.stringify(data);
      liveIds.add(obj.id);
      const prev = lastSync.get(obj.id);
      if (prev?.json === json && prev.location === "objects") continue;
      if ((await store.writeObject(data)) === false) {
        throw new Error("存储驱动写对象失败");
      }
      if (prev?.location === "trash" && (await store.removeTrashObject(obj.id)) === false) {
        throw new Error("存储驱动移除 trash 对象失败");
      }
      lastSync.set(obj.id, { location: "objects", json });
    }
    for (const [id, entry] of boardCore.trash) {
      if (aom?.isRemoteActive?.(id)) continue;
      const normalized = normalizeTrashEntry(entry);
      const json = JSON.stringify(normalized);
      const prev = lastSync.get(id);
      if (prev?.json === json && prev.location === "trash") continue;
      if ((await store.writeTrashEntry(normalized)) === false) {
        throw new Error("存储驱动写 trash 条目失败");
      }
      if (prev?.location === "objects" && (await store.removeObject(id)) === false) {
        throw new Error("存储驱动移除对象失败");
      }
      lastSync.set(id, { location: "trash", json });
    }
    if (!removeMissing) return;
    for (const [id, prev] of lastSync) {
      if (liveIds.has(id) || boardCore.trash.has(id)) continue;
      if (aom?.isRemoteActive?.(id)) continue;
      if (prev.location === "objects") {
        if ((await store.removeObject(id)) === false) {
          throw new Error("存储驱动移除对象失败");
        }
      } else if ((await store.removeTrashObject(id)) === false) {
        throw new Error("存储驱动移除 trash 对象失败");
      }
      lastSync.delete(id);
    }
  };

  /**
   * 将区块元数据文件对齐到当前层叠图状态
   * @returns {Promise<void>}
   * @throws {Error} 区块元数据写入失败时抛出
   */
  const reconcileChunks = async () => {
    for (const { chunk } of boardCore.chunkLoaded.values()) {
      if (!chunk?.objectManager) continue;
      const metadata = {
        tierGraph: chunk.objectManager.staticGraph.toArray(),
        objectCoverIndex: chunk.objectManager.serializeObjectCoverChunks(),
      };
      const json = JSON.stringify(metadata);
      if (lastChunkSync.get(chunk.id) === json) continue;
      if ((await store.writeChunkMetadata(chunk.id, metadata)) === false) {
        throw new Error("存储驱动写区块元数据失败");
      }
      lastChunkSync.set(chunk.id, json);
    }
  };

  /** @type {Set<string>} 处于连续写失败状态的日志流来源（进入时告警一次，恢复时告警一次） */
  const failedSources = new Set();

  /**
   * 执行一轮落盘：日志段（按 record.source 分流，persistStream 过滤）→ 对象调和 → 区块调和 → 板元数据
   * @returns {Promise<void>}
   * @throws {Error} 任一日志流、对象、区块或元数据写失败时抛出（失败项保留下轮重试，调用方可显式上报）
   *
   * @description
   * 落盘归属由 record.source 决定并经 persistStream 判定：daemon 落自己与 relay 远端来源的流
   * （直连客户端的流由其自写），GUI 只落本端流。
   * 写成功的记录才出队：写失败（返回 false 或抛错）的记录保留在队首下轮重试，
   * 不产生 per-source op-id 空洞（空洞会让重开时日志准入校验失败、板无法打开）。
   */
  const doFlush = async () => {
    /** @type {Error[]} 本轮写失败的明细 */
    const failures = [];
    if (pendingRecords.length > 0) {
      const records = pendingRecords;
      pendingRecords = [];
      const bySource = new Map();
      for (const record of records) {
        let group = bySource.get(record.source);
        if (group === undefined) {
          group = [];
          bySource.set(record.source, group);
        }
        group.push(record);
      }
      /** @type {Object[]} 写失败、留待下轮重试的记录（保持原序置于队首） */
      const retry = [];
      for (const [source, group] of bySource) {
        if (persistStream && !persistStream(source)) continue;
        const seq = state.nextSegmentSeqBySource.get(source) ?? 0;
        try {
          const used = await store.appendSegment(source, seq, group);
          if (used === false) {
            throw new Error("存储驱动写段失败");
          }
          state.nextSegmentSeqBySource.set(source, used + 1);
          // 代写该来源的流即承担其元数据分片（本盘上的计数与时间水位由此续号）
          state.flushedSources.add(source);
          if (failedSources.delete(source)) {
            console.error(`[journaler] 日志流 ${source} 落盘恢复`);
          }
        } catch (error) {
          retry.push(...group);
          failures.push(error instanceof Error ? error : new Error(String(error)));
          if (!failedSources.has(source)) {
            failedSources.add(source);
            console.error(
              `[journaler] 日志流 ${source} 写段失败，${group.length} 条记录保留下轮重试：${error?.message ?? error}`,
            );
          }
        }
      }
      // 失败记录回到队首（早于本轮 await 期间新到的记录），保持 per-source 序号连续
      if (retry.length > 0) {
        pendingRecords = retry.concat(pendingRecords);
      }
      for (const record of records) {
        if (typeof record.time === "number" && record.time > state.lastTime) {
          state.lastTime = record.time;
        }
      }
    }
    // 调和与元数据阶段各自独立容错：指纹未更新的项下轮自然重试，不阻断日志段落盘
    for (const [label, stage] of [
      ["对象调和", reconcileObjects],
      ["区块调和", reconcileChunks],
      ["元数据", writeSourceMetas],
    ]) {
      try {
        await stage();
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
        console.error(`[journaler] ${label}失败，下轮重试：${error?.message ?? error}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(failures.map((error) => error.message).join("；"));
    }
  };

  /**
   * 元数据分片落盘：本端 + 本会话代写过流的来源
   * @description 布局 v2：board.json 创建后只读，各写端只写自己负责的 meta/<source>.json；
   * 指纹比对，值不变不重写。
   * @returns {Promise<void>}
   * @throws {Error} 元数据分片写入失败时抛出
   */
  const writeSourceMetas = async () => {
    if (!writeMeta) return;
    const own = boardCore.source;
    const all = collectMeta?.() ?? {};
    for (const source of new Set([own, ...state.flushedSources])) {
      const meta = { lastTime: state.lastTime };
      const coreCounter = all.coreIdCounters?.[source];
      if (Number.isInteger(coreCounter)) {
        meta.coreIdCounters = { [source]: coreCounter };
      }
      const objectCounter = all.objectIdCounters?.[source];
      if (Number.isInteger(objectCounter)) {
        meta.objectIdCounters = { [source]: objectCounter };
      }
      const metaJson = stringifySorted(meta);
      if (metaJson !== lastMetaJson.get(source)) {
        if ((await store.writeSourceMeta(source, meta)) === false) {
          throw new Error("存储驱动写元数据分片失败");
        }
        lastMetaJson.set(source, metaJson);
      }
    }
  };

  /**
   * 显式排空：等待已排队的落盘完成
   * @description 内部串行链永不毒化：本轮失败经返回的 Promise 上抛给调用方，
   * 链本身捕获后续接（失败明细见 doFlush 的告警与返回值）。
   * @returns {Promise<void>}
   */
  const flush = () => {
    const round = flushing.then(doFlush);
    flushing = round.catch(() => {});
    return round;
  };

  /**
   * 微任务合批调度
   * @returns {void}
   */
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      void flush().catch((error) => {
        console.error(`[journaler] 自动落盘失败：${error?.message ?? error}`);
      });
    });
  };

  return {
    /**
     * 挂接到白板核心
     * @param {Object} [options] - 挂接选项
     * @param {Object<string, number>} [options.nextSegmentSeqBySource={}] - 各源流的下一个可用段序号（打开既有板时由存储读出）
     * @param {number} [options.lastTime=0] - 已落盘的最晚时间标记
     * @param {Object[]} [options.knownObjects=[]] - 盘上已有活动对象数据（指纹种子，避免首 flush 重写）
     * @param {Object[]} [options.knownTrash=[]] - 盘上已有 trash 条目（指纹种子）
     * @param {Object<string, Object>} [options.knownSourceMeta=null] - 盘上各来源的元数据分片（首轮比对种子）
     * @param {Array<{chunkId: number, tierGraph: Array, objectCoverIndex: Array}>} [options.knownChunkMetadata=[]] - 盘上区块元数据（指纹种子，避免首 flush 重写）
     * @returns {void}
     */
    attach({ nextSegmentSeqBySource = {}, lastTime = 0, knownObjects = [], knownTrash = [], knownSourceMeta = null, knownChunkMetadata = [] } = {}) {
      if (unsubscribe !== null) {
        throw new Error("journaler 已挂接");
      }
      state = {
        nextSegmentSeqBySource: new Map(Object.entries(nextSegmentSeqBySource)),
        lastTime,
        flushedSources: new Set(),
      };
      for (const data of knownObjects) {
        lastSync.set(data.id, { location: "objects", json: JSON.stringify(data) });
      }
      for (const entry of knownTrash) {
        // trash 条目的 id 在 entry.data.id（条目为 {data, chunks} 形状）
        lastSync.set(entry.data.id, {
          location: "trash",
          json: JSON.stringify(entry),
        });
      }
      if (knownSourceMeta !== null && typeof knownSourceMeta === "object") {
        lastMetaJson.clear();
        for (const [source, meta] of Object.entries(knownSourceMeta)) {
          lastMetaJson.set(source, stringifySorted(meta));
        }
      }
      for (const metadata of knownChunkMetadata) {
        // 种子与写入形状一致（键序固定），避免首 flush 因键序差异重写
        lastChunkSync.set(
          metadata.chunkId,
          JSON.stringify({
            tierGraph: metadata.tierGraph ?? [],
            objectCoverIndex: metadata.objectCoverIndex ?? [],
          }),
        );
      }
      unsubscribe = boardCore.operationLog.onAppend((record) => {
        pendingRecords.push(record);
        scheduleFlush();
      });
    },

    /**
     * 显式排空落盘队列
     * @returns {Promise<void>}
     */
    flush,

    /**
     * 卸接：退订并排空
     * @returns {Promise<void>}
     */
    async detach() {
      unsubscribe?.();
      unsubscribe = null;
      await flush();
    },

    /**
     * 待落盘记录数
     * @type {number}
     */
    get pendingCount() {
      return pendingRecords.length;
    },
  };
}

export { createJournaler };
