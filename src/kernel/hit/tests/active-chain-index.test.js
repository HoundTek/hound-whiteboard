// SPDX-License-Identifier: MIT

import { jest } from "@jest/globals";
import { ActiveChainIndex } from "../active-chain-index.js";

/**
 * 构造索引记录
 * @param {string} id - 记录 id
 * @returns {{id: string}} 记录
 */
function record(id) {
  return { id };
}

/**
 * 从完整序列构建索引
 * @param {string[]} ids - 记录 id 序列
 * @returns {ActiveChainIndex} 索引
 */
function fromIds(ids) {
  const index = new ActiveChainIndex();
  index.append(ids.map(record));
  return index;
}

describe("ActiveChainIndex", () => {
  test("插入与删除的变化序列和增量根均等价于重建", () => {
    const index = fromIds(["a", "b", "d"]);
    const inserted = index.insertBefore("b", [record("c")]);
    expect(inserted.diverge).toBe(1);
    expect(inserted.removed.map((r) => r.id)).toEqual(["b", "d"]);
    expect(inserted.added.map((r) => r.id)).toEqual(["c", "b", "d"]);
    expect(index.toArray().map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
    expect(index.rootHash).toBe(fromIds(["a", "c", "b", "d"]).rootHash);

    const removed = index.remove(["c"]);
    expect(removed.diverge).toBe(1);
    expect(removed.removed.map((r) => r.id)).toEqual(["c", "b", "d"]);
    expect(removed.added.map((r) => r.id)).toEqual(["b", "d"]);
    expect(index.rootHash).toBe(fromIds(["a", "b", "d"]).rootHash);
  });

  test("replace 保留公共前缀并校验连续性", () => {
    const index = fromIds(["a", "b", "c"]);
    const change = index.replace([record("a"), record("x"), record("c")]);
    expect(change.diverge).toBe(1);
    expect(change.removed.map((r) => r.id)).toEqual(["b", "c"]);
    expect(change.added.map((r) => r.id)).toEqual(["x", "c"]);
    expect(index.rootHash).toBe(fromIds(["a", "x", "c"]).rootHash);
    expect(() => index.remove(["a", "c"])).toThrow("连续");
  });

  test("根查询不展开序列，同序列根与构建路径无关", () => {
    const index = new ActiveChainIndex();
    index.append([record("a"), record("b")]);
    index.insertBefore("b", [record("x")]);
    index.remove(["x"]);
    const toArray = jest.spyOn(index, "toArray");

    expect(index.rootHash).toBe(fromIds(["a", "b"]).rootHash);
    expect(toArray).not.toHaveBeenCalled();
  });
});
