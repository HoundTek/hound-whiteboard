/**
 * @file 远端记录接入器
 * @description 为各同步通道提供共享的记录去重、依赖预检、乱序缓冲与权威日志水位驱动接入。
 * @module host/sync/remote-record-ingestor
 * @author Zhou Chenyu
 */

import {
  OPERATION_TYPES,
  compareRecords,
  parseOperationId,
  validateOperation,
} from "../../kernel/hit/operation.js";

/**
 * 计算各来源已追加的最大操作序号
 * @param {Object[]} records - 记录数组
 * @returns {Map<string, number>} 来源到最大序号的映射
 */
function maxSeqBySource(records) {
  const map = new Map();
  for (const record of records) {
    const parsed = parseOperationId(record.id);
    if (parsed !== null && parsed.n > (map.get(record.source) ?? 0)) {
      map.set(record.source, parsed.n);
    }
  }
  return map;
}

/**
 * 按超分子分组记录
 * @param {Map<string, Object>} pending - 待接入记录表
 * @returns {Object[][]} 分组结果
 */
function groupPending(pending) {
  const groups = [];
  const bySupra = new Map();
  for (const record of pending.values()) {
    const supraId = record.supraId ?? null;
    if (supraId === null) {
      groups.push([record]);
      continue;
    }
    let group = bySupra.get(supraId);
    if (group === undefined) {
      group = [];
      bySupra.set(supraId, group);
    }
    group.push(record);
  }
  for (const group of bySupra.values()) {
    group.sort((a, b) => {
      if (a.source !== b.source) return a.source < b.source ? -1 : 1;
      return parseOperationId(a.id).n - parseOperationId(b.id).n;
    });
    let run = [group[0]];
    groups.push(run);
    for (let i = 1; i < group.length; i += 1) {
      const prev = parseOperationId(group[i - 1].id).n;
      const curr = parseOperationId(group[i].id).n;
      if (curr !== prev + 1) {
        run = [];
        groups.push(run);
      }
      run.push(group[i]);
    }
  }
  return groups;
}

/**
 * 取记录应用前必须已经进入日志的语义目标
 * @param {Object} record - 操作记录
 * @returns {string[]} 目标记录 id 列表
 */
function semanticDependencies(record) {
  switch (record.type) {
    case OPERATION_TYPES.UNDO:
    case OPERATION_TYPES.MOVE_HEAD:
      return [record.payload.targetNodeId];
    case OPERATION_TYPES.REDO:
      return [record.payload.targetUndoId];
    default:
      return [];
  }
}

/**
 * 创建远端记录接入器
 * @param {Object} options - 接入选项
 * @param {import("../../kernel/board/board-core.js").BoardCore} options.boardCore - 白板核心
 * @param {import("../../kernel/api/board-api.js").BoardApi} options.boardApi - 内核 API
 * @param {(error: Error, record: Object) => void} [options.onReject] - 确定无法接入的记录回调
 * @returns {{ingest: Function, drain: Function, close: Function, pendingCount: number, rejectedCount: number}} 接入器句柄
 *
 * @description
 * 各通道共享同一权威日志水位；其他通道或本地提交推进日志时会再次整理 pending。
 * 确定非法或应用失败的记录会移出 pending 并上报，缺序号或缺依赖的合法记录继续等待。
 */
