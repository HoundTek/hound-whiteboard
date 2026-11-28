// SPDX-License-Identifier: MIT

import { jest } from "@jest/globals";
import { OperationLog } from "../operation-log.js";
import { UndoTree } from "../undo-tree-core.js";
import {
  createAddObjectOperation,
  createCloseSupraOperation,
  createUndoOperation,
  createRedoOperation,
  makeOperationId,
} from "../operation.js";
import { BoardCore } from "../../board/board-core.js";
import { BoardApi } from "../../api/board-api.js";

/**
 * 构造增加对象记录
 * @param {string} source - 来源
 * @param {number} n - 序号
 * @param {number} time - 时间标记
 * @param {?string} [supraId] - 超分子 id
 * @param {?string} [molId] - 增量式分子 id
 * @returns {import("../operation.js").OperationRecord} 操作记录
 */
function add(source, n, time, supraId = null, molId = null) {
  return createAddObjectOperation({
    id: makeOperationId(source, n),
    source,
    time,
    supraId,
    molId,
    chunkId: "1",
    objectId: `${source}/${n}`,
    data: {},
  });
}

/**
 * 读取活动成员记录 id
 * @param {UndoTree} tree - 回溯树
 * @returns {string[]} 记录 id 序列
 */
function activeIds(tree) {
  return tree.getActiveChain().flatMap((node) => node.memberIds);
}

describe("UndoTree active-chain 增量索引", () => {
  test("追加、时间插入、撤销、重做与移动 HEAD 的变化事件可还原旧新链", () => {
    const log = new OperationLog();
    const tree = new UndoTree(log);
    let current = [];
    const apply = (record) => {
      log.append(record);
      tree.applyRecord(record);
      expect(activeIds(tree)).toEqual(current);
      expect(tree.chainHash).toBe(UndoTree.rebuildFromLog(log).chainHash);
    };
    tree.onActiveChainChange(({ diverge, removed, added }) => {
      const prefix = current.slice(0, diverge);
      expect([...prefix, ...removed.map((r) => r.id)]).toEqual(current);
      current = [...prefix, ...added.map((r) => r.id)];
    });

    apply(add("a", 1, 100));
    apply(add("a", 2, 300));
    apply(add("b", 1, 200));
    const undo = createUndoOperation({
      id: "a/op-3",
      source: "a",
      time: 400,
      targetNodeId: "b/op-1",
      previousHeadId: "a/op-2",
    });
    apply(undo);
    const redo = createRedoOperation({
      id: "a/op-4",
      source: "a",
      time: 500,
      targetUndoId: "a/op-3",
    });
    apply(redo);
    tree.moveHeadTo("a/op-1");
    expect(activeIds(tree)).toEqual(current);
    tree.rebuild();
    expect(activeIds(tree)).toEqual(current);
  });

  test("同 molId 成员就地归并也追加到活动索引", () => {
    const log = new OperationLog();
    const tree = new UndoTree(log);
    let current = [];
    tree.onActiveChainChange(({ diverge, removed, added }) => {
      const prefix = current.slice(0, diverge);
      expect([...prefix, ...removed.map((r) => r.id)]).toEqual(current);
      current = [...prefix, ...added.map((r) => r.id)];
    });
    for (const record of [
      add("a", 1, 100, "a/supra-1", "a/mol-1"),
      add("a", 2, 200, "a/supra-1", "a/mol-1"),
    ]) {
      log.append(record);
      tree.applyRecord(record);
    }

    expect(tree.getActiveChain()).toHaveLength(1);
    expect(tree.getActiveChain()[0].memberIds).toEqual(["a/op-1", "a/op-2"]);
    expect(current).toEqual(["a/op-1", "a/op-2"]);
    expect(tree.chainHash).toBe(UndoTree.rebuildFromLog(log).chainHash);
  });

  test("close-supra 折叠不改变链哈希或发出活动记录变化", () => {
    const log = new OperationLog();
    const tree = new UndoTree(log);
    for (const record of [add("a", 1, 100, "a/supra-1"), add("a", 2, 200, "a/supra-1")]) {
      log.append(record);
      tree.applyRecord(record);
    }
    const before = tree.chainHash;
    const listener = jest.fn();
    tree.onActiveChainChange(listener);
    const close = createCloseSupraOperation({ id: "a/op-3", source: "a", time: 300, supraId: "a/supra-1" });
    log.append(close);
    tree.applyRecord(close);

    expect(tree.getActiveChain()).toHaveLength(1);
    expect(tree.chainHash).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("万级深链查找不依赖递归调用栈", () => {
    const log = new OperationLog();
    const tree = new UndoTree(log);
    for (let index = 1; index <= 10000; index += 1) {
      const record = add("a", index, index * 1000);
      log.append(record);
      tree.applyRecord(record);
    }

    expect(tree.findNode("a/op-9999")?.shareId).toBe("a/op-9999");
    expect(tree.findNode("a/op-10001")).toBeNull();
  });

  test("BoardApi 链哈希查询不展开活动链", () => {
    const log = new OperationLog();
    log.append(add("a", 1, 100));
    const tree = UndoTree.rebuildFromLog(log);
    const boardCore = new BoardCore({ hitRecords: log.toArray() });
    const api = new BoardApi(boardCore);
    const getActiveChain = jest.spyOn(boardCore.undoTree, "getActiveChain");

    expect(api.queryChainHash()).toBe(tree.chainHash);
    expect(getActiveChain).not.toHaveBeenCalled();
  });
});
