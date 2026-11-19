/**
 * @file 操作日志
 * @description hit 的 append-only 操作日志：id 分配与连续性把关、准入校验、全序视图与序列化。
 * @module kernel/hit/operation-log
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import {
  makeOperationId,
  parseOperationId,
  compareTimeMarks,
  validateOperation,
} from "./operation.js";

/**
 * 操作日志
 * @description
 * hit 的 append-only 操作日志，全量分子操作记录的权威载体：树与 HEAD 均由日志派生。
 * 日志只增不删；追加时校验记录，并把守各 source 的 id 序号连续递增（自增 id 即日志顺序）。
 * @class
 * @author Zhou Chenyu
 */
class OperationLog {
  /**
   * 按追加序存放的记录
   * @type {import("./operation.js").OperationRecord[]}
   */
  #records = [];

  /**
   * id 索引
   * @type {Map<string, import("./operation.js").OperationRecord>}
   */
  #byId = new Map();

  /**
   * 超分子索引（supraOpId -> 成员记录，按追加序；旧日志形态）
   * @type {Map<string, import("./operation.js").OperationRecord[]>}
   */
  #bySupra = new Map();

  /**
   * 超分子 id 索引（supraId -> 成员记录，按追加序；三级容器模型形态）
   * @type {Map<string, import("./operation.js").OperationRecord[]>}
   */
  #bySupraId = new Map();

  /**
   * 分子 id 索引（molId -> 成员记录，按追加序；多对象手势的分子含多条记录）
   * @type {Map<string, import("./operation.js").OperationRecord[]>}
   */
  #byMol = new Map();

  /**
   * 各 source 的下一个操作序号
   * @type {Map<string, number>}
   */
  #nextSeq = new Map();

  /**
   * 各 source 已追加记录的最大时间标记
   * @type {Map<string, number>}
   */
  #lastTime = new Map();

  /**
   * 追加事件订阅者集合
   * @type {Set<(record: Object) => void>}
   */
  #appendListeners = new Set();

  /**
   * 订阅追加事件
   * @param {(record: Object) => void} listener - 记录成功入日志后的回调
   * @returns {() => void} 退订函数
   *
   * @description
   * 本地 commit 与远端应用共用本日志的 append 通道，订阅者可观察到全部新增记录。
   */
  onAppend(listener) {
    this.#appendListeners.add(listener);
    return () => this.#appendListeners.delete(listener);
  }

  /**
   * 记录条数
   * @type {number}
   */
  get size() {
    return this.#records.length;
  }

  /**
   * 读取某 source 已追加记录的最大时间标记
   * @param {string} source - 来源标识
   * @returns {number} 最大时间标记；无记录时为 0
   */
  getLastTime(source) {
    return this.#lastTime.get(source) ?? 0;
  }

