/**
 * @file 确定性 JSON 序列化
 * @description 提供对象键序无关的规范化 JSON，供记录比较与摘要计算共用。
 * @module kernel/utils/canonical-json
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

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

export { canonicalJson };
