/**
 * @file Engine Board API
 * @description
 * BoardApi 是 Engine 侧的统一领域分发层。
 * 接收 BoardCore 实例，提供对象 CRUD、AOM 操作、查询和命中检测等方法的直接实现。
 * 与 RPC 客户端（bridges/board-api-rpc.js）共享同一契约签名。
 * @module kernel/api/board-api
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { deserialize } from "../objects/object-deserializer.js";
import {
  OPERATION_TYPES,
  OPERATION_EFFECT_KINDS,
  getOperationEffectKind,
  compareRecords,
  validateOperation,
} from "../hit/operation.js";
import { Matrix, Vector } from "../utils/math.js";
import { hashString } from "../utils/hash.js";
import {
  buildObjectDetails,
  buildObjectSummary,
} from "./object-summary.js";
import { IncrementalIdPool } from "../utils/incremental-id-pool.js";
import { intersectsRanges, RectangleRange } from "../range/index.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { Chunk } from "../chunk/chunk.js";
import { BoardCore } from "../board/board-core.js";
import { createDefaultAomRenderHooks } from "../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../board/persistence-adapter.js";
import {
  ANONYMOUS_CHOICE_NAME,
  isValidChoiceName,
} from "../board/active-object-manager.js";

/**
 * 数据擦除粗筛的范围余量（世界单位）
 * @description 覆盖笔画宽度等对象自身渲染留白；宽度超过该余量的对象可能在粗筛阶段被遗漏。
 * @type {number}
 */
const ERASE_COARSE_MARGIN = 64;

/**
 * 判断对象是否已进入 Worker 侧的区块静态图
 * @param {import("../board/board-core.js").BoardCore} boardCore - BoardCore 实例
 * @param {string} objectId - 对象 id
 * @returns {boolean}
 */
function hasStaticBoardObject(boardCore, objectId) {
  for (const { chunk } of boardCore.chunkLoaded.values()) {
    if (chunk?.objectManager?.staticGraph?.hasNode(objectId)) {
      return true;
    }
  }
  return false;
}

/**
 * 生成对象键序无关的确定性 JSON
 * @param {*} value - 待序列化值
 * @returns {string} 确定性 JSON
 */
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * 深拷贝可 JSON 序列化的快照
 * @param {*} value - 快照值
 * @returns {*} 独立快照
 */
function cloneSnapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 归一化记录的可选容器字段
 * @param {Object} record - 操作记录
 * @returns {Object} 归一化记录
 */
function normalizeOperationRecord(record) {
  return {
    ...record,
    molId: record.molId ?? null,
    supraId: record.supraId ?? null,
    discard: record.discard ?? false,
  };
}

/**
 * 比较两条同 ID 记录是否语义相同
 * @param {Object} a - 已入日志记录
 * @param {Object} b - 待接入记录
 * @returns {boolean} 是否一致
 */
function sameOperationRecord(a, b) {
  return canonicalJson(normalizeOperationRecord(a)) === canonicalJson(normalizeOperationRecord(b));
}

/**
 * 计算对象当前的世界坐标包围矩形
 * @param {import("../objects/basic-obj.js").BasicObject} obj - 对象实例
 * @returns {import("../range/index.js").RectangleRange | null} 世界包围矩形
 */
function getObjectWorldRect(obj) {
  if (!obj?.position) return null;
  const range = obj.getRange();
  if (!range) return null;
  return RectangleRange.from(range.withPosition(obj.position));
}

/**
 * 在静态状态图中加边（防御成环）
 * @description 记录携带的层位边来自真实 DAG、缝合边来自后到者居上规则，理论上不成环；
 * 但跨端交错与撤销过渡的中间态图可能短暂偏离，加边前以可达性检查兜底（成环则跳过该边）。
 * @param {import("../utils/directed-graph.js").DirectedGraph<string>} graph - 静态状态图
 * @param {string} from - 起点（在下者）
 * @param {string} to - 终点（在上者）
 * @returns {boolean} 是否实际写入
 */
function addLayerEdgeIfAcyclic(graph, from, to) {
  if (from === to || !graph.hasNode(from) || !graph.hasNode(to)) return false;
  if (graph.hasEdge(from, to)) return false;
  const stack = [to];
  const visited = new Set([to]);
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === from) return false;
    for (const next of graph.neighborsUnsafe(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
  }
  graph.addEdgeUnsafe(from, to);
  return true;
}

/**
 * Engine 侧 BoardApi
 * @class
 * @description
 * 直连 BoardCore 的领域 API 实现。所有方法同步执行（除 hitTest 因区块加载需要异步），
 * 不依赖 PostMessage 或 Worker 传输。
 * 方法签名与 {@link ../../types/board-api-types.js} 定义的 BoardApi 契约一致。
 * @author Zhou Chenyu
 */
class BoardApi {
  /**
   * BoardCore 实例
   * @type {import("../board/board-core.js").BoardCore}
   */
  #boardCore;

  /**
   * 数据擦除的串行队列
   * @description
   * eraseData 是异步读写：粗筛候选可能挂起等待区块加载，之后才切割与提交。
   * 工具侧按轨迹段 fire-and-forget，若并发执行，后到的调用持有的候选快照
   * 早于前序调用提交的分裂对象，会对新对象漏擦。串行队列保证每条调用的
   * 快照、切割与提交都发生在前一条完成之后。
   * @type {Promise<void>}
   * @private
   */
  #eraseDataQueue = Promise.resolve();

  /**
   * 选择前快照表
   * @description 对象 id -> 选择时刻的 serialize() 快照，作修改对象分子的前快照；对象提交或放弃时移除。
   * @type {Map<string, Object>}
   * @private
   */
  #chooseSnapshots = new Map();

  /**
   * 进行中的增量式分子表
   * @description molId -> 分子状态（supraKey 归属、逐对象 before 快照与序列水位）；
   * amend 流的唯一载体，endMol 物化或 abortMol 丢弃后移除。原子（帧增量）永不落盘。
   * @type {Map<string, { supraKey: ?string, create: boolean, objects: Map<string, { before: ?Object, create: ?Object }>, seq: number, history: Array<{seq: number, entries: Object[]}> }>}
   * @private
   */
  #mols = new Map();

  /**
   * 已物化水位表
   * @description 对象 id 出现即表示「实例当前状态 == 最近一次 endMol 物化记录的 after」，
   * commitObjects 凭此跳过重复的修改分子；任何后续实例改动（amendMol/modifyObject 等）使水位失效。
   * @type {Set<string>}
   * @private
   */
  #materializedMarks = new Set();

  /**
   * 远程选择注册表变更脏标记
   * @description 远程 choose/unchoose 效果应用时置位（远程活动对象的修改效果亦置位，
   * 装饰需按新几何重绘），合批为一次 remote-activity 事件。
   * @type {boolean}
   * @private
   */
  #remoteChoicesDirty = false;

  /**
   * 远程选择变更涉及的对象 id 集合（随 remote-activity 事件携带）
   * @type {Set<string>}
   * @private
   */
  #remoteChoicesDirtyIds = new Set();

  /**
   * @param {import("../board/board-core.js").BoardCore} boardCore - BoardCore 实例
   */
  constructor(boardCore) {
    this.#boardCore = boardCore;
  }

