/**
 * @file 操作记录定义
 * @description 定义 hit 的分子操作记录模型：八种分子类型与闭合超分子记录、三级容器字段（molId/supraId/discard）、公共属性与载荷结构、校验与排序辅助。
 * @module kernel/hit/operation
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

/**
 * 分子操作类型
 * @typedef {"add-object" | "modify-object" | "delete-object" | "choose-object" | "unchoose-object" | "move-head" | "undo" | "redo" | "close-supra"} OperationType
 */

/**
 * 分子操作按对 hit 的作用分类
 * @typedef {"append-node" | "move-head" | "reattach" | "fold"} OperationEffectKind
 */

/**
 * 分子操作类型常量
 * @readonly
 * @type {Readonly<Object<string, OperationType>>}
 */
const OPERATION_TYPES = Object.freeze({
  ADD_OBJECT: "add-object",
  MODIFY_OBJECT: "modify-object",
  DELETE_OBJECT: "delete-object",
  CHOOSE_OBJECT: "choose-object",
  UNCHOOSE_OBJECT: "unchoose-object",
  MOVE_HEAD: "move-head",
  UNDO: "undo",
  REDO: "redo",
  CLOSE_SUPRA: "close-supra",
});

/**
 * 作用类别常量
 * @readonly
 * @type {Readonly<Object<string, OperationEffectKind>>}
 */
const OPERATION_EFFECT_KINDS = Object.freeze({
  APPEND_NODE: "append-node",
  MOVE_HEAD: "move-head",
  REATTACH: "reattach",
  FOLD: "fold",
});

/**
 * 对象级操作类型：效果落在白板文档状态上，可被撤消操作抵消
 * @type {Readonly<OperationType[]>}
 */
const WHITEBOARD_OPERATION_TYPES = Object.freeze([
  OPERATION_TYPES.ADD_OBJECT,
  OPERATION_TYPES.MODIFY_OBJECT,
  OPERATION_TYPES.DELETE_OBJECT,
  OPERATION_TYPES.CHOOSE_OBJECT,
  OPERATION_TYPES.UNCHOOSE_OBJECT,
]);

/**
 * 树级操作类型：效果落在树的结构与指针上
 * @type {Readonly<OperationType[]>}
 */
const TREE_OPERATION_TYPES = Object.freeze([
  OPERATION_TYPES.MOVE_HEAD,
  OPERATION_TYPES.UNDO,
  OPERATION_TYPES.REDO,
  OPERATION_TYPES.CLOSE_SUPRA,
]);

/**
 * 各操作类型对 hit 的作用类别
 * @type {Readonly<Object<OperationType, OperationEffectKind>>}
 */
const EFFECT_KIND_OF_TYPE = Object.freeze({
  [OPERATION_TYPES.ADD_OBJECT]: OPERATION_EFFECT_KINDS.APPEND_NODE,
  [OPERATION_TYPES.MODIFY_OBJECT]: OPERATION_EFFECT_KINDS.APPEND_NODE,
  [OPERATION_TYPES.DELETE_OBJECT]: OPERATION_EFFECT_KINDS.APPEND_NODE,
  [OPERATION_TYPES.CHOOSE_OBJECT]: OPERATION_EFFECT_KINDS.APPEND_NODE,
  [OPERATION_TYPES.UNCHOOSE_OBJECT]: OPERATION_EFFECT_KINDS.APPEND_NODE,
  [OPERATION_TYPES.MOVE_HEAD]: OPERATION_EFFECT_KINDS.MOVE_HEAD,
  [OPERATION_TYPES.UNDO]: OPERATION_EFFECT_KINDS.REATTACH,
  [OPERATION_TYPES.REDO]: OPERATION_EFFECT_KINDS.REATTACH,
  [OPERATION_TYPES.CLOSE_SUPRA]: OPERATION_EFFECT_KINDS.FOLD,
});

