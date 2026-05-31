/**
 * @file 设备树
 * @description 提供结构化设备定义、逐层下传分发与路径解析的核心实现。
 * @module core/devices/devices-tree
 * @author Zhou Chenyu
 */

import {
  joinPath,
  normalizePath,
  resolvePath,
  toAbsolutePath,
} from "../utils/path.js";
import { SignalPacket } from "./signal.js";

/**
 * 设备树处理器上下文
 * @description
 * 处理器上下文包含当前节点元数据、累积上下文以及节点状态访问接口，
 * 供节点处理器在处理信号包时使用。
 *
 * 累积上下文（`context`）是逐层下传过程中逐步追加的只读对象：
 * - 上游节点通过返回 { context: { key: value } } 将数据注入累积上下文
 * - 下游节点从 context 中读取上游注入的数据
 * - 不可覆盖已有键（dispatcher 保证）
 * - 需要可变数据时使用 getNodeState / setNodeState
 * @typedef {Object} DevicesTreeHandlerContext
 * @property {DevicesTreeNode} node - 当前正在处理的节点
 * @property {DevicesTree} tree - 所属设备树
 * @property {string} path - 当前节点绝对路径
 * @property {Object} semantics - 当前节点语义元数据快照
 * @property {string} defaultChild - 当前节点声明的默认子链路
 * @property {string} resolvedDefaultChildPath - 当前默认子链路对应的绝对路径
 * @property {number} depth - 当前分发深度
 * @property {SignalPacket|undefined} signalPacket - 当前已规整的输入信号包
 * @property {Object} context - 累积上下文（逐层追加，只读）
 * @property {(path?: string) => any} getNodeState - 读取任意节点状态，默认读当前节点
 * @property {(path: string, state: any) => any} setNodeState - 写入任意节点状态
 */

/**
 * 设备树处理器输出
 * @description
 * 处理器返回此结构描述下一步的路由决策和上下文追加。
 * @typedef {Object} DevicesTreeHandlerResult
 * @property {SignalPacket[]} packets - 继续路由到子节点的信号包列表；空数组表示终止
 * @property {Object} [context] - 要合并到累积上下文的键值对；不可覆盖已有键
 * @property {string} [redirect] - 覆盖 dispatcher 原本要走的下一段子路径（仅指向子节点）
 * @property {boolean} [stop] - 强制终止当前链路路由
 */

/**
 * 兼容型 handler 返回值的内部规整目标
 * @typedef {DevicesTreeHandlerResult|SignalPacket|{to?: string, signals?: Array}|Array|undefined|null} RawHandlerResult
 */

/**
 * 设备树节点处理器
 * @description 设备树节点处理器是一个函数，
 * 接受规整后的信号包和处理上下文作为参数，并返回处理结果。
 * @callback DevicesTreeHandler
 * @param {SignalPacket} signalPacket - 已规整的输入信号包
 * @param {DevicesTreeHandlerContext} context - 当前处理上下文（含累积上下文）
 * @returns {RawHandlerResult}
 */

/**
 * 设备树节点卸载钩子
 * @description
 * 设备树节点卸载钩子是一个函数，在节点被卸载时调用，
 * 接受当前树实例和卸载上下文作为参数，并执行必要的清理工作。
 * @callback DevicesTreeNodeUmountHandler
 * @param {DevicesTreeHandlerContext} context - 当前卸载上下文
 * @returns {*}
 */

/**
 * 设备树节点配置
 * @description
 * 设备树节点配置包含节点处理器、默认子链路和卸载钩子等可选项，
 * 供节点构建器在构建节点时使用。
 * @typedef {Object} DevicesTreeNodeConfig
 * @property {string|null} [defaultChild] - 当前节点的默认子链路；传 `null` 或空串表示清空
 * @property {DevicesTreeHandler|null} [handler] - 当前节点处理器；传 `null` 表示清空
 * @property {Object|null} [semantics] - 当前节点的职责语义；传 `null` 表示清空
 * @property {DevicesTreeNodeUmountHandler|null} [umount] - 当前节点被卸载时的清理钩子；传 `null` 表示清空
 */

/**
 * 结构化子树节点定义
 * @description
 * 结构化子树节点定义用于描述任意输入子树的结构化定义，
 * 供子树构建器在构建节点时使用。
 * @typedef {Object} SubTreeNodeDefinition
 * @property {DevicesTreeHandler|null} [handler] - 当前节点处理器
 * @property {Object} [semantics] - 当前节点职责语义
 * @property {string} [defaultChild] - 当前节点默认子链路
 * @property {import("../tools/tool.js").Tool} [tool] - 当前节点绑定的工具实例
 * @property {Object} [toolContext] - 当前工具节点固定运行时上下文
 * @property {DevicesTreeNodeUmountHandler|null} [umount] - 当前节点卸载钩子
 * @property {Record<string, SubTreeNodeDefinition>} [children] - 子节点定义
 */

