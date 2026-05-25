/**
 * @file 文件块封装
 * @module file-block
 * @description 将多个逻辑文件打包存储到单个 JSON 块文件中。
 * @author Zhou Chenyu
 */

import { Directory, File } from "./io.js";

const BLOCK_VERSION = 1;
const DEFAULT_MIN_BLOCK_SIZE = 8 * 1024;
const DEFAULT_MAX_BLOCK_SIZE = 16 * 1024;

/**
 * 断言值是非空字符串
 * @param {string} value - 待断言值
 * @param {string} field - 字段名称（用于错误提示）
 * @throws {Error} 如果断言失败则抛出错误
 * @returns {void}
 * @private
 */
function assertString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

/**
 * 序列化负载
 * @param {*} payload - 待序列化的负载
 * @returns {string} 序列化后的字符串
 * @private
 */
function serializePayload(payload) {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

function buildVirtualEntry(fileId, payload) {
  return {
    id: fileId,
    name: fileId,
    content: serializePayload(payload),
  };
}

/**
 * 文件块类
 * @class
 * @author Zhou Chenyu
 * @description
 * FileBlock 类用于将多个逻辑文件打包存储到单个 JSON 块文件中，提供增删改查和分割合并功能。
 * 适用于需要管理大量小文件但又想减少磁盘 I/O 的场景。
 * 每个逻辑文件由一个唯一 ID 标识，内容可以是字符串或任意 JSON-serializable 对象。
 * 块文件本身是一个 JSON 文件，包含版本信息和文件列表。
 * 注意：该类不处理并发访问，需要外部保证单线程使用或加锁。
 * @example
 * const blockFile = new File(rootDir, "block1", "json");
 * const fileBlock = new FileBlock(blockFile);
 * fileBlock.addFile("file1", { hello: "world" }).flush();
 * console.log(fileBlock.getFile("file1").content); // '{"hello":"world"}'
 */
class FileBlock {
  /**
   * @param {File} blockFile - 用于持久化该块的文件
   * @param {object} [options] - 预留选项
   * @constructor
   */
  constructor(blockFile, options = {}) {
    if (!(blockFile instanceof File)) {
      throw new Error("blockFile must be an instance of File.");
    }

    this.blockFile = blockFile;
    this.entries = new Map();
    this.loaded = false;
  }

  ensureLoaded() {
    if (this.loaded) return;
    this.load();
  }

  /**
   * 从磁盘加载块内容到内存，如果文件不存在则初始化为空块
   * @returns {FileBlock}
   */
  load() {
    if (!this.blockFile.exist()) {
      this.entries = new Map();
      this.loaded = true;
      return this;
    }

    const content = this.blockFile.cat();
    if (content.trim() === "") {
      this.entries = new Map();
      this.loaded = true;
      return this;
    }

    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid block content.");
    }
    if (parsed.version !== BLOCK_VERSION || !Array.isArray(parsed.entries)) {
      throw new Error("Unsupported block format.");
    }

    this.entries = new Map();
    parsed.entries.forEach((entry) => {
      assertString(entry.id, "entry.id");
      this.entries.set(entry.id, {
        id: entry.id,
        name: typeof entry.name === "string" ? entry.name : entry.id,
        content: typeof entry.content === "string" ? entry.content : "",
      });
    });

    this.loaded = true;
    return this;
  }

  toJSONObject() {
    return {
      version: BLOCK_VERSION,
      entries: Array.from(this.entries.values()),
    };
  }

  byteSize() {
    this.ensureLoaded();
    return Buffer.byteLength(JSON.stringify(this.toJSONObject()), "utf8");
  }

  /**
   * 预测在加入指定条目后块的字节大小
   * @param {*} entry - 待加入的条目
   * @returns {number} 预测的字节大小
   * @private
   */
  predictedByteSizeWith(entry) {
    this.ensureLoaded();
    const cloned = new Map(this.entries);
    cloned.set(entry.id, entry);
    return Buffer.byteLength(
      JSON.stringify({
        version: BLOCK_VERSION,
        entries: Array.from(cloned.values()),
      }),
      "utf8",
    );
  }

  /**
   * 将当前内存状态写回块文件
   * @returns {FileBlock}
   */
  flush() {
    this.ensureLoaded();
    this.blockFile.unPeek().existOrMake();
    this.blockFile.writeJSON(this.toJSONObject());
    return this;
  }

  /**
   * 列出块内所有文件
    * @returns {Array<{ id: string, name: string, content: string }>} 块内所有文件的列表
   */
  listFiles() {
    this.ensureLoaded();
    return Array.from(this.entries.values());
  }

  /**
   * 检查块中是否存在指定文件
   * @param {string} fileId - 文件 ID
   * @returns {boolean} 是否存在
   */
  hasFile(fileId) {
    this.ensureLoaded();
    return this.entries.has(fileId);
  }

  /**
   * 获取块中指定文件的内容
   * @param {string} fileId - 文件 ID
    * @returns {{ id: string, name: string, content: string } | null} 文件内容，如果不存在则返回 null
   */
  getFile(fileId) {
    this.ensureLoaded();
    return this.entries.get(fileId) ?? null;
  }

  /**
   * 向块中加入一个逻辑文件
   * @param {string} fileId - 文件 ID，必须唯一
   * @param {string|object} payload - 文件内容，可以是字符串或任意 JSON-serializable 对象
    * @param {{ name?: string }} options - 选项
   * @returns {FileBlock} 当前块实例
   */
  addFile(fileId, payload, options = {}) {
    this.ensureLoaded();
    assertString(fileId, "fileId");
    if (this.entries.has(fileId)) {
      throw new Error(`File '${fileId}' already exists in block.`);
    }

    const entry = {
      id: fileId,
      name: options.name ?? fileId,
      content: serializePayload(payload),
    };

    this.entries.set(fileId, entry);
    return this;
  }

  /**
   * 将外部文件内容加入块
   * @param {File} sourceFile - 外部文件
    * @param {{ fileId?: string }} options - 选项
   * @returns {FileBlock} 当前块实例
   */
  addFromSourceFile(sourceFile, options = {}) {
    if (!(sourceFile instanceof File)) {
      throw new Error("sourceFile must be an instance of File.");
    }

    const fileId = options.fileId ?? sourceFile.getPath();
    return this.addFile(fileId, sourceFile.cat(), {
      name: `${sourceFile.name}.${sourceFile.extension}`,
    });
  }

  /**
   * 从块中移除指定文件
   * @param {string} fileId - 文件 ID
   * @returns {boolean} 是否成功移除
   */
  removeFile(fileId) {
    this.ensureLoaded();
    return this.entries.delete(fileId);
  }

  updateFile(fileId, payload) {
    this.ensureLoaded();
    const existing = this.entries.get(fileId);
    if (!existing) {
      throw new Error(`File '${fileId}' does not exist in block.`);
    }

    this.entries.set(fileId, {
      ...existing,
      content: serializePayload(payload),
    });

    return this;
  }

  /**
   * 分割当前块，filter 的结果为 true 的文件将被移动到目标块中
   * @param {FileBlock} targetBlock - 目标块实例，必须是 FileBlock 类型
    * @param {function({ id: string, name: string, content: string }): boolean} filter - 分割过滤函数，接受一个文件条目对象，返回 true 则该文件将被移动到目标块中
   * @returns {{ left: FileBlock, right: FileBlock, movedIds: string[] }} 分割结果，包括左右块实例和移动的文件 ID 列表
   * @throws {Error} 当目标块类型不正确或当前块文件数不足以分割时抛出错误
   */
  split(targetBlock, filter) {
    this.ensureLoaded();
    if (!(targetBlock instanceof FileBlock)) {
      throw new Error("targetBlock must be an instance of FileBlock.");
    }

    targetBlock.ensureLoaded();
    const ids = Array.from(this.entries.keys());
    if (ids.length < 2) {
      throw new Error("Cannot split a block with less than 2 files.");
    }

    const pivot = Math.ceil(ids.length / 2);
    const movedIds = ids.slice(pivot);
    movedIds.forEach((id) => {
      if (filter(this.entries.get(id))) {
        targetBlock.entries.set(id, this.entries.get(id));
        this.entries.delete(id);
      }
    });

    return {
      left: this,
      right: targetBlock,
      movedIds,
    };
  }

  /**
   * 合并另一个块到当前块
   * @description 将 sourceBlock 中的文件合并到当前块中，如果有 ID 冲突则根据 prefer 选项决定保留哪个块的文件内容，合并后可选择清空 sourceBlock。
   * @param {FileBlock} sourceBlock - 源块实例，必须是 FileBlock 类型
   * @param {{ prefer?: "current"|"source", clearSource?: boolean }} options - 选项
   * @returns {FileBlock} 当前块实例
   */
  merge(sourceBlock, options = {}) {
    this.ensureLoaded();
    if (!(sourceBlock instanceof FileBlock)) {
      throw new Error("sourceBlock must be an instance of FileBlock.");
    }

    sourceBlock.ensureLoaded();
    const prefer = options.prefer ?? "current";

    sourceBlock.entries.forEach((entry, id) => {
      if (!this.entries.has(id)) {
        this.entries.set(id, entry);
        return;
      }

      if (prefer === "source") {
        this.entries.set(id, entry);
      }
    });

    if (options.clearSource === true) {
      sourceBlock.entries.clear();
    }

    return this;
  }
}

