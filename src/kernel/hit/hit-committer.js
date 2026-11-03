/**
 * @file hit 提交器
 * @description 分子操作的 commit 边界单点：统一构造记录、分配 id 与单调时间、入日志并应用到树；三级容器模型的超分子句柄与分子/超分子 id 分配。
 * @module kernel/hit/hit-committer
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import {
  createAddObjectOperation,
  createModifyObjectOperation,
  createDeleteObjectOperation,
  createChooseObjectOperation,
  createUnchooseObjectOperation,
  createUndoOperation,
  createRedoOperation,
  createCloseSupraOperation,
  makeMoleculeId,
  parseMoleculeId,
  makeSupraId,
  parseSupraId,
} from "./operation.js";

/**
 * hit 提交器
 * @description
 * 分子操作的 commit 边界单点。白板效果执行后，调用方把效果摘要交给提交器，
 * 由提交器统一完成：构造分子操作记录（id、单调时间标记、本地视角父节点、超分子关联）、
 * 入操作日志、应用到时间回溯树（HEAD 随结构自然移动）。
 * 三级容器模型：超分子按键（supraKey）开启；开启期间指定该 key 的增加节点类提交
 * 即时物化上链（记录携带 supraId），不再缓冲草稿；endSupra(key) 追加 close-supra 记录，
 * 树构建把活动链上同 supraId 的连续节点段折叠为聚合节点。未指定 key 的提交永远独立成录。
 * 分子 id（molId）与超分子 id（supraId）由提交器分配，计数器从日志重放扫描续号（不落盘）。
 * @class
 * @author Zhou Chenyu
 */
class HitCommitter {
  /**
   * 发起者标识（hit 节点的 author）
   * @type {string}
   */
  #source;

  /**
   * 操作日志
   * @type {import("./operation-log.js").OperationLog}
   */
  #log;

  /**
   * 时间回溯树
   * @type {import("./undo-tree-core.js").UndoTree}
   */
  #tree;

  /**
   * 物理时间来源
   * @type {() => number}
   */
  #now;

  /**
   * 本 source 已发出的最晚时间标记
   * @type {number}
   */
  #lastTime = 0;

  /**
   * 开启中的超分子（key → 句柄）
   * @type {Map<string, { supraId: string }>}
   */
  #supras = new Map();

  /**
   * 本 source 的分子序号（重放续号）
   * @type {number}
   */
  #molSeq = 0;

  /**
   * 本 source 的超分子序号（重放续号）
   * @type {number}
   */
  #supraSeq = 0;

  /**
   * 构造 hit 提交器
   * @param {Object} options - 配置项
   * @param {string} options.source - 发起者标识
   * @param {import("./operation-log.js").OperationLog} options.log - 操作日志
   * @param {import("./undo-tree-core.js").UndoTree} options.tree - 时间回溯树
   * @param {() => number} [options.now] - 物理时间来源，缺省 Date.now
   * @param {number} [options.lastTime] - 本 source 已发出的最晚时间标记（恢复续号）
   */
  constructor({ source, log, tree, now, lastTime }) {
    this.#source = source;
    this.#log = log;
    this.#tree = tree;
    this.#now = now ?? (() => Date.now());
    this.#lastTime = lastTime ?? 0;
    // 分子/超分子序号从日志重放扫描续号：崩溃恢复后不撞号；
    // 未物化分子的 molId 无记录引用，复用无害
    for (const record of log.toArray()) {
      const molParts = parseMoleculeId(record.molId);
      if (molParts !== null && molParts.source === source) {
        this.#molSeq = Math.max(this.#molSeq, molParts.n);
      }
      const supraParts = parseSupraId(record.supraId)
        ?? parseSupraId(record.payload?.supraId);
      if (supraParts !== null && supraParts.source === source) {
        this.#supraSeq = Math.max(this.#supraSeq, supraParts.n);
      }
    }
  }

  /**
   * 发起者标识
   * @type {string}
   */
  get source() {
    return this.#source;
  }

  /**
   * 某 key 的超分子是否开启中
   * @param {string} key - 超分子 key
   * @returns {boolean} 是否开启中
   */
  hasSupra(key) {
    return this.#supras.has(key);
  }

  /**
   * 查询开启中超分子的 id
   * @param {string} key - 超分子 key
   * @returns {?string} 超分子 id；未开启时为 null
   */
  getSupraId(key) {
    return this.#supras.get(key)?.supraId ?? null;
  }