/**
 * 结构化子树定义
 * @description
 * 结构化子树定义用于描述任意一棵可挂载到 DevicesTree 的输入子树。
 * @typedef {Object} SubTreeDefinition
 * @property {string} root - 子树根路径
 * @property {SubTreeNodeDefinition} nodes - 结构化子树节点树
 * @property {() => void} [resetState] - 重置子树内部状态
 * @property {() => any} [getState] - 读取子树内部状态
 */

/**
 * 判断值是否为纯对象
 * @description 纯对象指的是通过 `{}` 或 `new Object()` 创建的对象，而非数组、函数或其他内置类型。
 * @param {any} value - 待判断的值
 * @returns {Boolean} - 如果值是纯对象，则返回 `true`；否则返回 `false`
 */
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 创建子树节点定义的空模板
 * @description
 * 返回一个带默认字段的节点定义结构，供子树构建器初始化节点时使用。
 * @returns {SubTreeNodeDefinition} 一个具有默认值的空子树节点定义
 */
function createEmptySubTreeNodeDefinition() {
  return {
    handler: null,
    semantics: {},
    defaultChild: "",
    tool: undefined,
    toolContext: {},
    umount: null,
    children: {},
  };
}

/**
 * 深度克隆子树节点定义
 * @description
 * 复制节点定义及其子节点，避免构建过程中共享可变引用。
 * @param {SubTreeNodeDefinition} nodeDefinition - 原始节点定义
 * @returns {SubTreeNodeDefinition} 克隆后的节点定义
 */
function cloneSubTreeNodeDefinition(nodeDefinition) {
  const clonedChildren = {};
  for (const [name, childDefinition] of Object.entries(
    nodeDefinition.children ?? {},
  )) {
    clonedChildren[name] = cloneSubTreeNodeDefinition(childDefinition);
  }

  return {
    handler:
      typeof nodeDefinition.handler === "function"
        ? nodeDefinition.handler
        : null,
    semantics: isPlainObject(nodeDefinition.semantics)
      ? { ...nodeDefinition.semantics }
      : {},
    defaultChild:
      typeof nodeDefinition.defaultChild === "string"
        ? nodeDefinition.defaultChild
        : "",
    tool: nodeDefinition.tool,
    toolContext: isPlainObject(nodeDefinition.toolContext)
      ? { ...nodeDefinition.toolContext }
      : {},
    umount:
      typeof nodeDefinition.umount === "function"
        ? nodeDefinition.umount
        : null,
    children: clonedChildren,
  };
}

/**
 * 子树节点定义构建器
 * @class
 * @author Zhou Chenyu
 */
class SubTreeNodeBuilder {
  /**
   * @constructor
   * @param {SubTreeBuilder} subTreeBuilder - 所属子树构建器
   * @param {SubTreeNodeDefinition} nodeDefinition - 当前节点定义
   * @param {SubTreeNodeBuilder|null} [parentNodeBuilder=null] - 父节点构建器
   */
  constructor(subTreeBuilder, nodeDefinition, parentNodeBuilder = null) {
    this.subTreeBuilder = subTreeBuilder;
    this.nodeDefinition = nodeDefinition;
    this.parentNodeBuilder = parentNodeBuilder;
  }

  /**
   * 在当前节点下创建或读取相对子节点
   * @param {string} path - 相对当前节点的子路径
   * @returns {SubTreeNodeBuilder} 返回对应子节点构建器
   */
  node(path = "") {
    const segments = normalizePath(path);
    let currentNode = this.nodeDefinition;

    for (const segment of segments) {
      if (!currentNode.children[segment]) {
        currentNode.children[segment] = createEmptySubTreeNodeDefinition();
      }
      currentNode = currentNode.children[segment];
    }

    return new SubTreeNodeBuilder(this.subTreeBuilder, currentNode, this);
  }

  /**
   * 设置节点处理器
   * @param {DevicesTreeHandler|null} handler - 节点处理器
   * @returns {SubTreeNodeBuilder} 返回自身以继续配置当前节点
   */
  handler(handler) {
    this.nodeDefinition.handler =
      typeof handler === "function" ? handler : null;
    return this;
  }

  /**
   * 合并当前节点的职责语义
   * @param {Object|null} semantics - 节点语义片段
   * @returns {SubTreeNodeBuilder} 返回自身以继续配置当前节点
   */
  semantics(semantics = {}) {
    this.nodeDefinition.semantics = isPlainObject(semantics)
      ? {
          ...(isPlainObject(this.nodeDefinition.semantics)
            ? this.nodeDefinition.semantics
            : {}),
          ...semantics,
        }
      : {};
    return this;
  }

  /**
   * 将当前节点标记为 prefix 语义节点
   * @param {DevicesTreeHandler|null} handler - 修饰节点处理器
   * @param {Object} [semantics={}] - 额外语义片段
   * @returns {SubTreeNodeBuilder} 返回自身以继续配置当前节点
   */
  prefix(handler, semantics = {}) {
    return this.handler(handler).semantics({
      prefix: true,
      ...(isPlainObject(semantics) ? semantics : {}),
    });
  }

