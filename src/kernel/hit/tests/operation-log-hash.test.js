// SPDX-License-Identifier: MIT

import { jest } from "@jest/globals";
import { OperationLog } from "../operation-log.js";
import { createRedoOperation, makeOperationId } from "../operation.js";

/**
 * 构造一条合法重做记录
 * @param {string} source - 来源
 * @param {number} n - 操作序号
 * @param {number} time - 时间标记
 * @param {string} [targetUndoId] - 目标撤销 id
 * @returns {import("../operation.js").OperationRecord} 操作记录
 */
function makeRecord(source, n, time, targetUndoId = `${source}/op-0`) {
  return createRedoOperation({
    id: makeOperationId(source, n),
    source,
    time,
    targetUndoId,
  });
}

describe("OperationLog.rootHash", () => {
  test("各 source 流追加顺序不同但内容相同时根一致", () => {
    const left = new OperationLog();
    left.append(makeRecord("a", 1, 100));
    left.append(makeRecord("b", 1, 150));
    left.append(makeRecord("a", 2, 200));
    const right = new OperationLog();
    right.append(makeRecord("b", 1, 150));
    right.append(makeRecord("a", 1, 100));
    right.append(makeRecord("a", 2, 200));

    expect(left.rootHash).toBe(right.rootHash);
    expect(OperationLog.fromJSON(left.toJSON()).rootHash).toBe(left.rootHash);
  });

  test("同长度同 id 不同 payload 时根不同", () => {
    const left = new OperationLog();
    const right = new OperationLog();
    left.append(makeRecord("a", 1, 100, "a/op-1"));
    right.append(makeRecord("a", 1, 100, "a/op-2"));

    expect(left.rootHash).not.toBe(right.rootHash);
  });

  test("根查询不扫描记录", () => {
    const log = new OperationLog();
    log.append(makeRecord("a", 1, 100));
    const toArray = jest.spyOn(log, "toArray");
    const toJSON = jest.spyOn(log, "toJSON");

    expect(log.rootHash).toMatch(/^[0-9a-f]{8}$/);
    expect(toArray).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });
});
