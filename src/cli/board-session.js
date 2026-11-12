/**
 * @file CLI 板会话装配
 * @description 命令行组合根：node driver + 会话存储 + BoardCore + 日志跟随者 + BoardApi。
 * @module cli/board-session
 * @author Zhou Chenyu
 */

import { BoardApi } from "../kernel/api/board-api.js";
import {
  BoardCore,
  DEFAULT_CHUNK_SIZE,
} from "../kernel/board/board-core.js";
import { createJournaler } from "../kernel/store/journaler.js";
import { createSessionStore } from "../kernel/store/session-store.js";
import { bindRoot } from "../io/driver/io-driver.js";
import { createNodeDriver } from "../io/driver/node.js";

import { resolveBoardPath } from "./board-path.js";
import { t } from "./i18n.js";

/**
 * 归一化区块边长
 * @param {number} [size] - 原始边长
 * @returns {number} 可用的区块边长
 */
const normalizeChunkSize = (size) =>
  Number.isFinite(size) && size > 0 ? size : DEFAULT_CHUNK_SIZE;

/**
 * 打开（或创建并打开）一个板会话
 * @param {string} rootPath - 板目录（绝对路径 / ~ 路径 / 板名）
 * @param {Object} [options={}] - 会话选项
 * @param {boolean} [options.create=false] - 板目录不存在时创建空板
 * @param {number} [options.width] - 新建板的区块边长（重开时以盘上配置为准）
 * @param {number} [options.height] - 同上（纵向）
 * @param {string} [options.source="cli"] - 协作身份（记录的 source 与新对象 id 前缀）
 * @param {(source: string) => boolean} [options.persistStream] - 日志流落盘判定（daemon 用：不落直连客户端的流）
 * @param {boolean} [options.writeMeta=true] - 是否写本端元数据分片（读会话置 false 保持零写盘）
 * @returns {Promise<{api: BoardApi, boardCore: BoardCore, store: Object, journaler: Object, meta: Object|null, flush: Function, close: Function}>} 板会话
 *
 * @description
 * 每次调用都是完整的「加载 → 可用」循环：盘上会话恢复进 BoardCore，
 * 日志跟随者以盘上内容为指纹种子挂接；调用方在命令结束后 flush + close。
 */
async function openBoardSession(rootPath, options = {}) {
  if (typeof rootPath !== "string" || rootPath.trim() === "") {
    throw new Error(t("err.boardPathMissing"));
  }
  rootPath = resolveBoardPath(rootPath);  const driver = createNodeDriver(rootPath);
  const { rootId } = await driver.registerRoot(rootPath);
  const store = createSessionStore(bindRoot(driver, rootId));

  const exists = await store.exists();
  if (!exists && !options.create) {
    throw new Error(t("err.boardNotFound", { path: rootPath }));
  }
  if (exists && options.create) {
    throw new Error(t("err.boardExists", { path: rootPath }));
  }
  if (!exists) {
    // 布局 v2：board.json 创建时写一次（含 boardConfig），之后只读；
    // 计数与时间水位归 meta/<source>.json 分片
    const width = normalizeChunkSize(options.width);
    const height = normalizeChunkSize(options.height);
    await store.create({ boardConfig: { width, height } });
  }

  const session = await store.loadAll();
  const meta = session.meta;
  // 盘上板配置优先：板尺寸是文档数据（决定区块划分），重开必须与原值一致
  const boardCore = new BoardCore({
    width: meta?.boardConfig?.width || options.width,
    height: meta?.boardConfig?.height || options.height,
    rootPath,
    source: options.source ?? "cli",
    hitRecords: session.records.length ? session.records : undefined,
    lastTime: meta?.lastTime ?? 0,
    coreIdCounters: meta?.coreIdCounters ?? {},
    objectIdCounters: meta?.objectIdCounters ?? {},
    // CLI / daemon 常驻持板：关闭区块卸载，查询面口径保持全量
    chunkUnload: false,
  });
  if (exists) {
    boardCore.restoreSession(session);
  }

  const journaler = createJournaler({
    boardCore,
    store,
    collectMeta: () => boardCore.collectSessionMeta(),
    persistStream: options.persistStream,
    writeMeta: options.writeMeta,
  });
  journaler.attach({
    nextSegmentSeqBySource: session.nextSegmentSeqBySource ?? {},
    lastTime: meta?.lastTime ?? 0,
    knownObjects: session.objects,
    knownTrash: session.trash,
    knownSourceMeta: session.sourceMeta ?? null,
    knownChunkMetadata: session.chunkMetadataList,
  });

  const api = new BoardApi(boardCore);
  return {
    api,
    boardCore,
    store,
    journaler,
    meta,
    flush: () => journaler.flush(),
    close: () => journaler.detach(),
  };
}

export { openBoardSession };