/**
 * 分子操作记录
 * @typedef {Object} OperationRecord
 * @property {string} id - 操作 id，形如 `"{source}/op-{n}"`
 * @property {OperationType} type - 分子操作类型
 * @property {string} source - 发起者标识，即 hit 节点的 author
 * @property {number} time - 毫秒时间标记（unix 纪元），操作级 CRDT 重建的排序依据
 * @property {?string} parentId - 记录时刻本地视角的父节点 id；首个操作为 null
 * @property {?string} supraOpId - 旧日志形态（草稿凝聚）的超分子关联；三级容器模型新记录不写，恒为 null
 * @property {?string} molId - 增量式分子标识，形如 `"{source}/mol-{n}"`；即时分子与 choose/unchoose 为 null
 * @property {?string} supraId - 归属超分子 id，形如 `"{source}/supra-{n}"`；独立分子为 null
 * @property {boolean} discard - 放弃型闭合标志（仅 unchoose-object 有意义：true 表示放弃修改回选择前快照）
 * @property {string[]} properties - 涉及属性的集合（如 `position`、`property`、`data.points`），冲突合并的判定粒度
 * @property {Object} payload - 类型载荷，结构由 type 决定
 */

/**
 * 查询操作类型对 hit 的作用类别
 * @param {OperationType} type - 分子操作类型
 * @returns {?OperationEffectKind} 作用类别；未知类型返回 null
 */
function getOperationEffectKind(type) {
  return EFFECT_KIND_OF_TYPE[type] ?? null;
}

/**
 * 构造操作 id
 * @param {string} source - 发起者标识
 * @param {number} n - 该发起者的操作序号
 * @returns {string} 操作 id，形如 `"{source}/op-{n}"`
 */
function makeOperationId(source, n) {
  return `${source}/op-${n}`;
}

/**
 * 解析操作 id
 * @param {string} id - 操作 id
 * @returns {?{ source: string, n: number }} 解析结果；id 形如 `"{source}/op-{n}"` 以外时返回 null
 */
function parseOperationId(id) {
  if (typeof id !== "string") {
    return null;
  }
  const match = /^(.+)\/op-(\d+)$/.exec(id);
  if (match === null) {
    return null;
  }
  return { source: match[1], n: Number(match[2]) };
}

/**
 * 构造分子 id
 * @param {string} source - 发起者标识
 * @param {number} n - 该发起者的分子序号
 * @returns {string} 分子 id，形如 `"{source}/mol-{n}"`
 */
function makeMoleculeId(source, n) {
  return `${source}/mol-${n}`;
}

/**
 * 解析分子 id
 * @param {string} id - 分子 id
 * @returns {?{ source: string, n: number }} 解析结果；id 形如 `"{source}/mol-{n}"` 以外时返回 null
 */
function parseMoleculeId(id) {
  if (typeof id !== "string") {
    return null;
  }
  const match = /^(.+)\/mol-(\d+)$/.exec(id);
  if (match === null) {
    return null;
  }
  return { source: match[1], n: Number(match[2]) };
}

/**
 * 构造超分子 id
 * @param {string} source - 发起者标识
 * @param {number} n - 该发起者的超分子序号
 * @returns {string} 超分子 id，形如 `"{source}/supra-{n}"`
 */
function makeSupraId(source, n) {
  return `${source}/supra-${n}`;
}

/**
 * 解析超分子 id
 * @param {string} id - 超分子 id
 * @returns {?{ source: string, n: number }} 解析结果；id 形如 `"{source}/supra-{n}"` 以外时返回 null
 */
function parseSupraId(id) {
  if (typeof id !== "string") {
    return null;
  }
  const match = /^(.+)\/supra-(\d+)$/.exec(id);
  if (match === null) {
    return null;
  }
  return { source: match[1], n: Number(match[2]) };
}

/**
 * 比较两条记录的时间标记（时钟环：毫秒数，相同毫秒按 author 字典序）
 * @param {OperationRecord} a - 记录 a
 * @param {OperationRecord} b - 记录 b
 * @returns {number} a 排在 b 前为负，相等为 0，a 排在 b 后为正
 */