  /**
   * 设置节点默认子链路
   * @param {string} defaultChild - 默认子链路
   * @returns {SubTreeNodeBuilder} 返回自身以继续配置当前节点
   */
  defaultChild(defaultChild = "") {
    this.nodeDefinition.defaultChild =
      typeof defaultChild === "string" ? defaultChild : "";
    return this;
  }

  /**
   * 绑定当前节点的工具
   * @param {import("../tools/tool.js").Tool} tool - 工具实例
   * @param {Object} [toolContext={}] - 工具节点固定上下文
   * @returns {SubTreeNodeBuilder} 返回自身以继续配置当前节点
   */
  tool(tool, toolContext = {}) {
    this.nodeDefinition.tool = tool;
    this.nodeDefinition.toolContext = isPlainObject(toolContext)
      ? { ...toolContext }
      : {};
    this.nodeDefinition.semantics = {
      ...(isPlainObject(this.nodeDefinition.semantics)
        ? this.nodeDefinition.semantics
        : {}),
      tool: true,
    };
    return this;
  }

  /**
   * 设置节点卸载钩子
   * @param {DevicesTreeNodeUmountHandler|null} umountHandler - 节点卸载钩子
   * @returns {SubTreeNodeBuilder} 返回自身以继续配置当前节点
   */
  umount(umountHandler) {
    this.nodeDefinition.umount =
      typeof umountHandler === "function" ? umountHandler : null;
    return this;
  }

  /**
   * 结束当前子节点构建
   * @returns {SubTreeBuilder|SubTreeNodeBuilder} 返回父节点构建器或子树构建器
   */
  end() {
    return this.parentNodeBuilder ?? this.subTreeBuilder;
  }
}

/**
 * 结构化子树构建器
 * @class
 * @author Zhou Chenyu
 */
class SubTreeBuilder {
  /**
   * @constructor
   * @param {string} rootPath - 子树根路径
   */
  constructor(rootPath = "/") {
    this.root = toAbsolutePath(normalizePath(rootPath));
    this.rootNodeDefinition = createEmptySubTreeNodeDefinition();
    this.exposedApi = {};
  }

  /**
   * 获取或创建某个相对路径的节点定义
   * @param {string} path - 相对子树根路径
   * @returns {SubTreeNodeBuilder} 返回对应节点构建器以开始配置某节点
   */
  node(path = "") {
    const segments = normalizePath(path);
    let currentNode = this.rootNodeDefinition;

    for (const segment of segments) {
      if (!currentNode.children[segment]) {
        currentNode.children[segment] = createEmptySubTreeNodeDefinition();
      }
      currentNode = currentNode.children[segment];
    }

    return new SubTreeNodeBuilder(this, currentNode);
  }

  /**
   * 暴露子树级状态 API
   * @param {Record<string, Function>} api - 子树接口
   * @returns {SubTreeBuilder} 返回自身以继续配置子树或完成子树构建
   */
  expose(api = {}) {
    for (const [name, value] of Object.entries(api)) {
      if (typeof value === "function") {
        this.exposedApi[name] = value;
      }
    }
    return this;
  }

  /**
   * 生成结构化子树定义
   * @returns {SubTreeDefinition} 返回结构化子树定义
   */
  build() {
    return {
      root: this.root,
      nodes: cloneSubTreeNodeDefinition(this.rootNodeDefinition),
      ...this.exposedApi,
    };
  }
}

/**
 * 创建结构化子树构建器
 * @description 创建子树根路径对应的节点构建器，供后续配置子节点和状态 API。
 * @param {string} rootPath - 子树根路径
 * @returns {SubTreeBuilder} 返回子树定义构建器以开始配置子树
 */
function createSubTree(rootPath = "/") {
  return new SubTreeBuilder(rootPath);
}

/**
 * 设备树节点
 * @class
 * @author Zhou Chenyu
 */
class DevicesTreeNode {
  /**
   * 节点名
   * @type {string}
   */
  name;

  /**
   * 父节点
   * @type {DevicesTreeNode|null}
   */
  parent;

  /**
   * 子节点表
   * @type {Map<string, DevicesTreeNode>}
   */
  children;

  /**
   * 节点处理器
   * @type {DevicesTreeHandler|null}
   */
  handler;

  /**
   * 节点职责语义
   * @type {Object}
   */
  semantics;

  /**
   * 节点默认子链路
   * @type {string}
   */
  defaultChild;

  /**
   * 节点状态
   * @type {any}
   */
  state;

  /**
   * 节点卸载钩子
   * @type {DevicesTreeNodeUmountHandler|null}
   */
  umountHandler;

  /**
   * @param {string} name - 节点名
   * @param {DevicesTreeNode|null} [parent=null] - 父节点
   * @param {DevicesTreeHandler|null} [handler=null] - 节点处理器
   * @param {Object} [semantics={}] - 节点职责语义
   * @param {string} [defaultChild=""] - 节点默认子链路
   * @param {DevicesTreeNodeUmountHandler|null} [umountHandler=null] - 节点卸载钩子
   * @constructor
   */
  constructor(
    name,
    parent = null,
    handler = null,
    semantics = {},
    defaultChild = "",
    umountHandler = null,
  ) {
    this.name = name;
    this.parent = parent;
    this.children = new Map();
    this.handler = typeof handler === "function" ? handler : null;
    this.semantics = isPlainObject(semantics) ? { ...semantics } : {};
    this.defaultChild = typeof defaultChild === "string" ? defaultChild : "";
    this.state = {};
    this.umountHandler =
      typeof umountHandler === "function" ? umountHandler : null;
  }

