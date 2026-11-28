/**
 * @file 序列化对象几何
 * @description 从不实例化 BasicObject 的快照计算范围与世界包围矩形。
 * @module kernel/objects/object-geometry
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { getSerializedObjectRange } from "./object-deserializer.js";
import { RectangleRange } from "../range/index.js";
import { Vector } from "../utils/math.js";

/**
 * 计算序列化快照的世界包围矩形
 * @param {Object} snapshot - 序列化对象快照
 * @returns {RectangleRange|null} 世界包围矩形；快照缺少几何时为 null
 */
function getSerializedObjectWorldRect(snapshot) {
  if (!snapshot?.position) return null;
  const range = getSerializedObjectRange(snapshot);
  if (!range) return null;
  if (Array.isArray(range.points) && range.points.length === 0) {
    return new RectangleRange(0, 0, 0, 0);
  }
  return RectangleRange.from(range.withPosition(Vector.parse(snapshot.position)));
}

export { getSerializedObjectRange, getSerializedObjectWorldRect };