function createRemoteRecordIngestor(options) {
  const { boardCore, boardApi, onReject } = options;
  const log = boardCore.operationLog;

  /**
   * 待接入记录
   * @type {Map<string, Object>}
   */
  const pending = new Map();

  /**
   * 已隔离记录及原因
   * @type {Map<string, Error>}
   */
  const rejected = new Map();

  /**
   * 是否正在排空，阻止 onAppend 重入
   * @type {boolean}
   */
  let draining = false;

  /**
   * 是否已关闭
   * @type {boolean}
   */
  let closed = false;

  /**
   * 隔离一条记录并上报原因
   * @param {Object} record - 记录
   * @param {Error} error - 失败原因
   * @returns {void}
   */
  const reject = (record, error) => {
    pending.delete(record.id);
    if (rejected.has(record.id)) return;
    rejected.set(record.id, error);
    onReject?.(error, record);
  };

  /**
   * 判定分组是否可接入
   * @param {Object[]} group - 记录分组
   * @param {Map<string, number>} nextSeq - 当前日志连续前缀的下一序号
   * @returns {boolean} 是否可接入
   */
  const isGroupApplicable = (group, nextSeq) => {
    const sorted = [...group].sort((a, b) => {
      if (a.source !== b.source) return compareRecords(a, b);
      return parseOperationId(a.id).n - parseOperationId(b.id).n;
    });
    const first = parseOperationId(sorted[0].id);
    if (first === null) return false;
    let expected = nextSeq.get(sorted[0].source) ?? 1;
    for (const record of sorted) {
      const parsed = parseOperationId(record.id);
      if (parsed === null || parsed.source !== record.source || parsed.n !== expected) {
        return false;
      }
      const dependencies = [
        ...(record.parentId === null ? [] : [record.parentId]),
        ...semanticDependencies(record),
      ];
      for (const id of dependencies) {
        if (!log.has(id) && !sorted.some((member) => member.id === id)) {
          return false;
        }
      }
      expected += 1;
    }
    return true;
  };

  /**
   * 排空全部当前可接入分组
   * @returns {{applied: number, pending: number, rejected: number}} 本轮接入统计
   */
  const drain = () => {
    let applied = 0;
    if (draining || closed) {
      return { applied, pending: pending.size, rejected: rejected.size };
    }
    draining = true;
    try {
      for (;;) {
        const nextSeq = new Map(
          [...maxSeqBySource(log.toJSON())].map(([source, n]) => [source, n + 1]),
        );
        const applicable = groupPending(pending)
          .filter((group) => isGroupApplicable(group, nextSeq))
          .sort((a, b) => compareRecords(a[0], b[0]));
        if (applicable.length === 0) break;
        for (const group of applicable) {
          const fresh = group.filter((record) => !log.has(record.id));
          for (const record of group) {
            if (log.has(record.id)) pending.delete(record.id);
          }
          if (fresh.length === 0) continue;
          try {
            const result = boardApi.applyRemoteOperations(fresh);
            applied += result.applied;
            for (const record of fresh) pending.delete(record.id);
          } catch (error) {
            const reason = error instanceof Error ? error : new Error(String(error));
            for (const record of fresh) {
              if (log.has(record.id)) {
                pending.delete(record.id);
              } else {
                reject(record, reason);
              }
            }
          }
        }
      }
    } finally {
      draining = false;
    }
    return { applied, pending: pending.size, rejected: rejected.size };
  };

  const unsubscribeAppend = log.onAppend(() => {
    queueMicrotask(() => {
      if (!draining && !closed) drain();
    });
  });

  return {
    /**
     * 接收一批远端记录并立即尝试接入
     * @param {Object[]} records - 记录数组
     * @returns {{applied: number, pending: number, rejected: number}} 接入统计
     */
    ingest(records) {
      if (closed) return { applied: 0, pending: pending.size, rejected: rejected.size };
      for (const record of Array.isArray(records) ? records : []) {
        if (record?.id === undefined || rejected.has(record.id) || log.has(record.id) || pending.has(record.id)) {
          continue;
        }
        const errors = validateOperation(record);
        if (errors.length > 0) {
          reject(record, new Error(errors.join("；")));
          continue;
        }
        pending.set(record.id, record);
      }
      return drain();
    },

    /**
     * 重新整理待接入记录
     * @returns {{applied: number, pending: number, rejected: number}} 接入统计
     */
    drain,

    /**
     * 停止日志订阅并清空待接入记录
     * @returns {void}
     */
    close() {
      if (closed) return;
      closed = true;
      unsubscribeAppend();
      pending.clear();
    },

    /**
     * 待接入记录数
     * @type {number}
     */
    get pendingCount() {
      return pending.size;
    },

    /**
     * 已隔离记录数
     * @type {number}
     */
    get rejectedCount() {
      return rejected.size;
    },
  };
}

export { createRemoteRecordIngestor, maxSeqBySource };
