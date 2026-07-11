/**
 * @file AOM 可绘制对象收集工具
 * @description 提供从 ActiveObjectManager 按层/语义收集 AOM 绘制对象的纯函数。不依赖渲染器内部状态。
 * @module core/worker/components/renderer/aom-collect-utils
 * @author Zhou Chenyu
 */

import { BasicObject } from "../../../shared/objects/basic-obj.js";
import { Layer } from "../orchestration/active-object-manager.js";

/**
 * 按对象 id 序列解析并收集可绘制对象
 * @param {Iterable<number>} objectIds - 对象 id 序列
 * @param {(objectId: number) => BasicObject | undefined} resolveObject - 对象解析器
 * @param {Set<number>} seenObjectIds - 已收集对象 id
 * @returns {BasicObject[]}
 */
function collectDrawablesByObjectIds(objectIds, resolveObject, seenObjectIds) {
  const drawables = [];

  for (const objectId of objectIds ?? []) {
    if (seenObjectIds.has(objectId)) continue;

    const objectInstance = resolveObject?.(objectId);
    if (!(objectInstance instanceof BasicObject)) continue;

    drawables.push(objectInstance);
    seenObjectIds.add(objectId);
  }

  return drawables;
}

/**
 * 收集某层按 inactive 语义参与绘制的对象 id
 * @param {Layer} layer - 当前层
 * @returns {number[]}
 */
function collectSemanticInactiveLayerObjectIds(layer) {
  const objectIds = Array.from(
    layer?.inactiveGraph?.getTopologicalOrder?.() ?? [],
  );

  if (layer?.active === false) {
    for (const objectId of layer.activeObjects ?? []) {
      if (objectIds.includes(objectId)) continue;
      objectIds.push(objectId);
    }
  }

  return objectIds;
}

/**
 * 按 inactive 语义收集某层的对象
 * @param {import("../orchestration/active-object-manager.js").ActiveObjectManager} aom - 活动对象管理器
 * @param {Layer} layer - 当前层
 * @param {Set<number>} seenObjectIds - 已收集对象 id
 * @returns {BasicObject[]}
 */
function collectInactiveLayerDrawables(aom, layer, seenObjectIds) {
  if (!aom) return [];

  return collectDrawablesByObjectIds(
    collectSemanticInactiveLayerObjectIds(layer),
    (objectId) => aom.findBoardObjectInstance?.(objectId),
    seenObjectIds,
  );
}

/**
 * 收集某层的活动对象
 * @param {import("../orchestration/active-object-manager.js").ActiveObjectManager} aom - 活动对象管理器
 * @param {Layer} layer - 当前层
 * @param {Set<number>} seenObjectIds - 已收集对象 id
 * @returns {BasicObject[]}
 */
function collectActiveLayerDrawables(aom, layer, seenObjectIds) {
  if (!aom || layer?.active === false) return [];

  return collectDrawablesByObjectIds(
    layer?.activeObjects,
    (objectId) => aom.activeObjectIndex?.get?.(objectId),
    seenObjectIds,
  );
}

/**
 * 收集某层的可绘制对象
 * @param {import("../orchestration/active-object-manager.js").ActiveObjectManager} aom - 活动对象管理器
 * @param {Layer} layer - 当前层
 * @param {Set<number>} seenObjectIds - 已收集对象 id
 * @returns {BasicObject[]}
 */
function collectLayerDrawables(aom, layer, seenObjectIds) {
  return [
    ...collectActiveLayerDrawables(aom, layer, seenObjectIds),
    ...collectInactiveLayerDrawables(aom, layer, seenObjectIds),
  ];
}

/**
 * 收集未落入 layerOrder 的活动对象
 * @param {import("../orchestration/active-object-manager.js").ActiveObjectManager} aom - 活动对象管理器
 * @param {Set<number>} seenObjectIds - 已收集对象 id
 * @returns {BasicObject[]}
 */
function collectFallbackActiveDrawables(aom, seenObjectIds) {
  if (!aom) return [];

  const drawables = [];
  for (const objectInstance of aom.activeObjects ?? []) {
    if (!(objectInstance instanceof BasicObject)) continue;
    if (seenObjectIds.has(objectInstance.id)) continue;
    drawables.push(objectInstance);
    seenObjectIds.add(objectInstance.id);
  }

  return drawables;
}

/**
 * 收集应绘制的 AOM 对象
 * @param {import("../orchestration/active-object-manager.js").ActiveObjectManager | undefined} aom - 活动对象管理器
 * @returns {BasicObject[]}
 */
function collectActiveDrawables(aom) {
  if (!aom) return [];

  const drawables = [];
  const seenObjectIds = new Set();

  for (const layer of aom.layerOrder ?? []) {
    drawables.push(...collectLayerDrawables(aom, layer, seenObjectIds));
  }

  drawables.push(...collectFallbackActiveDrawables(aom, seenObjectIds));

  return drawables;
}

export {
  collectActiveDrawables,
  collectActiveLayerDrawables,
  collectDrawablesByObjectIds,
  collectFallbackActiveDrawables,
  collectInactiveLayerDrawables,
  collectLayerDrawables,
  collectSemanticInactiveLayerObjectIds,
};