function compareTimeMarks(a, b) {
  if (a.time !== b.time) {
    return a.time - b.time;
  }
  if (a.source === b.source) {
    return 0;
  }
  return a.source < b.source ? -1 : 1;
}

/**
 * 比较两条记录的全序（时间标记时钟环，同刻同 author 按操作序号决胜）
 * @param {OperationRecord} a - 记录 a
 * @param {OperationRecord} b - 记录 b
 * @returns {number} a 排在 b 前为负，相等为 0，a 排在 b 后为正
 */
function compareRecords(a, b) {
  const byTime = compareTimeMarks(a, b);
  if (byTime !== 0) {
    return byTime;
  }
  return parseOperationId(a.id).n - parseOperationId(b.id).n;
}

/**
 * 构造分子操作记录的公共属性
 * @param {Object} fields - 公共属性
 * @param {string} fields.id - 操作 id
 * @param {OperationType} fields.type - 分子操作类型
 * @param {string} fields.source - 发起者标识
 * @param {number} fields.time - 毫秒时间标记
 * @param {?string} [fields.parentId] - 记录时刻本地视角的父节点 id
 * @param {?string} [fields.supraOpId] - 旧日志形态的超分子关联（新记录不传）
 * @param {?string} [fields.molId] - 增量式分子标识（仅增量式分子记录携带）
 * @param {?string} [fields.supraId] - 归属超分子 id（挂入超分子时携带）
 * @param {boolean} [fields.discard] - 放弃型闭合标志（仅 unchoose-object）
 * @param {string[]} [fields.properties] - 涉及属性的集合
 * @param {Object} payload - 类型载荷
 * @returns {OperationRecord} 分子操作记录
 * @private
 */
function _buildRecord(fields, payload) {
  return {
    id: fields.id,
    type: fields.type,
    source: fields.source,
    time: fields.time,
    parentId: fields.parentId ?? null,
    supraOpId: fields.supraOpId ?? null,
    molId: fields.molId ?? null,
    supraId: fields.supraId ?? null,
    discard: fields.discard ?? false,
    properties: fields.properties ?? [],
    payload,
  };
}

/**
 * 归一化层位边集合（逐区块的主体前驱/后继）
 * @description below = 主体之下的对象（前驱），above = 主体之上的对象（后继）；归一化为可 JSON 序列化的数组形态。
 * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} [chunks] - 层位边集合
 * @returns {?Array<{chunkId: string, below: string[], above: string[]}>} 归一化结果；未提供时为 undefined
 * @private
 */
function _normalizeLayerEdgeChunks(chunks) {
  if (chunks === undefined) {
    return undefined;
  }
  return (chunks ?? []).map((entry) => ({
    chunkId: String(entry.chunkId),
    below: [...(entry.below ?? [])],
    above: [...(entry.above ?? [])],
  }));
}

/**
 * 构造增加对象操作记录
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields
 * @param {string} fields.chunkId - 区块 id
 * @param {string} fields.objectId - 对象 id
 * @param {Object} fields.data - 对象全量内容（可 JSON 序列化）
 * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} [fields.chunks] - 提交时刻主体在各覆盖区块的层位边（撤销与层位修复的依据；创建手势物化时主体未入图则省略，重放回退后到者居上）
 * @returns {OperationRecord} 增加对象操作记录
 */
function createAddObjectOperation(fields) {
  return _buildRecord({ ...fields, type: OPERATION_TYPES.ADD_OBJECT }, {
    chunkId: fields.chunkId,
    objectId: fields.objectId,
    data: fields.data,
    ...(fields.chunks !== undefined
      ? { chunks: _normalizeLayerEdgeChunks(fields.chunks) }
      : {}),
  });
}

/**
 * 构造修改对象操作记录
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields；properties 承载涉及属性集合
 * @param {string} fields.chunkId - 区块 id
 * @param {string} fields.objectId - 对象 id
 * @param {Object} fields.before - 修改前快照，undo 用前快照回退（可 JSON 序列化）
 * @param {Object} fields.after - 修改后快照，协作用后快照传播（可 JSON 序列化）
 * @param {{before: Array, after: Array}} [fields.chunks] - 修改前后的层位边（仅绕过 AOM 会话直接改静态图且伴随边变更时携带，如擦除回写；手势会话的层位变化由 choose/unchoose 记录承载）
 * @returns {OperationRecord} 修改对象操作记录
 */