  /**
   * 当前节点的绝对路径
   * @type {string}
   */
  get path() {
    if (!this.parent) return "/";
    const parentPath = this.parent.path;
    return parentPath === "/" ? `/${this.name}` : `${parentPath}/${this.name}`;
  }

  /**
   * 设置节点处理器
   * @param {DevicesTreeHandler|null} handler - 节点处理器
   * @returns {DevicesTreeNode}
   */
  setHandler(handler) {
    this.handler = typeof handler === "function" ? handler : null;
    return this;
  }

  /**
   * 设置节点职责语义
   * @param {Object|null} semantics - 节点职责语义
   * @returns {DevicesTreeNode}
   */
  setSemantics(semantics = {}) {
    this.semantics = isPlainObject(semantics) ? { ...semantics } : {};
    return this;
  }

  /**
   * 设置节点默认子链路
   * @param {string} defaultChild - 默认子链路
   * @returns {DevicesTreeNode}
   */
  setDefaultChild(defaultChild = "") {
    this.defaultChild = typeof defaultChild === "string" ? defaultChild : "";
    return this;
  }

  /**
   * 设置节点卸载钩子
   * @param {DevicesTreeNodeUmountHandler|null} umountHandler - 节点卸载钩子
   * @returns {DevicesTreeNode}
   */
  setUmountHandler(umountHandler) {
    this.umountHandler =
      typeof umountHandler === "function" ? umountHandler : null;
    return this;
  }

  /**
   * 获取节点处理器
   * @returns {DevicesTreeHandler|null}
   */
  getHandler() {
    return typeof this.handler === "function" ? this.handler : null;
  }

  /**
   * 获取节点职责语义
   * @returns {Object}
   */
  getSemantics() {
    return isPlainObject(this.semantics) ? { ...this.semantics } : {};
  }

  /**
   * 获取节点默认子链路
   * @returns {string}
   */
  getDefaultChild() {
    return this.defaultChild || "";
  }

  /**
   * 获取节点卸载钩子
   * @returns {DevicesTreeNodeUmountHandler|null}
   */
  getUmountHandler() {
    return typeof this.umountHandler === "function" ? this.umountHandler : null;
  }

  /**
   * 处理当前节点收到的信号包
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {DevicesTree} tree - 当前设备树
   * @param {Object} accumulatedContext - 累积上下文
   * @param {{isDestination?: boolean, depth?: number}} [options={}] - 路由选项
   * @returns {DevicesTreeHandlerResult}
   */
  process(signalPacket, tree, accumulatedContext = {}, options = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket, {
      defaultTo: "",
    });
    const handler = this.getHandler();
    const handlerContext = tree.createHandlerContext(
      this,
      normalizedPacket,
      accumulatedContext,
      options,
    );

    if (!handler) {
      return {
        packets: [new SignalPacket("", normalizedPacket.signals)],
      };
    }

    return DevicesTree.normalizeHandlerResult(
      handler(normalizedPacket, handlerContext),
    );
  }

  /**
   * 在节点被卸载时执行清理
   * @param {DevicesTree} tree - 当前设备树
   * @param {Object} [accumulatedContext={}] - 累积上下文
   * @returns {*}
   */
  umount(tree, accumulatedContext = {}) {
    const umountHandler = this.getUmountHandler();
    const result = umountHandler?.(
      tree.createHandlerContext(this, undefined, accumulatedContext),
    );
    this.state = {};
    return result;
  }
}

/**
 * 设备树
 * @class
 * @author Zhou Chenyu
 */
class DevicesTree {
  /**
   * 根节点
   * @type {DevicesTreeNode}
   */
  root;

  /**
   * 最大转发深度
   * @type {number}
   */
  maxDispatchDepth;

  /**
   * @param {{maxDispatchDepth?: number}} [options={}] - 树配置
   * @constructor
   */
  constructor(options = {}) {
    this.root = new DevicesTreeNode("");
    this.maxDispatchDepth = options.maxDispatchDepth ?? 32;
  }

  /**
   * 规整路径字符串
   * @param {string} path - 原始路径
   * @returns {string[]}
   */
  static normalizePath(path = "/") {
    return normalizePath(path);
  }

  /**
   * 将相对路径或绝对路径解析为绝对路径
   * @param {string} basePath - 当前节点绝对路径
   * @param {string} targetPath - 目标路径，可为相对路径
   * @returns {string}
   */
  static resolvePath(basePath = "/", targetPath = "") {
    return resolvePath(basePath, targetPath);
  }