  /**
   * 解析对象所在区块 id
   * @description 先扫描已加载区块的静态状态图，未命中时按对象位置与画布尺寸推算；区块 id 统一规范为字符串。
   * @param {string} objectId - 对象 id
   * @returns {string} 区块 id；无法解析时为空串
   * @private
   */
  #resolveObjectChunkId(objectId) {
    const boardCore = this.#boardCore;
    for (const { chunk } of boardCore.chunkLoaded.values()) {
      if (chunk?.objectManager?.staticGraph?.hasNode(objectId)) {
        return String(chunk.id);
      }
    }
    const obj = boardCore.getObjectById(objectId);
    if (obj?.position && boardCore.width > 0 && boardCore.height > 0) {
      const chunkId = Chunk.worldToChunkId(obj.position, boardCore.width, boardCore.height);
      return chunkId == null ? "" : String(chunkId);
    }
    return "";
  }

  /**
   * 捕获对象在各已加载区块静态图中的层位边
   * @description below = 主体之下的对象（前驱），above = 主体之上的对象（后继）；id 按字典序排序，保证跨端序列化确定。
   * 主体节点不在任何静态图（如创建手势物化时对象仍在 AOM）时返回 undefined——
   * 区别于「在图但无边」的空数组形态：undefined 表示无权威层位可采，消费端回退几何居上。
   * @param {string} objectId - 对象 id
   * @returns {?Array<{chunkId: string, below: string[], above: string[]}>} 层位边集合
   * @private
   */
  #captureLayerEdges(objectId) {
    const chunks = [];
    for (const { chunk } of this.#boardCore.chunkLoaded.values()) {
      const graph = chunk?.objectManager?.staticGraph;
      if (!graph?.hasNode(objectId)) continue;
      chunks.push({
        chunkId: String(chunk.id),
        below: [...graph.predecessors(objectId)].sort(),
        above: [...graph.neighbors(objectId)].sort(),
      });
    }
    return chunks.length > 0 ? chunks : undefined;
  }

  /**
   * 比较前后快照的顶层差异键
   * @param {Object} before - 修改前快照
   * @param {Object} after - 修改后快照
   * @returns {string[]} 涉及属性的集合
   * @private
   */
  #diffProperties(before, after) {
    return ["position", "transform", "property", "data"].filter(
      (key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]),
    );
  }

  /**
   * 在 Engine 侧创建对象实例，注册到 AOM 动态图
   * @param {string} type - 对象类型名
   * @param {import("../types/board-api-types.js").CreateObjectProps} props - 创建属性
   * @returns {string} 新对象的 objectId
   */
  createObject(type, props) {
    const boardCore = this.#boardCore;
    const objectId = props?.id;
    if (objectId == null) {
      throw new Error("createObject requires an explicit object id.");
    }
    const existingObject = boardCore.getObjectById(objectId);
    if (existingObject) {
      throw new Error(
        `Duplicate object id ${objectId}: an object with this id already exists.`,
      );
    }

    const obj = deserialize({
      type,
      id: objectId,
      position: props?.position ?? { x: 0, y: 0 },
      transform: props?.transform ?? { a: 1, b: 0, c: 0, d: 1 },
      property: { ...(props?.property ?? {}) },
      data: { ...(props?.data ?? {}) },
    });

    boardCore.registerObjectInstance(obj);
    boardCore.activeObjectManager.add(new Set([obj]));

    return objectId;
  }

  /**
   * 断言对象为活动对象
   * @description 非活动对象不允许更改：想更改一个对象，它必须先经选择进入动态图。
   * @param {string} objectId - 对象 id
   * @returns {import("../objects/basic-obj.js").BasicObject} 对象实例
   * @private
   */
  #requireActiveObject(objectId) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    if (!obj) {
      throw new Error(`Object ${objectId} not found.`);
    }
    if (!boardCore.activeObjectManager.isActive(objectId)) {
      throw new Error(`对象 ${objectId} 不是活动对象：更改前须先选择（进入动态图）`);
    }
    return obj;
  }

  /**
   * 把 patch 应用到对象实例
   * @description 内核复合操作通道：不做活动对象准入，供擦除回写等切割效果的原子表达使用。
   * @param {import("../objects/basic-obj.js").BasicObject} obj - 对象实例
   * @param {import("../types/board-api-types.js").ObjectPatch} patch - 修改 patch
   * @returns {void}
   * @private
   */
  #applyObjectPatch(obj, patch) {
    const boardCore = this.#boardCore;
    if (patch.position != null) {
      obj.position = new Vector(patch.position.x, patch.position.y);
    }
    if (patch.transform != null) {
      const { a, b, c, d } = patch.transform;
      obj.setTransform(new Matrix(a, b, c, d));
    }
    if (patch.property != null) {
      obj.setProperty(patch.property);
    }
    if (patch.data != null) {
      obj.setData(patch.data);
    }
    if (typeof patch.append?.key === "string") {
      // 列表增量追加（创建手势逐点追点走 amend 的载体）
      obj.appendListItem(patch.append.key, ...(patch.append.items ?? []));
    }
    boardCore.aomRenderHooks.requestActiveRender([obj]);
  }

  /**
   * 修改单个对象的几何/样式属性
   * @description 仅活动对象可更改：对象须先经选择进入动态图。
   * @param {string} objectId - 对象 id
   * @param {import("../types/board-api-types.js").ObjectPatch} patch - 修改 patch
   * @returns {void}
   */
  modifyObject(objectId, patch) {
    this.#applyObjectPatch(this.#requireActiveObject(objectId), patch);
    this.#materializedMarks.delete(objectId);
  }

  /**
   * 批量修改多个对象
   * @description 仅活动对象可更改：对象须先经选择进入动态图。
   * @param {import("../types/board-api-types.js").ObjectPatchEntry[]} patches - 批量 patch
   * @returns {void}
   */
  modifyObjects(patches) {
    const items = Array.isArray(patches) ? patches : [];
    for (const { objectId, patch } of items) {
      if (objectId == null || !patch) continue;
      this.#applyObjectPatch(this.#requireActiveObject(objectId), patch);
      this.#materializedMarks.delete(objectId);
    }
  }

  /**
   * 向对象的列表属性追加元素
   * @param {string} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {any[]} items - 追加的元素集合
   * @returns {void}
   */
  appendListItem(objectId, key, items) {
    const obj = this.#requireActiveObject(objectId);
    obj.appendListItem(key, ...(items ?? []));
    this.#materializedMarks.delete(objectId);
    this.#boardCore.aomRenderHooks.requestActiveRender([obj]);
  }

  /**
   * 替换对象列表属性中指定索引的元素
   * @param {string} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @param {any} item - 新元素
   * @returns {void}
   */
  replaceListItem(objectId, key, index, item) {
    const obj = this.#requireActiveObject(objectId);
    obj.replaceListItem(key, index, item);
    this.#materializedMarks.delete(objectId);
    this.#boardCore.aomRenderHooks.requestActiveRender([obj]);
  }

  /**
   * 开启一个增量式分子（手势 begin）
   * @description 逐对象捕获 before 快照并分配 molId；分子进行中只产生 amend 流（原子，永不落盘），
   * endMol 时折叠物化为分子记录。对象须在活动层（准入不变式）。
   * @param {string[]} objectIds - 分子覆盖的对象 id 列表
   * @param {Object} [options] - 选项
   * @param {string} [options.supraKey] - 归属的超分子 key（须已开启）
   * @param {boolean} [options.create] - 创建型分子（before 为 null，endMol 物化为 add-object 记录）
   * @returns {string} 分子 id
   * @throws {Error} 对象不是活动对象、对象列表为空或指定的超分子未开启时抛出
   */
  beginMol(objectIds, options = {}) {
    const ids = Array.isArray(objectIds) ? objectIds : [];
    if (ids.length === 0) {
      throw new Error("beginMol 需要至少一个对象");
    }
    const boardCore = this.#boardCore;
    if (
      options.supraKey !== undefined &&
      !boardCore.hitCommitter.hasSupra(options.supraKey)
    ) {
      throw new Error(`超分子 ${options.supraKey} 未开启（分子无法指定进入）`);
    }
    const objects = new Map();
    for (const objectId of ids) {
      const obj = this.#requireActiveObject(objectId);
      objects.set(objectId, {
        before: options.create === true ? null : cloneSnapshot(obj.serialize()),
        create: options.create === true ? cloneSnapshot(obj.serialize()) : null,
      });
    }
    const molId = boardCore.hitCommitter.allocateMolId();
    this.#mols.set(molId, {
      supraKey: options.supraKey ?? null,
      create: options.create === true,
      objects,
      seq: 0,
      history: [],
    });
    this.#emitAmend({
      kind: "begin-mol",
      molId,
      entries: [...objects].map(([objectId, state]) => {
        const entry = { objectId, before: state.before };
        if (state.create !== null) {
          entry.create = state.create;
        }
        return entry;
      }),
    });
    return molId;
  }

  /**
   * 对进行中的分子施加增量修正（原子载体；手势的每帧）
   * @description 补丁即时应用到活动层实例（本地渲染与 amend 流的数据源），不产生记录；
   * 对已关闭的分子幂等空操作（RPC 竞态防护）。
   * @param {string} molId - 分子 id
   * @param {Object<string, import("../types/board-api-types.js").ObjectPatch>} patchesByObject - 对象 id -> 修改 patch
   * @returns {boolean} 分子是否仍在进行中
   */
  amendMol(molId, patchesByObject) {
    const mol = this.#mols.get(molId);
    if (mol === undefined) {
      return false;
    }
    const entries = [];
    for (const [objectId, patch] of Object.entries(patchesByObject ?? {})) {
      if (!mol.objects.has(objectId) || !patch) continue;
      this.#applyObjectPatch(this.#requireActiveObject(objectId), patch);
      this.#materializedMarks.delete(objectId);
      entries.push({ objectId, patch });
    }
    if (entries.length > 0) {
      mol.seq += 1;
      // 保留全量 amend 历史（断线重连对账重放用），endMol/abortMol 时随分子清理
      mol.history.push({ seq: mol.seq, entries });
      this.#emitAmend({ kind: "amend", molId, seq: mol.seq, entries });
    }
    return true;
  }

  /**
   * 定稿一个增量式分子（end-amend）：折叠为分子记录，即时物化上链
   * @description 逐对象取当前实例快照为 after，生成 modify-object（创建型为 add-object）记录：
   * 每对象一条、同 molId、带 supraId；多对象手势在树上归并为一个分子节点。
   * 无实际差异的对象不产生记录。对已关闭的分子幂等空操作。
   * @param {string} molId - 分子 id
   * @returns {boolean} 分子是否仍在进行中（false 表示本就未开启或已关闭）
   */
  endMol(molId) {
    const mol = this.#mols.get(molId);
    if (mol === undefined) {
      return false;
    }
    this.#mols.delete(molId);
    const boardCore = this.#boardCore;
    const committer = boardCore.hitCommitter;
    for (const [objectId, state] of mol.objects) {
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;
      const chunkId = this.#resolveObjectChunkId(objectId);
      const after = obj.serialize();
      if (state.before === null) {
        // 创建型物化：主体仍在 AOM 未入静态图，无权威层位边可采（省略 chunks，重放按后到者居上）
        committer.commitAdd({
          chunkId,
          objectId,
          data: after,
          supraKey: mol.supraKey ?? undefined,
          molId,
        });
        // 创建型物化水位：后续 commitObjects 凭此跳过重复的增加对象分子
        this.#materializedMarks.add(objectId);
        continue;
      }
      const properties = this.#diffProperties(state.before, after);
      if (properties.length === 0) continue;
      // 手势修改的层位变化由配对的 choose/unchoose 记录承载，分子记录不携带层位边
      committer.commitModify({
        chunkId,
        objectId,
        properties,
        before: state.before,
        after,
        supraKey: mol.supraKey ?? undefined,
        molId,
      });
      this.#materializedMarks.add(objectId);
    }
    this.#emitAmend({ kind: "end-mol", molId });
    return true;
  }

  /**
   * 中止一个增量式分子：丢弃 amend 流，实例还原到手势起点，不产生记录
   * @description 创建型分子的中止移除暂存对象。对已关闭的分子幂等空操作。
   * @param {string} molId - 分子 id
   * @returns {boolean} 分子是否曾在进行中
   */
  abortMol(molId) {
    const mol = this.#mols.get(molId);
    if (mol === undefined) {
      return false;
    }
    this.#mols.delete(molId);
    const boardCore = this.#boardCore;
    for (const [objectId, state] of mol.objects) {
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;
      if (state.before === null) {
        // 创建型中止：暂存对象随分子一并移除（尚未物化，无需记录）
        boardCore.activeObjectManager.discard(new Set([obj]));
        boardCore.objectLoaded.delete(objectId);
        continue;
      }
      this.#applyObjectPatch(obj, {
        position: state.before.position,
        transform: state.before.transform,
        property: state.before.property,
        data: state.before.data,
      });
    }
    this.#emitAmend({ kind: "abort-mol", molId });
    return true;
  }

  /**
   * 查询本端未闭合的增量式分子清单（断线重连对账用）
   * @returns {Array<{ molId: string, supraKey: ?string, create: boolean, seq: number, entries: Array<{ objectId: string, before: ?Object }> }>} 未闭合分子清单
   */
  queryOpenMols() {
    const list = [];
    for (const [molId, mol] of this.#mols) {
      list.push({
        molId,
        supraKey: mol.supraKey,
        create: mol.create,
        seq: mol.seq,
        entries: [...mol.objects].map(([objectId, state]) => ({
          objectId,
          before: state.before,
        })),
      });
    }
    return list;
  }

  /**
   * 取指定分子在给定 seq 水位之后的 amend 段（断线重连对账重发用）
   * @param {string} molId - 分子 id
   * @param {number} [sinceSeq=0] - 对端已持有的 seq 水位
   * @returns {?{ molId: string, supraKey: ?string, create: boolean, seq: number, entries: Array<{ objectId: string, before: ?Object }>, amends: Array<{ seq: number, entries: Array<{ objectId: string, patch: Object }> }> }} 重发载荷；分子不存在时为 null
   */
  queryMolAmendSince(molId, sinceSeq = 0) {
    const mol = this.#mols.get(molId);
    if (mol === undefined) {
      return null;
    }
    return {
      molId,
      supraKey: mol.supraKey,
      create: mol.create,
      seq: mol.seq,
      entries: [...mol.objects].map(([objectId, state]) => {
        const entry = { objectId, before: state.before };
        if (state.create !== null) {
          entry.create = state.create;
        }
        return entry;
      }),
      amends: mol.history.filter((frame) => frame.seq > sinceSeq),
    };
  }

  /**
   * 发射 amend 事件（分子生命周期：begin-mol / amend / end-mol / abort-mol）
   * @param {Object} message - amend 消息
   * @returns {void}
   * @private
   */
  #emitAmend(message) {
    this.#boardCore.activityEventBus.emit("amend", message);
  }

  /**
   * 删除对象列表属性中指定索引的元素
   * @param {string} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @returns {void}
   */
  removeListItem(objectId, key, index) {
    const obj = this.#requireActiveObject(objectId);
    obj.removeListItem(key, index);
    this.#boardCore.aomRenderHooks.requestActiveRender([obj]);
  }

  /**
   * 永久删除对象集合
   * @description 删除静态对象即删除对象分子操作；指定 supraKey 时进入该超分子，否则同一次删除自成一个超分子。
   * @param {string[]} objectIds - 要删除的对象 id 列表
   * @param {Object} [options] - 删除选项
   * @param {string} [options.supraKey] - 指定进入的超分子 key
   * @returns {void}
   */
  deleteObjects(objectIds, options = {}) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(objectIds) ? objectIds : [];
    const aom = boardCore.activeObjectManager;
    const activeToDiscard = [];
    const affectedChunks = new Set();
    const deletePayloads = new Map();
    const chunkIds = new Map(
      ids.map((objectId) => [objectId, this.#resolveObjectChunkId(objectId)]),
    );

    for (const objectId of ids) {
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;
      // 远程活动对象被来源锁定，本地不可删除
      if (boardCore.activeObjectManager.isRemoteActive(objectId)) continue;

      if (aom.isActive(objectId)) {
        activeToDiscard.push(obj);
      }

      // 删除记录与 trash 条目携带删除时刻的层位边：接收端与跨会话撤销凭以恢复
      const trashChunks = this.#captureLayerEdges(objectId) ?? [];
      for (const { chunk } of boardCore.chunkLoaded.values()) {
        if (!chunk?.objectManager?.staticGraph?.hasNode(objectId)) continue;
        chunk.removeObject(objectId);
        affectedChunks.add(chunk);
      }
      const snapshot = obj.serialize();
      boardCore.trash.set(objectId, { data: snapshot, chunks: trashChunks });
      // 删除记录携带快照与层位边：接收端凭以重建 trash 条目
      deletePayloads.set(objectId, { data: snapshot, chunks: trashChunks });

      boardCore.objectLoaded.delete(objectId);
      this.#chooseSnapshots.delete(objectId);
    }

    if (activeToDiscard.length > 0) {
      aom.discard(new Set(activeToDiscard));
    }

    const committer = boardCore.hitCommitter;
    const internalKey =
      options.supraKey === undefined ? this.#beginInternalSupra() : null;
    const supraKey = options.supraKey ?? internalKey;
    try {
      for (const objectId of ids) {
        const chunkId = chunkIds.get(objectId);
        const payload = deletePayloads.get(objectId);
        if (chunkId && payload) {
          committer.commitDelete({
            chunkId,
            objectId,
            data: payload.data,
            chunks: payload.chunks,
            supraKey,
          });
        }
      }
    } finally {
      if (internalKey !== null) {
        committer.endSupra(internalKey);
      }
    }

    if (
      affectedChunks.size > 0 &&
      boardCore.aomRenderHooks.requestStaticRender
    ) {
      boardCore.aomRenderHooks.requestStaticRender([...affectedChunks]);
    }
  }

  /**
   * 捕获对象的层级关系快照
   * @description 覆盖各区块静态状态图的出边集与入边集，以及 AOM 层归属（层静态图或层动态集合）。
   * @param {string} objectId - 对象 id
   * @returns {Object} 层级关系快照
   * @private
   */
  #captureZRelations(objectId) {
    const boardCore = this.#boardCore;
    const chunks = [];
    for (const { chunk } of boardCore.chunkLoaded.values()) {
      const graph = chunk?.objectManager?.staticGraph;
      if (!graph?.hasNode(objectId)) continue;
      chunks.push({
        chunk,
        graph,
        out: new Set(graph.neighbors(objectId)),
        in: new Set(graph.predecessors(objectId)),
      });
    }
    let layerMembership = null;
    const layer = boardCore.activeObjectManager.onLayer.get(objectId);
    if (layer?.activeObjects.has(objectId)) {
      layerMembership = { layer, kind: "active" };
    } else if (layer?.inactiveGraph.hasNode(objectId)) {
      layerMembership = {
        layer,
        kind: "inactive",
        out: new Set(layer.inactiveGraph.neighbors(objectId)),
        in: new Set(layer.inactiveGraph.predecessors(objectId)),
      };
    }
    return { chunks, layerMembership };
  }

  /**
   * 擦除分裂后重建层级关系
   * @description 按橡皮文档「分裂段的层级关系重建」执行：静态状态图对快照邻居集增量 re-hit-test
   * （分裂段继承有效边、原对象删失交边），层归属由 #inheritLayerMembership 继承。
   * @param {string} originId - 被擦除对象 id（首段回写后与原对象同一 id）
   * @param {string[]} splitIds - 分裂段 id 列表
   * @param {Object} zSnapshot - #captureZRelations 的层级关系快照
   * @returns {Set<Object>} 发生边变更的区块集合
   * @private
   */
  #rebuildZRelationsAfterSplit(originId, splitIds, zSnapshot) {
    const boardCore = this.#boardCore;
    const correctedChunks = new Set();
    // 世界包围矩形
    const rectOf = (id) => getObjectWorldRect(boardCore.getObjectById(id));
    for (const { chunk, graph, out, in: incoming } of zSnapshot.chunks) {
      let dirty = false;
      // apply 为分裂段默认写入的「置顶」边先清空
      for (const splitId of splitIds) {
        if (graph.hasNode(splitId)) {
          graph.deleteAllEdgesOfNode(splitId);
          dirty = true;
        }
      }
      for (const neighborId of new Set([...out, ...incoming])) {
        if (!graph.hasNode(neighborId)) continue;
        const neighborRect = rectOf(neighborId);
        if (!neighborRect) continue;
        // 原对象（首段回写）失交删边
        if (graph.hasNode(originId)) {
          const originRect = rectOf(originId);
          if (originRect && !intersectsRanges(originRect, neighborRect)) {
            if (graph.hasEdge(originId, neighborId)) {
              graph.deleteEdge(originId, neighborId);
              dirty = true;
            }
            if (graph.hasEdge(neighborId, originId)) {
              graph.deleteEdge(neighborId, originId);
              dirty = true;
            }
          }
        }
        // 分裂段按相交继承原边方向
        for (const splitId of splitIds) {
          if (!graph.hasNode(splitId)) continue;
          const splitRect = rectOf(splitId);
          if (!splitRect || !intersectsRanges(splitRect, neighborRect)) continue;
          if (out.has(neighborId) && !graph.hasEdge(splitId, neighborId)) {
            graph.addEdge(splitId, neighborId);
            dirty = true;
          }
          if (incoming.has(neighborId) && !graph.hasEdge(neighborId, splitId)) {
            graph.addEdge(neighborId, splitId);
            dirty = true;
          }
        }
      }
      if (dirty) {
        correctedChunks.add(chunk);
      }
    }
    this.#inheritLayerMembership(splitIds, zSnapshot.layerMembership);
    return correctedChunks;
  }

  /**
   * 分裂段继承原对象的层归属
   * @description 层静态图整体复制出边与入边（层位继承），层动态集合直接加入；
   * 分裂段先离开出生时注册的顶层。
   * @param {string[]} splitIds - 分裂段 id 列表
   * @param {?Object} layerMembership - #captureZRelations 捕获的层归属
   * @returns {void}
   * @private
   */
  #inheritLayerMembership(splitIds, layerMembership) {
    if (!layerMembership || splitIds.length === 0) return;
    const aom = this.#boardCore.activeObjectManager;
    const { layer, kind } = layerMembership;
    for (const splitId of splitIds) {
      aom.removeObjectFromLayer(splitId);
      if (kind === "inactive") {
        aom.unregisterTrackedActiveObject(splitId);
        const graph = layer.inactiveGraph;
        if (!graph.hasNode(splitId)) {
          graph.addNode(splitId);
        }
        for (const neighborId of layerMembership.out) {
          if (graph.hasNode(neighborId) && !graph.hasEdge(splitId, neighborId)) {
            graph.addEdge(splitId, neighborId);
          }
        }
        for (const neighborId of layerMembership.in) {
          if (graph.hasNode(neighborId) && !graph.hasEdge(neighborId, splitId)) {
            graph.addEdge(neighborId, splitId);
          }
        }
      } else {
        layer.activeObjects.add(splitId);
      }
      aom.onLayer.set(splitId, layer);
    }
    aom.requestActiveRender(
      splitIds.map((id) => this.#boardCore.getObjectById(id)).filter(Boolean),
    );
  }

  /**
   * 按橡皮轨迹擦除命中对象的数据
   * @description
   * 数据擦除的 Core 侧统一入口。调用进入串行队列依次执行，返回的 Promise
   * 在本次调用（含队列等待）完成后兑现。
   * @param {{ points: Array<{x: number, y: number}>, radius: number, source?: string }} payload - 轨迹段（世界坐标）、橡皮半径与来源标识
   * @param {Object} [options] - 擦除选项
   * @param {string} [options.supraKey] - 指定进入的超分子 key（缺省本次调用自成一个超分子）
   * @returns {Promise<{ modified: string[], created: string[], deleted: string[] }>} 受影响对象 id 三组
   */
  eraseData(payload, options = {}) {
    const run = this.#eraseDataQueue.then(() => this.#performEraseData(payload, options.supraKey));
    this.#eraseDataQueue = run.catch(() => { });
    return run;
  }

  /**
   * 执行单次数据擦除
   * @description
   * 粗筛命中 → 过滤 → 逐对象 eraseData 精确切割，
   * 按剩余点段分流（整笔删除 / 首段回写 / 其余段分裂新建并提交静态图）。
   * 分裂对象的 id 从 Core 侧分配器表按来源取用。
   *
   * 过滤规则：仅处理 isErasable() 为 true 且不是活动对象的对象——
   * 已被选中的对象不能被擦除，与选择逻辑的互斥一致；
   * 非活动层成员（被 pickup 一并纳入 AOM）与静态对象均可擦除。
   * @param {{ points: Array<{x: number, y: number}>, radius: number, source?: string }} payload - 轨迹段（世界坐标）、橡皮半径与来源标识
   * @returns {Promise<{ modified: string[], created: string[], deleted: string[] }>} 受影响对象 id 三组
   * @private
   */
  async #performEraseData(payload, supraKey) {
    // 一次 FD 擦除 = 修改对象（回写首段）+ 增加对象（分裂段）+ 删除对象（整笔擦没）的有序组合
    const internalKey = supraKey === undefined ? this.#beginInternalSupra() : null;
    try {
      return await this.#performEraseDataInner(payload, supraKey ?? internalKey);
    } finally {
      if (internalKey !== null) {
        this.#boardCore.hitCommitter.endSupra(internalKey);
      }
    }
  }

  /**
   * 单次数据擦除的内部实现
   * @param {{ points: Array<{x: number, y: number}>, radius: number, source?: string }} payload - 轨迹段（世界坐标）、橡皮半径与来源标识
   * @param {string} supraKey - 内部超分子 key
   * @returns {Promise<{ modified: string[], created: string[], deleted: string[] }>} 受影响对象 id 三组
   * @private
   */
  async #performEraseDataInner(payload, supraKey) {
    const boardCore = this.#boardCore;
    const points = Array.isArray(payload?.points) ? payload.points : [];
    const radius = Number.isFinite(payload?.radius) ? payload.radius : 0;
    const source = typeof payload?.source === "string" ? payload.source : "";

    const result = { modified: [], created: [], deleted: [] };
    if (points.length === 0 || radius <= 0) {
      return result;
    }

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const margin = radius + ERASE_COARSE_MARGIN;
    const minX = Math.min(...xs) - margin;
    const minY = Math.min(...ys) - margin;
    const maxX = Math.max(...xs) + margin;
    const maxY = Math.max(...ys) + margin;
    const queryRange = new RectangleRange(
      minX,
      minY,
      maxX - minX,
      maxY - minY,
    );

    const candidateIds = await this.#collectHitObjects(boardCore, queryRange);

    const modifiedStaticObjects = [];
    const previousWorldRects = new Map();
    const splitRebuilds = [];
    const modifiedInfos = [];
    for (const objectId of candidateIds) {
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;
      if (typeof obj.isErasable !== "function" || !obj.isErasable()) continue;
      if (typeof obj.eraseData !== "function") continue;
      // 已被选中的对象（本地或远程活动对象）不能被擦除
      if (
        boardCore.activeObjectManager.isActive(objectId) ||
        boardCore.activeObjectManager.isRemoteActive(objectId)
      ) {
        continue;
      }

      const runs = obj.eraseData(points, radius);
      if (runs == null) continue;

      if (runs.length === 0) {
        result.deleted.push(objectId);
        continue;
      }

      const zSnapshot = this.#captureZRelations(objectId);

      // 切割前快照旧世界范围：输出层按脏区增量更新，
      // 被擦区域与回缩残端的旧像素要靠旧范围失效才能清理
      const previousWorldRect = getObjectWorldRect(obj);
      if (previousWorldRect) {
        previousWorldRects.set(objectId, previousWorldRect);
      }

      const beforeErase = obj.serialize();
      // 内核复合操作通道：擦除回写是切割效果的原子表达，非用户更改，不经活动对象准入
      this.#applyObjectPatch(obj, { data: { points: runs[0] } });
      // 记录延迟到层位边重建完毕后统一物化：modify 携带前后层位边，分裂段 add 携带重建后的实际边
      modifiedInfos.push({ objectId, beforeErase, zSnapshot });
      result.modified.push(objectId);
      modifiedStaticObjects.push(obj);

      if (runs.length > 1) {
        const serialized = obj.serialize();
        const splitIds = [];
        for (let i = 1; i < runs.length; i++) {
          const newObjectId = boardCore.allocateObjectId(source);
          this.createObject(serialized.type, {
            id: newObjectId,
            position: serialized.position,
            transform: serialized.transform,
            property: serialized.property,
            data: { ...serialized.data, points: runs[i] },
          });
          splitIds.push(newObjectId);
          result.created.push(newObjectId);
        }
        splitRebuilds.push({ originId: objectId, splitIds, zSnapshot });
      } else {
        splitRebuilds.push({ originId: objectId, splitIds: [], zSnapshot });
      }
    }

    if (result.deleted.length > 0) {
      this.deleteObjects(result.deleted, { supraKey });
    }
    if (result.created.length > 0) {
      // 分裂段直接提交静态图（不经 commitObjects）：层位边待分裂重建后才确定，
      // 记录统一在重建后物化，携带重建后的实际边
      const splitObjects = result.created
        .map((id) => boardCore.getObjectById(id))
        .filter(Boolean);
      await boardCore.activeObjectManager.apply(new Set(splitObjects));
    }

    const correctedChunks = new Set();
    for (const { originId, splitIds, zSnapshot } of splitRebuilds) {
      for (const chunk of this.#rebuildZRelationsAfterSplit(originId, splitIds, zSnapshot)) {
        correctedChunks.add(chunk);
      }
    }

    // 层位边重建完毕，统一物化记录：擦除回写（modify，携带前后层位边）+
    // 分裂段（add，携带提交后的实际层位边），重放/远端凭记录边精确应用
    const committer = boardCore.hitCommitter;
    for (const { objectId, beforeErase, zSnapshot } of modifiedInfos) {
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;
      committer.commitModify({
        chunkId: this.#resolveObjectChunkId(objectId),
        objectId,
        properties: ["data"],
        before: beforeErase,
        after: obj.serialize(),
        chunks: {
          before: zSnapshot.chunks.map((entry) => ({
            chunkId: String(entry.chunk.id),
            below: [...entry.in],
            above: [...entry.out],
          })),
          after: this.#captureLayerEdges(objectId),
        },
        supraKey,
      });
    }
    for (const splitId of result.created) {
      const obj = boardCore.getObjectById(splitId);
      if (!obj) continue;
      committer.commitAdd({
        chunkId: this.#resolveObjectChunkId(splitId),
        objectId: splitId,
        data: obj.serialize(),
        chunks: this.#captureLayerEdges(splitId),
        supraKey,
      });
    }

    if (correctedChunks.size > 0) {
      boardCore.aomRenderHooks.requestStaticRender([...correctedChunks]);
    }
    if (modifiedStaticObjects.length > 0) {
      boardCore.aomRenderHooks.requestStaticRenderForObjects(
        modifiedStaticObjects,
        [],
        previousWorldRects,
      );
    }

    return result;
  }

  /**
   * 将 AOM 动态图中的对象写回静态图
   * @description commit 边界：首次进入静态图的对象凝聚为增加对象分子，被选择过的静态对象凝聚为
   * 修改对象分子（前快照取自选择时刻）并配对取消选择分子；指定 supraKey 时进入该超分子，否则同一次提交自成一个超分子。
   * @param {string[]} objectIds - 要提交的对象 id 列表
   * @param {Object} [options] - 提交选项
   * @param {string} [options.supraKey] - 指定进入的超分子 key
   * @returns {Promise<string[]>} 实际提交的对象 id（缺失的 id 被跳过，供调用方对账）
   */
  async commitObjects(objectIds, options = {}) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(objectIds) ? objectIds : [];
    const objects = ids
      .map((id) => boardCore.getObjectById(id))
      .filter(Boolean);
    if (objects.length === 0) {
      return [];
    }
    const wasStatic = new Map(
      objects.map((obj) => [obj.id, hasStaticBoardObject(boardCore, obj.id)]),
    );
    const committable = objects.filter((obj) => {
      if (!wasStatic.get(obj.id)) return true;
      // 已回静态层的对象（如 choose 被撤销后残留选择前快照）重复提交是幂等空操作：
      // 不产生取消选择分子，避免与会话超分子闭合竞态
      if (!boardCore.activeObjectManager.has(obj.id)) return false;
      if (this.#chooseSnapshots.has(obj.id)) return true;
      throw new Error(`对象 ${obj.id} 缺选择前快照`);
    });
    if (committable.length === 0) {
      return objects.map((obj) => obj.id);
    }
    // 提交前快照各对象的命名选择（apply 后成员关系即解除，取消选择分子凭以留名）
    const choiceOfObject = new Map(
      committable.map((obj) => [
        obj.id,
        boardCore.activeObjectManager.choiceOf(obj.id),
      ]),
    );
    await boardCore.activeObjectManager.apply(new Set(committable));

    const committer = boardCore.hitCommitter;
    const internalKey =
      options.supraKey === undefined ? this.#beginInternalSupra() : null;
    const supraKey = options.supraKey ?? internalKey;
    try {
      for (const obj of committable) {
        const chunkId = this.#resolveObjectChunkId(obj.id);
        const after = obj.serialize();
        // apply 已把全部提交对象的层位边写入静态图：逐对象捕获提交后的实际边
        //（同批对象的相互关系已就位），重放/远端凭记录边应用，不经本地重算
        const chunks = this.#captureLayerEdges(obj.id);
        if (wasStatic.get(obj.id)) {
          const before = this.#chooseSnapshots.get(obj.id);
          if (before === undefined) {
            throw new Error(`对象 ${obj.id} 缺选择前快照`);
          }
          const properties = this.#diffProperties(before, after);
          // 无实际差异时不产生修改分子；层位变化由 choose/unchoose 记录的层位边承载
          // 已被 endMol 物化覆盖（已物化水位）的对象不重复产生修改分子，只产取消选择分子
          if (properties.length > 0 && !this.#materializedMarks.has(obj.id)) {
            committer.commitModify({
              chunkId,
              objectId: obj.id,
              properties,
              before,
              after,
              supraKey,
            });
          }
          committer.commitUnchoose({
            chunkId,
            objectId: obj.id,
            supraKey,
            choice: choiceOfObject.get(obj.id),
            chunks,
          });
          this.#chooseSnapshots.delete(obj.id);
          this.#materializedMarks.delete(obj.id);
        } else {
          // 已被 endMol 物化覆盖（已物化水位）的创建不重复产生增加对象分子
          if (this.#materializedMarks.has(obj.id)) continue;
          committer.commitAdd({
            chunkId,
            objectId: obj.id,
            data: after,
            chunks,
            supraKey,
          });
        }
      }
    } finally {
      if (internalKey !== null) {
        committer.endSupra(internalKey);
      }
    }
    this.#emitActivity(
      "commit",
      committable.map((obj) => obj.id),
    );
    return objects.map((obj) => obj.id);
  }

  /**
   * 将对象加入 AOM 动态图
   * @description 静态对象进入 AOM 即选择对象分子操作：捕获选择前快照（修改分子的前快照）并提交记录。
   * 返回的 Promise 在 pickup 完成（对象成为活动对象）后兑现。
   * @param {string[]} objectIds - 对象 id 列表
   * @param {Object} [options] - 选择选项
   * @param {string} [options.supraKey] - 指定进入的超分子 key
   * @param {string} [options.choice] - 命名选择（choice）；缺省落匿名选择
   * @returns {Promise<void>}
   */
  async addActiveObjects(objectIds, options = {}) {
    const boardCore = this.#boardCore;
    if (
      options.choice !== undefined &&
      !isValidChoiceName(options.choice)
    ) {
      throw new Error(`非法 choice 名：${options.choice}`);
    }
    const ids = Array.isArray(objectIds) ? objectIds : [];
    const objects = ids
      .map((id) => boardCore.getObjectById(id))
      .filter(Boolean)
      // 远程活动对象被来源锁定，本地不可选择
      .filter((obj) => !boardCore.activeObjectManager.isRemoteActive(obj.id));
    if (objects.length === 0) {
      return;
    }
    const committer = boardCore.hitCommitter;
    const internalKey =
      options.supraKey === undefined ? this.#beginInternalSupra() : null;
    const supraKey = options.supraKey ?? internalKey;
    try {
      for (const obj of objects) {
        if (!hasStaticBoardObject(boardCore, obj.id)) continue;
        // 已在活动层的对象不重复记录；重新选择已退出的对象（如 choose 被撤销后）
        // 需重新捕获选择前快照并产生选择分子，不能以残留快照为由跳过
        if (boardCore.activeObjectManager.isActive(obj.id)) continue;
        this.#chooseSnapshots.set(obj.id, cloneSnapshot(obj.serialize()));
        committer.commitChoose({
          chunkId: this.#resolveObjectChunkId(obj.id),
          objectId: obj.id,
          supraKey,
          choice: options.choice,
          // 提取边：选择不改变静态图，选择时刻的层位边是撤销会话时的恢复依据
          chunks: this.#captureLayerEdges(obj.id),
        });
      }
      await boardCore.activeObjectManager.choose(new Set(objects));
    } finally {
      if (internalKey !== null) {
        committer.endSupra(internalKey);
      }
    }
    boardCore.activeObjectManager.assignLocalChoice(
      objects.map((obj) => obj.id),
      options.choice ?? ANONYMOUS_CHOICE_NAME,
    );
    // 按当前命名选择分组广播 choose 活动：命名选择各自带名，匿名合并为一条
    const chooseIdsByChoice = new Map();
    for (const obj of objects) {
      const name = boardCore.activeObjectManager.choiceOf(obj.id);
      const key = name ?? "";
      if (!chooseIdsByChoice.has(key)) chooseIdsByChoice.set(key, []);
      chooseIdsByChoice.get(key).push(obj.id);
    }
    for (const [key, ids] of chooseIdsByChoice) {
      this.#emitActivity("choose", ids, key === "" ? undefined : key);
    }
  }

  /**
   * 将对象从 AOM 动态图移除
   * @description 静态对象被放弃更改即取消选择分子操作；生于 AOM 的暂存对象不产生记录。
   * 已退出活动层的对象（如 choose 被撤销后的残留选择）丢弃为幂等空操作，不产生记录。
   * @param {string[]} objectIds - 对象 id 列表
   * @param {Object} [options] - 选项
   * @param {string} [options.supraKey] - 指定进入的超分子 key
   * @returns {void}
   */
  discardActiveObjects(objectIds, options = {}) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(objectIds) ? objectIds : [];
    const objects = ids
      .map((id) => boardCore.getObjectById(id))
      .filter(Boolean);

    const transientObjectIds = objects.filter(
      (obj) => !hasStaticBoardObject(boardCore, obj.id),
    );

    // 不在 AOM 的对象（choose 被撤销后快照仍在）跳过：不还原快照、不产取消选择分子，
    // 否则残留选择的延迟丢弃会把 unchoose(discard) 泄漏进后续会话的超分子
    const discardable = objects.filter((obj) =>
      boardCore.activeObjectManager.has(obj.id),
    );

    // 放弃前快照各对象的命名选择（discard 后成员关系即解除，取消选择分子凭以留名）
    const choiceOfObject = new Map(
      discardable.map((obj) => [
        obj.id,
        boardCore.activeObjectManager.choiceOf(obj.id),
      ]),
    );
    boardCore.activeObjectManager.discard(new Set(discardable));

    const committer = boardCore.hitCommitter;
    const internalKey =
      options.supraKey === undefined ? this.#beginInternalSupra() : null;
    const supraKey = options.supraKey ?? internalKey;
    try {
      for (const obj of discardable) {
        // 放弃更改仅在对象确经选择时产生取消选择分子
        if (this.#chooseSnapshots.has(obj.id)) {
          // 用选择前快照还原实例（choose→modify→discard 链的整体回滚），
          // 否则实例已携带的修改会随失活回到静态层，污染静态图
          const snapshot = this.#chooseSnapshots.get(obj.id);
          this.#applyObjectPatch(obj, {
            position: snapshot.position,
            transform: snapshot.transform,
            property: snapshot.property,
            data: snapshot.data,
          });
          committer.commitUnchoose({
            chunkId: this.#resolveObjectChunkId(obj.id),
            objectId: obj.id,
            supraKey,
            choice: choiceOfObject.get(obj.id),
            // 放弃型闭合标志：对象退出活动层且状态回选择前快照；
            // restore 快照供重放/重做/远端还原（实例的本地还原本路径上方已完成）
            discard: true,
            restore: {
              position: snapshot.position,
              transform: snapshot.transform,
              property: snapshot.property,
              data: snapshot.data,
            },
            // 提交边：discard 写回静态图后的实际层位边（实况如何，记录即如何）
            chunks: this.#captureLayerEdges(obj.id),
          });
          this.#chooseSnapshots.delete(obj.id);
          this.#materializedMarks.delete(obj.id);
        }
      }
    } finally {
      if (internalKey !== null) {
        committer.endSupra(internalKey);
      }
    }

    for (const objectId of transientObjectIds) {
      boardCore.objectLoaded.delete(objectId);
    }
    this.#emitActivity(
      "unchoose",
      objects.map((obj) => obj.id),
    );
  }

  /**
   * 发射本地 AOM 活动事件（ephemeral）
   * @param {"choose"|"unchoose"|"commit"} kind - 事件种类
   * @param {string[]} ids - 对象 id 列表
   * @param {string} [choice] - 命名选择名（choose 事件携带；匿名缺省）
   * @returns {void}
   * @private
   *
   * @description
   * choose/unchoose/commit 记录即时物化入日志（权威路径）；本通道是 ephemeral 的
   * 实时可见与互斥依据，远端凭它即时登记远程活动，日志记录到达后收敛。
   */
  #emitActivity(kind, ids, choice) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    this.#boardCore.activityEventBus.emit("activity", {
      kind,
      ids: [...ids],
      source: this.#boardCore.hitCommitter.source,
      time: Date.now(),
      ...(choice !== undefined ? { choice } : {}),
    });
  }

  /**
   * 应用远程 AOM 活动事件（ephemeral 通道入口）
   * @param {Object|Object[]} events - 远程活动事件（{kind, ids}）
   * @param {string} source - 来源标识
   * @returns {void}
   */
  applyRemoteActivity(events, source) {
    if (typeof source !== "string" || source === "") return;
    const boardCore = this.#boardCore;
    const aom = boardCore.activeObjectManager;
    const list = Array.isArray(events) ? events : [events];
    const changedIds = new Set();
    for (const event of list) {
      const ids = Array.isArray(event?.ids) ? event.ids : [];
      if (ids.length === 0) continue;
      if (event.kind === "choose") {
        aom.applyRemoteChoose(ids, source, event.choice);
      } else if (event.kind === "unchoose" || event.kind === "commit") {
        aom.applyRemoteUnchoose(ids, source);
      }
      for (const id of ids) changedIds.add(id);
    }
    const instances = [...changedIds]
      .map((id) => boardCore.getObjectById(id))
      .filter(Boolean);
    if (instances.length > 0) {
      aom.requestActiveRender(instances);
    }
    if (changedIds.size > 0) {
      for (const id of changedIds) this.#remoteChoicesDirtyIds.add(id);
      this.#remoteChoicesDirty = true;
      this.#flushRemoteChoicesNotification();
    }
  }

  /**
   * 清理某来源的全部远程活动登记（断线清理入口）
   * @param {string} source - 来源标识
   * @returns {string[]} 被清理的对象 id 列表
   */
  clearRemoteActivity(source) {
    const removed = this.#boardCore.activeObjectManager.clearRemoteActive(source);
    const instances = removed
      .map((id) => this.#boardCore.getObjectById(id))
      .filter(Boolean);
    if (instances.length > 0) {
      this.#boardCore.activeObjectManager.requestActiveRender(instances);
    }
    if (removed.length > 0) {
      for (const id of removed) this.#remoteChoicesDirtyIds.add(id);
      this.#remoteChoicesDirty = true;
      this.#flushRemoteChoicesNotification();
    }
    return removed;
  }

  /**
   * 上报 UI 侧对象 id 池计数
   * @param {string} source - 来源标识
   * @param {number} counter - 已分配的最大计数
   * @returns {boolean} 是否接受（单调取大，回拨不报）
   *
   * @description
   * UI 侧对象 id 池的计数随板元数据持久化，重开板后续种防碰撞。
   */
  reportObjectIdCounter(source, counter) {
    return this.#boardCore.reportObjectIdCounter(source, counter);
  }

  /**
   * 读取 UI 侧对象 id 池计数表
   * @returns {Object<string, number>} 各来源已分配的最大计数
   */
  getObjectIdCounters() {
    return this.#boardCore.getObjectIdCounters();
  }

  /**
   * 创建并提交一个对象（持板侧原子完成 id 分配、创建、提交与计数上报）
   * @param {string} type - 对象类型名
   * @param {Object} [props={}] - 创建属性（position / transform / property / data，不含 id）
   * @returns {Promise<string>} 新对象的 objectId
   *
   * @description
   * id 按板身份的对象 id 池续号分配。组合面供非本地前端（CLI / daemon 客户端）使用：
   * 若由客户端先读计数再创建，并发客户端可能取到同一计数而撞 id，故分配必须在持板侧串行完成。
   */
  async addObject(type, props = {}) {
    const boardCore = this.#boardCore;
    const source = boardCore.hitCommitter.source;
    const counters = boardCore.getObjectIdCounters();
    const pool = new IncrementalIdPool(source, counters[source] ?? 0);
    // 防撞循环：计数可能滞后（远端 ingest 未推进/重开后盘上计数表滞后），
    // 分配后检查对象是否已存在，撞号则续到下一个空位
    let id = pool.allocate();
    while (boardCore.getObjectById(id)) {
      id = pool.allocate();
    }
    this.createObject(type, { ...props, id });
    // 计数在 commit 的异步让出前上报：并发调用分配时读到已上报的最新计数，避免撞号
    this.reportObjectIdCounter(source, pool.counter);
    await this.commitObjects([id]);
    return id;
  }

  /**
   * 查询板概要信息（meta、日志规模、HEAD、对象与 trash 计数）
   * @returns {Object} 板概要
   */
  queryBoardInfo() {
    const boardCore = this.#boardCore;
    const meta = boardCore.collectSessionMeta();
    return {
      boardConfig: meta.boardConfig,
      records: boardCore.operationLog.size,
      head: boardCore.undoTree.head?.shareId ?? null,
      chain: boardCore.undoTree
        .getActiveChain()
        .map((node) => node.shareId),
      objects: boardCore.getAllObjects().length,
      trash: boardCore.trash.size,
      coreIdCounters: meta.coreIdCounters,
      objectIdCounters: meta.objectIdCounters,
    };
  }

  /**
   * 列出活动与 trash 对象
   * @returns {{objects: Array<{id: string, type: string}>, trash: string[]}} 对象清单
   */
  queryObjectList() {
    const boardCore = this.#boardCore;
    return {
      objects: boardCore
        .getAllObjects()
        .map((obj) => ({ id: obj.id, type: obj.type ?? obj.constructor.name })),
      trash: [...boardCore.trash.keys()],
    };
  }

  /**
   * 查询单个对象的序列化数据
   * @param {string} objectId - 对象 id
   * @returns {Object|null} 序列化数据；对象不存在时为 null
   */
  queryObject(objectId) {
    return this.#boardCore.getObjectById(objectId)?.serialize() ?? null;
  }

  /**
   * 查询操作日志记录明细
   * @description 过滤先于 limit：先按来源/类型筛选，再取末尾 limit 条（最新侧）。
   * @param {Object} [options] - 查询选项
   * @param {string} [options.source] - 按记录来源过滤
   * @param {string} [options.type] - 按分子操作类型过滤
   * @param {number} [options.limit] - 仅保留末尾 N 条
   * @returns {Array<Object>} 操作记录数组（含 id、type、source、time、parentId、supraOpId、molId、supraId、discard、properties、payload）
   */
  queryOperations(options = {}) {
    let records = this.#boardCore.operationLog.toJSON();
    if (typeof options.source === "string" && options.source !== "") {
      records = records.filter((record) => record.source === options.source);
    }
    if (typeof options.type === "string" && options.type !== "") {
      records = records.filter((record) => record.type === options.type);
    }
    if (Number.isInteger(options.limit) && options.limit > 0) {
      records = records.slice(-options.limit);
    }
    return records;
  }

  /**
   * 查询时间回溯树结构
   * @description 节点表为扁平先根遍历（子节点按时间标记升序），含活动链外的已撤销分支；
   * CLI 等前端可凭 parentId/depth 排版缩进树。多记录节点（增量式分子/聚合节点）以 memberTypes 列出成员类型。
   * @returns {{head: ?string, activeChain: string[], redoStack: Array<{targetId: string, previousHeadId: string}>, nodes: Array<{id: string, parentId: ?string, depth: number, type: ?string, memberTypes: ?string[], molId: ?string, supraId: ?string, source: ?string, active: boolean, isHead: boolean}>}} 树结构
   */
  queryUndoTree() {
    const boardCore = this.#boardCore;
    const tree = boardCore.undoTree;
    const activeChain = tree.getActiveChain().map((node) => node.shareId);
    const activeIds = new Set(activeChain);
    const recordById = new Map(
      boardCore.operationLog.toJSON().map((record) => [record.id, record]),
    );
    const nodes = [];
    const walk = (parent) => {
      for (const child of parent.children) {
        const record = recordById.get(child.shareId);
        // 多记录节点（增量式分子/聚合节点）以节点 memberIds 为准展开成员类型；
        // discard 型取消选择成员标注 (discard) 后缀
        const memberTypes =
          child.memberIds.length > 1
            ? child.memberIds
              .map((id) => {
                const member = recordById.get(id);
                if (member == null) return null;
                return member.discard === true
                  ? `${member.type}(discard)`
                  : member.type;
              })
              .filter((type) => type !== null)
            : null;
        nodes.push({
          id: child.shareId,
          parentId: parent.shareId ?? null,
          depth: child.depth,
          type:
            record == null
              ? null
              : record.discard === true
                ? `${record.type}(discard)`
                : record.type,
          memberTypes,
          molId: child.molId,
          supraId: child.supraId,
          source: record?.source ?? null,
          active: activeIds.has(child.shareId),
          isHead: child === tree.head,
        });
        walk(child);
      }
    };
    walk(tree.root);
    return {
      head: tree.head?.shareId ?? null,
      activeChain,
      redoStack: tree.getRedoStack(),
      nodes,
    };
  }

  /**
   * 按 id 查询对象摘要
   * @param {string[]} ids - 对象 id 列表
   * @returns {import("../types/types.js").ObjectSummary[]} 对象摘要列表
   */
  queryObjects(ids) {
    return this.#collectObjects(ids).map((obj) =>
      buildObjectSummary(this.#boardCore, obj),
    );
  }

  /**
   * 按 id 查询对象详情
   * @description
   * 在摘要之外带回几何数据快照、属性快照、引用计数与覆盖区块，供调试与命令行诊断。
   * 返回体会随几何复杂度增长（一条笔迹带完整点数组），不得用在框选、手势等高频路径。
   * @param {string[]} ids - 对象 id 列表
   * @returns {import("../types/types.js").ObjectDetails[]} 对象详情列表
   */
  queryObjectDetails(ids) {
    return this.#collectObjects(ids).map((obj) =>
      buildObjectDetails(this.#boardCore, obj),
    );
  }

  /**
   * 按 id 收集已驻留对象
   * @param {string[]} ids - 对象 id 列表
   * @returns {import("../objects/basic-obj.js").BasicObject[]} 存在的对象
   * @private
   */
  #collectObjects(ids) {
    const boardCore = this.#boardCore;
    const idList = Array.isArray(ids) ? ids : [];
    return idList
      .map((objectId) => boardCore.getObjectById(objectId))
      .filter(Boolean);
  }

  /**
   * 列出本端的命名选择
   * @returns {{ name: string, ids: string[] }[]} 命名选择列表（匿名选择不暴露）
   *
   * @description
   * AOM 注册表是命名选择的权威状态：列出的对象必然在活动集中，不存在与影子状态漂移的问题。
   */
  queryChoices() {
    return this.#boardCore.activeObjectManager.queryLocalChoices();
  }

  /**
   * 列出全部远程命名选择（awareness 查询面）
   * @returns {{ source: string, name: string|undefined, ids: string[] }[]} 远程选择列表（匿名为 name undefined）
   *
   * @description
   * 远程注册表经 ephemeral 活动事件、日志回放与断线清理三路维护；UI 选中装饰据此按来源着色。
   */
  queryRemoteChoices() {
    return this.#boardCore.activeObjectManager.queryRemoteChoices();
  }

  /**
   * 计算对象状态的确定性校验和
   * @description 口径为**已驻留**对象数据（按 id 排序的 serialize JSON）与 trash 条目；不含 AOM
   * 成员身份与区块层序（各端已载区块集随视口不同，纳入会误报）。只在全量驻留端
   * （`boardCore.isFullResidency()`）之间可比：部分驻留端的已载集合随视口漂移，跨端比对必误报。
   * 供同步 digest 发现效果层分歧（日志一致但效果未放全）。
   * @returns {string} 状态校验和
   */
  queryStateHash() {
    const boardCore = this.#boardCore;
    const parts = [];
    const objects = boardCore
      .getAllObjects()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const obj of objects) {
      parts.push(JSON.stringify(obj.serialize()));
    }
    parts.push("|trash|");
    const trashIds = [...boardCore.trash.keys()].sort();
    for (const id of trashIds) {
      parts.push(id, JSON.stringify(boardCore.trash.get(id)));
    }
    return hashString(parts.join(""));
  }

  /**
   * 计算活动链的确定性校验和
   * @description 口径为活动链全部节点的成员记录 id 序列（链序）。活动链是 f(日志) 的派生态，
   * 与对象驻留无关，任意两端在日志一致时可比：链校验和分歧说明本地树的派生与对端不一致。
   * @returns {string} 活动链校验和
   */
  queryChainHash() {
    const parts = [];
    for (const node of this.#boardCore.undoTree.getActiveChain()) {
      for (const id of node.memberIds) {
        parts.push(id);
      }
    }
    return hashString(parts.join(""));
  }

  /**
   * 找出本地活动中尚未提交、不能被日志派生态覆盖的对象
   * @returns {Set<string>} 受保护对象 id 集合
   * @private
   */
  #uncommittedLocalObjectIds() {
    const protectedIds = new Set();
    for (const hold of this.#boardCore.activeObjectManager.queryLocalActivity()) {
      for (const objectId of hold.ids) {
        const obj = this.#boardCore.getObjectById(objectId);
        if (!obj) continue;
        const before = this.#chooseSnapshots.get(objectId);
        if (
          !hasStaticBoardObject(this.#boardCore, objectId) ||
          before === undefined ||
          canonicalJson(before) !== canonicalJson(obj.serialize())
        ) {
          protectedIds.add(objectId);
        }
      }
    }
    return protectedIds;
  }

  /**
   * 从权威日志重建时间回溯树并对齐白板效果
   * @returns {{repaired: boolean, fixedIds: string[]}} 修复结果
   */
  repairChainFromLog() {
    if (
      this.queryOpenMols().length > 0 ||
      this.#uncommittedLocalObjectIds().size > 0
    ) {
      return { repaired: false, fixedIds: [] };
    }
    const beforeHash = this.queryChainHash();
    const beforeRecords = this.#recordsOfChain(
      this.#boardCore.undoTree.getActiveChain(),
    );
    this.#boardCore.undoTree.rebuild();
    const effectsChanged = this.#transitionEffects(
      beforeRecords,
      this.#recordsOfChain(this.#boardCore.undoTree.getActiveChain()),
    );
    this.#flushRemoteChoicesNotification();
    const repaired = effectsChanged || beforeHash !== this.queryChainHash();
    if (repaired) {
      this.#boardCore.activityEventBus.emit("hit-changed", { time: Date.now() });
    }
    return { repaired, fixedIds: repaired ? ["chain"] : [] };
  }

  /**
   * 从本端日志重放派生对象状态并对齐活体（效果层分歧自愈）
   * @description 正确性定义为「对象状态 == f(日志)」：scratch 核心按日志序纯增量重放全部
   * 记录得到派生态（undo/redo/折叠随回放自然呈现，永不触发重建），与活体逐对象比对后以
   * remove+add 对齐（addObjectEffect 自带区块落座与层序，绕开跨区块重排位问题），trash 全量
   * 对齐，层位边逐已载区块比对重写（digest 口径不含层序，边级分歧借此通道自愈）。
   * 派生态多出但经卸载路径合法离场（驻留驱逐）的对象不补回内存（部分驻留硬约束，保住 chunkUnload）。
   * 本地有未闭合分子时拒绝修复；无 open mol 但有未提交修改的活动对象逐项跳过，
   * 保留其实例与 choice，含本地活动对象的区块层位同样跳过对齐。
   * @returns {{ repaired: boolean, fixedIds: string[] }} 修复结果；repaired=false 表示被门拒绝或无分歧
   */
  repairStateFromLog() {
    const boardCore = this.#boardCore;
    if (this.queryOpenMols().length > 0) {
      return { repaired: false, fixedIds: [] };
    }
    const scratchCore = new BoardCore({
      width: boardCore.width,
      height: boardCore.height,
      source: "__repair__",
      chunkUnload: false,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    new BoardApi(scratchCore).applyRemoteOperations(
      boardCore.operationLog.toJSON(),
    );

    const affectedChunks = new Set();
    const fixedIds = new Set();
    const protectedIds = this.#uncommittedLocalObjectIds();
    const canonical = (obj) => JSON.stringify(obj.serialize());
    const derived = new Map(
      scratchCore.getAllObjects().map((obj) => [obj.id, obj]),
    );
    for (const live of boardCore.getAllObjects()) {
      if (protectedIds.has(live.id)) {
        derived.delete(live.id);
        continue;
      }
      const want = derived.get(live.id);
      if (want !== undefined && canonical(want) === canonical(live)) {
        derived.delete(live.id);
        continue;
      }
      // 活体多出或数据分歧：先移除（新增与改判的重建统一走下方 addObjectEffect）
      this.#removeObjectEffect(live.id, affectedChunks);
      fixedIds.add(live.id);
    }
    for (const obj of derived.values()) {
      // 部分驻留硬约束：经卸载路径合法离场的对象不补回内存（保住 chunkUnload）；
      // 效果缺失（非驱逐）照常补回。digest 通道已按全量驻留门控，本约束兜底直接调用（RPC 面）
      if (protectedIds.has(obj.id) || boardCore.isObjectEvicted(obj.id)) continue;
      this.#addObjectEffect(
        { objectId: obj.id, data: obj.serialize() },
        affectedChunks,
      );
      fixedIds.add(obj.id);
    }

    // trash 全量对齐（条目随删除/恢复记录落定，分歧时整体替换）
    const trashOf = (core) =>
      JSON.stringify(
        [...core.trash.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    const trashChanged = trashOf(boardCore) !== trashOf(scratchCore);
    if (trashChanged) {
      boardCore.trash.clear();
      for (const [id, entry] of scratchCore.trash) {
        boardCore.trash.set(id, JSON.parse(JSON.stringify(entry)));
      }
    }

    // 层位边对齐：派生态的边集是 f(日志) 的权威层位，逐已载区块比对并重写分歧
    const aom = boardCore.activeObjectManager;
    for (const { chunk } of boardCore.chunkLoaded.values()) {
      const graph = chunk?.objectManager?.staticGraph;
      if (!graph) continue;
      const nodes = [...graph.getNodes()];
      // 本地未闭合会话的主体合法偏离派生态（提交时重算居上），其所在区块跳过
      if (nodes.some((id) => aom.isActive(id))) continue;
      const derivedGraph = scratchCore.getChunkById(chunk.id)?.objectManager?.staticGraph;
      const edgesOf = (g) =>
        [...g.getNodes()]
          .flatMap((id) => [...(g.neighborsUnsafe(id) ?? [])].map((to) => `${id}${to}`))
          .sort()
          .join("");
      const localEdges = edgesOf(graph);
      const derivedEdges = derivedGraph ? edgesOf(derivedGraph) : "";
      if (localEdges === derivedEdges) continue;
      for (const id of nodes) graph.deleteAllEdgesOfNode(id);
      if (derivedGraph) {
        for (const id of derivedGraph.getNodes()) {
          for (const to of derivedGraph.neighborsUnsafe(id) ?? []) {
            addLayerEdgeIfAcyclic(graph, id, to);
          }
        }
      }
      affectedChunks.add(chunk);
      fixedIds.add(`chunk:${chunk.id}`);
    }

    if (affectedChunks.size > 0) {
      boardCore.aomRenderHooks.requestStaticRender([...affectedChunks]);
    }
    const repaired = fixedIds.size > 0 || trashChanged;
    if (repaired) {
      // 文档状态变化：UI 工具凭此清理本地失效选中（同远端应用路径）
      boardCore.activityEventBus.emit("hit-changed", { time: Date.now() });
    }
    return { repaired, fixedIds: [...fixedIds] };
  }

  /**
   * 远程活动对象几何变化时标记选择装饰待刷新
   * @description 远程 choose/unchoose 之外的变更缝：远程活动对象的修改效果（应用或逆放）
   * 改变对象几何，装饰层须凭 remote-activity 通知重拉对象摘要，对端选中框随记录归位；
   * 非远程活动对象不标记（空操作）。
   * @param {string} objectId - 对象 id
   * @returns {void}
   * @private
   */
  #markRemoteChoicesDirtyIfRemoteActive(objectId) {
    if (!this.#boardCore.activeObjectManager.isRemoteActive(objectId)) return;
    this.#remoteChoicesDirty = true;
    this.#remoteChoicesDirtyIds.add(objectId);
  }

  /**
   * 冲刷远程选择变更通知（awareness 缝）
   * @returns {void}
   * @private
   *
   * @description
   * 远程注册表的全部变更路径（ephemeral 活动、日志回放、断线清理）合批为一次 remote-activity
   * 事件；UI 经 host 桥接收后重新拉取 queryRemoteChoices 刷新选中装饰。
   */
  #flushRemoteChoicesNotification() {
    if (!this.#remoteChoicesDirty) return;
    this.#remoteChoicesDirty = false;
    const ids = [...this.#remoteChoicesDirtyIds];
    this.#remoteChoicesDirtyIds.clear();
    this.#boardCore.activityEventBus.emit("remote-activity", {
      time: Date.now(),
      ids,
    });
  }

  /**
   * 按区块查询对象 id
   * @param {number[]} chunkIds - 区块 id 列表
   * @returns {string[]} 对象 id 列表
   */
  queryChunkObjects(chunkIds) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(chunkIds) ? chunkIds : [];
    const seen = new Set();

    for (const chunkId of ids) {
      const chunk = boardCore.getChunkById(chunkId);
      if (!chunk?.objectManager?.staticGraph) continue;
      for (const objectId of chunk.objectManager.staticGraph.getNodes()) {
        seen.add(objectId);
      }
    }

    return [...seen];
  }

  /**
   * 在合并视图上执行命中查询
   * @param {import("../range/range.js").Range | import("../types/types.js").Rect} range - 命中范围
   * @param {string} [mode] - 命中模式
   * @returns {Promise<string[]>} 命中的 objectId 列表
   */
  async hitTest(range, mode) {
    const boardCore = this.#boardCore;

    let queryRange;
    if (range instanceof RectangleRange) {
      queryRange = range;
    } else if (typeof range?.left === "number") {
      queryRange = RectangleRange.fromRectLike(range);
    } else {
      queryRange = range;
    }
    if (!queryRange) return [];

    return this.#collectHitObjects(boardCore, queryRange);
  }

  /**
   * 收集与查询范围相交的对象 id
   * @description
   * 若查询范围覆盖未加载或仅临时加载的区块，会先 FullLoad 使对象实例就绪，
   * 执行命中检测后销毁 loader 释放引用。
   * @param {import("../board/board-core.js").BoardCore} boardCore - BoardCore 实例
   * @param {RectangleRange} queryRange - 查询范围
   * @returns {Promise<string[]>} 命中的对象 id 列表
   * @private
   */
  async #collectHitObjects(boardCore, queryRange) {
    let chunkIds;
    let loader;
    if (
      boardCore.width > 0 &&
      boardCore.height > 0 &&
      typeof queryRange.left === "number"
    ) {
      chunkIds = ChunkObjectManager.calculateCoveredChunkIdsForRange(
        queryRange,
        boardCore.width,
        boardCore.height,
      );
      const chunksToLoad = [...chunkIds]
        .map((id) => boardCore.getChunkById(id))
        .filter((chunk) => chunk && (chunk.isTempLoad || !chunk.isLoad));

      if (chunksToLoad.length > 0) {
        loader = await boardCore.loadChunksAndWaitComplete(
          chunksToLoad,
          `hit-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        );
      }
    }

    const hits = this.#runHitTest(boardCore, queryRange, chunkIds);
    loader?.destroy(300);
    return hits;
  }

  /**
   * 在当前已加载对象中执行命中检测
   * @param {import("../board/board-core.js").BoardCore} boardCore - BoardCore 实例
   * @param {RectangleRange} queryRange - 查询范围
   * @param {Set<number>} [chunkIds] - 查询范围覆盖的区块 id 集合，用于粗筛
   * @returns {string[]}
   * @private
   */
  #runHitTest(boardCore, queryRange, chunkIds) {
    const hits = [];

    for (const [objectId] of boardCore.objectLoaded) {
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;

      if (chunkIds) {
        const coverChunks = boardCore.getObjectCoverChunks(objectId);
        if (coverChunks && !this.#chunkSetsOverlap(coverChunks, chunkIds)) {
          continue;
        }
      }

      const worldRange = obj.getRange()?.withPosition(obj.position);
      if (!worldRange) continue;

      if (intersectsRanges(worldRange, queryRange)) {
        hits.push(objectId);
      }
    }

    return hits;
  }

  /**
   * 判断两个区块 id 集合是否有交集
   * @param {Set<number>} a - 集合 a
   * @param {Set<number>} b - 集合 b
   * @returns {boolean}
   * @private
   */
  #chunkSetsOverlap(a, b) {
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const id of smaller) {
      if (larger.has(id)) return true;
    }
    return false;
  }

  /**
   * 开启一个超分子
   * @description 开启期间指定该 key 的增加节点类提交即时物化上链（记录携带 supraId）；
   * endSupra(key) 追加 close-supra 记录，树构建把活动链上同 supraId 的连续节点段折叠为聚合节点。
   * 未指定 key 的提交永远独立成录。谁开启谁关闭。
   * @param {string} key - 超分子 key（调用方提供的会话标识，可跨通道序列化）
   * @returns {void}
   */
  beginSupra(key) {
    this.#boardCore.hitCommitter.beginSupra(key);
  }

  /**
   * 闭合一个超分子：先闭合其下未闭合的分子（endMol 物化），再追加 close-supra 记录
   * @param {string} key - 超分子 key
   * @returns {void}
   */
  endSupra(key) {
    // 防御 RPC 乱序：amend 流先于闭合记录定稿
    for (const [molId, mol] of [...this.#mols]) {
      if (mol.supraKey === key) {
        this.endMol(molId);
      }
    }
    this.#boardCore.hitCommitter.endSupra(key);
  }

  /**
   * 中止一个超分子：丢弃其下未闭合分子（还原实例），并逐个撤销仍在活动链上的已物化成员
   * @description 异常路径语义（组件卸载等）：产生撤销动作；成员已不在活动链上时
   * （如会话已被撤销到 choose 终止）退化为纯句柄清理，不产生任何记录。
   * @param {string} key - 超分子 key
   * @returns {void}
   */
  abortSupra(key) {
    for (const [molId, mol] of [...this.#mols]) {
      if (mol.supraKey === key) {
        this.abortMol(molId);
      }
    }
    const supraId = this.#boardCore.hitCommitter.abortSupra(key);
    const tree = this.#boardCore.undoTree;
    for (;;) {
      const nodes = tree.getActiveSupraNodes(supraId);
      if (nodes.length === 0) break;
      this.#undoCore(nodes[nodes.length - 1].shareId);
    }
  }

  /**
   * 内部匿名超分子序号
   * @type {number}
   * @private
   */
  #internalSupraSeq = 0;

  /**
   * 开启一个内部匿名超分子并返回其 key
   * @description 单次复合调用（提交/删除/擦除等）的内部成组用，调用方在 finally 中闭合。
   * @returns {string} 内部超分子 key
   * @private
   */
  #beginInternalSupra() {
    this.#internalSupraSeq += 1;
    const key = `__board/${this.#internalSupraSeq}`;
    this.#boardCore.hitCommitter.beginSupra(key);
    return key;
  }

  /**
   * 执行撤销
   * @description 拖动中撤销先闭合本端全部未闭合分子（endMol 物化后再撤，所有操作都有记录）；
   * 记录撤销并应用树（退化/分叉改挂/被吸收在应用时确定），再经链过渡对齐白板效果。
   * @param {string} [targetNodeId] - 显式撤销目标（活动链节点 shareId）；缺省时取本端来源最近的活动链节点（各撤各的）
   * @returns {{ undone: boolean, targetNodeId: ?string, forcedEndMolIds: string[] }} 撤销结果（含被强制闭合的分子 id 列表）
   */
  undo(targetNodeId) {
    const forcedEndMolIds = [];
    for (const molId of [...this.#mols.keys()]) {
      if (this.endMol(molId)) {
        forcedEndMolIds.push(molId);
      }
    }
    return { ...this.#undoCore(targetNodeId), forcedEndMolIds };
  }

  /**
   * 撤销核心：记录撤销并应用树，经链过渡对齐白板效果
   * @description 缺省各撤各的：目标为本端来源最近的活动链节点，而非链末端——
   * 协作下链末端可能是远端操作。显式传 targetNodeId 可撤任意活动链节点。
   * @param {string} [targetNodeId] - 显式撤销目标（活动链节点 shareId）
   * @returns {{ undone: boolean, targetNodeId: ?string }} 撤销结果
   * @private
   */
  #undoCore(targetNodeId) {
    const boardCore = this.#boardCore;
    const tree = boardCore.undoTree;
    if (tree.head === tree.root) {
      return { undone: false, targetNodeId: null };
    }
    let targetId = targetNodeId ?? null;
    if (targetId === null) {
      const source = boardCore.hitCommitter.source;
      const log = boardCore.operationLog;
      const chain = tree.getActiveChain();
      for (let i = chain.length - 1; i >= 0; i--) {
        if (log.get(chain[i].shareId)?.source === source) {
          targetId = chain[i].shareId;
          break;
        }
      }
    }
    if (targetId === null || !tree.isOnActiveChain(targetId)) {
      return { undone: false, targetNodeId: null };
    }
    const beforeRecords = this.#recordsOfChain(tree.getActiveChain());
    boardCore.hitCommitter.commitUndo({ targetNodeId: targetId });
    this.#transitionEffects(
      beforeRecords,
      this.#recordsOfChain(tree.getActiveChain()),
    );
    // 过渡可能逆放远端 modify（远程活动对象几何变化）：冲刷选择装饰刷新通知
    this.#flushRemoteChoicesNotification();
    return { undone: true, targetNodeId: targetId };
  }

  /**
   * 取活动链的成员记录序列（效果过渡的比较与重放粒度）
   * @description 必须在树变更「之前」对旧链取序列：增量式分子归并就地改末端节点的
   * memberIds（undo-tree-core 不复制节点），变更后再取会把新记录误算进旧序列。
   * @param {import("../hit/undo-tree-core.js").MolecularNode[]} chain - 活动链
   * @returns {import("../hit/operation.js").OperationRecord[]} 成员记录序列（链序）
   * @private
   */
  #recordsOfChain(chain) {
    return chain.flatMap((node) => this.#recordsOfNode(node));
  }

  /**
   * 活动链状态过渡：分叉点逆放旧链尾段、正放新链尾段
   * @description 分叉判定以成员记录序列为粒度（而非节点 shareId）：折叠只改节点分组、
   * 记录序列不变，判为零过渡；若按节点比较，聚合节点复用段首 shareId 会把段尾成员误判为
   * 已撤销，净亏其效果（远端应用 close-supra 时位置回弹、选择残留）。
   * 入参为记录序列而非节点链，且须在树变更前取妥（见 recordsOfChain）。
   * @param {import("../hit/operation.js").OperationRecord[]} beforeRecords - 过渡前记录序列
   * @param {import("../hit/operation.js").OperationRecord[]} afterRecords - 过渡后记录序列
   * @returns {boolean} 活动链是否发生变化
   * @private
   */
  #transitionEffects(beforeRecords, afterRecords) {
    let diverge = 0;
    while (
      diverge < beforeRecords.length &&
      diverge < afterRecords.length &&
      beforeRecords[diverge].id === afterRecords[diverge].id
    ) {
      diverge++;
    }
    const affectedChunks = new Set();
    for (let i = beforeRecords.length - 1; i >= diverge; i--) {
      this.#revertOpEffect(beforeRecords[i], affectedChunks);
    }
    for (let i = diverge; i < afterRecords.length; i++) {
      this.#applyOpEffect(afterRecords[i], affectedChunks);
    }
    if (affectedChunks.size > 0) {
      this.#boardCore.aomRenderHooks.requestStaticRender([...affectedChunks]);
    }
    return diverge !== beforeRecords.length || diverge !== afterRecords.length;
  }

  /**
   * 应用一条分子操作的白板效果（重放）
   * @param {import("../hit/operation.js").OperationRecord} record - 分子操作记录
   * @returns {void}
   * @private
   */
  #applyOpEffect(record, affectedChunks) {
    const boardCore = this.#boardCore;
    const { type, payload } = record;
    switch (type) {
      case OPERATION_TYPES.ADD_OBJECT:
        this.#addObjectEffect(payload, affectedChunks);
        break;
      case OPERATION_TYPES.MODIFY_OBJECT: {
        const obj = boardCore.getObjectById(payload.objectId);
        if (obj) {
          this.#collectObjectChunks(obj, affectedChunks);
          this.#applyObjectPatch(obj, payload.after);
          this.#collectObjectChunks(obj, affectedChunks);
          // 跨区块移动：迁移静态图节点与覆盖索引（重放/远端应用的归属维护）
          this.#syncObjectChunkMembership(obj, affectedChunks);
          // 擦除回写等绕过 AOM 会话的修改：层位边以记录为准（手势会话的层位由 unchoose 记录承载）
          if (
            payload.chunks?.after !== undefined &&
            !boardCore.activeObjectManager.has(payload.objectId)
          ) {
            this.#applyRecordedLayerEdges(payload.objectId, payload.chunks.after, affectedChunks);
            // 缝合：日志序先于本记录但提交捕获后才到达的相交对象不在记录中，按后写者居上补齐
            this.#stitchUnrecordedIntersections(obj, payload.chunks.after, affectedChunks, "above");
          }
          this.#markRemoteChoicesDirtyIfRemoteActive(payload.objectId);
        } else {
          // 对象在 trash 中：快照随链上修改滚动，恢复时拿到的是当前状态
          this.#patchTrashSnapshot(payload.objectId, payload.after);
        }
        break;
      }
      case OPERATION_TYPES.DELETE_OBJECT:
        this.#deleteObjectEffect(payload, affectedChunks);
        break;
      case OPERATION_TYPES.CHOOSE_OBJECT:
        this.#enterAomEffect(
          payload.objectId,
          affectedChunks,
          record.source,
          payload.choice,
        );
        break;
      case OPERATION_TYPES.UNCHOOSE_OBJECT: {
        // discard 型闭合：先凭 restore 快照还原实例状态（回选择前），再退出活动层
        if (record.discard === true && payload.restore !== undefined) {
          const obj = boardCore.getObjectById(payload.objectId);
          if (obj) {
            this.#collectObjectChunks(obj, affectedChunks);
            this.#applyObjectPatch(obj, payload.restore);
            this.#collectObjectChunks(obj, affectedChunks);
          }
        }
        this.#leaveAomEffect(
          payload.objectId,
          affectedChunks,
          record.source,
        );
        // 提交边以记录为准：覆盖本地 discard 的重算结果，远程来源的提交边同样落实到静态图；
        // 本地活动中的对象（会话冲突由链序收敛）不动边
        if (
          payload.chunks !== undefined &&
          !boardCore.activeObjectManager.isActive(payload.objectId)
        ) {
          this.#applyRecordedLayerEdges(payload.objectId, payload.chunks, affectedChunks);
          // 缝合：日志序先于本记录但提交捕获后才到达的相交对象不在记录中，按后写者居上补齐
          const obj = boardCore.getObjectById(payload.objectId);
          if (obj) {
            this.#stitchUnrecordedIntersections(obj, payload.chunks, affectedChunks, "above");
          }
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * 回退一条分子操作的白板效果（逆放）
   * @param {import("../hit/operation.js").OperationRecord} record - 分子操作记录
   * @returns {void}
   * @private
   */
  #revertOpEffect(record, affectedChunks) {
    const { type, payload } = record;
    switch (type) {
      case OPERATION_TYPES.ADD_OBJECT:
        this.#removeObjectEffect(payload.objectId, affectedChunks);
        break;
      case OPERATION_TYPES.MODIFY_OBJECT: {
        const obj = this.#boardCore.getObjectById(payload.objectId);
        if (obj) {
          this.#collectObjectChunks(obj, affectedChunks);
          this.#applyObjectPatch(obj, payload.before);
          this.#collectObjectChunks(obj, affectedChunks);
          // 跨区块移动的逆放：同步迁移静态图节点与覆盖索引
          this.#syncObjectChunkMembership(obj, affectedChunks);
          // 携带层位边的修改（擦除回写）：逆放恢复修改前的边并按后到者居上缝合
          if (
            payload.chunks?.before !== undefined &&
            !this.#boardCore.activeObjectManager.has(payload.objectId)
          ) {
            this.#restoreRecordedLayerEdges(payload.objectId, payload.chunks.before, affectedChunks);
          }
          this.#markRemoteChoicesDirtyIfRemoteActive(payload.objectId);
        } else {
          this.#patchTrashSnapshot(payload.objectId, payload.before);
        }
        break;
      }
      case OPERATION_TYPES.DELETE_OBJECT:
        this.#restoreDeletedObjectEffect(payload.objectId, affectedChunks);
        break;
      case OPERATION_TYPES.CHOOSE_OBJECT:
        this.#leaveAomEffect(
          payload.objectId,
          affectedChunks,
          record.source,
        );
        // 恢复选择时刻的提取边并缝合：撤销选择（或整个会话）后对象回到选择前的层位
        if (
          payload.chunks !== undefined &&
          !this.#boardCore.activeObjectManager.has(payload.objectId)
        ) {
          this.#restoreRecordedLayerEdges(payload.objectId, payload.chunks, affectedChunks);
        }
        break;
      case OPERATION_TYPES.UNCHOOSE_OBJECT:
        this.#enterAomEffect(
          payload.objectId,
          affectedChunks,
          record.source,
          payload.choice,
        );
        break;
      default:
        break;
    }
  }

  /**
   * 收集对象覆盖的已加载区块（渲染失效用）
   * @param {import("../objects/basic-obj.js").BasicObject} object - 对象实例
   * @param {Set<import("../chunk/chunk.js").Chunk>} affectedChunks - 受影响区块集合（输出参数）
   * @returns {void}
   * @private
   */
  #collectObjectChunks(object, affectedChunks) {
    const boardCore = this.#boardCore;
    if (boardCore.width <= 0 || boardCore.height <= 0) return;
    const rect = getObjectWorldRect(object);
    if (!rect) return;
    const covered = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      rect,
      boardCore.width,
      boardCore.height,
    );
    for (const chunkId of covered) {
      const chunk = boardCore.getChunkById(chunkId);
      if (chunk) {
        affectedChunks.add(chunk);
      }
    }
  }

  /**
   * 同步对象的区块归属（远端修改/逆放跨区块移动时调用）
   * @param {import("../objects/basic-obj.js").BasicObject} obj - 对象实例（补丁已应用）
   * @param {Set<import("../chunk/chunk.js").Chunk>} affectedChunks - 受影响区块集合（输出参数）
   * @returns {void}
   * @private
   *
   * @description
   * 按对象当前几何重算覆盖区块，与覆盖索引（权威副本）比较后迁移静态图节点：
   * 退出不再覆盖的区块、加入新覆盖的区块（below 取相交节点，与增加对象效果同款）。
   * AOM 成员的归属由 AOM 自己管理，不在此同步。
   */
  #syncObjectChunkMembership(obj, affectedChunks) {
    const boardCore = this.#boardCore;
    if (boardCore.width <= 0 || boardCore.height <= 0) return;
    if (boardCore.activeObjectManager.has(obj.id)) return;
    const rect = getObjectWorldRect(obj);
    if (!rect) return;
    const next = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      rect,
      boardCore.width,
      boardCore.height,
    );
    if (next.size === 0) return;
    const prev = boardCore.getObjectCoverChunks(obj.id) ?? new Set();
    for (const chunkId of prev) {
      if (next.has(chunkId)) continue;
      const chunk = boardCore.getChunkById(chunkId);
      if (chunk?.objectManager?.staticGraph?.hasNode(obj.id)) {
        chunk.removeObject(obj.id);
        affectedChunks.add(chunk);
      }
    }
    for (const chunkId of next) {
      const chunk = boardCore.getChunkById(chunkId);
      if (!chunk) continue;
      const graph = chunk.objectManager?.staticGraph;
      if (graph?.hasNode(obj.id)) continue;
      const below = graph
        ? graph.getNodes().filter((nodeId) => {
            const nodeRect = getObjectWorldRect(boardCore.getObjectById(nodeId));
            return nodeRect && intersectsRanges(rect, nodeRect);
          })
        : [];
      chunk.addObject(obj, below, []);
      boardCore.registerObjectInstance(obj);
      affectedChunks.add(chunk);
    }
    // chunk.removeObject 会顺带清掉覆盖索引条目，统一在最后重写
    boardCore.setObjectCoverChunks(obj.id, next);
  }

  /**
   * 增加对象效果：重建实例并写入覆盖区块
   * @description 层位边以记录为准（发送端提交时刻的实际写边，含橡皮分裂的层位继承）；
   * 旧记录未携带时回退几何派生——按后到者居上写入相交区块。
   * @param {Object} payload - 增加对象分子载荷
   * @param {Set<import("../chunk/chunk.js").Chunk>} affectedChunks - 受影响区块集合（输出参数）
   * @returns {void}
   * @private
   */
  #addObjectEffect(payload, affectedChunks) {
    const boardCore = this.#boardCore;
    if (boardCore.getObjectById(payload.objectId)) return;
    let obj;
    try {
      obj = deserialize(payload.data);
    } catch (error) {
      // 毒记录降级：记录已入日志即视为接入完成，不可反序列化的载荷跳过效果并告警留痕；
      // 不抛出——协调器捕获重试会对已入日志的记录再 append，造成「id 序号不连续」死循环
      console.warn(
        `[board-api] 跳过不可反序列化的增加对象载荷（${String(payload.objectId)}）：${error?.message ?? error}`,
      );
      return;
    }
    boardCore.registerObjectInstance(obj);
    // 不变量：对象在垍即无 trash 条目（重放/重插入自愈僵尸条目）
    boardCore.trash.delete(payload.objectId);
    if (boardCore.width <= 0 || boardCore.height <= 0) return;
    this.#collectObjectChunks(obj, affectedChunks);
    const rect = getObjectWorldRect(obj);
    if (!rect) return;
    const covered = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      rect,
      boardCore.width,
      boardCore.height,
    );
    boardCore.setObjectCoverChunks(obj.id, covered);
    if (payload.chunks !== undefined) {
      // 节点先按覆盖区块就位（不设边），层位边以记录为准
      for (const chunkId of covered) {
        const chunk = boardCore.getChunkById(chunkId);
        if (!chunk) continue;
        chunk.addObject(obj);
      }
      this.#applyRecordedLayerEdges(payload.objectId, payload.chunks, affectedChunks);
      // 缝合：此刻在册但记录时刻不在静态图的相交对象（trash 中或会话中），新对象居上
      this.#stitchUnrecordedIntersections(obj, payload.chunks, affectedChunks, "above");
      return;
    }
    for (const chunkId of covered) {
      const chunk = boardCore.getChunkById(chunkId);
      if (!chunk) continue;
      const graph = chunk.objectManager?.staticGraph;
      const below = graph
        ? graph.getNodes().filter((nodeId) => {
          const nodeRect = getObjectWorldRect(boardCore.getObjectById(nodeId));
          return nodeRect && intersectsRanges(rect, nodeRect);
        })
        : [];
      chunk.addObject(obj, below, []);
    }
  }

  /**
   * 静默移除对象（不产生记录）
   * @param {string} objectId - 对象 id
   * @param {Set<import("../chunk/chunk.js").Chunk>} affectedChunks - 受影响区块集合（输出参数）
   * @returns {void}
   * @private
   */
  #removeObjectEffect(objectId, affectedChunks) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    if (obj) {
      this.#collectObjectChunks(obj, affectedChunks);
    }
    this.#chooseSnapshots.delete(objectId);
    for (const { chunk } of boardCore.chunkLoaded.values()) {
      if (chunk?.objectManager?.staticGraph?.hasNode(objectId)) {
        chunk.removeObject(objectId);
      }
    }
    const aom = boardCore.activeObjectManager;
    if (aom.onLayer.get(objectId)) {
      aom.removeObjectFromLayer(objectId);
      aom.unregisterTrackedActiveObject(objectId);
    }
    boardCore.objectLoaded.delete(objectId);
  }

  /**
   * 将修改快照滚入 trash 条目
   * @param {string} objectId - 对象 id
   * @param {Object} [snapshot] - 全量快照（after 或 before）
   * @returns {void}
   * @private
   *
   * @description
   * 对象在 trash 中时修改效果不落活对象而落 trash 快照：乱序下先删后改的场景恢复时与链上重放一致。
   */
  #patchTrashSnapshot(objectId, snapshot) {
    const entry = this.#boardCore.trash.get(objectId);
    if (!entry || snapshot === undefined || snapshot === null) return;
    entry.data = JSON.parse(JSON.stringify(snapshot));
  }

  /**
   * 删除对象效果：以记录载荷重建 trash 条目并移除对象
   * @param {Object} payload - 删除载荷（chunkId/objectId/data/chunks）
   * @param {Set<import("../chunk/chunk.js").Chunk>} affectedChunks - 受影响区块集合（输出参数）
   * @returns {void}
   * @private
   *
   * @description
   * trash 条目以记录携带的作者端快照与层位边为准，各端重建结果一致；本地路径已建条目时跳过。
   */
  #deleteObjectEffect(payload, affectedChunks) {
    const boardCore = this.#boardCore;
    if (!boardCore.trash.has(payload.objectId)) {
      boardCore.trash.set(payload.objectId, {
        data: payload.data,
        // 层位边统一为数组形态（与本地删除路径的 trash 条目一致，状态校验和跨端可比）
        chunks: (payload.chunks ?? []).map((entry) => ({
          chunkId: entry.chunkId,
          below: [...(entry.below ?? [])],
          above: [...(entry.above ?? [])],
        })),
      });
    }
    this.#removeObjectEffect(payload.objectId, affectedChunks);
  }

  /**
   * 应用记录携带的层位边（after 语义）
   * @description 清主体在各记录区块的旧边，按记录写回（过滤已不存在的节点）——
   * 重放/远端/重做的层位效果以记录为准，不经本地几何重算：复制的是效果而非重执行。
   * 记录区块未加载时跳过（加载后由后续对账收敛）。
   * @param {string} objectId - 对象 id
   * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} chunksEntries - 层位边集合
   * @param {Set<import("../chunk/chunk.js").Chunk>} [affectedChunks] - 受影响区块集合（输出参数）
   * @returns {void}
   * @private
   */
  #applyRecordedLayerEdges(objectId, chunksEntries, affectedChunks) {
    const boardCore = this.#boardCore;
    for (const entry of chunksEntries ?? []) {
      const chunk = boardCore.getChunkById(Number(entry.chunkId));
      const graph = chunk?.objectManager?.staticGraph;
      if (!graph) continue;
      if (!graph.hasNode(objectId)) graph.addNodeUnsafe(objectId);
      graph.deleteAllEdgesOfNode(objectId);
      for (const id of entry.below ?? []) {
        addLayerEdgeIfAcyclic(graph, id, objectId);
      }
      for (const id of entry.above ?? []) {
        addLayerEdgeIfAcyclic(graph, objectId, id);
      }
      affectedChunks?.add(chunk);
    }
  }

  /**
   * 缝合记录之外的相交对象（后到者居上）
   * @description 记录时刻不在静态图中的对象（trash 中或会话中）不可能出现在记录的层位边里；
   * 它们与主体的相对方位按「后到者居上」补齐：较晚物化的一方居上。
   * AOM 成员的层位边由其自身会话的记录管理，不参与缝合。
   * @param {import("../objects/basic-obj.js").BasicObject} obj - 主体对象实例
   * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} chunksEntries - 记录携带的层位边集合
   * @param {Set<import("../chunk/chunk.js").Chunk>} [affectedChunks] - 受影响区块集合（输出参数）
   * @param {"above"|"below"} position - 主体相对缝合对象的方位：正放新增为 above（新对象居上），历史恢复为 below
   * @returns {void}
   * @private
   */
  #stitchUnrecordedIntersections(obj, chunksEntries, affectedChunks, position) {
    const boardCore = this.#boardCore;
    const rect = getObjectWorldRect(obj);
    if (!rect) return;
    const aom = boardCore.activeObjectManager;
    for (const entry of chunksEntries ?? []) {
      const chunk = boardCore.getChunkById(Number(entry.chunkId));
      const graph = chunk?.objectManager?.staticGraph;
      if (!graph?.hasNode(obj.id)) continue;
      const recorded = new Set([...(entry.below ?? []), ...(entry.above ?? [])]);
      for (const nodeId of graph.getNodes()) {
        if (nodeId === obj.id || recorded.has(nodeId)) continue;
        if (aom.has(nodeId)) continue;
        const nodeRect = getObjectWorldRect(boardCore.getObjectById(nodeId));
        if (!nodeRect || !intersectsRanges(rect, nodeRect)) continue;
        const [from, to] = position === "above" ? [nodeId, obj.id] : [obj.id, nodeId];
        if (addLayerEdgeIfAcyclic(graph, from, to)) {
          affectedChunks?.add(chunk);
        }
      }
    }
  }

  /**
   * 恢复历史层位边并缝合（before 语义）
   * @description 写回记录边后，对不在记录中的当前相交对象补「主体居下」边——
   * 这些对象在该历史时刻之后物化，按后到者居上缝合。
   * @param {string} objectId - 对象 id
   * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} chunksEntries - 层位边集合
   * @param {Set<import("../chunk/chunk.js").Chunk>} [affectedChunks] - 受影响区块集合（输出参数）
   * @returns {void}
   * @private
   */
  #restoreRecordedLayerEdges(objectId, chunksEntries, affectedChunks) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    if (!obj) return;
    this.#applyRecordedLayerEdges(objectId, chunksEntries, affectedChunks);
    this.#stitchUnrecordedIntersections(obj, chunksEntries, affectedChunks, "below");
  }

  /**
   * 从回收站恢复被删除的对象及其层位边
   * @param {string} objectId - 对象 id
   * @param {Set<import("../chunk/chunk.js").Chunk>} affectedChunks - 受影响区块集合（输出参数）
   * @returns {void}
   * @private
   */
  #restoreDeletedObjectEffect(objectId, affectedChunks) {
    const boardCore = this.#boardCore;
    const entry = boardCore.trash.get(objectId);
    if (!entry || boardCore.getObjectById(objectId)) return;
    let obj;
    try {
      obj = deserialize(entry.data);
    } catch (error) {
      // 与 #addObjectEffect 同款降级：毒快照跳过效果并告警，不阻断日志回放
      console.warn(
        `[board-api] 跳过不可反序列化的回收站快照（${objectId}）：${error?.message ?? error}`,
      );
      return;
    }
    boardCore.registerObjectInstance(obj);
    this.#collectObjectChunks(obj, affectedChunks);
    // 恢复删除时刻的层位边；删除窗口期创建（或当时仍在会话中）的相交对象按后到者居上缝合
    this.#restoreRecordedLayerEdges(objectId, entry.chunks, affectedChunks);
    boardCore.trash.delete(objectId);
  }

  /**
   * 进入动态图效果：对象成为活动对象
   * @param {string} objectId - 对象 id
   * @param {Set<import("../chunk/chunk.js").Chunk>} affectedChunks - 受影响区块集合（输出参数）
   * @param {string} [source] - 记录来源；与本端不同则登记远程活动而非本地活动
   * @param {string} [choice] - 记录携带的命名选择名；缺省为匿名选择
   * @returns {void}
   * @private
   */
  #enterAomEffect(objectId, affectedChunks, source, choice) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    const aom = boardCore.activeObjectManager;
    // 远程 choose：登记远程活动（锁定 + 可见），不进本地活动集
    if (source !== undefined && source !== boardCore.hitCommitter.source) {
      aom.applyRemoteChoose([objectId], source, choice);
      this.#remoteChoicesDirty = true;
      this.#remoteChoicesDirtyIds.add(objectId);
      if (obj) this.#collectObjectChunks(obj, affectedChunks);
      return;
    }
    if (!obj || aom.isActive(objectId)) return;
    this.#collectObjectChunks(obj, affectedChunks);
    // 回放再激活（撤销 unchoose / 重做 choose）补捕选择前快照：快照在 commit/discard
    // 时已删除，缺失会让后续 commitObjects 抛错；须在 add 前判断（add 后对象离开静态图）。
    // 仅缺失时补捕：重做 choose 时原快照仍有效（首次选择时刻的状态），不得覆盖
    if (
      hasStaticBoardObject(boardCore, objectId) &&
      !this.#chooseSnapshots.has(objectId)
    ) {
      this.#chooseSnapshots.set(objectId, cloneSnapshot(obj.serialize()));
    }
    // 本地选择优先：撤销该对象的远程活动登记（并发 choose 冲突按链序收敛）
    aom.revokeRemoteActive(objectId);
    aom.add(new Set([obj]));
    // 回放恢复本地命名选择标签（匿名选择不记 choice，落匿名桶）
    aom.assignLocalChoice([objectId], choice ?? ANONYMOUS_CHOICE_NAME);
  }

  /**
   * 离开动态图效果：对象退出活动状态
   * @param {string} objectId - 对象 id
   * @param {Set<import("../chunk/chunk.js").Chunk>} affectedChunks - 受影响区块集合（输出参数）
   * @param {string} [source] - 记录来源；与本端不同则注销远程活动登记
   * @returns {void}
   * @private
   */
  #leaveAomEffect(objectId, affectedChunks, source) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    const aom = boardCore.activeObjectManager;
    // 远程 unchoose：注销远程活动登记（按来源与对象完备，无需指定 choice）
    if (source !== undefined && source !== boardCore.hitCommitter.source) {
      aom.applyRemoteUnchoose([objectId], source);
      this.#remoteChoicesDirty = true;
      this.#remoteChoicesDirtyIds.add(objectId);
      if (obj) this.#collectObjectChunks(obj, affectedChunks);
      return;
    }
    if (!obj || !aom.has(objectId)) return;
    this.#collectObjectChunks(obj, affectedChunks);
    aom.discard(new Set([obj]));
  }

  /**
   * 取节点的成员记录
   * @param {import("../hit/undo-tree-core.js").MolecularNode} node - 树节点
   * @returns {import("../hit/operation.js").OperationRecord[]} 成员记录数组（独立分子为单件，增量式分子为同 molId 记录组，聚合节点为折叠段全组）
   * @private
   */
  #recordsOfNode(node) {
    const log = this.#boardCore.operationLog;
    return node.memberIds.map((id) => log.get(id)).filter(Boolean);
  }

  /**
   * 执行重做
   * @description 发射即生效：先凭树侧登记解析本端可重做的撤销（栈顶语义），无可重做时
   * 不发记录；发射的记录携带目标撤销 id，各端按纯日志谓词一致生效。生效效果为撤销
   * 目标节点按时间标记重新激活（插回活动链），再经链过渡对齐白板效果。
   * @returns {{ redone: boolean, targetNodeId: ?string }} 重做结果
   */
  redo() {
    const boardCore = this.#boardCore;
    const tree = boardCore.undoTree;
    const target = tree.getRedoTargetForSource(boardCore.hitCommitter.source);
    if (target === null) {
      return { redone: false, targetNodeId: null };
    }
    const beforeRecords = this.#recordsOfChain(tree.getActiveChain());
    boardCore.hitCommitter.commitRedo({ targetUndoId: target.undoId });
    const afterChain = tree.getActiveChain();
    this.#transitionEffects(
      beforeRecords,
      this.#recordsOfChain(afterChain),
    );
    // 过渡可能正放远端 modify（远程活动对象几何变化）：冲刷选择装饰刷新通知
    this.#flushRemoteChoicesNotification();
    return { redone: true, targetNodeId: target.targetId };
  }

  /**
   * 应用远端到达的分子操作记录
   * @description 同步插件的入口：记录入日志后按「插入与重放的边界」分流——纯插入/纯应用走增量；
   * 旧操作落在上下文敏感操作之前时全量重建（f(日志) 兜底），再经链过渡对齐白板效果。
   * 同批的超分子成员聚合为一组应用。
   * @param {import("../hit/operation.js").OperationRecord[]} records - 分子操作记录
   * @returns {{ applied: number }} 应用条数
   */
  applyRemoteOperations(records) {
    const boardCore = this.#boardCore;
    const log = boardCore.operationLog;
    const tree = boardCore.undoTree;
    const input = Array.isArray(records) ? records : [];
    const list = [];
    for (const record of input) {
      const errors = validateOperation(record);
      if (errors.length > 0) {
        throw new Error(errors.join("；"));
      }
      const existing = log.get(record.id);
      if (existing !== null) {
        if (!sameOperationRecord(existing, record)) {
          throw new Error(`记录 id 内容冲突：${record.id}`);
        }
        continue;
      }
      list.push(record);
    }
    const groups = [];
    const bySupra = new Map();
    for (const record of list) {
      if (record.supraOpId == null) {
        groups.push([record]);
      } else {
        let group = bySupra.get(record.supraOpId);
        if (group === undefined) {
          group = [];
          bySupra.set(record.supraOpId, group);
          groups.push(group);
        }
        group.push(record);
      }
    }
    for (const group of groups) {
      for (const record of group) {
        const errors = log.append(record);
        if (errors.length > 0) {
          throw new Error(errors.join("；"));
        }
        boardCore.hitCommitter.observeRemoteTime(record);
        // 远端 add-object 推进对象 id 计数（单调取大）：
        // 同 source 双写端（GUI 直连 + daemon 托管的 CLI add）各自从计数续号，
        // 不推进则 daemon 侧从 0 分配与 GUI 已创建对象撞号
        if (record.type === "add-object") {
          const objectId = record?.payload?.objectId;
          if (typeof objectId === "string") {
            const slash = objectId.lastIndexOf("/");
            const seq = Number(objectId.slice(slash + 1));
            if (slash > 0 && Number.isInteger(seq)) {
              boardCore.reportObjectIdCounter(objectId.slice(0, slash), seq);
            }
          }
        }
      }
      const beforeRecords = this.#recordsOfChain(tree.getActiveChain());
      if (this.#needsReplay(group[group.length - 1])) {
        tree.rebuild();
      } else if (group[0].supraOpId == null) {
        tree.applyRecord(group[0]);
      } else {
        tree.applySupraNode(group);
      }
      this.#transitionEffects(
        beforeRecords,
        this.#recordsOfChain(tree.getActiveChain()),
      );
    }
    // 链过渡可能含远程 choose/unchoose 效果：合批冲刷一次变更通知
    this.#flushRemoteChoicesNotification();
    const applied = list.length;
    if (applied > 0) {
      // 远程文档变化：UI 工具凭此清理本地失效选中（幽灵选择）
      this.#boardCore.activityEventBus.emit("hit-changed", {
        time: Date.now(),
      });
    }
    return { applied };
  }

  /**
   * 判定到达记录是否需要全量重建（「插入与重放的边界」判定表）
   * @description 增加节点类与撤销在插入点之后只有增加节点类时纯插入/纯应用；
   * 重做与更改 HEAD 在插入点之后有任何已应用操作时一律重建。
   * @param {import("../hit/operation.js").OperationRecord} record - 到达记录（超分子取末分子）
   * @returns {boolean} 是否需要全量重建
   * @private
   */
  #needsReplay(record) {
    const sorted = this.#boardCore.operationLog.toSortedArray();
    const index = sorted.findIndex((r) => compareRecords(r, record) > 0);
    const after = index === -1 ? [] : sorted.slice(index);
    if (record.type === OPERATION_TYPES.REDO || record.type === OPERATION_TYPES.MOVE_HEAD) {
      return after.length > 0;
    }
    return after.some(
      (r) => getOperationEffectKind(r.type) !== OPERATION_EFFECT_KINDS.APPEND_NODE,
    );
  }
}

export { BoardApi };
