/**
 * @file 设备树
 * @description 提供设备树节点分发与路径解析的核心实现。
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
 * @typedef {Object} DevicesTreeRouteContext
 * @property {DevicesTreeNode} [node] - 当前正在处理的节点
 * @property {DevicesTree} [tree] - 所属设备树
 * @property {string} [path] - 当前节点路径
 * @property {string} [defaultPath] - 当前节点声明的默认下游路径
 * @property {string} [resolvedDefaultPath] - 当前节点默认下游路径对应的绝对路径
 * @property {Object} [nodeContext] - 当前节点的持久路由上下文
 * @property {number} [depth] - 当前分发深度
 */

/**
 * 设备树处理器输出
 * @typedef {SignalPacket|Object|Array<SignalPacket|Object>|null|undefined} DevicesTreeProcessorResult
 */

/**
 * 设备树节点处理器
 * @callback DevicesTreeProcessor
 * @param {SignalPacket} signalPacket - 已规整的输入信号包
 * @param {DevicesTreeRouteContext} routeContext - 当前路由上下文
 * @returns {DevicesTreeProcessorResult}
 */

/**
 * 设备树节点整包改写器
 * @callback DevicesTreePacketRewriter
 * @param {SignalPacket} signalPacket - 已规整的输入信号包
 * @param {DevicesTreeRouteContext} routeContext - 当前路由上下文
 * @returns {DevicesTreeProcessorResult}
 */

/**
 * 设备树节点卸载钩子
 * @callback DevicesTreeNodeUmountHandler
 * @param {DevicesTreeRouteContext} routeContext - 当前卸载上下文
 * @returns {*}
 */

/**
 * 设备树节点配置
 * @typedef {Object} DevicesTreeNodeConfig
 * @property {string|null} [defaultPath] - 当前节点的默认下游路径，可为相对路径；传 `null` 或空串表示清空
 * @property {DevicesTreePacketRewriter|null} [rewritePacket] - 当前节点的整包改写器；传 `null` 表示清空
 * @property {DevicesTreeProcessor|null} [processor] - 挂载到该节点的处理器；传 `null` 表示清空
 * @property {DevicesTreeNodeUmountHandler|null} [umount] - 当前节点被卸载时的清理钩子；传 `null` 表示清空
 */

/**
 * 设备子树节点定义
 * @typedef {Object} DeviceNodeDefinition
 * @property {string} [path] - 相对设备根路径
 * @property {string} [defaultPath] - 当前节点的默认下游路径，可为相对路径
 * @property {DevicesTreePacketRewriter|null} [rewritePacket] - 当前节点的整包改写器
 * @property {DevicesTreeProcessor|null} [processor] - 挂载到该节点的处理器
 * @property {DevicesTreeNodeUmountHandler|null} [umount] - 当前节点被卸载时的清理钩子
 */

