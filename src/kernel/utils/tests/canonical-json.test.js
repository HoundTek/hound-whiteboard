// SPDX-License-Identifier: MIT

import { canonicalJson } from "../canonical-json.js";

describe("canonicalJson", () => {
  test("对象键序不影响规范化结果，数组顺序保留", () => {
    const left = { z: 1, a: { d: [2, 1], b: true } };
    const right = { a: { b: true, d: [2, 1] }, z: 1 };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson(left)).not.toBe(canonicalJson({ ...right, z: 2 }));
  });

  test("沿用语义比较中的 null 与 undefined 归一", () => {
    expect(canonicalJson({ a: undefined })).toBe('{"a":null}');
    expect(canonicalJson([undefined, null])).toBe("[null,null]");
  });
});
