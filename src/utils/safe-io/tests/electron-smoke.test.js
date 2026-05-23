import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const securityManagerUrl = pathToFileURL(path.resolve(currentDir, "../security/manager.js")).href;
const handlersUrl = pathToFileURL(path.resolve(currentDir, "../ipc/handlers.js")).href;
const workspacePackageUrl = pathToFileURL(path.resolve(process.cwd(), "package.json")).href;
const require = createRequire(import.meta.url);

describe("safe-io Electron 主进程 smoke", () => {
  test("真实 Electron 主进程可以导入并初始化 security manager 与 handlers", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-electron-smoke-"));
    const scriptPath = path.join(tempDir, "main.cjs");
    const electronBinary = require("electron");

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "safe-io-electron-smoke",
        version: "1.0.0",
        main: "main.cjs",
      }),
      "utf8"
    );

    fs.writeFileSync(
      scriptPath,
      `
const fs = require("fs");
const { createRequire } = require("module");
const requireFromWorkspace = createRequire(${JSON.stringify(workspacePackageUrl)});
const { app } = requireFromWorkspace("electron");

(async () => {
  await app.whenReady();

  const { SecurityManager } = await import(${JSON.stringify(securityManagerUrl)});
  const { registerHandlers, setWindowManager } = await import(${JSON.stringify(handlersUrl)});

  const manager = new SecurityManager();
  const context = manager.createContext({ windowId: "smoke-window", preset: "READ_ONLY" });
  const preloadPath = manager.generatePreload("smoke-window", context);

  setWindowManager({
    createWindow: (config) => ({ id: config.name || "smoke" }),
    getWindow: () => ({ win: { close() {} } }),
  });
  registerHandlers();

  console.log(JSON.stringify({
    windowId: context.windowId,
    preloadExists: fs.existsSync(preloadPath),
    preloadPath,
  }));

  app.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
      `,
      "utf8"
    );

    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    const output = execFileSync(electronBinary, [tempDir], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 20000,
      env: {
        ...childEnv,
        ELECTRON_ENABLE_LOGGING: "false",
      },
    });

    const lines = output.trim().split("\n").filter(Boolean);
    const result = JSON.parse(lines.at(-1));

    expect(result.windowId).toBe("smoke-window");
    expect(result.preloadExists).toBe(true);
    expect(result.preloadPath).toContain("preload-smoke-window.js");

    fs.rmSync(tempDir, { recursive: true, force: true });
  }, 30000);
});