  /**
   * 将 handler 的原始返回值规整为 DevicesTreeHandlerResult
   * @param {RawHandlerResult} result - handler 原始返回
   * @returns {DevicesTreeHandlerResult}
   */
  static normalizeHandlerResult(result) {
    // 已是新格式：有 packets 字段则直接返回
    if (
      result != null &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      Object.prototype.hasOwnProperty.call(result, "packets")
    ) {
      return {
        packets: Array.isArray(result.packets)
          ? result.packets.map((p) => SignalPacket.from(p))
          : [],
        context:
          result.context != null && typeof result.context === "object"
            ? { ...result.context }
            : undefined,
        redirect:
          typeof result.redirect === "string" ? result.redirect : undefined,
        stop: Boolean(result.stop),
      };
    }

    // null / undefined → 终止
    if (result === undefined || result === null) {
      return { packets: [] };
    }

    // 数组 → 将每个元素分别规整，合并所有 packets
    if (Array.isArray(result)) {
      const allPackets = [];
      for (const item of result) {
        if (
          item != null &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          Object.prototype.hasOwnProperty.call(item, "packets")
        ) {
          // 新格式结果 → 提取 packets
          allPackets.push(
            ...(Array.isArray(item.packets)
              ? item.packets.map((p) => SignalPacket.from(p))
              : []),
          );
        } else {
          // 旧格式 → 逐个规整
          allPackets.push(SignalPacket.from(item));
        }
      }
      return { packets: allPackets };
    }

    // 单个包或 { to, signals } 对象 → 规整为 SignalPacket 放进 packets
    return { packets: [SignalPacket.from(result)] };
  }

  /**
   * 将原始 handler 返回（兼容旧格式）规整为 SignalPacket[]
   * @deprecated 使用 normalizeHandlerResult 替代
   * @param {*} result - 原始处理结果
   * @returns {SignalPacket[]}
   */
  static normalizeProcessResult(result) {
    return DevicesTree.normalizeHandlerResult(result).packets;
  }

  /**
   * 创建节点处理器上下文
   * @param {DevicesTreeNode} node - 当前节点
   * @param {SignalPacket|undefined} signalPacket - 当前信号包
   * @param {Object} accumulatedContext - 累积上下文
   * @param {{isDestination?: boolean, depth?: number}} [options={}] - 路由选项
   * @returns {DevicesTreeHandlerContext}
   */
  createHandlerContext(
    node,
    signalPacket,
    accumulatedContext = {},
    options = {},
  ) {
    const defaultChild = node.getDefaultChild();
    return {
      node,
      tree: this,
      path: node.path,
      semantics: node.getSemantics(),
      defaultChild,
      resolvedDefaultChildPath: defaultChild
        ? DevicesTree.resolvePath(node.path, defaultChild)
        : node.path,
      depth: options.depth ?? 0,
      signalPacket,
      context: { ...accumulatedContext },
      getNodeState: (path = node.path) => this.getNodeState(path),
      setNodeState: (path, state) => this.setNodeState(path, state),
    };
  }

  /**
   * 根据路径获取节点
   * @param {string} path - 节点路径
   * @returns {DevicesTreeNode|null}
   */
  getNode(path = "/") {
    const segments = DevicesTree.normalizePath(path);
    let node = this.root;
    for (const segment of segments) {
      node = node.children.get(segment);
      if (!node) return null;
    }
    return node;
  }

  /**
   * 读取某个节点的状态
   * @param {string} [path="/"] - 节点路径
   * @returns {any}
   */
  getNodeState(path = "/") {
    return this.getNode(path)?.state;
  }

  /**
   * 写入某个节点的状态
   * @param {string} path - 节点路径
   * @param {any} state - 节点状态
   * @returns {any}
   */
  setNodeState(path, state) {
    const node = this.ensureNode(path);
    node.state = state ?? {};
    return node.state;
  }

  /**
   * 确保指定路径存在
   * @param {string} path - 节点路径
   * @returns {DevicesTreeNode}
   */
  ensureNode(path) {
    const segments = DevicesTree.normalizePath(path);
    let node = this.root;
    for (const segment of segments) {
      if (!node.children.has(segment)) {
        node.children.set(segment, new DevicesTreeNode(segment, node));
      }
      node = node.children.get(segment);
    }
    return node;
  }

  /**
   * 挂载节点处理器
   * @param {string} path - 节点路径
   * @param {DevicesTreeHandler|null} handler - 节点处理器
   * @param {DevicesTreeNodeConfig} [options={}] - 节点挂载选项
   * @returns {DevicesTreeNode}
   */
  mount(path, handler = null, options = {}) {
    const node = this.ensureNode(path);
    node.setHandler(handler);
    node.setSemantics(options.semantics ?? {});
    node.setDefaultChild(options.defaultChild ?? "");
    node.setUmountHandler(options.umount ?? null);
    return node;
  }

