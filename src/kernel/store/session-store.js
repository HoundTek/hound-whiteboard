/**
 * @file 会话存储
 * @description 白板会话的存储布局语义：板元数据、对象快照、trash 留存与操作日志段文件的读写编排，仅依赖注入的 SessionDriver。
 * @module kernel/store/session-store
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

/**
 * 会话驱动
 * @description
 * 内核会话存储的最小文件操作接口（结构化契约，kernel 不依赖具体实现）。
 * io 包的 bindRoot 输出天然满足该结构；memory/node/tauri 驱动经绑定后均可注入。
 * 所有方法不抛业务错误：失败返回 null/false/[]。
 * @typedef {Object} SessionDriver
 * @property {(relPath: string) => Promise<string|null>} read - 读取文件内容（utf8）
 * @property {(relPath: string, content: string) => Promise<boolean>} write - 写入文件内容
 * @property {(relPath: string) => Promise<Array<{name: string, isDir: boolean, isFile: boolean}>>} ls - 列出目录条目
 * @property {(relPath: string) => Promise<boolean>} exists - 检查路径是否存在
 * @property {(relPath: string) => Promise<boolean>} rm - 删除文件或目录
 * @property {(srcRel: string, destRel: string) => Promise<boolean>} mv - 移动文件或目录
 * @property {(relPath: string) => Promise<boolean>} mkdir - 创建目录
 */

import { parseOperationId } from "../hit/operation.js";

/** 板文件格式版本 */
const FORMAT_VERSION = 1;

/** 板元数据文件名 */
const BOARD_META_FILE = "board.json";

/** 活动对象目录名 */
const OBJECTS_DIR = "objects";

/** trash 目录名 */
const TRASH_DIR = "trash";

/** 操作日志目录名 */
const HIT_DIR = "hit";

/** per-source 元数据目录名 */
const META_DIR = "meta";

/** 区块元数据目录名 */
const CHUNKS_DIR = "chunks";

/** 类型索引扫描的每批文件数（限制峰值内存） */
const OBJECT_INDEX_BATCH_SIZE = 64;

/** 日志段文件名前缀 */
const SEGMENT_PREFIX = "seg-";

/** 日志段文件名后缀 */
const SEGMENT_EXT = ".jsonl";

/** 日志段序号的十进制宽度 */
const SEGMENT_SEQ_WIDTH = 6;

/**
 * 对象 id 编码为文件名
 * @param {string} objectId - 对象 id
 * @returns {string} 文件名（含 .json 后缀）
 *
 * @description
 * 对象 id 含「/」（如 demo/1），需编码后方可作为文件名单段使用。
 */
function encodeObjectFileName(objectId) {
  return `${encodeURIComponent(objectId)}.json`;
}

/**
 * 文件名解码为对象 id
 * @param {string} fileName - 文件名（含 .json 后缀）
 * @returns {string|null} 对象 id，文件名不合法时为 null
 */
function decodeObjectFileName(fileName) {
  if (typeof fileName !== "string" || !fileName.endsWith(".json")) return null;
  try {
    return decodeURIComponent(fileName.slice(0, -".json".length));
  } catch {
    return null;
  }
}

/**
 * 日志段序号编码为文件名
 * @param {number} seq - 段序号（非负整数）
 * @returns {string} 段文件名
 */
function segmentFileName(seq) {
  return `${SEGMENT_PREFIX}${String(seq).padStart(SEGMENT_SEQ_WIDTH, "0")}${SEGMENT_EXT}`;
}

/**
 * 日志段文件名解析为序号
 * @param {string} fileName - 文件名
 * @returns {number|null} 段序号，文件名不合法时为 null
 */
function parseSegmentSeq(fileName) {
  if (
    typeof fileName !== "string" ||
    !fileName.startsWith(SEGMENT_PREFIX) ||
    !fileName.endsWith(SEGMENT_EXT)
  ) {
    return null;
  }
  const body = fileName.slice(
    SEGMENT_PREFIX.length,
    fileName.length - SEGMENT_EXT.length,
  );
  if (!/^\d+$/.test(body)) return null;
  return Number(body);
}