function createModifyObjectOperation(fields) {
  return _buildRecord({ ...fields, type: OPERATION_TYPES.MODIFY_OBJECT }, {
    chunkId: fields.chunkId,
    objectId: fields.objectId,
    before: fields.before,
    after: fields.after,
    ...(fields.chunks !== undefined
      ? {
          chunks: {
            before: _normalizeLayerEdgeChunks(fields.chunks.before) ?? [],
            after: _normalizeLayerEdgeChunks(fields.chunks.after) ?? [],
          },
        }
      : {}),
  });
}

/**
 * 构造删除对象操作记录
 * @description 记录携带对象快照与层位边：接收端凭以重建 trash 条目（撤销删除可恢复），复制的是效果而非重执行。
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields
 * @param {string} fields.chunkId - 区块 id
 * @param {string} fields.objectId - 对象 id
 * @param {Object} fields.data - 对象序列化快照
 * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} [fields.chunks] - 层位边（归一化为数组）
 * @returns {OperationRecord} 删除对象操作记录
 */
function createDeleteObjectOperation(fields) {
  return _buildRecord({ ...fields, type: OPERATION_TYPES.DELETE_OBJECT }, {
    chunkId: fields.chunkId,
    objectId: fields.objectId,
    data: fields.data,
    chunks: _normalizeLayerEdgeChunks(fields.chunks) ?? [],
  });
}

/**
 * 构造选择对象操作记录
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields
 * @param {string} fields.chunkId - 区块 id
 * @param {string} fields.objectId - 对象 id
 * @param {string} [fields.choice] - 命名选择名；缺省为匿名选择（不记录）
 * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} [fields.chunks] - 选择时刻主体在各覆盖区块的层位边（提取边：撤销选择或撤销整个会话时凭以恢复）
 * @returns {OperationRecord} 选择对象操作记录
 */
function createChooseObjectOperation(fields) {
  return _buildRecord({ ...fields, type: OPERATION_TYPES.CHOOSE_OBJECT }, {
    chunkId: fields.chunkId,
    objectId: fields.objectId,
    // 命名选择名；匿名选择不记录（旧记录无此字段即匿名）
    ...(fields.choice !== undefined ? { choice: fields.choice } : {}),
    ...(fields.chunks !== undefined
      ? { chunks: _normalizeLayerEdgeChunks(fields.chunks) }
      : {}),
  });
}

/**
 * 构造取消选择操作记录
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields
 * @param {string} fields.chunkId - 区块 id
 * @param {string} fields.objectId - 对象 id
 * @param {string} [fields.choice] - 命名选择名；缺省为匿名选择（不记录）
 * @param {Object} [fields.restore] - discard 型闭合的选择前快照（重放/重做时凭以还原实例）
 * @param {Array<{chunkId: string, below: Iterable<string>, above: Iterable<string>}>} [fields.chunks] - 写回静态图后主体在各覆盖区块的层位边（提交边：重放/远端凭以应用，不经本地重算）
 * @returns {OperationRecord} 取消选择操作记录
 */
function createUnchooseObjectOperation(fields) {
  return _buildRecord({ ...fields, type: OPERATION_TYPES.UNCHOOSE_OBJECT }, {
    chunkId: fields.chunkId,
    objectId: fields.objectId,
    // 命名选择名；匿名选择不记录
    ...(fields.choice !== undefined ? { choice: fields.choice } : {}),
    // discard 型闭合的还原点：选择前快照（仅 discard 时携带）
    ...(fields.restore !== undefined ? { restore: fields.restore } : {}),
    ...(fields.chunks !== undefined
      ? { chunks: _normalizeLayerEdgeChunks(fields.chunks) }
      : {}),
  });
}