  /**
   * 运行时更新某个节点的配置
   * @param {string} path - 节点路径
   * @param {DevicesTreeNodeConfig} [options={}] - 节点配置变更
   * @returns {DevicesTreeNode}
   */
  configureNode(path, options = {}) {
    const node = this.ensureNode(path);

    if (Object.prototype.hasOwnProperty.call(options, "handler")) {
      node.setHandler(options.handler ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(options, "semantics")) {
      node.setSemantics(options.semantics ?? {});
    }

    if (Object.prototype.hasOwnProperty.call(options, "defaultChild")) {
      node.setDefaultChild(options.defaultChild ?? "");
    }

    if (Object.prototype.hasOwnProperty.call(options, "umount")) {
      node.setUmountHandler(options.umount ?? null);
    }

    return node;
  }

  /**
   * 解析从某个锚点路径出发，沿默认子链路能到达的最末端节点
   * @param {string} path - 锚点路径
   * @param {{createMissing?: boolean}} [options={}] - 解析选项
   * @returns {DevicesTreeNode|null}
   */
  resolveDefaultLeaf(path, options = {}) {
    let node = options.createMissing
      ? this.ensureNode(path)
      : this.getNode(path);
    if (!node) return null;

    while (node.getDefaultChild()) {
      const nextPath = DevicesTree.resolvePath(
        node.path,
        node.getDefaultChild(),
      );
      const nextNode = this.getNode(nextPath);
      if (!nextNode) {
        break;
      }
      node = nextNode;
    }

    return node;
  }

  /**
   * 显式挂载工具节点
   * @param {string} path - 工具节点的绝对路径
   * @param {import("../tools/tool.js").Tool} tool - 要挂载的工具
   * @param {Object} [toolContext={}] - 工具固定上下文
   * @returns {DevicesTreeNode}
   */
  mountTool(path, tool, toolContext = {}) {
    if (!tool || typeof tool.createProcessor !== "function") {
      throw new TypeError("Tool must provide createProcessor().");
    }

    const processor = tool.createProcessor(toolContext);

    const node = this.mount(path, processor, {
      semantics: { tool: true },
      umount: (context = {}) => {
        processor.dispose?.(context);
        return tool.umount?.(
          typeof tool.createDeviceContext === "function"
            ? tool.createDeviceContext(context, toolContext)
            : context,
        );
      },
    });

    return node;
  }

  /**
   * 显式卸载工具节点
   * @param {string} path - 工具节点绝对路径
   * @param {Object} [accumulatedContext={}] - 累积上下文
   * @returns {boolean}
   */
  unmountTool(path, accumulatedContext = {}) {
    return this.unmount(path, accumulatedContext);
  }

  /**
   * 挂载一棵结构化输入子树
   * @param {string} basePath - 子树挂载基路径
   * @param {SubTreeDefinition} subTreeDefinition - 结构化子树定义
   * @param {Object} [mountContext={}] - 子树挂载时的固定上下文
   * @returns {DevicesTreeNode[]}
   */
  mountSubTree(basePath, subTreeDefinition, mountContext = {}) {
    if (!subTreeDefinition || typeof subTreeDefinition.root !== "string") {
      throw new TypeError("Sub-tree definition must provide root.");
    }

    if (!isPlainObject(subTreeDefinition.nodes)) {
      throw new TypeError("Sub-tree definition must provide structured nodes.");
    }

    const subTreeRootPath = joinPath(basePath, subTreeDefinition.root);
    const mountedNodes = [];

    const mountStructuredNode = (nodeDefinition, currentPath) => {
      if (!isPlainObject(nodeDefinition)) {
        throw new TypeError(
          `Invalid sub-tree node definition at ${currentPath}`,
        );
      }

      let handler =
        typeof nodeDefinition.handler === "function"
          ? nodeDefinition.handler
          : null;
      const semantics = isPlainObject(nodeDefinition.semantics)
        ? { ...nodeDefinition.semantics }
        : {};
      let umount =
        typeof nodeDefinition.umount === "function"
          ? nodeDefinition.umount
          : null;

      if (nodeDefinition.tool !== undefined) {
        if (
          !nodeDefinition.tool ||
          typeof nodeDefinition.tool.createProcessor !== "function"
        ) {
          throw new TypeError(`Invalid tool node at ${currentPath}`);
        }

        if (handler) {
          throw new TypeError(
            `Sub-tree node cannot define both handler and tool at ${currentPath}`,
          );
        }

        const toolContext = {
          ...(isPlainObject(mountContext) ? mountContext : {}),
          ...(isPlainObject(nodeDefinition.toolContext)
            ? nodeDefinition.toolContext
            : {}),
        };

        const processor = nodeDefinition.tool.createProcessor(toolContext);
        handler = processor;
        semantics.tool = true;
        umount = (context = {}) => {
          processor.dispose?.(context);
          return nodeDefinition.tool.umount?.(
            typeof nodeDefinition.tool.createDeviceContext === "function"
              ? nodeDefinition.tool.createDeviceContext(context, toolContext)
              : context,
          );
        };
      }

      const mountedNode = this.mount(currentPath, handler, {
        semantics,
        defaultChild: nodeDefinition.defaultChild ?? "",
        umount,
      });
      mountedNodes.push(mountedNode);

      for (const [childName, childDefinition] of Object.entries(
        nodeDefinition.children ?? {},
      )) {
        mountStructuredNode(childDefinition, joinPath(currentPath, childName));
      }
    };

    mountStructuredNode(subTreeDefinition.nodes, subTreeRootPath);
    return mountedNodes;
  }

  /**
   * 卸载某个节点子树
   * @param {string} path - 节点路径
   * @param {Object} [accumulatedContext={}] - 累积上下文
   * @returns {boolean}
   */
  unmount(path, accumulatedContext = {}) {
    const segments = DevicesTree.normalizePath(path);
    if (segments.length === 0) return false;
    const name = segments[segments.length - 1];
    const parentPath = `/${segments.slice(0, -1).join("/")}`;
    const parentNode = this.getNode(parentPath === "/" ? "/" : parentPath);
    const targetNode = this.getNode(path);
    if (!parentNode || !targetNode) return false;

    const umountRecursively = (node) => {
      for (const child of [...node.children.values()]) {
        umountRecursively(child);
      }
      node.umount(this, accumulatedContext);
      node.children.clear();
    };

    umountRecursively(targetNode);
    return parentNode.children.delete(name);
  }

  /**
   * 沿默认子链路卸载叶子节点
   * @param {string} path - 起始节点路径
   * @param {Object} [accumulatedContext={}] - 累积上下文
   * @returns {boolean}
   */
  unmountLeaf(path, accumulatedContext = {}) {
    const leafNode = this.resolveDefaultLeaf(path);
    if (!leafNode || leafNode.path === "/") {
      return false;
    }
    return this.unmount(leafNode.path, accumulatedContext);
  }

  /**
   * 向目标节点逐层下传分发信号包
   * @description
   * 从根节点出发，沿 packet.to 路径逐段下传。每经过一个节点都调用其 handler，
   * 合并 handler 返回的 context（只增不改），支持 redirect 改写剩余路径。
   * 返回包只能指向当前节点的子节点，不可跳过中间节点或向上路由。
   * @param {SignalPacket|Object} signalPacket - 输入信号包；to 为从当前节点出发的子节点链
   * @param {Object} [accumulatedContext={}] - 累积上下文
   * @param {number} [depth=0] - 当前递归深度
   * @returns {DevicesTreeHandlerResult}
   */
  dispatch(signalPacket, accumulatedContext = {}, depth = 0) {
    if (depth > this.maxDispatchDepth) {
      throw new RangeError("DevicesTree dispatch depth exceeded limit");
    }

    const startPacket = SignalPacket.from(signalPacket, { defaultTo: "" });
    let segments = DevicesTree.normalizePath(startPacket.to || "");

    // 无目标路径：尝试 defaultChild，否则终止
    if (segments.length === 0) {
      if (this.root.getDefaultChild()) {
        segments = DevicesTree.normalizePath(this.root.getDefaultChild());
      } else {
        return { packets: [startPacket] };
      }
    }

    let currentNode = this.root;
    let currentPacket = startPacket;
    let mergedContext = { ...accumulatedContext };
    const finalPackets = [];
    const deferredRoutes = [];
    let nodeVisitCount = depth; // 累计已访问节点数

    const flushDeferredRoutes = () => {
      for (const deferredRoute of deferredRoutes) {
        finalPackets.push(
          ...this._routeFromNode(
            deferredRoute.fromNode,
            deferredRoute.packet,
            deferredRoute.context,
            depth + 1,
          ),
        );
      }
      deferredRoutes.length = 0;
    };

    // 逐层下传主循环
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const child = currentNode.children.get(segment);

      // 路径中断——当前节点没有名为 segment 的子节点 → 终止
      if (!child) {
        flushDeferredRoutes();
        return {
          packets:
            finalPackets.length > 0
              ? finalPackets
              : [new SignalPacket("", currentPacket.signals)],
          context:
            mergedContext !== accumulatedContext ? mergedContext : undefined,
        };
      }

      const isDestination = i === segments.length - 1;

      nodeVisitCount++;
      if (nodeVisitCount > this.maxDispatchDepth) {
        throw new RangeError("DevicesTree dispatch depth exceeded limit");
      }

      const result = child.process(currentPacket, this, mergedContext, {
        isDestination,
        depth: nodeVisitCount,
      });

      // 合并上下文（重复键报错）
      if (result.context && typeof result.context === "object") {
        for (const key of Object.keys(result.context)) {
          if (Object.prototype.hasOwnProperty.call(mergedContext, key)) {
            throw new Error(
              `Cannot override existing context key "${key}" at node ${child.path}`,
            );
          }
        }
        mergedContext = { ...mergedContext, ...result.context };
      }

      // 强制终止
      if (result.stop) {
        if (result.packets.length > 0) {
          finalPackets.push(...result.packets);
        }
        flushDeferredRoutes();
        return {
          packets: finalPackets.length > 0 ? finalPackets : result.packets,
          context:
            mergedContext !== accumulatedContext ? mergedContext : undefined,
        };
      }

      // redirect：替换从下一段开始的剩余路径
      if (result.redirect) {
        const redirectSegments = DevicesTree.normalizePath(result.redirect);
        // 移除从 i+1 开始的所有段，替换为 redirect 的段
        segments.splice(i + 1, segments.length - i - 1, ...redirectSegments);
      }

      // handler 返回了 packets——它们应该继续路由（从当前 child 的子节点出发）
      if (result.packets.length > 0) {
        // 取第一个 packet 作为继续在当前路径走的主包
        const primaryPacket = SignalPacket.from(result.packets[0]);
        const remainingPackets = result.packets.slice(1);

        // 其他包延后到主链完成后再分发，保留 handler 返回顺序
        for (const extraPacket of remainingPackets) {
          const p = SignalPacket.from(extraPacket);
          if (p.to) {
            deferredRoutes.push({
              fromNode: child,
              packet: p,
              context: mergedContext,
            });
          }
        }

        // 主包继续走剩余路径
        if (primaryPacket.to) {
          // 主包显式指定了 to → 用它替换剩余 segments
          const primarySegments = DevicesTree.normalizePath(primaryPacket.to);
          segments.splice(i + 1, segments.length - i - 1, ...primarySegments);
          currentPacket = primaryPacket;
        } else if (child.getDefaultChild()) {
          // 主包没有指定 to，但当前 child 有 defaultChild → 继续
          segments = [...segments.slice(0, i + 1), child.getDefaultChild()];
          currentPacket = primaryPacket;
        } else if (i === segments.length - 1) {
          // 到达目的地且没有后续路由 → 记录
          finalPackets.push(primaryPacket);
          break;
        }
        // 否则（中间节点、无 to、无 defaultChild）→ 继续沿原路径走下一段
      } else {
        // handler 返回空 packets → 终止当前链路
        break;
      }

      currentNode = child;
    }

    flushDeferredRoutes();
    return {
      packets: finalPackets.length > 0 ? finalPackets : [],
      context: mergedContext !== accumulatedContext ? mergedContext : undefined,
    };
  }

