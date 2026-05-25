/**
 * @file 设备树
 * @description 提供结构化设备定义、节点分发与路径解析的核心实现。
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
 * 设备树事件上下文
 * @description
 * 事件上下文包含当前节点信息、设备树实例、
 * 路径解析结果以及当前信号包等数据，供节点处理器使用。
 * @typedef {Object} DevicesTreeEventContext
 * @property {DevicesTreeNode} node - 当前正在处理的节点
 * @property {DevicesTree} tree - 所属设备树
 * @property {string} path - 当前节点路径
 * @property {string} defaultChild - 当前节点声明的默认子链路
 * @property {string} resolvedDefaultChildPath - 当前默认子链路对应的绝对路径
 * @property {number} depth - 当前分发深度
 * @property {SignalPacket|undefined} signalPacket - 当前已规整的输入信号包
 */

/**
 * 设备树运行时上下文
 * @description
 * 运行时上下文包含设备树级的共享资源和工具实例等数据，
 * 供节点处理器在分发过程中访问。
 * @typedef {Object} DevicesTreeRuntimeContext
 * @property {import("../components/board.js").Board} [board] - 当前白板实例
 * @property {import("../components/monitor.js").Monitor} [monitor] - 当前 monitor 实例
 * @property {() => number} [allocateObjectId] - 对象 id 分配器
 * @property {(position: any) => number|undefined} [resolveOwnerChunkId] - 归属区块解析器
 */

/**
 * 设备树处理器上下文
 * @description
 * 处理器上下文包含事件上下文、树级运行时上下文以及节点状态访问接口等数据，
 * 供节点处理器在处理信号包时使用。
 * @typedef {Object} DevicesTreeHandlerContext
 * @property {DevicesTreeEventContext} eventContext - 只读事件上下文
 * @property {DevicesTreeRuntimeContext} runtimeContext - 运行时上下文
 * @property {(path?: string) => any} getNodeState - 读取节点状态
 * @property {(path: string, state: any) => any} setNodeState - 写入节点状态
 */

/**
 * 设备树处理器输出
 * @description
 * 处理器输出可以是单个信号包、对象、信号包或对象的数组，或者为空。
 * @typedef {SignalPacket|Object|Array<SignalPacket|Object>|null|undefined} DevicesTreeHandlerResult
 */

/**
 * 设备树节点处理器
 * @description 设备树节点处理器是一个函数，
 * 接受规整后的信号包和处理上下文作为参数，并返回处理结果。
 * @callback DevicesTreeHandler
 * @param {SignalPacket} signalPacket - 已规整的输入信号包
 * @param {DevicesTreeHandlerContext} context - 当前处理上下文
 * @returns {DevicesTreeHandlerResult}
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
 * @property {DevicesTreeNodeUmountHandler|null} [umount] - 当前节点被卸载时的清理钩子；传 `null` 表示清空
 */

/**
 * 结构化设备节点定义
 * @description
 * 结构化设备节点定义用于描述设备子树的结构化定义，
 * 供设备构建器在构建设备节点时使用。
 * @typedef {Object} DeviceNodeDefinition
 * @property {DevicesTreeHandler|null} [handler] - 当前节点处理器
 * @property {string} [defaultChild] - 当前节点默认子链路
 * @property {import("../tools/tool.js").Tool} [tool] - 当前节点绑定的工具实例
 * @property {Object} [toolContext] - 当前工具节点固定运行时上下文
 * @property {DevicesTreeNodeUmountHandler|null} [umount] - 当前节点卸载钩子
 * @property {Record<string, DeviceNodeDefinition>} [children] - 子节点定义
 */

/**
 * 设备子树定义
 * @description
 * 设备子树定义用于描述整个设备的结构化定义，
 * 供设备构建器在构建设备时使用。
 * @typedef {Object} DeviceDefinition
 * @property {string} root - 设备根路径
 * @property {DeviceNodeDefinition} nodes - 结构化设备节点树
 * @property {() => void} [resetState] - 重置设备内部状态
 * @property {() => any} [getState] - 读取设备内部状态
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
 * 创建设备节点定义的空模板
 * @description
 * 返回一个带默认字段的节点定义结构，供设备构建器初始化节点时使用。
 * @returns {DeviceNodeDefinition} 一个具有默认值的空设备节点定义
 */
function createEmptyDeviceNodeDefinition() {
  return {
    handler: null,
    defaultChild: "",
    tool: undefined,
    toolContext: {},
    umount: null,
    children: {},
  };
}

