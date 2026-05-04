/**
 * 设备树
 * @module core/devices/devices-tree
 * @author Zhou Chenyu
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
   * @type {Function|null}
   */
  processor;

  /**
   * @constructor
   * @param {string} name
   * @param {DevicesTreeNode|null} parent
   * @param {Function|null} processor
   */
  constructor(name, parent = null, processor = null) {
    this.name = name;
    this.parent = parent;
    this.children = new Map();
    this.processor = processor;
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
   * @param {Function|null} processor - 节点处理器
   * @returns {DevicesTreeNode} 当前节点
   */
  setProcessor(processor) {
    this.processor = processor;
    return this;
  }

  /**
   * 获取节点处理器
   * @returns {Function|null} 节点处理器
   */
  getProcessor() {
    if (typeof this.processor === "function") {
      return this.processor;
    }
    return null;
  }

  /**
   * 处理当前节点收到的信号包
   * @param {{to?: string, signals?: Array<Object>}} signalPacket - 输入信号包
   * @param {Object} routeContext - 路由上下文
   * @returns {Array<{to: string, signals: Array<Object>}>} 输出信号包列表
   */
  process(signalPacket, routeContext = {}) {
    const normalizedPacket = DevicesTree.normalizeSignalPacket(signalPacket);
    const processor = this.getProcessor();
    if (!processor) {
      return [normalizedPacket];
    }

    return DevicesTree.normalizeProcessResult(
      processor(normalizedPacket, {
        ...routeContext,
        node: this,
        path: this.path,
      }),
    );
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
    if (path === "/" || path === "") return [];
    return path
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  /**
   * 规整信号包
   * @param {{to?: string, signals?: Array<Object>}} signalPacket - 输入信号包
   * @returns {{to: string, signals: Array<Object>}} 规整后的信号包
   */
  static normalizeSignalPacket(signalPacket = {}) {
    return {
      to: signalPacket.to ?? "/",
      signals: Array.isArray(signalPacket.signals) ? signalPacket.signals : [],
    };
  }

  /**
   * 规整处理结果
   * @param {{to?: string, signals?: Array<Object>}|Array<{to?: string, signals?: Array<Object>}>|null} result - 处理结果
   * @returns {Array<{to: string, signals: Array<Object>}>} 规整后的结果
   */
  static normalizeProcessResult(result) {
    if (result === undefined || result === null) return [];
    const packets = Array.isArray(result) ? result : [result];
    return packets.map((packet) => DevicesTree.normalizeSignalPacket(packet));
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
   * @param {Function|null} processor - 节点处理器
   * @returns {DevicesTreeNode} 挂载后的节点
   */
  mount(path, processor = null) {
    const node = this.ensureNode(path);
    node.setProcessor(processor);
    return node;
  }

  /**
   * 挂载一棵设备子树
   * @param {string} rootPath - 设备根路径
   * @param {{defineNodes?: Function}} deviceDefinition - 设备子树定义
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

    const normalizedRootSegments = DevicesTree.normalizePath(rootPath);
    const mountedNodes = [];
    for (const nodeDefinition of nodes) {
      const relativeSegments = DevicesTree.normalizePath(
        nodeDefinition.path ?? "",
      );
      const absolutePath = `/${normalizedRootSegments
        .concat(relativeSegments)
        .join("/")}`.replace(/\/+/g, "/");
      mountedNodes.push(
        this.mount(
          absolutePath === "" ? "/" : absolutePath,
          nodeDefinition.processor ?? null,
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
    if (!parentNode) return false;
    return parentNode.children.delete(name);
  }

  /**
   * 向目标节点分发信号包
   * @param {{to?: string, signals?: Array<Object>}} signalPacket - 输入信号包
   * @param {Object} routeContext - 路由上下文
   * @returns {Array<{to: string, signals: Array<Object>}>} 终止在树中的信号包
   */
  dispatch(signalPacket, routeContext = {}) {
    const normalizedPacket = DevicesTree.normalizeSignalPacket(signalPacket);
    const depth = routeContext.depth ?? 0;
    if (depth > this.maxDispatchDepth) {
      throw new RangeError("DevicesTree dispatch depth exceeded limit");
    }

    const targetNode = this.getNode(normalizedPacket.to || "/");
    if (!targetNode) {
      return [normalizedPacket];
    }

    const normalizedNextPackets = targetNode.process(normalizedPacket, {
      ...routeContext,
      tree: this,
      depth,
    });

    if (normalizedNextPackets.length === 0) {
      return [];
    }

    return normalizedNextPackets.flatMap((packet) => {
      const nextPacket = DevicesTree.normalizeSignalPacket(packet);
      if (!nextPacket.to || nextPacket.to === targetNode.path) {
        return [nextPacket];
      }
      return this.dispatch(nextPacket, { ...routeContext, depth: depth + 1 });
    });
  }
}

export { DevicesTree, DevicesTreeNode };
