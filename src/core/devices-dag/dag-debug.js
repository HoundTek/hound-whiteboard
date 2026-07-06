/**
 * @file DAG 调试与可视化
 * @description
 * 提供 DevicesDAG 的文本树形表示（dagToString）和 Mermaid 流程图生成（dagToMermaid）。
 * @module core/devices-dag/dag-debug
 * @author Zhou Chenyu
 */

import { DevicesDAG } from "./dag.js";
import { DevicesDAGNode } from "./dag-node-edge.js";

/**
 * 将 DevicesDAG 转换为树状字符串
 * @description
 * 从根节点开始 DFS 遍历，输出类似如下格式：
 * ```text
 * /
 * ├── keyboard#1
 * │   ├── code#2
 * │   │   ├── KeyW#3 [handler] [default=wasd]
 * │   │   │   └── wasd#4 [handler] [tool] [in=4]
 * │   │   ├── KeyA#5 [handler] [default=wasd]
 * │   │   │   └── wasd#4 [handler] [tool] [in=4]
 * │   │   ├── KeyS#6 [handler] [default=wasd]
 * │   │   │   └── wasd#4 [handler] [tool] [in=4]
 * │   │   └── KeyD#7 [handler] [default=wasd]
 * │   │       └── wasd#4 [handler] [tool] [in=4]
 * │   └── wasd-move#8 [handler] [tool]
 * └── mouse#9
 *     └── primary#10
 *         └── tool#11 [handler] [tool]
 * ```
 * @param {DevicesDAG} dag
 * @returns {string}
 */
function dagToString(dag) {
  const lines = [];

  /**
   * 递归遍历节点
   * @param {DevicesDAGNode} node
   * @param {string} path
   * @param {string} prefix
   * @param {boolean} isLast
   */
  const traverse = (node, path = "/", prefix = "", isLast = true) => {
    const label = path === "/" ? "/" : path.split("/").at(-1);
    const branch = path === "/" ? "" : isLast ? "└── " : "├── ";

    const handler = node.getHandler?.() ?? node.handler;
    const defaultRoute = node.getDefaultRoute?.() ?? node.defaultRoute ?? "";
    const semantics = node.getSemantics?.() ?? node.semantics ?? {};
    // viewport / prefix / tool 作为独立标签展示，其余语义归入 [...]
    const isViewport = !!semantics.viewport;
    const isPrefix = !!semantics.prefix;
    const isTool = !!semantics.tool;
    const restKeys = Object.keys(semantics).filter(
      (k) =>
        semantics[k] &&
        k !== "viewport" &&
        k !== "prefix" &&
        k !== "tool" &&
        k !== "root",
    );

    const parts = [
      `${prefix}${branch}${label}`,
      Number.isInteger(node.id) ? `#${node.id}` : "",
      handler ? "[handler]" : "",
      isViewport ? "[viewport]" : "",
      isPrefix ? "[prefix]" : "",
      isTool ? "[tool]" : "",
      defaultRoute ? `[default=${defaultRoute}]` : "",
      restKeys.length ? `[${restKeys.join(",")}]` : "",
      node.inEdges?.size > 1 ? `[in=${node.inEdges.size}]` : "",
    ];
    lines.push(parts.filter(Boolean).join(" "));

    const edges = Array.from(node.outEdges?.entries?.() ?? []).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    const childPrefix = prefix + (path === "/" ? "" : isLast ? "    " : "│   ");

    edges.forEach(([edgeName, edge], i) => {
      const childPath = path === "/" ? `/${edgeName}` : `${path}/${edgeName}`;
      traverse(edge.target, childPath, childPrefix, i === edges.length - 1);
    });
  };

  traverse(dag._root);
  return lines.join("\n");
}

