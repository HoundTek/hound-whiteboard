// SPDX-License-Identifier: MIT

import { HashTrie } from "../hash-trie.js";
import { hashString } from "../hash.js";

/**
 * 从键值表构建哈希 trie
 * @param {Object<string, string>} entries - 键与值哈希
 * @returns {HashTrie} 哈希 trie
 */
function build(entries) {
  const trie = new HashTrie();
  for (const [key, valueHash] of Object.entries(entries)) {
    trie.set(key, valueHash);
  }
  return trie;
}

describe("HashTrie", () => {
  test("插入顺序不影响根，更新与删除等价于重建", () => {
    const left = build({ a: "01", b: "02", c: "03" });
    const right = build({ c: "03", a: "01", b: "02" });
    expect(left.rootHash).toBe(right.rootHash);

    left.set("b", "04");
    left.delete("a");
    left.set("d", "05");
    expect(left.rootHash).toBe(build({ b: "04", c: "03", d: "05" }).rootHash);
    expect(left.get("b")).toBe("04");
    expect(left.get("a")).toBeUndefined();
  });

  test("diffKeys 只返回值不同的完整 key", () => {
    const left = build({ a: "01", b: "02", c: "03" });
    const right = build({ a: "01", b: "99", d: "04" });

    expect(left.diffKeys(right)).toEqual(["b", "c", "d"]);
    expect(right.diffKeys(left)).toEqual(["b", "c", "d"]);
    expect(left.diffKeys(build({ a: "01", b: "02", c: "03" }))).toEqual([]);
  });

  test("同哈希路径的不同 key 不合并", () => {
    const first = "object-112789";
    const second = "object-349192";
    expect(hashString(first)).toBe(hashString(second));
    const left = build({ [first]: "01", [second]: "02" });
    const right = build({ [first]: "01", [second]: "03" });

    expect(left.diffKeys(right)).toEqual([second]);
  });
});