/**
 * 设备子树定义
 * @typedef {Object} DeviceDefinition
 * @property {() => DeviceNodeDefinition[]} defineNodes - 返回整棵设备子树的节点定义
 * @description DevicesTree 只消费这个最小协议；业务侧通常应通过 Monitor.mountDevice() 挂载。
 */

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
   * @type {DevicesTreeProcessor|null}
   */
  processor;

  /**
   * 节点的默认下游路径
   * @type {string}
   */
  defaultPath;

  /**
   * 节点的整包改写器
   * @type {DevicesTreePacketRewriter|null}
   */
  rewritePacket;

  /**
   * 节点的持久上下文
   * @type {Object}
   */
  context;

  /**
   * 节点的卸载钩子
   * @type {DevicesTreeNodeUmountHandler|null}
   */
  umountHandler;

  /**
   * @constructor
   * @param {string} name
   * @param {DevicesTreeNode|null} parent
   * @param {DevicesTreeProcessor|null} processor
   * @param {string} defaultPath
   * @param {DevicesTreePacketRewriter|null} rewritePacket
   */
  constructor(
    name,
    parent = null,
    processor = null,
    defaultPath = "",
    rewritePacket = null,
    umountHandler = null,
  ) {
    this.name = name;
    this.parent = parent;
    this.children = new Map();
    this.processor = processor;
    this.defaultPath = typeof defaultPath === "string" ? defaultPath : "";
    this.rewritePacket =
      typeof rewritePacket === "function" ? rewritePacket : null;
    this.context = {};
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
   * 获取到根节点的路径片段
   * @returns {string[]} 路径片段
   */
  getSegments() {
    if (!this.parent) return [];
    return this.parent.getSegments().concat(this.name);
  }

  /**
   * 设置节点处理器
   * @param {DevicesTreeProcessor|null} processor - 节点处理器
   * @returns {DevicesTreeNode} 当前节点
   */
  setProcessor(processor) {
    this.processor = processor;
    return this;
  }

  /**
   * 设置节点默认下游路径
   * @param {string} defaultPath - 默认下游路径
   * @returns {DevicesTreeNode} 当前节点
   */
  setDefaultPath(defaultPath = "") {
    this.defaultPath = typeof defaultPath === "string" ? defaultPath : "";
    return this;
  }

  /**
   * 设置节点整包改写器
   * @param {DevicesTreePacketRewriter|null} rewritePacket - 节点整包改写器
   * @returns {DevicesTreeNode} 当前节点
   */
  setRewritePacket(rewritePacket) {
    this.rewritePacket =
      typeof rewritePacket === "function" ? rewritePacket : null;
    return this;
  }

  /**
   * 设置节点卸载钩子
   * @param {DevicesTreeNodeUmountHandler|null} umountHandler - 节点卸载钩子
   * @returns {DevicesTreeNode} 当前节点
   */
  setUmountHandler(umountHandler) {
    this.umountHandler =
      typeof umountHandler === "function" ? umountHandler : null;
    return this;
  }

  /**
   * 获取节点整包改写器
   * @returns {DevicesTreePacketRewriter|null}
   */
  getRewritePacket() {
    if (typeof this.rewritePacket === "function") {
      return this.rewritePacket;
    }
    return null;
  }

  /**
   * 获取节点卸载钩子
   * @returns {DevicesTreeNodeUmountHandler|null}
   */
  getUmountHandler() {
    if (typeof this.umountHandler === "function") {
      return this.umountHandler;
    }
    return null;
  }

  /**
   * 获取节点默认下游路径
   * @returns {string}
   */
  getDefaultPath() {
    return this.defaultPath || "";
  }

  /**
   * 获取节点处理器
   * @returns {DevicesTreeProcessor|null} 节点处理器
   */
  getProcessor() {
    if (typeof this.processor === "function") {
      return this.processor;
    }
    return null;
  }

  /**
   * 处理当前节点收到的信号包
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {DevicesTreeRouteContext} routeContext - 路由上下文
   * @returns {SignalPacket[]} 输出信号包列表
   */
  process(signalPacket, routeContext = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket, {
      defaultTo: "/",
    });
    const baseContext = routeContext;
    baseContext.node = this;
    baseContext.path = this.path;
    baseContext.defaultPath = this.getDefaultPath();
    baseContext.resolvedDefaultPath = this.getDefaultPath()
      ? DevicesTree.resolvePath(this.path, this.getDefaultPath())
      : this.path;
    baseContext.nodeContext = this.context;
    const processor = this.getProcessor();
    if (processor) {
      return DevicesTree.normalizeProcessResult(
        processor(normalizedPacket, baseContext),
      );
    }

    const rewritePacket = this.getRewritePacket();
    if (rewritePacket) {
      return DevicesTree.normalizeProcessResult(
        rewritePacket(normalizedPacket, baseContext),
      );
    }

    return [new SignalPacket("", normalizedPacket.signals)];
  }

  /**
   * 在节点被卸载时执行清理。
   * @param {DevicesTreeRouteContext} routeContext - 卸载上下文
   * @returns {*}
   */
  umount(routeContext = {}) {
    const baseContext = routeContext;
    baseContext.node = this;
    baseContext.path = this.path;
    baseContext.defaultPath = this.getDefaultPath();
    baseContext.resolvedDefaultPath = this.getDefaultPath()
      ? DevicesTree.resolvePath(this.path, this.getDefaultPath())
      : this.path;
    baseContext.nodeContext = this.context;
    const umountHandler = this.getUmountHandler();
    const result = umountHandler?.(baseContext);
    this.context = {};
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
   * @constructor
   */
  constructor(options = {}) {
    this.root = new DevicesTreeNode("");
    this.maxDispatchDepth = options.maxDispatchDepth ?? 32;
  }

  /**
   * 规整路径字符串
   * @param {string} path - 原始路径
   * @returns {string[]} 路径片段
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
   * @param {SignalPacket|Object|Array<SignalPacket|Object>|null} result - 处理结果
   * @returns {SignalPacket[]} 规整后的结果
   */
  static normalizeProcessResult(result) {
    return SignalPacket.normalizeResult(result);
  }

  /**
   * 根据路径获取节点
   * @param {string} path - 节点路径
   * @returns {DevicesTreeNode|null} 对应节点
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
   * 确保指定路径存在
   * @param {string} path - 节点路径
   * @returns {DevicesTreeNode} 目标节点
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
   * @param {DevicesTreeProcessor|null} processor - 节点处理器
   * @param {DevicesTreeNodeConfig} [options={}] - 节点挂载选项
   * @returns {DevicesTreeNode} 挂载后的节点
   */
  mount(path, processor = null, options = {}) {
    const node = this.ensureNode(path);
    node.setProcessor(processor);
    node.setDefaultPath(options.defaultPath ?? "");
    node.setRewritePacket(options.rewritePacket ?? null);
    node.setUmountHandler(options.umount ?? null);
    return node;
  }

  /**
   * 运行时更新某个节点的配置
   * @param {string} path - 节点路径
   * @param {DevicesTreeNodeConfig} [options={}] - 节点配置变更
   * @returns {DevicesTreeNode} 更新后的节点
   */
  configureNode(path, options = {}) {
    const node = this.ensureNode(path);

    if (Object.prototype.hasOwnProperty.call(options, "processor")) {
      node.setProcessor(options.processor ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(options, "defaultPath")) {
      node.setDefaultPath(options.defaultPath ?? "");
    }

    if (Object.prototype.hasOwnProperty.call(options, "rewritePacket")) {
      node.setRewritePacket(options.rewritePacket ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(options, "umount")) {
      node.setUmountHandler(options.umount ?? null);
    }

    return node;
  }

  /**
   * 解析从某个锚点路径出发，沿默认路径能到达的最末端节点
   * @param {string} path - 锚点路径
   * @param {{createMissing?: boolean}} [options={}] - 解析选项
   * @returns {DevicesTreeNode|null}
   */
  resolveDefaultTail(path, options = {}) {
    let node = options.createMissing
      ? this.ensureNode(path)
      : this.getNode(path);
    if (!node) return null;

    while (node.getDefaultPath()) {
      const nextPath = DevicesTree.resolvePath(
        node.path,
        node.getDefaultPath(),
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
   * 运行时在某个设备节点末端挂载工具节点
   * @param {string} path - 工具挂载锚点路径
   * @param {import("../tools/tool.js").Tool} tool - 要挂载的工具
   * @param {Object} [toolContext={}] - 工具固定上下文
   * @returns {DevicesTreeNode}
   */
  mountTool(path, tool, toolContext = {}) {
    if (!tool || typeof tool.createProcessor !== "function") {
      throw new TypeError("Tool must provide createProcessor().");
    }

    const tailNode = this.resolveDefaultTail(path, { createMissing: true });
    if (!tailNode) {
      throw new Error(`Cannot resolve tool mount path: ${path}`);
    }

    const isToolNode = tailNode.name === "tool";
    if (!isToolNode && !tailNode.getDefaultPath()) {
      tailNode.setDefaultPath("tool");
    }

    const toolPath = isToolNode ? tailNode.path : joinPath(tailNode.path, "tool");
    return this.mount(toolPath, tool.createProcessor(toolContext), {
      umount: (routeContext = {}) => {
        const deviceContext = Object.assign({}, toolContext, routeContext);
        deviceContext.nodeContext =
          routeContext.nodeContext ?? routeContext.node?.context ?? {};
        if (deviceContext.object == null) {
          deviceContext.object = deviceContext.nodeContext.object;
        }
        if (deviceContext.objects == null) {
          deviceContext.objects = deviceContext.nodeContext.objects;
        }
        return tool.umount?.(deviceContext);
      },
    });
  }

  /**
   * 运行时从某个设备节点末端卸载最后一个工具节点
   * @param {string} path - 工具卸载锚点路径
   * @returns {boolean}
   */
  unmountTool(path) {
    const tailNode = this.resolveDefaultTail(path);
    if (!tailNode || tailNode.name !== "tool") {
      return false;
    }
    return this.unmount(tailNode.path);
  }

  /**
   * 挂载一棵设备子树
   * @param {string} rootPath - 设备根路径（通常已包含 monitorId）
   * @param {DeviceDefinition} deviceDefinition - 设备子树定义
   * @returns {DevicesTreeNode[]} 挂载后的节点列表
   */
  mountDevice(rootPath, deviceDefinition) {
    if (
      !deviceDefinition ||
      typeof deviceDefinition.defineNodes !== "function"
    ) {
      throw new TypeError("Device definition must provide defineNodes().");
    }

    const nodes = deviceDefinition.defineNodes();
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return [];
    }

    const mountedNodes = [];
    for (const nodeDefinition of nodes) {
      const absolutePath = joinPath(rootPath, nodeDefinition.path ?? "");
      mountedNodes.push(
        this.mount(
          absolutePath === "" ? "/" : absolutePath,
          nodeDefinition.processor ?? null,
          {
            defaultPath: nodeDefinition.defaultPath ?? "",
            rewritePacket: nodeDefinition.rewritePacket ?? null,
            umount: nodeDefinition.umount ?? null,
          },
        ),
      );
    }

    return mountedNodes;
  }

  /**
   * 卸载节点
   * @param {string} path - 节点路径
   * @returns {boolean} 是否成功卸载
   */
  unmount(path) {
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
      node.umount({ tree: this });
      node.children.clear();
    };

    umountRecursively(targetNode);
    return parentNode.children.delete(name);
  }

  /**
   * 向目标节点分发信号包
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {DevicesTreeRouteContext} routeContext - 路由上下文
   * @returns {SignalPacket[]} 终止在树中的信号包
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
      ...routeContext,
      tree: this,
      depth,
    };
    const normalizedNextPackets = targetNode.process(
      normalizedPacket,
      nextRouteContext,
    );

    if (normalizedNextPackets.length === 0) {
      return [];
    }

    return normalizedNextPackets.flatMap((packet) => {
      const nextPacket = SignalPacket.from(packet);
      let requestedPath = nextPacket.to;
      if (!requestedPath && targetNode.getDefaultPath()) {
        const defaultTargetPath = DevicesTree.resolvePath(
          targetNode.path,
          targetNode.getDefaultPath(),
        );
        if (this.getNode(defaultTargetPath)) {
          requestedPath = targetNode.getDefaultPath();
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

export { DevicesTree, DevicesTreeNode };