/**
 * 将 DevicesDAG 转换为 Mermaid flowchart 字符串
 * @description
 * 生成一个以节点 id 为 key 的 flowchart，可直接渲染为 SVG。
 *
 * - 根节点（`semantics.root`）→ 方角矩形 `["..."]`
 * - Viewport 节点（`semantics.viewport`）→ 体育场形 `(["..."])`
 * - Prefix 节点（`semantics.prefix`）→ 子程序形 `[["..."]]`
 * - Tool 节点（`semantics.tool`）→ 数据库形 `[("...")]`
 * - 普通节点 → 圆角矩形 `("...")`
 * - 多入边节点会自然形成汇聚（DAG 特性）
 *
 * @param {DevicesDAG} dag
 * @param {Object} [options={}]
 * @param {"TD"|"LR"} [options.orientation="TD"] - 流程图方向（上下 / 左右）
 * @returns {string} Mermaid flowchart 源码
 *
 * @example
 * const dag = new DevicesDAG();
 * dag.ensureNode("/mouse/primary");
 * dag.configureNode("/mouse", { handler: () => {}, defaultRoute: "primary" });
 * console.log(dagToMermaid(dag));
 * // flowchart TD
 * //   0["/ #0 [root]"]
 * //   0 -->|"mouse"| 1
 * //   1("mouse #1 [handler] →primary")
 * //   1 -->|"primary"| 2
 * //   2("primary #2")
 */
function dagToMermaid(dag, options = {}) {
  const orientation = options.orientation ?? "TD";
  const lines = [`flowchart ${orientation}`];
  const visited = new Set();

  /**
   * @param {DevicesDAGNode} node
   * @param {number|null} parentId
   * @param {string|null} edgeName
   */
  const traverse = (node, parentId = null, edgeName = null) => {
    const alreadyVisited = visited.has(node.id);

    // 画出从父节点到当前节点的边（即使节点已 visit 过也要画边）
    if (parentId !== null && edgeName !== null) {
      const safeEdge = edgeName.replace(/"/g, "'");
      lines.push(`  ${parentId} -->|"${safeEdge}"| ${node.id}`);
    }

    if (alreadyVisited) return;
    visited.add(node.id);

    const label = mermaidNodeLabel(node);
    const safeLabel = label.replace(/"/g, "'");
    const semantics = node.getSemantics?.() ?? node.semantics ?? {};

    // 根据语义选择节点形状（优先级：root > viewport > prefix > tool > 默认）
    if (semantics.root) {
      lines.push(`  ${node.id}["${safeLabel}"]`);
    } else if (semantics.viewport) {
      lines.push(`  ${node.id}(["${safeLabel}"])`);
    } else if (semantics.prefix) {
      lines.push(`  ${node.id}[["${safeLabel}"]]`);
    } else if (semantics.tool) {
      lines.push(`  ${node.id}[("${safeLabel}")]`);
    } else {
      lines.push(`  ${node.id}("${safeLabel}")`);
    }

    const edges = Array.from(node.outEdges?.entries?.() ?? []).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    for (const [name, edge] of edges) {
      traverse(edge.target, node.id, name);
    }
  };

  traverse(dag._root);
  return lines.join("\n");
}

/**
 * 生成 Mermaid 节点的可读标签
 * @param {DevicesDAGNode} node
 * @returns {string}
 */
function mermaidNodeLabel(node) {
  const parts = [];

  // 路径末段名
  const pathName = node.path
    ? node.path.split("/").at(-1) || "/"
    : `#${node.id}`;
  parts.push(pathName);

  // 节点 id
  parts.push(`#${node.id}`);

  // 语义标签（viewport/prefix/tool 独立展示，其余归入 [...]）
  const semantics = node.getSemantics?.() ?? node.semantics ?? {};
  if (semantics.viewport) parts.push("[viewport]");
  if (semantics.prefix) parts.push("[prefix]");
  if (semantics.tool) parts.push("[tool]");
  const restKeys = Object.keys(semantics).filter(
    (k) =>
      semantics[k] &&
      k !== "viewport" &&
      k !== "prefix" &&
      k !== "tool" &&
      k !== "root",
  );
  if (restKeys.length) parts.push(`[${restKeys.join(",")}]`);

  // handler 标记
  const handler = node.getHandler?.() ?? node.handler;
  if (handler) parts.push("[handler]");

  // defaultRoute 标记
  const defaultRoute = node.getDefaultRoute?.() ?? node.defaultRoute ?? "";
  if (defaultRoute) parts.push(`→${defaultRoute}`);

  return parts.join(" ");
}

export { dagToString, dagToMermaid };