  /**
   * 从指定节点出发逐层下发信号包（内部辅助）
   * @param {DevicesTreeNode} fromNode - 起始节点
   * @param {SignalPacket} packet - 信号包
   * @param {Object} accumulatedContext - 累积上下文
   * @param {number} depth - 当前深度
   * @returns {SignalPacket[]}
   * @private
   */
  _routeFromNode(fromNode, packet, accumulatedContext, depth) {
    const segments = DevicesTree.normalizePath(packet.to || "");
    if (segments.length === 0) {
      if (fromNode.getDefaultChild()) {
        return this._routeFromNode(
          fromNode,
          new SignalPacket(fromNode.getDefaultChild(), packet.signals),
          accumulatedContext,
          depth,
        );
      }
      return [];
    }

    let currentNode = fromNode;
    let currentPacket = packet;
    let mergedContext = { ...accumulatedContext };
    const finalPackets = [];
    const deferredRoutes = [];

    const flushDeferredRoutes = () => {
      for (const deferredRoute of deferredRoutes) {
        finalPackets.push(
          ...this._routeFromNode(
            deferredRoute.fromNode,
            deferredRoute.packet,
            deferredRoute.context,
            depth,
          ),
        );
      }
      deferredRoutes.length = 0;
    };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const child = currentNode.children.get(segment);
      if (!child) {
        flushDeferredRoutes();
        return finalPackets;
      }

      const isDestination = i === segments.length - 1;
      const result = child.process(currentPacket, this, mergedContext, {
        isDestination,
        depth,
      });

      if (result.context && typeof result.context === "object") {
        for (const key of Object.keys(result.context)) {
          if (Object.prototype.hasOwnProperty.call(mergedContext, key)) {
            throw new Error(
              `Cannot override existing context key "${key}" at node ${child.path}`,
            );
          }
        }
        mergedContext = { ...mergedContext, ...result.context };
      }

      if (result.stop) {
        if (result.packets.length > 0) {
          finalPackets.push(...result.packets);
        }
        flushDeferredRoutes();
        return finalPackets;
      }

      if (result.packets.length === 0) {
        flushDeferredRoutes();
        return finalPackets;
      }

      const primaryPacket = SignalPacket.from(result.packets[0]);
      const remainingPackets = result.packets.slice(1);

      for (const extraPacket of remainingPackets) {
        const normalizedPacket = SignalPacket.from(extraPacket);
        if (normalizedPacket.to) {
          deferredRoutes.push({
            fromNode: child,
            packet: normalizedPacket,
            context: mergedContext,
          });
        }
      }

      currentPacket = primaryPacket;
      if (!currentPacket.to && child.getDefaultChild()) {
        segments.push(child.getDefaultChild());
      } else if (currentPacket.to) {
        const newSegments = DevicesTree.normalizePath(currentPacket.to);
        segments.splice(i + 1, segments.length - i - 1, ...newSegments);
      } else if (i === segments.length - 1) {
        finalPackets.push(currentPacket);
        break;
      }

      currentNode = child;
    }

    flushDeferredRoutes();
    return finalPackets.length > 0 ? finalPackets : [currentPacket];
  }
}

export { DevicesTree, DevicesTreeNode, createSubTree };
