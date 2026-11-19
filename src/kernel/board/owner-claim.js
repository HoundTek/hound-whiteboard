/**
 * @file 板目录 owner claim 格式
 * @description 定义 `.owner.json` 的字段、解析校验与 daemon 描述转换。
 * @module kernel/board/owner-claim
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

/** owner claim 文件名（写在板目录下，标记板目录的写权持有者） */
const OWNER_FILE = ".owner.json";

/** owner claim 锁文件名（写在板目录下，护住 claim/release 窗口） */
const OWNER_LOCK_FILE = ".owner.lock";

/**
 * owner transport 类型
 * @readonly
 * @enum {string}
 */
const OWNER_TRANSPORT_KINDS = Object.freeze({
  DAEMON: "daemon",
  GUI: "gui",
});

/**
 * 生成 owner id
 * @returns {string} 随机 owner id
 */
function createOwnerId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

/**
 * 创建 daemon owner claim
 * @param {Object} fields - claim 字段
 * @param {string} fields.name - daemon 名
 * @param {number} fields.pid - 进程号
 * @param {string} fields.source - 协作身份
 * @param {?string} [fields.boardId=null] - 协作房间 id
 * @param {string} [fields.host="127.0.0.1"] - 监听地址
 * @param {number} fields.port - 监听端口
 * @param {string} [fields.ownerId] - owner id（缺省时生成）
 * @param {string} [fields.claimedAt] - claim 时间（缺省时取当前时间）
 * @returns {Object} daemon owner claim
 */
function createDaemonOwnerClaim({
  name,
  pid,
  source,
  boardId = null,
  host = "127.0.0.1",
  port,
  ownerId = createOwnerId(),
  claimedAt = new Date().toISOString(),
}) {
  return {
    ownerId,
    pid,
    source,
    boardId,
    transport: {
      kind: OWNER_TRANSPORT_KINDS.DAEMON,
      name,
      host,
      port,
    },
    claimedAt,
  };
}

/**
 * 解析并校验 owner claim
 * @param {string|Object} value - JSON 文本或 claim 对象
 * @returns {Object|null} 规范化后的 claim；缺失或非法时为 null
 */
function parseOwnerClaim(value) {
  let claim = value;
  if (typeof value === "string") {
    try {
      claim = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (claim === null || typeof claim !== "object" || Array.isArray(claim)) {
    return null;
  }

  const transport = claim.transport;
  if (
    typeof claim.ownerId !== "string" ||
    claim.ownerId === "" ||
    !Number.isSafeInteger(claim.pid) ||
    claim.pid <= 0 ||
    typeof claim.source !== "string" ||
    typeof claim.claimedAt !== "string" ||
    (claim.boardId !== null &&
      claim.boardId !== undefined &&
      typeof claim.boardId !== "string") ||
    transport === null ||
    typeof transport !== "object" ||
    Array.isArray(transport) ||
    typeof transport.kind !== "string" ||
    transport.kind === ""
  ) {
    return null;
  }

  if (transport.kind === OWNER_TRANSPORT_KINDS.DAEMON) {
    if (
      typeof transport.name !== "string" ||
      transport.name === "" ||
      typeof transport.host !== "string" ||
      transport.host === "" ||
      !Number.isInteger(transport.port) ||
      transport.port <= 0 ||
      transport.port > 65535
    ) {
      return null;
    }
  }

  return {
    ownerId: claim.ownerId,
    pid: claim.pid,
    source: claim.source,
    boardId: claim.boardId ?? null,
    transport: { ...transport },
    claimedAt: claim.claimedAt,
  };
}

/**
 * 将 daemon owner claim 转为 daemon 描述
 * @param {Object|null} claim - owner claim
 * @returns {Object|null} daemon 描述；非 daemon transport 时为 null
 */
function ownerClaimToDaemonDescriptor(claim) {
  const parsed = parseOwnerClaim(claim);
  if (parsed === null || parsed.transport.kind !== OWNER_TRANSPORT_KINDS.DAEMON) {
    return null;
  }
  return {
    name: parsed.transport.name,
    host: parsed.transport.host,
    port: parsed.transport.port,
    source: parsed.source,
    boardId: parsed.boardId,
    pid: parsed.pid,
    ownerId: parsed.ownerId,
    claimedAt: parsed.claimedAt,
  };
}

export {
  OWNER_FILE,
  OWNER_LOCK_FILE,
  OWNER_TRANSPORT_KINDS,
  createOwnerId,
  createDaemonOwnerClaim,
  parseOwnerClaim,
  ownerClaimToDaemonDescriptor,
};