  /**
   * 分配某 source 的下一个操作 id
   * @param {string} source - 发起者标识
   * @returns {string} 操作 id，形如 `"{source}/op-{n}"`
   */
  nextId(source) {
    return makeOperationId(source, this.#nextSeq.get(source) ?? 1);
  }

  /**
   * 追加一条记录
   * @description 记录须通过 validateOperation 校验，id 序号恰为该 source 的下一个序号，且时间标记不早于该
   * source 的已追加记录（同 source 时间单调，从日志层消除时钟回拨）；追加失败时日志保持不变。
   * @param {import("./operation.js").OperationRecord} record - 分子操作记录
   * @returns {string[]} 错误列表；空数组表示追加成功
   */
  append(record) {
    const errors = validateOperation(record);
    if (errors.length > 0) {
      return errors;
    }
    const expected = this.#nextSeq.get(record.source) ?? 1;
    const actual = parseOperationId(record.id).n;
    if (actual !== expected) {
      return [`id 序号不连续：期望 ${makeOperationId(record.source, expected)}，实际 ${record.id}`];
    }
    const lastTime = this.#lastTime.get(record.source);
    if (lastTime !== undefined && record.time < lastTime) {
      return [`时间标记回拨：${record.source} 的已追加记录最晚为 ${lastTime}，实际 ${record.time}`];
    }
    // 三级容器模型字段归一：旧记录（无 molId/supraId/discard 字段）读入后等价于即时分子、独立成录、非放弃型
    record.molId ??= null;
    record.supraId ??= null;
    record.discard ??= false;
    this.#records.push(record);
    this.#byId.set(record.id, record);
    if (record.supraOpId !== null) {
      const members = this.#bySupra.get(record.supraOpId) ?? [];
      members.push(record);
      this.#bySupra.set(record.supraOpId, members);
    }
    if (record.supraId !== null) {
      const members = this.#bySupraId.get(record.supraId) ?? [];
      members.push(record);
      this.#bySupraId.set(record.supraId, members);
    }
    if (record.molId !== null) {
      const members = this.#byMol.get(record.molId) ?? [];
      members.push(record);
      this.#byMol.set(record.molId, members);
    }
    this.#nextSeq.set(record.source, expected + 1);
    this.#lastTime.set(record.source, record.time);
    for (const listener of this.#appendListeners) {
      listener(record);
    }
    return [];
  }

  /**
   * 按 id 查找记录
   * @param {string} id - 操作 id
   * @returns {?import("./operation.js").OperationRecord} 记录；不存在时为 null
   */
  get(id) {
    return this.#byId.get(id) ?? null;
  }

  /**
   * 判断日志是否含有某 id 的记录
   * @param {string} id - 操作 id
   * @returns {boolean} 是否含有
   */
  has(id) {
    return this.#byId.has(id);
  }

  /**
   * 取节点的代表记录（时间标记的来源）
   * @description 独立分子为其自身；超分子节点为其末分子（完成时刻）。
   * @param {string} id - 操作 id 或超分子 id
   * @returns {?import("./operation.js").OperationRecord} 代表记录；不存在时为 null
   */
  getLastMember(id) {
    const record = this.get(id);
    if (record === null || record.supraOpId === null) {
      return record;
    }
    const members = this.#bySupra.get(record.supraOpId);
    return members?.[members.length - 1] ?? record;
  }

  /**
   * 取超分子的成员记录组
   * @param {string} supraOpId - 超分子 id（首分子 id）
   * @returns {import("./operation.js").OperationRecord[]} 成员记录数组的副本
   */
  getSupraMembers(supraOpId) {
    return [...(this.#bySupra.get(supraOpId) ?? [])];
  }

  /**
   * 取三级容器超分子的成员记录组（按 supraId）
   * @param {string} supraId - 超分子 id，形如 `"{source}/supra-{n}"`
   * @returns {import("./operation.js").OperationRecord[]} 成员记录数组的副本
   */
  getSupraIdMembers(supraId) {
    return [...(this.#bySupraId.get(supraId) ?? [])];
  }

  /**
   * 取增量式分子的成员记录组（按 molId；多对象手势的分子含多条记录）
   * @param {string} molId - 分子 id，形如 `"{source}/mol-{n}"`
   * @returns {import("./operation.js").OperationRecord[]} 成员记录数组的副本
   */
  getMoleculeMembers(molId) {
    return [...(this.#byMol.get(molId) ?? [])];
  }

  /**
   * 按追加序导出全部记录
   * @returns {import("./operation.js").OperationRecord[]} 记录数组的副本
   */
  toArray() {
    return [...this.#records];
  }

  /**
   * 按时间标记（时钟环）全序导出全部记录，日志重放的顺序依据
   * @returns {import("./operation.js").OperationRecord[]} 全序记录数组
   */
  toSortedArray() {
    return [...this.#records].sort(compareTimeMarks);
  }

  /**
   * 序列化为 JSON（记录数组）
   * @returns {import("./operation.js").OperationRecord[]} 记录数组
   */
  toJSON() {
    return this.toArray();
  }

  /**
   * 从序列化数据重建日志
   * @param {*} json - toJSON 产出的记录数组
   * @returns {OperationLog} 重建的日志
   * @throws {Error} 数据非法或序号不连续时抛出，错误信息合并全部失败条目
   */
  static fromJSON(json) {
    const log = new OperationLog();
    const list = Array.isArray(json) ? json : [];
    const errors = [];
    for (const record of list) {
      errors.push(...log.append(record));
    }
    if (!Array.isArray(json)) {
      errors.push("序列化数据必须是记录数组");
    }
    if (errors.length > 0) {
      throw new Error(errors.join("；"));
    }
    return log;
  }
}

export {
  OperationLog,
};