/**
 * 来源标识编码为流目录名
 * @param {string} source - 记录来源
 * @returns {string} 目录名
 *
 * @description
 * source 可能含路径不安全字符，编码后方可作为目录名单段使用。
 */
function encodeSourceDirName(source) {
  return encodeURIComponent(source);
}

/**
 * 流目录名解码为来源标识
 * @param {string} dirName - 目录名
 * @returns {string|null} 来源标识，目录名不合法时为 null
 */
function decodeSourceDirName(dirName) {
  if (typeof dirName !== "string" || dirName === "") return null;
  try {
    return decodeURIComponent(dirName);
  } catch {
    return null;
  }
}

/**
 * 安全解析 JSON 文本
 * @param {string|null} content - JSON 文本
 * @returns {*} 解析结果，失败为 null
 */
function parseJson(content) {
  if (typeof content !== "string" || content.length === 0) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 归并板级元数据与 per-source 元数据分片
 * @param {Object|null} boardMeta - board.json 内容
 * @param {Object<string, Object>} sourceMeta - 来源到分片的映射
 * @returns {Object|null} 归并后的板元数据
 *
 * @description
 * 计数表按 key 并入（分片覆盖板级同名 key），lastTime 取全源最大值。
 */
function mergeSourceMeta(boardMeta, sourceMeta) {
  if (boardMeta === null && Object.keys(sourceMeta).length === 0) return null;
  const merged = { ...(boardMeta ?? {}) };
  let lastTime = typeof merged.lastTime === "number" ? merged.lastTime : 0;
  const coreIdCounters = { ...(merged.coreIdCounters ?? {}) };
  const objectIdCounters = { ...(merged.objectIdCounters ?? {}) };
  for (const meta of Object.values(sourceMeta)) {
    if (typeof meta.lastTime === "number" && meta.lastTime > lastTime) {
      lastTime = meta.lastTime;
    }
    Object.assign(coreIdCounters, meta.coreIdCounters ?? {});
    Object.assign(objectIdCounters, meta.objectIdCounters ?? {});
  }
  if (boardMeta !== null || lastTime > 0) merged.lastTime = lastTime;
  if (Object.keys(coreIdCounters).length > 0) merged.coreIdCounters = coreIdCounters;
  if (Object.keys(objectIdCounters).length > 0) {
    merged.objectIdCounters = objectIdCounters;
  }
  return merged;
}

/**
 * 创建会话存储
 * @param {SessionDriver} driver - 注入的会话驱动（已绑定白板根目录）
 * @returns {Object} 会话存储操作面
 *
 * @description
 * 布局：board.json（板级元数据，创建时写一次后只读）、meta/{source}.json（per-source 元数据分片）、
 * objects/{id}.json（活动对象快照）、trash/{id}.json（trash 条目，含层位边）、
 * chunks/{chunkId}.json（区块层叠图与覆盖索引）、
 * hit/{source}/seg-{NNNNNN}.jsonl（per-source 操作日志流，一行一条记录，各写端只写自己的流）。
 */
function createSessionStore(driver) {
  /** @type {Set<string>} 已建好的日志流目录（本实例内避免重复 mkdir） */
  const knownSegmentDirs = new Set();

  /**
   * 读取目录下全部段文件的记录
   * @param {string} dir - 段目录相对路径
   * @returns {Promise<{records: Object[], nextSeq: number}>} 按段序拼接的记录与下一段序号
   */
  const readSegmentsIn = async (dir) => {
    const entries = await driver.ls(dir);
    const segments = entries
      .filter((entry) => entry.isFile)
      .map((entry) => ({ name: entry.name, seq: parseSegmentSeq(entry.name) }))
      .filter((seg) => seg.seq !== null)
      .sort((a, b) => a.seq - b.seq);
    const records = [];
    for (const seg of segments) {
      const content = await driver.read(`${dir}/${seg.name}`);
      if (typeof content !== "string") continue;
      for (const line of content.split("\n")) {
        const record = parseJson(line);
        if (record && typeof record === "object") records.push(record);
      }
    }
    const nextSeq =
      segments.length === 0 ? 0 : segments[segments.length - 1].seq + 1;
    return { records, nextSeq };
  };
  /**
   * 读取目录下全部对象数据
   * @param {string} dir - 目录相对路径
   * @returns {Promise<Object[]>} 对象数据数组（跳过缺失与损坏文件）
   */
  const readAllObjectsIn = async (dir) => {
    const entries = await driver.ls(dir);
    const files = entries
      .filter((entry) => entry.isFile)
      .map((entry) => entry.name)
      .filter((name) => decodeObjectFileName(name) !== null);
    const objects = await Promise.all(
      files.map(async (name) => {
        const data = parseJson(await driver.read(`${dir}/${name}`));
        return data && typeof data === "object" ? data : null;
      }),
    );
    return objects.filter((data) => data !== null);
  };

  /**
   * 读取目录下全部对象的 id 与类型
   * @param {string} dir - 目录相对路径
   * @returns {Promise<Array<{id: string, type: string|null}>>} 类型索引（跳过缺失与损坏文件）
   *
   * @description
   * 分批解析对象文件，只保留 id/type，避免一次性持有全部对象数据；
   * 供部分驻留的 owner 在不加载对象实例的情况下回答对象清单。
   */
  const readObjectTypeIndexIn = async (dir) => {
    const entries = await driver.ls(dir);
    const files = entries
      .filter((entry) => entry.isFile)
      .map((entry) => entry.name)
      .filter((name) => decodeObjectFileName(name) !== null);
    const index = [];
    for (let offset = 0; offset < files.length; offset += OBJECT_INDEX_BATCH_SIZE) {
      const batch = files.slice(offset, offset + OBJECT_INDEX_BATCH_SIZE);
      const items = await Promise.all(
        batch.map(async (name) => {
          const data = parseJson(await driver.read(`${dir}/${name}`));
          if (!data || typeof data !== "object") return null;
          if (typeof data.id !== "string" || data.id === "") return null;
          return {
            id: data.id,
            type: typeof data.type === "string" ? data.type : null,
          };
        }),
      );
      index.push(...items.filter((item) => item !== null));
    }
    return index;
  };

  /**
   * 原子写入文件（临时文件 + rename，崩溃不留撕裂内容）
   * @param {string} rel - 目标相对路径
   * @param {string} content - 文件内容
   * @returns {Promise<boolean>} 是否成功
   */
  const atomicWrite = async (rel, content) => {
    const slash = rel.lastIndexOf("/");
    const dir = slash === -1 ? "." : rel.slice(0, slash);
    const tmp = `${dir}/.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!(await driver.write(tmp, content))) return false;
    return driver.mv(tmp, rel);
  };

  return {
    /**
     * 检查白板文件是否存在
     * @returns {Promise<boolean>} board.json 是否存在
     */
    async exists() {
      return driver.exists(BOARD_META_FILE);
    },

    /**
     * 创建白板目录骨架
     * @param {Object} [meta={}] - 初始板元数据（并入骨架）
     * @returns {Promise<boolean>} 是否成功
     *
     * @description
     * 幂等：目录与元数据文件已存在时不覆盖已有元数据。
     */
    async create(meta = {}) {
      if (await driver.exists(BOARD_META_FILE)) return true;
      const dirsReady = await Promise.all([
        driver.mkdir(OBJECTS_DIR),
        driver.mkdir(TRASH_DIR),
        driver.mkdir(HIT_DIR),
        driver.mkdir(META_DIR),
        driver.mkdir(CHUNKS_DIR),
      ]);
      if (!dirsReady.every(Boolean)) return false;
      return driver.write(
        BOARD_META_FILE,
        JSON.stringify({ formatVersion: FORMAT_VERSION, ...meta }),
      );
    },

    /**
     * 读取板元数据
     * @returns {Promise<Object|null>} 板元数据，缺失或损坏时为 null
     */
    async readMeta() {
      const meta = parseJson(await driver.read(BOARD_META_FILE));
      return meta && typeof meta === "object" ? meta : null;
    },

    /**
     * 重写板元数据
     * @param {Object} meta - 板元数据
     * @returns {Promise<boolean>} 是否成功
     */
    async writeMeta(meta) {
      if (!meta || typeof meta !== "object") return false;
      return driver.write(
        BOARD_META_FILE,
        JSON.stringify({ formatVersion: FORMAT_VERSION, ...meta }),
      );
    },

    /**
     * 写入某来源的元数据分片（per-source，原子写）
     * @param {string} source - 来源标识
     * @param {Object} meta - 元数据分片（lastTime 与本端 id 计数）
     * @returns {Promise<boolean>} 是否成功
     *
     * @description
     * 各写端只写自己的分片（布局 v2：board.json 创建时写一次后只读，
     * 计数与时间水位随 source 分片，多写者零冲突）。
     */
    async writeSourceMeta(source, meta) {
      if (typeof source !== "string" || source === "") return false;
      if (!meta || typeof meta !== "object") return false;
      if (!knownSegmentDirs.has(META_DIR)) {
        await driver.mkdir(META_DIR);
        knownSegmentDirs.add(META_DIR);
      }
      return atomicWrite(
        `${META_DIR}/${encodeSourceDirName(source)}.json`,
        JSON.stringify(meta),
      );
    },

    /**
     * 读取全部来源的元数据分片
     * @returns {Promise<Object<string, Object>>} 来源到分片的映射（损坏文件跳过）
     */
    async readAllSourceMeta() {
      const entries = await driver.ls(META_DIR);
      const out = {};
      for (const entry of entries) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        const source = decodeSourceDirName(entry.name.slice(0, -".json".length));
        if (source === null) continue;
        const meta = parseJson(await driver.read(`${META_DIR}/${entry.name}`));
        if (meta && typeof meta === "object") out[source] = meta;
      }
      return out;
    },

    /**
     * 追加一段操作日志段（per-source 流）
     * @param {string} source - 记录来源（决定流目录，各写端只写自己的流）
     * @param {number} seq - 期望的流内段序号（已占用时递增到空位，自愈多写者时序差）
     * @param {Object[]} records - 操作记录数组
     * @returns {Promise<number|boolean>} 实际使用的段序号；失败为 false
     *
     * @description
     * 段内容为 JSONL：一行一条序列化记录。原子写：先写临时文件再 mv 就位，
     * 崩溃不会留下撕裂段（多写者共板时的兜底）。归并按操作 id 序号定序，
     * 段序号只承担文件唯一性与粗序，占用冲突时递增避让不改变归并结果。
     */
    async appendSegment(source, seq, records) {
      if (typeof source !== "string" || source === "") return false;
      if (!Number.isInteger(seq) || seq < 0 || !Array.isArray(records)) {
        return false;
      }
      if (records.length === 0) return seq;
      const dir = `${HIT_DIR}/${encodeSourceDirName(source)}`;
      if (!knownSegmentDirs.has(dir)) {
        await driver.mkdir(dir);
        knownSegmentDirs.add(dir);
      }
      let actual = seq;
      let rel = `${dir}/${segmentFileName(actual)}`;
      while (await driver.exists(rel)) {
        actual += 1;
        rel = `${dir}/${segmentFileName(actual)}`;
      }
      const tmp = `${dir}/.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
      if (!(await driver.write(tmp, content))) return false;
      if (!(await driver.mv(tmp, rel))) return false;
      return actual;
    },

    /**
     * 读取全部操作记录（per-source 流归并）
     * @returns {Promise<{records: Object[], nextSegmentSeqBySource: Object<string, number>}>} 归并后的记录数组与各源流的下一个可用段序号
     *
     * @description
     * 归并规则：各源流（目录名升序、流内序号升序）的全部记录按 record.source 分组、
     * 组内按操作 id 序号升序、按 id 去重（同 id 首现保留），组按 source 字典序拼接。
     * 产出确定性的 append 序，满足操作日志 per-source 序号连续与时间单调的准入校验；
     * 树重建（f(日志)）自身按 (时间, author) 定序，与 append 序无关。损坏的段内行跳过。
     * hit/ 下的散文件（非流目录）一律不读。
     */
    async readAllRecords() {
      const entries = await driver.ls(HIT_DIR);
      const streamDirs = entries
        .filter((entry) => entry.isDir)
        .map((entry) => decodeSourceDirName(entry.name))
        .filter((source) => source !== null)
        .sort();
      const streams = [];
      const nextSegmentSeqBySource = {};
      for (const source of streamDirs) {
        const { records, nextSeq } = await readSegmentsIn(
          `${HIT_DIR}/${encodeSourceDirName(source)}`,
        );
        streams.push({ source, records });
        nextSegmentSeqBySource[source] = nextSeq;
      }
      // 归并：按 source 分组、组内按操作序号升序、按 id 去重
      const seen = new Set();
      const bySource = new Map();
      const ingest = (record) => {
        if (typeof record.id === "string") {
          if (seen.has(record.id)) return;
          seen.add(record.id);
        }
        const source =
          typeof record.source === "string" ? record.source : "";
        let group = bySource.get(source);
        if (group === undefined) {
          group = [];
          bySource.set(source, group);
        }
        group.push(record);
      };
      for (const stream of streams) {
        for (const record of stream.records) ingest(record);
      }
      const records = [];
      for (const source of [...bySource.keys()].sort()) {
        const group = bySource.get(source);
        group.sort((a, b) => {
          const na = parseOperationId(a.id)?.n ?? Number.MAX_SAFE_INTEGER;
          const nb = parseOperationId(b.id)?.n ?? Number.MAX_SAFE_INTEGER;
          return na - nb;
        });
        records.push(...group);
      }
      return { records, nextSegmentSeqBySource };
    },

    /**
     * 写入活动对象快照
     * @param {Object} objectData - 对象序列化数据（必须含字符串 id）
     * @returns {Promise<boolean>} 是否成功
     */
    async writeObject(objectData) {
      if (!objectData || typeof objectData.id !== "string") return false;
      return atomicWrite(
        `${OBJECTS_DIR}/${encodeObjectFileName(objectData.id)}`,
        JSON.stringify(objectData),
      );
    },

    /**
     * 读取全部活动对象快照
     * @returns {Promise<Object[]>} 对象数据数组
     */
    async readAllObjects() {
      return readAllObjectsIn(OBJECTS_DIR);
    },

    /**
     * 读取对象类型索引（不加载对象实例）
     * @returns {Promise<Array<{id: string, type: string|null}>>} `{id, type}` 列表（跳过损坏文件）
     */
    async readObjectTypeIndex() {
      return readObjectTypeIndexIn(OBJECTS_DIR);
    },

    /**
     * 读取全部 trash 对象数据
     * @returns {Promise<Object[]>} 对象数据数组
     */
    async readAllTrash() {
      return readAllObjectsIn(TRASH_DIR);
    },

    /**
     * 写入 trash 条目
     * @param {Object} entry - trash 条目（含 data 与 chunks 层位边）
     * @returns {Promise<boolean>} 是否成功
     */
    async writeTrashEntry(entry) {
      if (!entry?.data || typeof entry.data.id !== "string") return false;
      return atomicWrite(
        `${TRASH_DIR}/${encodeObjectFileName(entry.data.id)}`,
        JSON.stringify(entry),
      );
    },

    /**
     * 移除活动对象文件（已不存在视为成功）
     * @param {string} objectId - 对象 id
     * @returns {Promise<boolean>} 是否成功
     */
    async removeObject(objectId) {
      const rel = `${OBJECTS_DIR}/${encodeObjectFileName(objectId)}`;
      if (!(await driver.exists(rel))) return true;
      return driver.rm(rel);
    },

    /**
     * 写入区块元数据
     * @param {number} chunkId - 区块 id
     * @param {{tierGraph: any[], objectCoverIndex: any[]}} metadata - 区块元数据
     * @returns {Promise<boolean>} 是否成功
     */
    async writeChunkMetadata(chunkId, metadata) {
      if (!Number.isInteger(chunkId) || !metadata) return false;
      return driver.write(
        `${CHUNKS_DIR}/${chunkId}.json`,
        JSON.stringify({
          tierGraph: Array.isArray(metadata.tierGraph) ? metadata.tierGraph : [],
          objectCoverIndex: Array.isArray(metadata.objectCoverIndex)
            ? metadata.objectCoverIndex
            : [],
        }),
      );
    },

    /**
     * 读取全部区块元数据
     * @returns {Promise<Array<{chunkId: number, tierGraph: any[], objectCoverIndex: any[]}>>} 区块元数据列表
     */
    async readAllChunkMetadata() {
      const entries = await driver.ls(CHUNKS_DIR);
      const files = entries
        .filter((entry) => entry.isFile)
        .map((entry) => entry.name)
        .filter((name) => /^\d+\.json$/.test(name));
      const list = await Promise.all(
        files.map(async (name) => {
          const data = parseJson(await driver.read(`${CHUNKS_DIR}/${name}`));
          if (!data || typeof data !== "object") return null;
          return {
            chunkId: Number(name.slice(0, -".json".length)),
            tierGraph: Array.isArray(data.tierGraph) ? data.tierGraph : [],
            objectCoverIndex: Array.isArray(data.objectCoverIndex)
              ? data.objectCoverIndex
              : [],
          };
        }),
      );
      return list.filter((item) => item !== null);
    },

    /**
     * 聚合读取全部会话数据（打开既有板）
     * @returns {Promise<Object>} 会话数据（meta、sourceMeta、records、nextSegmentSeqBySource、chunkMetadataList、objects、trash）
     *
     * @description
     * meta 归并：board.json（boardConfig / formatVersion 与存量兜底字段）+ 全部
     * meta/<source>.json 分片——计数表按 key 并入（分片覆盖板级同名字段），lastTime 取最大值。
     */
    /**
     * 聚合读取全部会话数据（打开既有板）
     * @param {{ includeObjects?: boolean }} [options={}] - 读取选项
     * @param {boolean} [options.includeObjects=true] - 是否读取对象快照；false 时只返回类型索引
     * @returns {Object} 会话数据（meta、sourceMeta、records、nextSegmentSeqBySource、chunkMetadataList、objects、objectIndex、trash）
     *
     * @description
     * meta 归并：board.json（boardConfig / formatVersion 与存量兜底字段）+ 全部
     * meta/<source>.json 分片——计数表按 key 并入（分片覆盖板级同名字段），lastTime 取最大值。
     * `includeObjects:false` 供部分驻留 owner 使用：不读对象数据，类型索引留待首次查询时
     * 经 `readObjectTypeIndex()` 构建。
     */
    async loadAll({ includeObjects = true } = {}) {
      const [
        meta,
        sourceMeta,
        { records, nextSegmentSeqBySource },
        chunkMetadataList,
        objects,
        trash,
      ] = await Promise.all([
        this.readMeta(),
        this.readAllSourceMeta(),
        this.readAllRecords(),
        this.readAllChunkMetadata(),
        includeObjects ? this.readAllObjects() : Promise.resolve([]),
        this.readAllTrash(),
      ]);
      const merged = mergeSourceMeta(meta, sourceMeta);
      return {
        meta: merged,
        sourceMeta,
        records,
        nextSegmentSeqBySource,
        chunkMetadataList,
        objects,
        objectIndex: null,
        trash,
      };
    },

    /**
     * 移除 trash 对象文件（已不存在视为成功）
     * @param {string} objectId - 对象 id
     * @returns {Promise<boolean>} 是否成功
     */
    async removeTrashObject(objectId) {
      const rel = `${TRASH_DIR}/${encodeObjectFileName(objectId)}`;
      if (!(await driver.exists(rel))) return true;
      return driver.rm(rel);
    },
  };
}

export { createSessionStore };