/**
 * 深度克隆设备节点定义
 * @description
 * 复制节点定义及其子节点，避免构建过程中共享可变引用。
 * @param {DeviceNodeDefinition} nodeDefinition - 原始节点定义
 * @returns {DeviceNodeDefinition} 克隆后的节点定义
 */
function cloneDeviceNodeDefinition(nodeDefinition) {
  const clonedChildren = {};
  for (const [name, childDefinition] of Object.entries(
    nodeDefinition.children ?? {},
  )) {
    clonedChildren[name] = cloneDeviceNodeDefinition(childDefinition);
  }

  return {
    handler:
      typeof nodeDefinition.handler === "function"
        ? nodeDefinition.handler
        : null,
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
 * 设备节点定义构建器
 * @class
 * @author Zhou Chenyu
 */
class DeviceNodeBuilder {
  /**
   * @constructor
   * @param {DeviceBuilder} deviceBuilder - 所属设备构建器
   * @param {DeviceNodeDefinition} nodeDefinition - 当前节点定义
   */
  constructor(deviceBuilder, nodeDefinition) {
    this.deviceBuilder = deviceBuilder;
    this.nodeDefinition = nodeDefinition;
  }

  /**
   * 设置节点处理器
   * @param {DevicesTreeHandler|null} handler - 节点处理器
   * @returns {DeviceNodeBuilder} 返回自身以继续配置当前节点
   */
  handler(handler) {
    this.nodeDefinition.handler =
      typeof handler === "function" ? handler : null;
    return this;
  }

  /**
   * 设置节点默认子链路
   * @param {string} defaultChild - 默认子链路
   * @returns {DeviceNodeBuilder} 返回自身以继续配置当前节点
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
   * @returns {DeviceNodeBuilder} 返回自身以继续配置当前节点
   */
  tool(tool, toolContext = {}) {
    this.nodeDefinition.tool = tool;
    this.nodeDefinition.toolContext = isPlainObject(toolContext)
      ? { ...toolContext }
      : {};
    return this;
  }

  /**
   * 设置节点卸载钩子
   * @param {DevicesTreeNodeUmountHandler|null} umountHandler - 节点卸载钩子
   * @returns {DeviceNodeBuilder} 返回自身以继续配置当前节点
   */
  umount(umountHandler) {
    this.nodeDefinition.umount =
      typeof umountHandler === "function" ? umountHandler : null;
    return this;
  }

  /**
   * 结束当前子节点构建
   * @returns {DeviceBuilder} 返回设备构建器以继续配置其他节点或完成设备构建
   */
  end() {
    return this.deviceBuilder;
  }
}

/**
 * 设备定义构建器
 * @class
 * @author Zhou Chenyu
 */
class DeviceBuilder {
  /**
   * @constructor
   * @param {string} rootPath - 设备根路径
   */
  constructor(rootPath = "/") {
    this.root = toAbsolutePath(normalizePath(rootPath));
    this.rootNodeDefinition = createEmptyDeviceNodeDefinition();
    this.exposedApi = {};
  }

  /**
   * 获取或创建某个相对路径的节点定义
   * @param {string} path - 相对设备根路径
   * @returns {DeviceNodeBuilder} 返回对应节点构建器以开始配置某节点
   */
  node(path = "") {
    const segments = normalizePath(path);
    let currentNode = this.rootNodeDefinition;

    for (const segment of segments) {
      if (!currentNode.children[segment]) {
        currentNode.children[segment] = createEmptyDeviceNodeDefinition();
      }
      currentNode = currentNode.children[segment];
    }

    return new DeviceNodeBuilder(this, currentNode);
  }

  /**
   * 暴露设备级状态 API
   * @param {Record<string, Function>} api - 设备接口
   * @returns {DeviceBuilder} 返回自身以继续配置设备或完成设备构建
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
   * 生成结构化设备定义
   * @returns {DeviceDefinition} 返回结构化设备定义
   */
  build() {
    return {
      root: this.root,
      nodes: cloneDeviceNodeDefinition(this.rootNodeDefinition),
      ...this.exposedApi,
    };
  }
}

/**
 * 创建设备定义构建器
 * @description 创建设备根路径对应的节点构建器，供后续配置子节点和状态 API。
 * @param {string} rootPath - 设备根路径
 * @returns {DeviceBuilder} 返回设备定义构建器以开始配置设备子树
 */
function createDevice(rootPath = "/") {
  return new DeviceBuilder(rootPath);
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
   * @param {string} [defaultChild=""] - 节点默认子链路
   * @param {DevicesTreeNodeUmountHandler|null} [umountHandler=null] - 节点卸载钩子
   * @constructor
   */
  constructor(
    name,
    parent = null,
    handler = null,
    defaultChild = "",
    umountHandler = null,
  ) {
    this.name = name;
    this.parent = parent;
    this.children = new Map();
    this.handler = typeof handler === "function" ? handler : null;
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
   * @param {{depth?: number, runtimeContext?: DevicesTreeRuntimeContext}} [routeContext={}] - 路由上下文
   * @returns {SignalPacket[]}
   */
  process(signalPacket, tree, routeContext = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket, {
      defaultTo: "/",
    });
    const handler = this.getHandler();
    if (!handler) {
      return [new SignalPacket("", normalizedPacket.signals)];
    }

    return DevicesTree.normalizeProcessResult(
      handler(
        normalizedPacket,
        tree.createHandlerContext(this, normalizedPacket, routeContext),
      ),
    );
  }

  /**
   * 在节点被卸载时执行清理
   * @param {DevicesTree} tree - 当前设备树
   * @param {{depth?: number, runtimeContext?: DevicesTreeRuntimeContext}} [routeContext={}] - 卸载上下文
   * @returns {*}
   */
  umount(tree, routeContext = {}) {
    const umountHandler = this.getUmountHandler();
    const result = umountHandler?.(
      tree.createHandlerContext(this, undefined, routeContext),
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
   * 树级运行时上下文
   * @type {DevicesTreeRuntimeContext}
   */
  runtimeContext;

  /**
   * @param {{maxDispatchDepth?: number, runtimeContext?: DevicesTreeRuntimeContext}} [options={}] - 树配置
   * @constructor
   */
  constructor(options = {}) {
    this.root = new DevicesTreeNode("");
    this.maxDispatchDepth = options.maxDispatchDepth ?? 32;
    this.runtimeContext = isPlainObject(options.runtimeContext)
      ? { ...options.runtimeContext }
      : {};
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
   * 规整处理结果
   * @param {DevicesTreeHandlerResult} result - 处理结果
   * @returns {SignalPacket[]}
   */
  static normalizeProcessResult(result) {
    return SignalPacket.normalizeResult(result);
  }

  /**
   * 合并树级与调用级运行时上下文
   * @param {{runtimeContext?: DevicesTreeRuntimeContext}} [routeContext={}] - 调用上下文
   * @returns {DevicesTreeRuntimeContext}
   */
  buildRuntimeContext(routeContext = {}) {
    return {
      ...this.runtimeContext,
      ...(isPlainObject(routeContext.runtimeContext)
        ? routeContext.runtimeContext
        : {}),
    };
  }

  /**
   * 创建节点处理器上下文
   * @param {DevicesTreeNode} node - 当前节点
   * @param {SignalPacket|undefined} signalPacket - 当前信号包
   * @param {{depth?: number, runtimeContext?: DevicesTreeRuntimeContext}} [routeContext={}] - 路由上下文
   * @returns {DevicesTreeHandlerContext}
   */
  createHandlerContext(node, signalPacket, routeContext = {}) {
    const defaultChild = node.getDefaultChild();
    const eventContext = Object.freeze({
      node,
      tree: this,
      path: node.path,
      defaultChild,
      resolvedDefaultChildPath: defaultChild
        ? DevicesTree.resolvePath(node.path, defaultChild)
        : node.path,
      depth: routeContext.depth ?? 0,
      signalPacket,
    });

    return {
      eventContext,
      runtimeContext: this.buildRuntimeContext(routeContext),
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
   * @param {DevicesTreeRuntimeContext} [toolContext={}] - 工具固定上下文
   * @returns {DevicesTreeNode}
   */
  mountTool(path, tool, toolContext = {}) {
    if (!tool || typeof tool.createProcessor !== "function") {
      throw new TypeError("Tool must provide createProcessor().");
    }

    return this.mount(path, tool.createProcessor(toolContext), {
      umount: (context = {}) =>
        tool.umount?.(
          typeof tool.createDeviceContext === "function"
            ? tool.createDeviceContext(context, toolContext)
            : context,
        ),
    });
  }

  /**
   * 显式卸载工具节点
   * @param {string} path - 工具节点绝对路径
   * @param {{runtimeContext?: DevicesTreeRuntimeContext}} [routeContext={}] - 卸载时上下文
   * @returns {boolean}
   */
  unmountTool(path, routeContext = {}) {
    return this.unmount(path, routeContext);
  }

  /**
   * 挂载一棵结构化设备子树
   * @param {string} basePath - 设备挂载基路径
   * @param {DeviceDefinition} deviceDefinition - 设备子树定义
   * @param {DevicesTreeRuntimeContext} [runtimeContext={}] - 设备级运行时上下文
   * @returns {DevicesTreeNode[]}
   */
  mountDevice(basePath, deviceDefinition, runtimeContext = {}) {
    if (!deviceDefinition || typeof deviceDefinition.root !== "string") {
      throw new TypeError("Device definition must provide root.");
    }

    if (!isPlainObject(deviceDefinition.nodes)) {
      throw new TypeError("Device definition must provide structured nodes.");
    }

    const deviceRootPath = joinPath(basePath, deviceDefinition.root);
    const mountedNodes = [];

    const mountStructuredNode = (nodeDefinition, currentPath) => {
      if (!isPlainObject(nodeDefinition)) {
        throw new TypeError(`Invalid device node definition at ${currentPath}`);
      }

      let handler =
        typeof nodeDefinition.handler === "function"
          ? nodeDefinition.handler
          : null;
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
            `Device node cannot define both handler and tool at ${currentPath}`,
          );
        }

        const toolContext = {
          ...(isPlainObject(runtimeContext) ? runtimeContext : {}),
          ...(isPlainObject(nodeDefinition.toolContext)
            ? nodeDefinition.toolContext
            : {}),
        };

        handler = nodeDefinition.tool.createProcessor(toolContext);
        umount = (context = {}) =>
          nodeDefinition.tool.umount?.(
            typeof nodeDefinition.tool.createDeviceContext === "function"
              ? nodeDefinition.tool.createDeviceContext(context, toolContext)
              : context,
          );
      }

      mountedNodes.push(
        this.mount(currentPath, handler, {
          defaultChild: nodeDefinition.defaultChild ?? "",
          umount,
        }),
      );

      for (const [childName, childDefinition] of Object.entries(
        nodeDefinition.children ?? {},
      )) {
        mountStructuredNode(childDefinition, joinPath(currentPath, childName));
      }
    };

    mountStructuredNode(deviceDefinition.nodes, deviceRootPath);
    return mountedNodes;
  }

  /**
   * 卸载某个节点子树
   * @param {string} path - 节点路径
   * @param {{runtimeContext?: DevicesTreeRuntimeContext}} [routeContext={}] - 卸载时上下文
   * @returns {boolean}
   */
  unmount(path, routeContext = {}) {
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
      node.umount(this, routeContext);
      node.children.clear();
    };

    umountRecursively(targetNode);
    return parentNode.children.delete(name);
  }

  /**
   * 沿默认子链路卸载叶子节点
   * @param {string} path - 起始节点路径
   * @param {{runtimeContext?: DevicesTreeRuntimeContext}} [routeContext={}] - 卸载时上下文
   * @returns {boolean}
   */
  unmountLeaf(path, routeContext = {}) {
    const leafNode = this.resolveDefaultLeaf(path);
    if (!leafNode || leafNode.path === "/") {
      return false;
    }
    return this.unmount(leafNode.path, routeContext);
  }

  /**
   * 向目标节点分发信号包
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {{depth?: number, runtimeContext?: DevicesTreeRuntimeContext}} [routeContext={}] - 路由上下文
   * @returns {SignalPacket[]}
   */
  dispatch(signalPacket, routeContext = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket, {
      defaultTo: "/",
    });
    const depth = routeContext.depth ?? 0;
    if (depth > this.maxDispatchDepth) {
      throw new RangeError("DevicesTree dispatch depth exceeded limit");
    }

    const targetNode = this.getNode(normalizedPacket.to || "/");
    if (!targetNode) {
      return [normalizedPacket];
    }

    const nextRouteContext = {
      depth,
      runtimeContext: this.buildRuntimeContext(routeContext),
    };
    const normalizedNextPackets = targetNode.process(
      normalizedPacket,
      this,
      nextRouteContext,
    );

    if (normalizedNextPackets.length === 0) {
      return [];
    }

    return normalizedNextPackets.flatMap((packet) => {
      const nextPacket = SignalPacket.from(packet);
      let requestedPath = nextPacket.to;

      if (!requestedPath && targetNode.getDefaultChild()) {
        const defaultTargetPath = DevicesTree.resolvePath(
          targetNode.path,
          targetNode.getDefaultChild(),
        );
        if (this.getNode(defaultTargetPath)) {
          requestedPath = targetNode.getDefaultChild();
        }
      }

      const resolvedPacket = new SignalPacket(
        DevicesTree.resolvePath(
          targetNode.path,
          requestedPath || targetNode.path,
        ),
        nextPacket.signals,
      );

      if (resolvedPacket.to === targetNode.path) {
        return [resolvedPacket];
      }

      return this.dispatch(resolvedPacket, {
        ...nextRouteContext,
        depth: depth + 1,
      });
    });
  }
}

export { DevicesTree, DevicesTreeNode, createDevice };
