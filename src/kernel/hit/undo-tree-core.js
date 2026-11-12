/**
 * @file 时间回溯树的核心模块
 * @description 单一共享树与共享 HEAD：分子节点结构、追加与时间插入、三级容器归并折叠、活动链解析、视图查询与从日志派生重建。
 * @module kernel/hit/undo-tree-core
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import {
  OPERATION_TYPES,
  OPERATION_EFFECT_KINDS,
  getOperationEffectKind,
  compareRecords,
  parseOperationId,
} from "./operation.js";

/**
 * 分子节点
 * @description
 * 树状结构记在节点上：父链、子节点（按时间标记有序）、深度与所属操作的 share id。
 * 节点不存时间（时间随所属操作），数据不自带，放在数据池（操作日志）中凭 id 获取。
 * 三级容器模型下节点有三种形态：独立分子（单记录）、增量式分子节点（同 molId 的记录组）、
 * 聚合节点（超分子闭合时连续段折叠产物）；成员记录 id 序列记在 memberIds 上。
 * @class
 * @author Zhou Chenyu
 */
class MolecularNode {
  /**
   * 数据池共享 id，即节点首条所属操作的 id；多个节点可凭同一 share id 共享数据
   * @type {?string}
   */
  shareId;

  /**
   * 父节点；虚拟根为 null
   * @type {?MolecularNode}
   */
  parent;

  /**
   * 子节点，按时间标记（时钟环，同刻按操作序号）升序
   * @type {MolecularNode[]}
   */
  children = [];

  /**
   * 深度；虚拟根为 0
   * @type {number}
   */
  depth;

  /**
   * 节点承载的记录 id 序列（按追加序）
   * @description 独立节点为单元素；增量式分子节点为同 molId 的记录组；聚合节点为折叠段全部成员。
   * @type {string[]}
   */
  memberIds;

  /**
   * 增量式分子 id；非增量式分子节点为 null
   * @type {?string}
   */
  molId;

  /**
   * 归属超分子 id（三级容器模型）；不属于超分子为 null
   * @type {?string}
   */
  supraId;

  /**
   * 构造分子节点
   * @param {?string} shareId - 数据池共享 id
   * @param {?MolecularNode} parent - 父节点
   * @param {Object} [info] - 节点承载信息
   * @param {string[]} [info.memberIds] - 成员记录 id 序列（缺省为 [shareId]）
   * @param {?string} [info.molId] - 增量式分子 id
   * @param {?string} [info.supraId] - 归属超分子 id
   */
  constructor(shareId, parent, info = {}) {
    this.shareId = shareId;
    this.parent = parent;
    this.depth = parent === null ? 0 : parent.depth + 1;
    this.memberIds = info.memberIds ?? (shareId === null ? [] : [shareId]);
    this.molId = info.molId ?? null;
    this.supraId = info.supraId ?? null;
  }
}

/**
 * 时间回溯树
 * @description
 * 内核内有且仅有一棵 hit 树，与操作日志（数据池）配合：树是日志的追溯结构，可凭 f(日志) 派生重建。
 * HEAD 指向当前状态对应的节点，可在链中间；root→HEAD 是活动链，HEAD 下游的后代是已撤销的节点。
 * @class
 * @author Zhou Chenyu
 */
class UndoTree {
  /**
   * 数据池（操作日志）
   * @type {import("./operation-log.js").OperationLog}
   */
  #log;

  /**
   * 虚拟根
   * @type {MolecularNode}
   */
  #root;

  /**
   * 共享 HEAD
   * @type {MolecularNode}
   */
  #head;

  /**
   * 活动链上 share id 到节点的索引
   * @type {Map<string, MolecularNode>}
   */
  #activeByShareId = new Map();

  /**
   * 生效撤销登记表（由日志派生：生效撤销登记，同源新工作洗刷，重做销记）
   * @description 键为撤销记录 id；重做凭 targetUndoId 查表判定生效，是纯日志谓词，
   * 不依赖记录投递交错。远端来源的新工作不洗刷本端撤销（各端按同一时间序评估，结论一致）。
   * @type {Map<string, { targetId: string, previousHeadId: string, source: string, time: number, n: number, redone: boolean, washed: boolean }>}
   */
  #undoRegistry = new Map();

