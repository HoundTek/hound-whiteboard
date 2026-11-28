/**
 * @file 白板投影协调器
 * @description 连接活动链应然投影与 BoardCore 物化摘要，提供局部分歧定位和定点重捕。
 * @module kernel/projection/board-projection
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { DerivedBoardProjection } from "./derived-board-projection.js";
import { MaterializedBoardProjection } from "./materialized-board-projection.js";
import { collectRecordChunkIds } from "../api/undo-transition.js";
import { CHUNK_LOAD_EVENTS } from "../chunk/chunk-loader.js";

/**
 * 白板投影协调器
 * @class
 * @author Zhou Chenyu
 */
class BoardProjection {
  /**
   * 白板核心
   * @type {import("../board/board-core.js").BoardCore}
   * @private
   */
  #boardCore;

  /**
   * 应然投影
   * @type {DerivedBoardProjection}
   * @private
   */
  #derived;

  /**
   * 物化摘要
   * @type {MaterializedBoardProjection}
   * @private
   */
  #materialized;

  /**
   * 待重捕对象 id
   * @type {Set<string>}
   * @private
   */
  #pendingObjectIds = new Set();

  /**
   * 待重捕区块 id
   * @type {Set<number>}
   * @private
   */
  #pendingChunkIds = new Set();

  /**
   * 已排定的微任务重捕
   * @type {Promise<void>|null}
   * @private
   */
  #scheduledCapture = null;

  /**
   * 构造投影协调器
   * @param {import("../board/board-core.js").BoardCore} boardCore - 白板核心
   * @param {{onChunkLoad?: (chunkId: number) => void}} [options] - 区块加载回调
   */
  constructor(boardCore, { onChunkLoad } = {}) {
    this.#boardCore = boardCore;
    this.#derived = new DerivedBoardProjection({
      width: boardCore.width,
      height: boardCore.height,
    });
    this.#derived.rebuild(this.#activeRecords());
    this.#materialized = new MaterializedBoardProjection(boardCore, this.#derived);
    this.refreshMaterialized();
    boardCore.undoTree.onActiveChainChange((change) => {
      this.#derived.applyTransition(change);
      this.#scheduleCapture([...change.removed, ...change.added]);
    });
    boardCore.chunkLoadEventBus.on(CHUNK_LOAD_EVENTS.LOAD_COMPLETE, ({ chunkId }) => {
      onChunkLoad?.(chunkId);
      const chunk = boardCore.getChunkById(chunkId);
      const objectIds = chunk?.objectManager?.staticGraph.getNodes() ?? [];
      this.refreshMaterialized({ objectIds, chunkIds: [chunkId] });
    });
  }

  /**
   * 应然对象状态根哈希
   * @type {string}
   */
  get derivedStateHash() {
    return this.#derived.stateHash;
  }

  /**
   * 物化对象状态根哈希
   * @type {string}
   */
  get stateHash() {
    this.#capturePendingNow();
    return this.#materialized.stateHash;
  }

  /**
   * 应然层序根哈希
   * @type {string}
   */
  get derivedLayerHash() {
    return this.#derived.layerHash;
  }

  /**
   * 物化层序根哈希
   * @type {string}
   */
  get layerHash() {
    this.#capturePendingNow();
    return this.#materialized.layerHash;
  }

  /**
   * 找出应然与物化静态图不同的区块
   * @returns {number[]} 分歧区块 id
   */
  diffLayerKeys() {
    this.#capturePendingNow();
    return this.#derived.getLayerHashes()
      .diffKeys(this.#materialized.getLayerHashes())
      .map(Number);
  }

  /**
   * 读取应然区块静态图
   * @param {number} chunkId - 区块 id
   * @returns {import("../utils/directed-graph.js").DirectedGraph|undefined} 静态图
   */
  getDerivedGraph(chunkId) {
    return this.#derived.getGraph(chunkId);
  }

  /**
   * 从当前活动链重建应然投影
   * @returns {void}
   */
  rebuildDerived() {
    this.#derived.rebuild(this.#activeRecords());
    this.refreshMaterialized();
  }

  /**
   * 找出应然与物化状态不同的对象
   * @returns {string[]} 分歧对象 id
   */
  diffStateKeys() {
    this.#capturePendingNow();
    return this.#derived.getStateHashes().diffKeys(this.#materialized.getStateHashes());
  }

  /**
   * 读取应然对象投影
   * @param {string} id - 对象 id
   * @returns {Object} 对象投影
   */
  getDerivedObject(id) {
    return this.#derived.getObject(id);
  }

  /**
   * 重捕实际物化状态
   * @param {{objectIds?: Iterable<string>, chunkIds?: Iterable<number>}} [options] - 定点重捕选项
   * @returns {void}
   */
  refreshMaterialized(options = {}) {
    this.#materialized.refresh(options);
  }

  /**
   * 等待已排定的物化重捕完成
   * @returns {Promise<void>}
   */
  async flush() {
    if (this.#scheduledCapture !== null) await this.#scheduledCapture;
    this.#capturePendingNow();
  }

  /**
   * 导出当前活动记录
   * @returns {import("../hit/operation.js").OperationRecord[]} 活动记录
   * @private
   */
  #activeRecords() {
    const { undoTree, operationLog } = this.#boardCore;
    return undoTree.getActiveChain().flatMap((node) =>
      node.memberIds.map((id) => operationLog.get(id)).filter(Boolean),
    );
  }

  /**
   * 将记录影响范围排入微任务重捕
   * @param {import("../hit/operation.js").OperationRecord[]} records - 变化记录
   * @returns {void}
   * @private
   */
  #scheduleCapture(records) {
    for (const record of records) {
      if (typeof record.payload?.objectId === "string") {
        this.#pendingObjectIds.add(record.payload.objectId);
      }
    }
    for (const chunkId of collectRecordChunkIds(this.#boardCore, records)) {
      this.#pendingChunkIds.add(chunkId);
    }
    if (this.#scheduledCapture === null) {
      this.#scheduledCapture = Promise.resolve()
        .then(() => this.#capturePendingNow())
        .finally(() => {
          this.#scheduledCapture = null;
        });
    }
  }

  /**
   * 同步重捕当前待处理范围
   * @returns {void}
   * @private
   */
  #capturePendingNow() {
    if (this.#pendingObjectIds.size === 0 && this.#pendingChunkIds.size === 0) return;
    const objectIds = [...this.#pendingObjectIds];
    const chunkIds = [...this.#pendingChunkIds];
    this.#pendingObjectIds.clear();
    this.#pendingChunkIds.clear();
    this.refreshMaterialized({ objectIds, chunkIds });
  }
}

export { BoardProjection };