  /**
   * 分配一个分子 id（增量式分子的标识，amend 流与分子记录对齐）
   * @returns {string} 分子 id，形如 `"{source}/mol-{n}"`
   */
  allocateMolId() {
    this.#molSeq += 1;
    return makeMoleculeId(this.#source, this.#molSeq);
  }

  /**
   * 开启一个超分子
   * @description 分配 supraId 并建句柄；开启期间指定该 key 的提交即时物化并携带 supraId。
   * 谁开启谁关闭；调用方须保证闭合（finally）。
   * @param {string} key - 超分子 key（调用方提供的会话标识，可跨通道序列化）
   * @returns {string} 分配的超分子 id
   * @throws {Error} 该 key 已开启时抛出
   */
  beginSupra(key) {
    if (this.#supras.has(key)) {
      throw new Error(`超分子 ${key} 已开启（重复开启）`);
    }
    this.#supraSeq += 1;
    const supraId = makeSupraId(this.#source, this.#supraSeq);
    this.#supras.set(key, { supraId });
    return supraId;
  }

  /**
   * 闭合一个超分子：追加 close-supra 记录（树构建据此折叠活动链上的成员连续段）
   * @description 成员不足两条（空组/单成员）的超分子不产生闭合记录——折叠是恒等。
   * @param {string} key - 超分子 key
   * @returns {?import("./operation.js").OperationRecord} close-supra 记录；空超分子为 null
   * @throws {Error} 该 key 未开启时抛出
   */
  endSupra(key) {
    const supra = this.#supras.get(key);
    if (supra === undefined) {
      throw new Error(`超分子 ${key} 未开启（闭合者与开启者不一致）`);
    }
    this.#supras.delete(key);
    // 单成员超分子的折叠是恒等（单节点段不折叠），不产生闭合记录
    if (this.#log.getSupraIdMembers(supra.supraId).length < 2) {
      return null;
    }
    return this.#emit(createCloseSupraOperation, { supraId: supra.supraId });
  }

  /**
   * 中止一个超分子：销毁句柄并返回 supraId
   * @description 已物化成员的逐个撤销由调用方（BoardApi）凭 supraId 编排；
   * 成员已不在活动链上时退化为纯句柄清理（不产生任何记录）。
   * @param {string} key - 超分子 key
   * @returns {string} 被中止的超分子 id
   * @throws {Error} 该 key 未开启时抛出
   */
  abortSupra(key) {
    const supra = this.#supras.get(key);
    if (supra === undefined) {
      throw new Error(`超分子 ${key} 未开启（中止者与开启者不一致）`);
    }
    this.#supras.delete(key);
    return supra.supraId;
  }

  /**
   * 提交增加对象分子操作
   * @param {Object} effect - 效果摘要
   * @param {string} effect.chunkId - 区块 id
   * @param {string} effect.objectId - 对象 id
   * @param {Object} effect.data - 对象全量内容（可 JSON 序列化）
   * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} [effect.chunks] - 提交时刻主体的层位边（创建手势物化时主体未入图则省略，重放回退后到者居上）
   * @param {string} [effect.supraKey] - 指定进入的超分子 key（缺省独立成录）
   * @param {string} [effect.molId] - 增量式分子 id（创建手势的 endMol 物化携带）
   * @returns {import("./operation.js").OperationRecord} 分子操作记录
   */
  commitAdd(effect) {
    return this.#emit(createAddObjectOperation, effect);
  }

  /**
   * 提交修改对象分子操作
   * @param {Object} effect - 效果摘要
   * @param {string} effect.chunkId - 区块 id
   * @param {string} effect.objectId - 对象 id
   * @param {string[]} effect.properties - 涉及属性的集合
   * @param {Object} effect.before - 修改前快照
   * @param {Object} effect.after - 修改后快照
   * @param {{before: Array, after: Array}} [effect.chunks] - 修改前后的层位边（仅擦除回写等绕过 AOM 会话且伴随边变更的修改携带）
   * @param {string} [effect.supraKey] - 指定进入的超分子 key（缺省独立成录）
   * @param {string} [effect.molId] - 增量式分子 id（endMol 物化携带）
   * @returns {import("./operation.js").OperationRecord} 分子操作记录
   */
  commitModify(effect) {
    return this.#emit(createModifyObjectOperation, effect);
  }

  /**
   * 提交删除对象分子操作
   * @param {Object} effect - 效果摘要
   * @param {string} effect.chunkId - 区块 id
   * @param {string} effect.objectId - 对象 id
   * @param {string} [effect.supraKey] - 指定进入的超分子 key（缺省独立成录）
   * @returns {import("./operation.js").OperationRecord} 分子操作记录
   */
  commitDelete(effect) {
    return this.#emit(createDeleteObjectOperation, effect);
  }

  /**
   * 提交选择对象分子操作
   * @param {Object} effect - 效果摘要
   * @param {string} effect.chunkId - 区块 id
   * @param {string} effect.objectId - 对象 id
   * @param {string} [effect.supraKey] - 指定进入的超分子 key（缺省独立成录）
   * @param {string} [effect.choice] - 命名选择名（缺省匿名，不记录）
   * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} [effect.chunks] - 选择时刻主体的层位边（提取边，撤销时凭以恢复）
   * @returns {import("./operation.js").OperationRecord} 分子操作记录
   */
  commitChoose(effect) {
    return this.#emit(createChooseObjectOperation, effect);
  }

  /**
   * 提交取消选择分子操作
   * @param {Object} effect - 效果摘要
   * @param {string} effect.chunkId - 区块 id
   * @param {string} effect.objectId - 对象 id
   * @param {string} [effect.supraKey] - 指定进入的超分子 key（缺省独立成录）
   * @param {string} [effect.choice] - 命名选择名（缺省匿名，不记录）
   * @param {boolean} [effect.discard] - 放弃型闭合标志（放弃修改、回选择前快照）
   * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} [effect.chunks] - 写回静态图后主体的层位边（提交边，重放/远端凭以应用）
   * @returns {import("./operation.js").OperationRecord} 分子操作记录
   */
  commitUnchoose(effect) {
    return this.#emit(createUnchooseObjectOperation, effect);
  }

  /**
   * 提交撤销分子操作
   * @description 记录目标节点与撤销前 HEAD 位置（视图与可重做栈投影使用）；退化/分叉改挂/被吸收在应用时确定。
   * 撤销不属于任何超分子：即使携带 supraKey 也独立成录、即时上树。
   * @param {Object} effect - 效果摘要
   * @param {string} effect.targetNodeId - 撤消操作的目标节点 id（缺省为活动链末端，由调用方解析后传入）
   * @returns {import("./operation.js").OperationRecord} 撤销操作记录
   */
  commitUndo(effect) {
    return this.#emit(createUndoOperation, {
      ...effect,
      previousHeadId: this.#tree.head.shareId,
    });
  }

