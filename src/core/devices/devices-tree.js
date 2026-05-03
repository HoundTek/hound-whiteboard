/**
 * 设备树
 * @module core/devices/devices-tree
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
	 * 挂载在节点上的设备或处理器
	 * @type {*}
	 */
	device;

	/**
	 * 子节点表
	 * @type {Map<string, DevicesTreeNode>}
	 */
	children;

	constructor(name, parent = null, device = null) {
		this.name = name;
		this.parent = parent;
		this.device = device;
		this.children = new Map();
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
}

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

	constructor(options = {}) {
		this.root = new DevicesTreeNode("");
		this.maxDispatchDepth = options.maxDispatchDepth ?? 32;
	}

	/**
	 * 规整路径字符串。
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
	 * 规整信号包。
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
	 * 根据路径获取节点。
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
	 * 确保指定路径存在。
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
	 * 挂载设备节点。
	 * @param {string} path - 节点路径
	 * @param {*} device - 设备或处理器
	 * @returns {DevicesTreeNode} 挂载后的节点
	 */
	mount(path, device = null) {
		const node = this.ensureNode(path);
		node.device = device;
		return node;
	}

	/**
	 * 卸载节点。
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
	 * 获取节点上的设备处理函数。
	 * @param {DevicesTreeNode} node - 目标节点
	 * @returns {Function|null} 处理函数
	 */
	getNodeProcessor(node) {
		if (!node?.device) return null;
		if (typeof node.device.processSignalPacket === "function") {
			return node.device.processSignalPacket.bind(node.device);
		}
		if (typeof node.device.process === "function") {
			return node.device.process.bind(node.device);
		}
		if (typeof node.device === "function") {
			return node.device;
		}
		return null;
	}

	/**
	 * 向目标节点分发信号包。
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

		const processor = this.getNodeProcessor(targetNode);
		if (!processor) {
			return [normalizedPacket];
		}

		const nextPackets = processor(normalizedPacket, {
			...routeContext,
			tree: this,
			node: targetNode,
			path: targetNode.path,
			depth,
		});
		const normalizedNextPackets = Array.isArray(nextPackets)
			? nextPackets
			: nextPackets
				? [nextPackets]
				: [];

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
