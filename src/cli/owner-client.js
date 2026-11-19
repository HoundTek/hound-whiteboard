/**
 * @file GUI owner RPC 客户端
 * @description 按板目录的 GUI owner transport 连接 Rust 本地 WebSocket，提供与 daemon-client 同形的会话面。
 * @module cli/owner-client
 * @author Zhou Chenyu
 */

import { createRpcSession } from "./daemon-client.js";
import { OWNER_TRANSPORT_KINDS } from "../kernel/board/owner-claim.js";

/**
 * 连接 GUI owner RPC 端点
 * @param {Object} claim - 板目录 owner claim
 * @param {{ rootPath?: string, source?: string }} [options={}] - 会话选项
 * @returns {Promise<Object|null>} 会话面；非 GUI owner 或连接/鉴权失败时为 null
 */
async function connectOwnerByClaim(claim, { rootPath, source } = {}) {
  const transport = claim?.transport;
  if (
    transport === null ||
    typeof transport !== "object" ||
    transport.kind !== OWNER_TRANSPORT_KINDS.GUI ||
    typeof transport.host !== "string" ||
    !Number.isInteger(transport.port) ||
    typeof transport.token !== "string"
  ) {
    return null;
  }
  return createRpcSession({
    url: `ws://${transport.host}:${transport.port}`,
    token: transport.token,
    source,
    rootPath,
  });
}

export { connectOwnerByClaim };