  /**
   * 提交重做分子操作
   * @description 重做携带目标撤销记录 id（targetUndoId），生效判定是纯日志谓词
   * （撤销已生效、未重做、未被同源新工作洗刷），发射即在各端一致生效。
   * 重做任何时刻都是独立分子，不进入超分子。
   * @param {Object} effect - 效果摘要
   * @param {string} effect.targetUndoId - 被重做的撤销记录 id（由调用方凭树侧登记解析）
   * @returns {import("./operation.js").OperationRecord} 重做操作记录
   */
  commitRedo(effect) {
    return this.#emit(createRedoOperation, effect);
  }

  /**
   * 接收远端记录后推进本 source 的时间水位
   * @param {import("./operation.js").OperationRecord} record - 已入日志的远端记录
   * @returns {void}
   */
  observeRemoteTime(record) {
    if (record.source === this.#source && Number.isFinite(record.time)) {
      this.#lastTime = Math.max(this.#lastTime, record.time);
    }
  }

  /**
   * 单调时间推进
   * @returns {number} 时间标记
   * @private
   */
  #tick() {
    const time = Math.max(this.#now(), this.#lastTime);
    this.#lastTime = time;
    return time;
  }

  /**
   * 统一的发射管线：构造记录、入日志、应用到树
   * @description 指定了 supraKey 的增加节点类操作即时物化并携带该超分子的 supraId（不再是草稿）；
   * 未指定 key 的提交即时独立成录；撤销、重作与闭合超分子永远独立成录。
   * @param {(fields: Object) => import("./operation.js").OperationRecord} factory - 分子记录工厂
   * @param {Object} effect - 效果摘要
   * @returns {import("./operation.js").OperationRecord} 分子操作记录
   * @throws {Error} 记录未通过日志准入校验，或指定的超分子未开启时抛出
   * @private
   */
  #emit(factory, effect) {
    const joinable =
      factory !== createUndoOperation &&
      factory !== createRedoOperation &&
      factory !== createCloseSupraOperation;
    const supraKey = joinable ? (effect.supraKey ?? null) : null;
    let supraId = null;
    if (supraKey !== null) {
      const supra = this.#supras.get(supraKey);
      if (supra === undefined) {
        throw new Error(`超分子 ${supraKey} 未开启（分子无法指定进入）`);
      }
      supraId = supra.supraId;
    }
    const record = factory({
      ...effect,
      id: this.#log.nextId(this.#source),
      source: this.#source,
      time: this.#tick(),
      parentId: this.#tree.head.shareId,
      // 句柄解析出的归属优先；非成员操作（close-supra）保留效果摘要自带的 supraId（由工厂决定落位）
      supraId: supraId ?? effect.supraId ?? null,
    });
    const errors = this.#log.append(record);
    if (errors.length > 0) {
      throw new Error(errors.join("；"));
    }
    this.#tree.applyRecord(record);
    return record;
  }
}

export { HitCommitter };
