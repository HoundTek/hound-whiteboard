/**
 * @file 层位边写入
 * @description 提供静态层叠图共享的无环层位边写入规则。
 * @module kernel/board/layer-edges
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { canonicalJson } from "../utils/canonical-json.js";
import { hashString } from "../utils/hash.js";

/**
 * 计算静态层叠图的确定性内容哈希
 * @param {import("../utils/directed-graph.js").DirectedGraph<string>} graph - 静态状态图
 * @returns {string} 图内容哈希
 */
function hashLayerGraph(graph) {
  const nodes = [...graph.getNodes()].sort();
  const edges = nodes.flatMap((id) =>
    [...(graph.neighborsUnsafe(id) ?? [])].map((to) => [id, to]),
  ).sort(([aFrom, aTo], [bFrom, bTo]) =>
    aFrom === bFrom ? (aTo < bTo ? -1 : aTo > bTo ? 1 : 0) : (aFrom < bFrom ? -1 : 1),
  );
  return hashString(canonicalJson({ nodes, edges }));
}

/**
 * 在静态状态图中加边（防御成环）
 * @description 记录边与缝合边理论上不成环；过渡中间态偏离时以可达性检查兜底。
 * @param {import("../utils/directed-graph.js").DirectedGraph<string>} graph - 静态状态图
 * @param {string} from - 起点（在下者）
 * @param {string} to - 终点（在上者）
 * @returns {boolean} 是否实际写入
 */
function addLayerEdgeIfAcyclic(graph, from, to) {
  if (from === to || !graph.hasNode(from) || !graph.hasNode(to)) return false;
  if (graph.hasEdge(from, to)) return false;
  const stack = [to];
  const visited = new Set([to]);
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === from) return false;
    for (const next of graph.neighborsUnsafe(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
  }
  graph.addEdgeUnsafe(from, to);
  return true;
}

export { addLayerEdgeIfAcyclic, hashLayerGraph };