/**
 * 构造更改 HEAD 指针操作记录
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields
 * @param {string} fields.targetNodeId - HEAD 移动的目标节点 id
 * @returns {OperationRecord} 更改 HEAD 指针操作记录
 */
function createMoveHeadOperation(fields) {
  return _buildRecord({ ...fields, type: OPERATION_TYPES.MOVE_HEAD }, {
    targetNodeId: fields.targetNodeId,
  });
}

/**
 * 构造撤销操作记录
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields
 * @param {string} fields.targetNodeId - 撤消操作的目标节点 id（缺省为活动链末端，由调用方解析后记录）
 * @param {string} fields.previousHeadId - 撤销前的 HEAD 位置（视图与可重做栈投影使用）
 * @returns {OperationRecord} 撤销操作记录
 */
function createUndoOperation(fields) {
  return _buildRecord({ ...fields, type: OPERATION_TYPES.UNDO }, {
    targetNodeId: fields.targetNodeId,
    previousHeadId: fields.previousHeadId,
  });
}

/**
 * 构造重做操作记录
 * @description 重做携带目标撤销记录 id：生效判定是纯日志谓词（撤销已生效、未重做、未被同源新工作洗刷），
 * 不依赖投递交错；效果为把撤销目标节点按时间标记重新激活（插回活动链）。
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields
 * @param {string} fields.targetUndoId - 被重做的撤销记录 id
 * @returns {OperationRecord} 重做操作记录
 */
function createRedoOperation(fields) {
  return _buildRecord({ ...fields, type: OPERATION_TYPES.REDO }, {
    targetUndoId: fields.targetUndoId,
  });
}

/**
 * 构造闭合超分子操作记录
 * @description 超分子闭合信号：树构建见到本记录时，把活动链上同 supraId 的连续节点段折叠为聚合节点。
 * 树级操作，无白板效果，自身不产生节点、不作为超分子成员。
 * @param {Object} fields - 公共属性，同 _buildRecord 的 fields
 * @param {string} fields.supraId - 待闭合的超分子 id
 * @returns {OperationRecord} 闭合超分子操作记录
 */
function createCloseSupraOperation(fields) {
  // 顶层 supraId 固定为 null（本记录不是超分子成员），待闭合的超分子 id 只在载荷中
  return _buildRecord({ ...fields, supraId: null, type: OPERATION_TYPES.CLOSE_SUPRA }, {
    supraId: fields.supraId,
  });
}

/**
 * 校验分子操作记录
 * @param {*} record - 待校验的记录
 * @returns {string[]} 错误列表；空数组表示记录合法
 */
