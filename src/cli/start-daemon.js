#!/usr/bin/env node
/**
 * @file 板 daemon 进程入口
 * @description 用法：node start-daemon.js --name <名> --path <板目录> [--create] [--source 身份] [--relay 中继地址] [--board-id 房间] [--port 端口] [--resident-chunks 区块数]。
 * @module cli/start-daemon
 * @author Zhou Chenyu
 */

import { startBoardDaemon } from "./board-daemon.js";
import { resolveBoardPath } from "./board-path.js";
import { parseArgv } from "./args.js";
import { initI18n, t } from "./i18n.js";

initI18n();

const { flags } = parseArgv(process.argv.slice(2));
const name = flags.name;
const rootPath = flags.path;
if (typeof name !== "string" || name === "" || typeof rootPath !== "string" || rootPath === "") {
  console.error(t("out.sdUsage"));
  process.exit(1);
}

const resolvedPath = resolveBoardPath(rootPath);

const daemon = await startBoardDaemon({
  name,
  rootPath: resolvedPath,
  source: flags.source,
  relayUrl: flags.relay,
  boardId: flags["board-id"],
  port: flags.port != null ? Number(flags.port) : undefined,
  residentChunks:
    typeof flags["resident-chunks"] === "string" &&
    flags["resident-chunks"] !== ""
      ? Number(flags["resident-chunks"])
      : undefined,
});
console.log(t("out.sdStarted", { name, port: daemon.port }));
console.log(t("out.sdBoardDir", { path: resolvedPath }));
console.log(t("out.sdIdentity", { source: daemon.source }));
if (flags.relay) {
  console.log(t("out.sdRelay", { relay: flags.relay, room: flags["board-id"] ?? resolvedPath }));
} else {
  console.log(t("out.sdNoRelay"));
}

process.on("SIGINT", async () => {
  await daemon.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await daemon.close();
  process.exit(0);
});