/**
 * 无序块分配器
 * @class
 * @description
 * UnorderedBlockAllocator 绑定一个目录，并把目录中的 block 文件视为统一存储池。
 * 它负责：
 * - 选择可写入块（避免超过 maxBlockSize）
 * - 新建块文件
 * - 维护 fileId -> blockId 的内存索引
 * - 在块超限时自动 split
 * - 提供显式 merge 与 compact 能力
 * @example
 * const allocator = new UnorderedBlockAllocator(rootDir.cd("blocks"), { maxBlockSize: 1024 }).load();
 * allocator.addFile("file1", { hello: "world" });
 * const fileEntry = allocator.getFile("file1");
 * console.log(fileEntry.content); // '{"hello":"world"}'
 * @author Zhou Chenyu
 */
class UnorderedBlockAllocator {
  /**
   * @param {Directory} blockDir - 块目录
   * @param {{
   *   minBlockSize?: number,
   *   maxBlockSize?: number,
   *   blockPrefix?: string,
   *   blockExtension?: string,
   *   autoFlush?: boolean,
   * }} options - 选项
   * @constructor
   */
  constructor(blockDir, options = {}) {
    if (!(blockDir instanceof Directory)) {
      throw new Error("blockDir must be an instance of Directory.");
    }

    this.blockDir = blockDir;
    this.minBlockSize = options.minBlockSize ?? DEFAULT_MIN_BLOCK_SIZE;
    this.maxBlockSize = options.maxBlockSize ?? DEFAULT_MAX_BLOCK_SIZE;
    this.blockPrefix = options.blockPrefix ?? "block";
    this.blockExtension = options.blockExtension ?? "json";
    this.autoFlush = options.autoFlush !== false;

    this.blocks = new Map();
    this.fileToBlock = new Map();
    this.loaded = false;
  }