function validateOperation(record) {
  const errors = [];
  if (record === null || typeof record !== "object") {
    return ["记录必须是对象"];
  }
  const idParts = parseOperationId(record.id);
  if (idParts === null) {
    errors.push(`id 形如 "{source}/op-{n}"：${String(record.id)}`);
  }
  if (typeof record.source !== "string" || record.source.length === 0) {
    errors.push("source 必须是非空字符串");
  } else if (idParts !== null && idParts.source !== record.source) {
    errors.push(`id 的 source 段（${idParts.source}）与 source（${record.source}）不一致`);
  }
  if (!Object.values(OPERATION_TYPES).includes(record.type)) {
    errors.push(`未知操作类型：${String(record.type)}`);
  }
  if (typeof record.time !== "number" || !Number.isFinite(record.time)) {
    errors.push("time 必须是有限数值");
  }
  if (record.parentId !== null && parseOperationId(record.parentId) === null) {
    errors.push(`parentId 非法：${String(record.parentId)}`);
  }
  if (record.supraOpId !== null && parseOperationId(record.supraOpId) === null) {
    errors.push(`supraOpId 非法：${String(record.supraOpId)}`);
  }
  if (
    record.supraOpId !== null &&
    getOperationEffectKind(record.type) !== OPERATION_EFFECT_KINDS.APPEND_NODE
  ) {
    errors.push("仅增加节点类操作可属于超分子操作");
  }
  // molId/supraId/discard 为三级容器模型新增字段：旧记录无此字段（undefined），读入侧归一为 null/false
  if (record.molId !== null && record.molId !== undefined) {
    const molParts = parseMoleculeId(record.molId);
    if (molParts === null) {
      errors.push(`molId 非法：${String(record.molId)}`);
    } else if (molParts.source !== record.source) {
      errors.push(`molId 的 source 段（${molParts.source}）与 source（${record.source}）不一致`);
    }
    if (
      record.type !== OPERATION_TYPES.ADD_OBJECT &&
      record.type !== OPERATION_TYPES.MODIFY_OBJECT
    ) {
      errors.push("仅增加/修改对象操作可携带 molId");
    }
  }
  if (record.supraId !== null && record.supraId !== undefined) {
    const supraParts = parseSupraId(record.supraId);
    if (supraParts === null) {
      errors.push(`supraId 非法：${String(record.supraId)}`);
    } else if (supraParts.source !== record.source) {
      errors.push(`supraId 的 source 段（${supraParts.source}）与 source（${record.source}）不一致`);
    }
    if (getOperationEffectKind(record.type) !== OPERATION_EFFECT_KINDS.APPEND_NODE) {
      errors.push("仅增加节点类操作可携带 supraId");
    }
  }
  if (record.discard !== undefined && typeof record.discard !== "boolean") {
    errors.push("discard 必须是布尔值");
  }
  if (record.discard === true && record.type !== OPERATION_TYPES.UNCHOOSE_OBJECT) {
    errors.push("仅 unchoose-object 可携带 discard 标志");
  }
  if (!Array.isArray(record.properties) || record.properties.some((p) => typeof p !== "string")) {
    errors.push("properties 必须是字符串数组");
  }
  if (record.payload === null || typeof record.payload !== "object") {
    errors.push("payload 必须是对象");
    return errors;
  }
  _validatePayload(record, errors);
  return errors;
}

/**
 * 校验记录的载荷
 * @param {OperationRecord} record - 分子操作记录
 * @param {string[]} errors - 错误收集列表
 * @private
 */
function _validatePayload(record, errors) {
  const { type, payload } = record;
  /**
   * 校验字符串字段
   * @param {string} key - 字段名
   * @returns {void}
   */
  const requireString = (key) => {
    if (typeof payload[key] !== "string" || payload[key].length === 0) {
      errors.push(`${type} 载荷的 ${key} 必须是非空字符串`);
    }
  };
  /**
   * 校验节点 id 字段
   * @param {string} key - 字段名
   * @returns {void}
   */
  const requireNodeId = (key) => {
    if (parseOperationId(payload[key]) === null) {
      errors.push(`${type} 载荷的 ${key} 非法：${String(payload[key])}`);
    }
  };
  switch (type) {
    case OPERATION_TYPES.ADD_OBJECT:
      requireString("chunkId");
      requireString("objectId");
      if (payload.data === undefined) {
        errors.push("add-object 载荷缺 data");
      }
      _validateLayerStackSnapshot(payload, errors);
      _validateLayerEdgeChunks(payload.chunks, errors, "add-object");
      break;
    case OPERATION_TYPES.MODIFY_OBJECT:
      requireString("chunkId");
      requireString("objectId");
      if (payload.before === undefined || payload.after === undefined) {
        errors.push("modify-object 载荷缺 before/after 快照");
      } else if (
        payload.before === null ||
        typeof payload.before !== "object" ||
        Array.isArray(payload.before) ||
        payload.after === null ||
        typeof payload.after !== "object" ||
        Array.isArray(payload.after)
      ) {
        errors.push("modify-object 载荷的 before/after 必须是对象快照");
      }
      _validateLayerStackSnapshot(payload, errors);
      if (payload.chunks !== undefined) {
        if (payload.chunks === null || typeof payload.chunks !== "object" || Array.isArray(payload.chunks)) {
          errors.push("modify-object 载荷的 chunks 必须是 {before, after} 形态");
        } else {
          _validateLayerEdgeChunks(payload.chunks.before, errors, "modify-object chunks.before");
          _validateLayerEdgeChunks(payload.chunks.after, errors, "modify-object chunks.after");
        }
      }
      break;
    case OPERATION_TYPES.DELETE_OBJECT:
      requireString("chunkId");
      requireString("objectId");
      if (payload.data === null || typeof payload.data !== "object") {
        errors.push("delete-object 载荷缺 data 快照");
      }
      if (!Array.isArray(payload.chunks)) {
        errors.push("delete-object 载荷缺 chunks 层位边");
      } else {
        _validateLayerEdgeChunks(payload.chunks, errors, "delete-object");
      }
      break;
    case OPERATION_TYPES.CHOOSE_OBJECT:
    case OPERATION_TYPES.UNCHOOSE_OBJECT:
      requireString("chunkId");
      requireString("objectId");
      if (
        payload.choice !== undefined &&
        typeof payload.choice !== "string"
      ) {
        errors.push(`${type} 载荷的 choice 必须是字符串`);
      }
      _validateLayerEdgeChunks(payload.chunks, errors, type);
      break;
    case OPERATION_TYPES.MOVE_HEAD:
      requireNodeId("targetNodeId");
      break;
    case OPERATION_TYPES.UNDO:
      requireNodeId("targetNodeId");
      requireNodeId("previousHeadId");
      break;
    case OPERATION_TYPES.REDO:
      requireNodeId("targetUndoId");
      break;
    case OPERATION_TYPES.CLOSE_SUPRA:
      if (parseSupraId(payload.supraId) === null) {
        errors.push(`close-supra 载荷的 supraId 非法：${String(payload.supraId)}`);
      }
      break;
    default:
      break;
  }
}

