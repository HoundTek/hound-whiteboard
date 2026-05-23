import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-security-"));

await jest.unstable_mockModule("electron", () => ({
  default: {
    app: {
      getPath: jest.fn(() => userDataDir),
    },
  },
  app: {
    getPath: jest.fn(() => userDataDir),
  },
}));

const { PERMISSION_PRESETS, SecurityManager } = await import("../security/manager.js");

describe("safe-io 安全管理器", () => {
  let manager;

  beforeEach(() => {
    manager = new SecurityManager();
  });

  afterEach(() => {
    const summaries = manager.getContextsSummary();
    for (const summary of summaries) {
      manager.destroyContext(summary.windowId);
    }
  });

  afterAll(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test("createContext 会创建带预设权限和 token 的上下文", () => {
    const context = manager.createContext({
      windowId: "main-window",
      preset: "READ_WRITE",
      bindFile: "/tmp/project.save",
    });

    expect(context.windowId).toBe("main-window");
    expect(context.preset).toBe("READ_WRITE");
    expect(context.permissions).toEqual(PERMISSION_PRESETS.READ_WRITE);
    expect(context.bindFile).toBe("/tmp/project.save");
    expect(context.token.root).toBe("/tmp/project.save");
    expect(manager.getContext("main-window")).toBe(context);
  });

  test("generatePreload 会生成 preload 文件并缓存路径", () => {
    const context = manager.createContext({ windowId: "preview", preset: "READ_ONLY" });

    const preloadPath = manager.generatePreload("preview", context);
    const content = fs.readFileSync(preloadPath, "utf8");

    expect(fs.existsSync(preloadPath)).toBe(true);
    expect(content).toContain('contextBridge.exposeInMainWorld("safeIO", api);');
    expect(content).toContain("window:create");
    expect(manager.generatePreload("preview", context)).toBe(preloadPath);
  });

  test("updatePermissions 会更新上下文摘要，destroyContext 会清理 preload", () => {
    const context = manager.createContext({ windowId: "editor", preset: "READ_ONLY" });
    const preloadPath = manager.generatePreload("editor", context);

    expect(manager.updatePermissions("editor", "FULL")).toBe(true);
    expect(manager.getContext("editor").preset).toBe("FULL");
    expect(manager.getContextsSummary()).toEqual([
      expect.objectContaining({ windowId: "editor", preset: "FULL" }),
    ]);

    manager.destroyContext("editor");

    expect(manager.getContext("editor")).toBeNull();
    expect(fs.existsSync(preloadPath)).toBe(false);
  });

  test("updatePermissions 会刷新 preload 内容中的允许通道", () => {
    const context = manager.createContext({ windowId: "permissions-window", preset: "READ_ONLY" });
    const preloadPath = manager.generatePreload("permissions-window", context);
    const beforeContent = fs.readFileSync(preloadPath, "utf8");

    expect(beforeContent).not.toContain("fs:delete");
    expect(beforeContent).not.toContain("fs:write");

    expect(manager.updatePermissions("permissions-window", "FULL")).toBe(true);

    const afterContent = fs.readFileSync(preloadPath, "utf8");

    expect(afterContent).toContain("fs:delete");
    expect(afterContent).toContain("fs:write");
  });

  test("多个窗口会生成隔离的 preload，并且单窗口更新不会污染其他窗口", () => {
    const leftContext = manager.createContext({ windowId: "left-window", preset: "READ_ONLY" });
    const rightContext = manager.createContext({ windowId: "right-window", preset: "FULL" });

    const leftPath = manager.generatePreload("left-window", leftContext);
    const rightPath = manager.generatePreload("right-window", rightContext);
    const rightBefore = fs.readFileSync(rightPath, "utf8");

    expect(leftPath).not.toBe(rightPath);
    expect(fs.readFileSync(leftPath, "utf8")).not.toContain("fs:delete");
    expect(rightBefore).toContain("fs:delete");

    expect(manager.updatePermissions("left-window", "READ_WRITE")).toBe(true);

    const leftAfter = fs.readFileSync(leftPath, "utf8");
    const rightAfter = fs.readFileSync(rightPath, "utf8");

    expect(leftAfter).toContain("fs:write");
    expect(leftAfter).not.toContain("fs:delete");
    expect(rightAfter).toBe(rightBefore);
    expect(manager.getContext("right-window").preset).toBe("FULL");
  });
});