  /**
   * 构造时间回溯树
   * @param {import("./operation-log.js").OperationLog} log - 数据池（操作日志）
   */
  constructor(log) {
    this.#log = log;
    this.#root = new MolecularNode(null, null);
    this.#head = this.#root;
  }

  /**
   * 虚拟根
   * @type {MolecularNode}
   */
  get root() {
    return this.#root;
  }

  /**
   * 共享 HEAD
   * @type {MolecularNode}
   */
  get head() {
    return this.#head;
  }

  /**
   * 活动链（root→HEAD 的操作节点序列，不含虚拟根）
   * @returns {MolecularNode[]} 活动链节点序列
   */
  getActiveChain() {
    const chain = [];
    for (let node = this.#head; node !== this.#root; node = node.parent) {
      chain.push(node);
    }
    return chain.reverse();
  }

  /**
   * 可重做撤销栈快照（派生自日志：生效撤销登记，同源新工作洗刷，重做销记）
   * @returns {Array<{ targetId: string, previousHeadId: string }>} 栈项序列（按撤销时间升序，栈底在前）
   */
  getRedoStack() {
    return [...this.#undoRegistry.values()]
      .filter((entry) => !entry.redone && !entry.washed)
      .sort((a, b) => a.time - b.time)
      .map((entry) => ({ targetId: entry.targetId, previousHeadId: entry.previousHeadId }));
  }

  /**
   * 取某来源当前可重做的撤销（栈顶语义：该来源最近一次未洗刷、未重做的生效撤销）
   * @param {string} source - 发起者标识
   * @returns {?{ undoId: string, targetId: string }} 可重做的撤销；无可重做时为 null
   */
  getRedoTargetForSource(source) {
    let best = null;
    for (const [undoId, entry] of this.#undoRegistry) {
      if (entry.source !== source || entry.redone || entry.washed) {
        continue;
      }
      if (best === null || entry.time > best.entry.time) {
        best = { undoId, entry };
      }
    }
    return best === null ? null : { undoId: best.undoId, targetId: best.entry.targetId };
  }

  /**
   * 活动链上携带某操作的节点
   * @param {string} shareId - 数据池共享 id（操作 id）
   * @returns {?MolecularNode} 节点；该操作不在活动链上时为 null
   */
  getActiveNode(shareId) {
    return this.#activeByShareId.get(shareId) ?? null;
  }

  /**
   * 判断某操作是否在活动链上
   * @param {string} shareId - 数据池共享 id（操作 id）
   * @returns {boolean} 是否在活动链上
   */
  isOnActiveChain(shareId) {
    return this.#activeByShareId.has(shareId);
  }

  /**
   * 活动链上归属某超分子的节点序列（链序）
   * @param {string} supraId - 超分子 id，形如 `"{source}/supra-{n}"`
   * @returns {MolecularNode[]} 归属该超分子的活动链节点（不含已撤销分支）
   */
  getActiveSupraNodes(supraId) {
    return this.getActiveChain().filter((node) => node.supraId === supraId);
  }

  /**
   * 整棵树中查找携带某操作的节点（含分支，深度优先取先见者）
   * @param {string} shareId - 数据池共享 id（操作 id）
   * @returns {?MolecularNode} 节点；不存在时为 null
   */
  findNode(shareId) {
    return this.#findNode(this.#root, shareId);
  }

  /**
   * 某节点的子节点视图（按时间标记升序的副本）
   * @param {MolecularNode} node - 父节点
   * @returns {MolecularNode[]} 子节点数组的副本
   */
  getChildrenOf(node) {
    return [...node.children];
  }

  /**
   * 应用一条分子操作记录
   * @description
   * 增加节点类按时间标记落位：晚于 HEAD（时钟环）时在 HEAD 之后追加并推进 HEAD，否则插入活动链的
   * 对应位置、插入点之后的节点改挂。撤销按目标在活动链上的位置呈现退化/分叉改挂/被吸收形态。
   * 增量式分子成员（同 molId）到达活动链末端时并入末端节点，一个分子始终是链上一个节点。
   * 闭合超分子记录触发折叠：活动链上同 supraId 的连续节点段合并为聚合节点，自身不产生节点。
   * @param {import("./operation.js").OperationRecord} record - 分子操作记录
   * @returns {?MolecularNode} 记录产生（或并入）的节点；撤销与闭合超分子不产生新节点返回 null
   * @throws {Error} 记录未入数据池（日志），或类型暂不支持时抛出
   */
  applyRecord(record) {
    if (!this.#log.has(record.id)) {
      throw new Error(`记录未入数据池：${record.id}`);
    }
    if (record.type === OPERATION_TYPES.UNDO) {
      return this.#applyUndo(record);
    }
    if (record.type === OPERATION_TYPES.REDO) {
      return this.#applyRedo(record);
    }
    if (record.type === OPERATION_TYPES.CLOSE_SUPRA) {
      return this.#applyCloseSupra(record);
    }
    if (getOperationEffectKind(record.type) !== OPERATION_EFFECT_KINDS.APPEND_NODE) {
      throw new Error(`树级操作的应用随更改 HEAD 落地补全：${record.type}`);
    }
    if (record.supraOpId !== null) {
      throw new Error(`旧形态超分子成员不产生独立节点，经 applySupraNode 应用：${record.id}`);
    }
    // 同源新工作洗刷该来源已登记的重做资格（远端来源不洗刷：各端按同一时间序评估，结论一致）
    this.#washRegistry(record.source, record.time, parseOperationId(record.id)?.n ?? 0);
    // 增量式分子归并：活动链末端节点与本记录同分子（同 molId 且同 supraId）时并入；
    // 乱序到达或分子被并发操作分隔时各自独立成节点（退化，语义安全）
    if (
      record.molId !== null &&
      this.#head !== this.#root &&
      this.#head.molId === record.molId &&
      this.#head.supraId === record.supraId &&
      this.#compareRecords(record, this.#timeRecordOfNode(this.#head)) > 0
    ) {
      this.#head.memberIds.push(record.id);
      return this.#head;
    }
    if (this.#head === this.#root || this.#compareRecords(record, this.#timeRecordOfNode(this.#head)) > 0) {
      return this.appendRecord(record);
    }
    return this.insertRecordByTimeMark(record);
  }

  /**
   * 应用一个旧形态超分子操作（全部成员凝聚为一个节点）
   * @description 兼容旧日志形态（草稿凝聚）：节点 shareId 为超分子 id（首分子 id），时间标记取末分子（完成时刻）；
   * 晚于 HEAD 时追加并推进 HEAD，否则插入活动链对应位置。空成员组不产生节点。
   * @param {import("./operation.js").OperationRecord[]} members - 超分子成员记录（按追加序）
   * @returns {?MolecularNode} 超分子节点；空组返回 null
   */
  applySupraNode(members) {
    if (!Array.isArray(members) || members.length === 0) {
      return null;
    }
    const shareId = members[0].supraOpId;
    // 同源新工作洗刷该来源已登记的重做资格（与 applyRecord 同规则）
    const lastMember = members[members.length - 1];
    this.#washRegistry(lastMember.source, lastMember.time, parseOperationId(lastMember.id)?.n ?? 0);
    // 旧形态成员分批到达时并入既有节点，效果重放读取同一成员全集
    const existing = this.getActiveNode(shareId);
    if (existing !== null) {
      existing.memberIds = [
        ...new Set([...existing.memberIds, ...members.map((member) => member.id)]),
      ];
      return existing;
    }
    const info = { memberIds: members.map((member) => member.id) };
    const last = members[members.length - 1];
    if (this.#head === this.#root || this.#compareRecords(last, this.#timeRecordOfNode(this.#head)) > 0) {
      return this.#appendNode(shareId, info);
    }
    return this.#insertNodeByTime(shareId, last, info);
  }

  /**
   * 应用撤销操作记录
   * @description
   * 目标不在活动链上时被吸收（无结构变化）；目标为活动链末端时退化为 HEAD 回退；
   * 目标在链中段时在目标父节点处分叉：目标与 HEAD 之间的链（不含目标）改挂到分叉点，
   * 原位置按 (时间, author) 截断——不晚于撤销操作的节点留在原位置（凭同一 share id 共享数据），
   * 晚于的只存在于撤销分支；HEAD 移到新末端。撤销本身不产生节点。
   * 生效撤销登记入册（含来源与时间），作为后续重做生效判定的纯日志谓词依据；被吸收的撤销不登记。
   * @param {import("./operation.js").OperationRecord} record - 撤销操作记录
   * @returns {null}
   * @private
   */
  #applyUndo(record) {
    const target = this.getActiveNode(record.payload.targetNodeId);
    if (target === null) {
      return null;
    }
    this.#undoRegistry.set(record.id, {
      targetId: record.payload.targetNodeId,
      previousHeadId: record.payload.previousHeadId,
      source: record.source,
      time: record.time,
      n: parseOperationId(record.id)?.n ?? 0,
      redone: false,
      washed: false,
    });
    if (target === this.#head) {
      this.#head = target.parent;
      this.#rebuildActiveIndex();
      return null;
    }
    const forkPoint = target.parent;
    // 目标与 HEAD 之间的链（不含目标），按时间升序
    const chain = [];
    for (let node = this.#head; node !== target; node = node.parent) {
      chain.unshift(node);
    }
    // 原位置截断：不晚于撤销操作的前缀留在原位置，其后从原位置摘下
    let keepCount = 0;
    while (
      keepCount < chain.length &&
      this.#compareRecords(this.#timeRecordOfNode(chain[keepCount]), record) <= 0
    ) {
      keepCount++;
    }
    if (keepCount < chain.length) {
      const dropped = chain[keepCount];
      dropped.parent.children = dropped.parent.children.filter((child) => child !== dropped);
    }
    // 改挂：分叉点下新建链，节点凭同一 share id 与成员序列共享数据
    let parent = forkPoint;
    for (const old of chain) {
      const copy = new MolecularNode(old.shareId, parent, {
        memberIds: [...old.memberIds],
        molId: old.molId,
        supraId: old.supraId,
      });
      this.#insertChildSorted(parent, copy);
      parent = copy;
    }
    this.#head = parent;
    this.#rebuildActiveIndex();
    return null;
  }

  /**
   * 应用闭合超分子操作记录（折叠）
   * @description 在活动链上找同 supraId 的连续节点段，逐段折叠为一个聚合节点；
   * 已撤销分支上的成员不参与折叠（保持独立，可重做）；单节点段保持独立（退化规则，
   * 撤销粒度退回分子级，功能不丢）。重复闭合幂等（聚合节点自成单节点段，不再折叠）。
   * @param {import("./operation.js").OperationRecord} record - 闭合超分子操作记录
   * @returns {null}
   * @private
   */
  #applyCloseSupra(record) {
    const supraId = record.payload.supraId;
    const chain = this.getActiveChain();
    const segments = [];
    let current = null;
    for (const node of chain) {
      if (node.supraId === supraId) {
        if (current === null) {
          current = [];
          segments.push(current);
        }
        current.push(node);
      } else {
        current = null;
      }
    }
    for (const segment of segments) {
      if (segment.length >= 2) {
        this.#foldSegment(segment);
      }
    }
    return null;
  }

  /**
   * 折叠活动链上一段连续节点为聚合节点
   * @description 聚合节点 shareId 取段首节点，memberIds 为段内全部节点的成员记录扁平序列（链序）；
   * 段内节点携带的分支子节点转挂到聚合节点（保持分支可达，重做目标不丢）；
   * HEAD 落在段内时移到聚合节点（同一逻辑位置）。
   * @param {MolecularNode[]} segment - 活动链上的连续节点段（链序，长度 ≥ 2）
   * @returns {MolecularNode} 聚合节点
   * @private
   */
  #foldSegment(segment) {
    const first = segment[0];
    const members = new Set(segment);
    const aggregate = new MolecularNode(first.shareId, first.parent, {
      memberIds: segment.flatMap((node) => node.memberIds),
      supraId: first.supraId,
    });
    // 段首位置替换：父节点的子节点数组中摘出段首、按时间序插入聚合节点
    const parent = first.parent;
    parent.children = parent.children.filter((child) => child !== first);
    this.#insertChildSorted(parent, aggregate);
    // 段内节点的链外子节点（活动链后继与分支）全部转挂聚合节点
    for (const node of segment) {
      for (const child of [...node.children]) {
        if (members.has(child)) {
          continue;
        }
        child.parent = aggregate;
        this.#insertChildSorted(aggregate, child);
        this.#shiftDepth(child, aggregate.depth + 1 - child.depth);
      }
    }
    if (members.has(this.#head)) {
      this.#head = aggregate;
    }
    this.#rebuildActiveIndex();
    return aggregate;
  }

  /**
   * 在 HEAD 之后追加节点并推进 HEAD
   * @param {import("./operation.js").OperationRecord} record - 分子操作记录
   * @returns {MolecularNode} 新节点
   */
  appendRecord(record) {
    return this.#appendNode(record.id, this.#nodeInfoOf(record));
  }

  /**
   * 按时间标记插入活动链的对应位置，插入点之后的节点改挂；HEAD 不变
   * @param {import("./operation.js").OperationRecord} record - 分子操作记录
   * @returns {MolecularNode} 新节点
   */
  insertRecordByTimeMark(record) {
    return this.#insertNodeByTime(record.id, record, this.#nodeInfoOf(record));
  }

  /**
   * 取记录对应的节点承载信息
   * @param {import("./operation.js").OperationRecord} record - 分子操作记录
   * @returns {{ memberIds: string[], molId: ?string, supraId: ?string }} 节点承载信息
   * @private
   */
  #nodeInfoOf(record) {
    return { memberIds: [record.id], molId: record.molId, supraId: record.supraId };
  }

  /**
   * 在 HEAD 之后追加节点并推进 HEAD
   * @param {string} shareId - 数据池共享 id
   * @param {Object} [info] - 节点承载信息（见 MolecularNode 构造）
   * @returns {MolecularNode} 新节点
   * @private
   */
  #appendNode(shareId, info = {}) {
    const node = new MolecularNode(shareId, this.#head, info);
    this.#insertChildSorted(this.#head, node);
    this.#head = node;
    this.#rebuildActiveIndex();
    return node;
  }

  /**
   * 按时间标记插入活动链的对应位置，插入点之后的节点改挂；HEAD 不变
   * @param {string} shareId - 数据池共享 id
   * @param {import("./operation.js").OperationRecord} timeRecord - 时间标记的来源记录
   * @param {Object} [info] - 节点承载信息（见 MolecularNode 构造）
   * @returns {MolecularNode} 新节点
   * @private
   */
  #insertNodeByTime(shareId, timeRecord, info = {}) {
    const chain = this.getActiveChain();
    const successor = chain.find(
      (node) => this.#compareRecords(timeRecord, this.#timeRecordOfNode(node)) < 0,
    ) ?? null;
    if (successor === null) {
      return this.#appendNode(shareId, info);
    }
    const parent = successor.parent;
    const node = new MolecularNode(shareId, parent, info);
    this.#replaceChild(parent, successor, node);
    node.children = [successor];
    const delta = node.depth + 1 - successor.depth;
    successor.parent = node;
    this.#shiftDepth(successor, delta);
    this.#rebuildActiveIndex();
    return node;
  }

  /**
   * 应用重做操作记录
   * @description 重做凭 targetUndoId 查生效撤销登记册，生效是纯日志谓词：撤销已生效登记、
   * 未重做、未被同源新工作洗刷——不依赖记录投递交错（同源记录保序到达，树级操作乱序
   * 触发重建，各端评估序同为时间序）。生效效果为把撤销目标节点按时间标记重新激活：
   * 并发远端工作留在链上不动，被撤节点回到其时间位置。重做本身不产生节点。
   * @param {import("./operation.js").OperationRecord} record - 重做操作记录
   * @returns {null}
   * @private
   */
  #applyRedo(record) {
    const entry = this.#undoRegistry.get(record.payload.targetUndoId);
    if (entry === undefined || entry.redone || entry.washed) {
      return null;
    }
    entry.redone = true;
    this.#reactivateNode(entry.targetId);
    return null;
  }

  /**
   * 同源新工作洗刷该来源已登记的重做资格
   * @description 同来源、按记录全序（时钟环 + 同刻同 author 按操作序号决胜）晚于撤销、
   * 尚未重做的生效撤销被标记为已洗刷；远端来源的新工作不洗刷本端撤销
   * （各端按同一时间序评估，结论一致，收敛不依赖投递交错）。
   * @param {string} source - 新工作记录的来源
   * @param {number} time - 新工作记录的时间标记
   * @param {number} n - 新工作记录的操作序号（同刻决胜依据）
   * @returns {void}
   * @private
   */
  #washRegistry(source, time, n) {
    for (const entry of this.#undoRegistry.values()) {
      if (
        entry.source === source &&
        !entry.redone &&
        (time > entry.time || (time === entry.time && n > entry.n))
      ) {
        entry.washed = true;
      }
    }
  }

  /**
   * 重新激活被撤销的节点：从撤销分支摘下，按时间标记插回活动链
   * @description 插入点由节点时间标记在活动链上的位置决定：晚于链末端时追加并推进 HEAD；
   * 否则插在对应位置、原后继改挂为其子节点（并发新工作留在链上不动）。节点携既有
   * 撤销分支子树整体移动，深度同步平移。
   * @param {string} targetId - 目标节点携带的操作 id
   * @returns {void}
   * @private
   */
  #reactivateNode(targetId) {
    if (this.isOnActiveChain(targetId)) {
      return;
    }
    const node = this.findNode(targetId);
    if (node === null || node.parent === null) {
      return;
    }
    node.parent.children = node.parent.children.filter((child) => child !== node);
    const timeRecord = this.#timeRecordOfNode(node);
    const chain = this.getActiveChain();
    const successor = chain.find(
      (current) => this.#compareRecords(timeRecord, this.#timeRecordOfNode(current)) < 0,
    ) ?? null;
    if (successor === null) {
      node.parent = this.#head;
      this.#insertChildSorted(this.#head, node);
      this.#shiftDepth(node, this.#head.depth + 1 - node.depth);
      this.#head = node;
    } else {
      const parent = successor.parent;
      node.parent = parent;
      this.#replaceChild(parent, successor, node);
      this.#shiftDepth(node, parent.depth + 1 - node.depth);
      successor.parent = node;
      this.#insertChildSorted(node, successor);
      this.#shiftDepth(successor, node.depth + 1 - successor.depth);
    }
    this.#rebuildActiveIndex();
  }

  /**
   * 移动 HEAD 至树上已有节点
   * @param {string} shareId - 目标节点携带的操作 id
   * @returns {boolean} 是否成功移动；目标不存在时为 false
   */
  moveHeadTo(shareId) {
    const node = this.findNode(shareId);
    if (node === null) {
      return false;
    }
    this.#head = node;
    this.#rebuildActiveIndex();
    return true;
  }

  /**
   * 从数据池（操作日志）原地派生重建（f(日志)）
   * @description 清空结构状态后按单元定序逐条应用。派生单元：旧日志形态（supraOpId）成员
   * 并入其超分子组，凝聚为单节点；其余记录各自独立应用——三级容器模型的分子归并
   * （同 molId 相邻并入）与超分子折叠（close-supra 触发）在应用时发生。两种日志形态
   * 混合同一棵树收敛；undo/move-head/redo 在语义目标尚未应用时按确定顺序推迟。
   * @returns {void}
   */
  rebuild() {
    this.#root = new MolecularNode(null, null);
    this.#head = this.#root;
    this.#activeByShareId = new Map();
    this.#undoRegistry = new Map();
    const units = [];
    const legacyGroups = new Map();
    for (const record of this.#log.toArray()) {
      if (record.supraOpId === null) {
        units.push(record);
      } else {
        let group = legacyGroups.get(record.supraOpId);
        if (group === undefined) {
          group = [];
          legacyGroups.set(record.supraOpId, group);
          units.push(group);
        }
        group.push(record);
      }
    }
    // 单元定序：旧超分子组取末分子时间标记（完成时刻），单条记录取自身，保证确定性全序
    units.sort((a, b) => {
      const reprA = Array.isArray(a) ? a[a.length - 1] : a;
      const reprB = Array.isArray(b) ? b[b.length - 1] : b;
      return compareRecords(reprA, reprB);
    });
    const appliedIds = new Set();
    /**
     * 应用一个派生单元并登记其记录
     * @param {Object|Object[]} unit - 单条记录或旧超分子成员组
     * @returns {void}
     */
    const applyUnit = (unit) => {
      if (Array.isArray(unit)) {
        this.applySupraNode(unit);
        for (const record of unit) appliedIds.add(record.id);
      } else {
        this.applyRecord(unit);
        appliedIds.add(unit.id);
      }
    };
    while (units.length > 0) {
      let index = units.findIndex((unit) => {
        if (Array.isArray(unit)) return true;
        let dependency = null;
        if (unit.type === OPERATION_TYPES.UNDO || unit.type === OPERATION_TYPES.MOVE_HEAD) {
          dependency = unit.payload.targetNodeId;
        } else if (unit.type === OPERATION_TYPES.REDO) {
          dependency = unit.payload.targetUndoId;
        }
        return dependency === null || appliedIds.has(dependency);
      });
      // 缺失目标或循环依赖的损坏日志仍按确定顺序落地，由效果修复与校验和暴露问题
      if (index === -1) index = 0;
      const [unit] = units.splice(index, 1);
      applyUnit(unit);
    }
  }

  /**
   * 从操作日志派生重建树（f(日志)：按时间标记全序逐条应用）
   * @param {import("./operation-log.js").OperationLog} log - 操作日志
   * @returns {UndoTree} 重建的树
   */
  static rebuildFromLog(log) {
    const tree = new UndoTree(log);
    tree.rebuild();
    return tree;
  }

  /**
   * 取节点的代表记录（时间标记的来源：成员序列的末条记录）
   * @param {MolecularNode} node - 分子节点
   * @returns {import("./operation.js").OperationRecord} 代表记录
   * @private
   */
  #timeRecordOfNode(node) {
    return this.#log.get(node.memberIds[node.memberIds.length - 1] ?? node.shareId);
  }

  /**
   * 记录排序比较：先按时间标记（时钟环），同刻同 author 按操作序号决胜
   * @param {import("./operation.js").OperationRecord} a - 记录 a
   * @param {import("./operation.js").OperationRecord} b - 记录 b
   * @returns {number} a 排在 b 前为负，相等为 0，a 排在 b 后为正
   * @private
   */
  #compareRecords(a, b) {
    return compareRecords(a, b);
  }

  /**
   * 把子节点插入父节点的有序子节点数组
   * @param {MolecularNode} parent - 父节点
   * @param {MolecularNode} child - 子节点
   * @private
   */
  #insertChildSorted(parent, child) {
    const childRecord = this.#timeRecordOfNode(child);
    const index = parent.children.findIndex(
      (sibling) => this.#compareRecords(childRecord, this.#timeRecordOfNode(sibling)) < 0,
    );
    if (index === -1) {
      parent.children.push(child);
    } else {
      parent.children.splice(index, 0, child);
    }
  }

  /**
   * 在父节点的子节点数组中以新节点替换旧节点，保持有序位置
   * @param {MolecularNode} parent - 父节点
   * @param {MolecularNode} oldChild - 被替换的子节点
   * @param {MolecularNode} newChild - 新子节点
   * @private
   */
  #replaceChild(parent, oldChild, newChild) {
    parent.children = parent.children.filter((child) => child !== oldChild);
    this.#insertChildSorted(parent, newChild);
  }

  /**
   * 整棵子树深度平移
   * @param {MolecularNode} node - 子树根
   * @param {number} delta - 深度增量
   * @private
   */
  #shiftDepth(node, delta) {
    node.depth += delta;
    for (const child of node.children) {
      this.#shiftDepth(child, delta);
    }
  }

  /**
   * 深度优先查找携带某操作的节点
   * @param {MolecularNode} node - 当前节点
   * @param {string} shareId - 数据池共享 id
   * @returns {?MolecularNode} 节点；不存在时为 null
   * @private
   */
  #findNode(node, shareId) {
    if (node.shareId === shareId) {
      return node;
    }
    for (const child of node.children) {
      const found = this.#findNode(child, shareId);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  /**
   * 重建活动链索引（root→HEAD 路径上的 share id）
   * @private
   */
  #rebuildActiveIndex() {
    this.#activeByShareId.clear();
    for (let node = this.#head; node !== this.#root; node = node.parent) {
      this.#activeByShareId.set(node.shareId, node);
    }
  }
}

export {
  MolecularNode,
  UndoTree,
};