/**
 * 校验层栈快照字段（旧日志形态）
 * @description 层栈快照已退役：新记录不再携带（层位信息由层位边承载）；旧记录存在该字段时仍须为字符串数组。
 * @param {Object} payload - 类型载荷
 * @param {string[]} errors - 错误收集列表
 * @private
 */
function _validateLayerStackSnapshot(payload, errors) {
  if (payload.layerStackSnapshot === undefined) {
    return;
  }
  if (!Array.isArray(payload.layerStackSnapshot) || payload.layerStackSnapshot.some((id) => typeof id !== "string")) {
    errors.push("layerStackSnapshot 必须是字符串数组");
  }
}

/**
 * 校验层位边集合字段（可选）
 * @param {?Array<{chunkId: string, below: string[], above: string[]}>} chunks - 层位边集合；undefined 合法（未携带）
 * @param {string[]} errors - 错误收集列表
 * @param {string} label - 错误信息的字段前缀
 * @returns {void}
 * @private
 */
function _validateLayerEdgeChunks(chunks, errors, label) {
  if (chunks === undefined) {
    return;
  }
  if (!Array.isArray(chunks)) {
    errors.push(`${label} 的 chunks 必须是数组`);
    return;
  }
  for (const entry of chunks) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.chunkId !== "string" ||
      !Array.isArray(entry.below) ||
      entry.below.some((id) => typeof id !== "string") ||
      !Array.isArray(entry.above) ||
      entry.above.some((id) => typeof id !== "string")
    ) {
      errors.push(`${label} 的 chunks 条目必须是 {chunkId, below: string[], above: string[]} 形态`);
      return;
    }
  }
}

export {
  OPERATION_TYPES,
  OPERATION_EFFECT_KINDS,
  WHITEBOARD_OPERATION_TYPES,
  TREE_OPERATION_TYPES,
  getOperationEffectKind,
  makeOperationId,
  parseOperationId,
  makeMoleculeId,
  parseMoleculeId,
  makeSupraId,
  parseSupraId,
  compareTimeMarks,
  compareRecords,
  createAddObjectOperation,
  createModifyObjectOperation,
  createDeleteObjectOperation,
  createChooseObjectOperation,
  createUnchooseObjectOperation,
  createMoveHeadOperation,
  createUndoOperation,
  createRedoOperation,
  createCloseSupraOperation,
  validateOperation,
};