  ensureLoaded() {
    if (this.loaded) return;
    this.load();
  }

  buildBlockName(blockId) {
    return `${this.blockPrefix}-${blockId}`;
  }

  parseBlockId(fileName) {
    const prefix = `${this.blockPrefix}-`;
    if (!fileName.startsWith(prefix)) return null;
    return fileName.slice(prefix.length);
  }

  nextBlockId() {
    let seq = 1;
    while (true) {
      const candidate = seq.toString().padStart(6, "0");
      if (!this.blocks.has(candidate)) return candidate;
      seq += 1;
    }
  }

  createBlock(blockId = this.nextBlockId()) {
    if (this.blocks.has(blockId)) {
      return this.blocks.get(blockId);
    }

    const blockFile = this.blockDir.peek(
      this.buildBlockName(blockId),
      this.blockExtension,
    );
    const block = new FileBlock(blockFile).load();

    this.blocks.set(blockId, block);
    return block;
  }

  /**
   * 从目录扫描并加载所有块文件，同时重建 fileId 索引。
  * @returns {UnorderedBlockAllocator}
   */
  load() {
    this.blockDir.existOrMake();
    this.blocks.clear();
    this.fileToBlock.clear();

    const blockFiles = this.blockDir
      .lsFile()
      .filter(
        (file) =>
          file.extension === this.blockExtension &&
          this.parseBlockId(file.name) !== null,
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    blockFiles.forEach((file) => {
      const blockId = this.parseBlockId(file.name);
      const block = new FileBlock(file).load();

      this.blocks.set(blockId, block);
      block.listFiles().forEach((entry) => {
        this.fileToBlock.set(entry.id, blockId);
      });
    });

    this.loaded = true;
    return this;
  }

  listBlocks() {
    this.ensureLoaded();
    return Array.from(this.blocks.entries())
      .map(([blockId, block]) => ({
        blockId,
        fileCount: block.listFiles().length,
        byteSize: block.byteSize(),
      }))
      .sort((a, b) => a.blockId.localeCompare(b.blockId));
  }

  /**
   * 估算某条目写入时的大小提示（字节）。
   * @param {string} fileId - 逻辑文件 ID
   * @param {string|object} payload - 逻辑文件内容
   * @returns {number} 估算字节数
   */
  estimateEntrySizeHint(fileId, payload) {
    const entry = buildVirtualEntry(fileId, payload);
    return Buffer.byteLength(
      JSON.stringify({
        version: BLOCK_VERSION,
        entries: [entry],
      }),
      "utf8",
    );
  }

  /**
   * 按块剩余空间排序。
   * @param {"asc"|"desc"} order - 排序方向，asc 表示从小到大（更紧凑优先）
   * @returns {Array<{ blockId: string, fileCount: number, byteSize: number, remainingSpace: number }>} 排序后的块信息
   */
  listBlocksByRemainingSpace(order = "asc") {
    this.ensureLoaded();
    const items = this.listBlocks().map((info) => ({
      ...info,
      remainingSpace: this.maxBlockSize - info.byteSize,
    }));

    items.sort((a, b) => {
      if (order === "desc") return b.remainingSpace - a.remainingSpace;
      return a.remainingSpace - b.remainingSpace;
    });
    return items;
  }

  locateFile(fileId) {
    this.ensureLoaded();
    const blockId = this.fileToBlock.get(fileId);
    if (!blockId) return null;
    return {
      blockId,
      block: this.blocks.get(blockId),
    };
  }

  /**
   * 为写入请求分配块。
   * @param {number} sizeHint - 预计写入大小（字节）
   * @returns {{
   *  blockId: string,
   *  block: FileBlock,
   *  created: boolean,
   *  oversized: boolean,
   *  remainingSpace: number,
   * }} 分配结果
   */
  allocateForWrite(sizeHint) {
    this.ensureLoaded();
    if (!Number.isFinite(sizeHint) || sizeHint < 0) {
      throw new Error("sizeHint must be a non-negative finite number.");
    }

    const oversized = sizeHint > this.maxBlockSize;
    if (!oversized) {
      const candidates = this.listBlocksByRemainingSpace("asc");
      const fit = candidates.find((item) => item.remainingSpace >= sizeHint);
      if (fit) {
        return {
          blockId: fit.blockId,
          block: this.blocks.get(fit.blockId),
          created: false,
          oversized: false,
          remainingSpace: fit.remainingSpace,
        };
      }
    }

    const blockId = this.nextBlockId();
    const block = this.createBlock(blockId);
    return {
      blockId,
      block,
      created: true,
      oversized,
      remainingSpace: this.maxBlockSize - block.byteSize(),
    };
  }

  isOversizedEntry(fileId, payload) {
    const entry = buildVirtualEntry(fileId, payload);
    const singleBlockSize = Buffer.byteLength(
      JSON.stringify({
        version: BLOCK_VERSION,
        entries: [entry],
      }),
      "utf8",
    );
    return singleBlockSize > this.maxBlockSize;
  }

  flushBlocks(...blockIds) {
    if (!this.autoFlush) return;
    blockIds
      .filter(Boolean)
      .forEach((blockId) => this.blocks.get(blockId)?.flush());
  }

  /**
   * 分配并写入新逻辑文件
   * @param {string} fileId
   * @param {string|object} payload
    * @returns {{ blockId: string, entry: { id: string, name: string, content: string } }}
   */
  addFile(fileId, payload) {
    this.ensureLoaded();
    assertString(fileId, "fileId");
    if (this.fileToBlock.has(fileId)) {
      throw new Error(`File '${fileId}' already exists in allocator.`);
    }

    const oversized = this.isOversizedEntry(fileId, payload);
    const sizeHint = this.estimateEntrySizeHint(fileId, payload);
    const allocation = this.allocateForWrite(sizeHint);
    const targetBlockId = allocation.blockId;
    const targetBlock = allocation.block;
    targetBlock.addFile(fileId, payload);
    this.fileToBlock.set(fileId, targetBlockId);

    // 贪心策略：若普通写入导致块超限，则立即分裂；超大文件保持独占块。
    let splitResult = null;
    if (!oversized && targetBlock.byteSize() > this.maxBlockSize) {
      splitResult = this.splitBlock(targetBlockId);
    }

    this.flushBlocks(targetBlockId, splitResult?.rightBlockId);

    return {
      blockId: this.fileToBlock.get(fileId),
      entry: this.getFile(fileId),
    };
  }

  getFile(fileId) {
    const located = this.locateFile(fileId);
    if (!located) return null;
    return located.block.getFile(fileId);
  }

  updateFile(fileId, payload) {
    this.ensureLoaded();
    const located = this.locateFile(fileId);
    if (!located) {
      throw new Error(`File '${fileId}' does not exist in allocator.`);
    }

    const oversized = this.isOversizedEntry(fileId, payload);
    if (oversized && located.block.listFiles().length > 1) {
      located.block.removeFile(fileId);
      const dedicatedBlockId = this.nextBlockId();
      const dedicatedBlock = this.createBlock(dedicatedBlockId);
      dedicatedBlock.addFile(fileId, payload);
      this.fileToBlock.set(fileId, dedicatedBlockId);

      if (located.block.listFiles().length === 0) {
        located.block.blockFile.rmWhenExist();
        this.blocks.delete(located.blockId);
      } else {
        this.flushBlocks(located.blockId);
      }

      this.flushBlocks(dedicatedBlockId);
      return this.getFile(fileId);
    }

    located.block.updateFile(fileId, payload);
    let splitResult = null;
    if (located.block.byteSize() > this.maxBlockSize && located.block.listFiles().length > 1) {
      splitResult = this.splitBlock(located.blockId);
    }

    this.flushBlocks(located.blockId, splitResult?.rightBlockId);
    return this.getFile(fileId);
  }

  removeFile(fileId) {
    this.ensureLoaded();
    const located = this.locateFile(fileId);
    if (!located) return false;

    const removed = located.block.removeFile(fileId);
    if (!removed) return false;

    this.fileToBlock.delete(fileId);
    if (located.block.listFiles().length === 0) {
      located.block.blockFile.rmWhenExist();
      this.blocks.delete(located.blockId);
      return true;
    }

    this.flushBlocks(located.blockId);
    return true;
  }

  /**
   * 将指定块分裂为两个块
   * @param {string} blockId
   * @returns {{ leftBlockId: string, rightBlockId: string, movedIds: string[] }}
   */
  splitBlock(blockId) {
    this.ensureLoaded();
    const sourceBlock = this.blocks.get(blockId);
    if (!sourceBlock) {
      throw new Error(`Block '${blockId}' does not exist.`);
    }

    const rightBlockId = this.nextBlockId();
    const rightBlock = this.createBlock(rightBlockId);

    const result = sourceBlock.split(rightBlock, () => true);
    result.movedIds.forEach((fileId) => {
      this.fileToBlock.set(fileId, rightBlockId);
    });

    return {
      leftBlockId: blockId,
      rightBlockId,
      movedIds: result.movedIds,
    };
  }

  /**
   * 合并两个块
   * @param {string} targetBlockId
   * @param {string} sourceBlockId
   * @param {{ prefer?: "current"|"source" }} options
  * @returns {UnorderedBlockAllocator}
   */
  mergeBlocks(targetBlockId, sourceBlockId, options = {}) {
    this.ensureLoaded();
    if (targetBlockId === sourceBlockId) return this;

    const target = this.blocks.get(targetBlockId);
    const source = this.blocks.get(sourceBlockId);
    if (!target || !source) {
      throw new Error("Target or source block does not exist.");
    }

    const sourceEntries = source.listFiles();
    target.merge(source, {
      prefer: options.prefer,
      clearSource: true,
    });

    sourceEntries.forEach((entry) => {
      this.fileToBlock.set(entry.id, targetBlockId);
    });

    source.blockFile.rmWhenExist();
    this.blocks.delete(sourceBlockId);
    this.flushBlocks(targetBlockId);

    return this;
  }

  /**
   * 尝试压缩小块
    * @description 将小于 minBlockSize 的块进行聚合，直到合并后的块达到 maxBlockSize 或没有更多小块可合并。
    * @returns {UnorderedBlockAllocator}
   */
  compact() {
    this.ensureLoaded();
    const infos = this.listBlocks();
    const small = infos.filter((info) => info.byteSize < this.minBlockSize);
    if (small.length < 2) return this;

    for (let i = 0; i < small.length - 1; i++) {
      const left = this.blocks.get(small[i].blockId);
      const right = this.blocks.get(small[i + 1].blockId);
      if (!left || !right) continue;

      const mergedSize = Buffer.byteLength(
        JSON.stringify({
          version: BLOCK_VERSION,
          entries: [...left.listFiles(), ...right.listFiles()],
        }),
        "utf8",
      );
      if (mergedSize > this.maxBlockSize) continue;

      this.mergeBlocks(small[i].blockId, small[i + 1].blockId);
    }

    return this;
  }
}

export {
  BLOCK_VERSION,
  DEFAULT_MIN_BLOCK_SIZE,
  DEFAULT_MAX_BLOCK_SIZE,
  FileBlock,
  UnorderedBlockAllocator,
};
