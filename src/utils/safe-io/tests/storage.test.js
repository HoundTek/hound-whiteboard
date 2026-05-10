import fs from "fs";
import os from "os";
import path from "path";

import { PluginManager, ResourcePackManager, SaveManager, SecureStorageManager } from "../storage/index.js";

describe("safe-io 安全存储管理", () => {
  let rootDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-storage-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test("SaveManager 可以创建、读取、更新、列出和删除存档", () => {
    const manager = new SaveManager(path.join(rootDir, "saves"));
    const created = manager.create("slotA", { coins: 1 });

    expect(created.success).toBe(true);
    expect(manager.getPath(created.saveId)).toBe(created.path);
    expect(manager.read(created.saveId)).toEqual(
      expect.objectContaining({ success: true, data: expect.objectContaining({ name: "slotA", data: { coins: 1 } }) })
    );

    expect(manager.update(created.saveId, { lives: 3 })).toEqual({ success: true });
    expect(manager.read(created.saveId).data.data).toEqual({ coins: 1, lives: 3 });
    expect(manager.list()).toEqual(expect.objectContaining({ success: true, saves: expect.any(Array) }));
    expect(manager.delete(created.saveId)).toEqual({ success: true });
  });

  test("PluginManager 可以安装、加载、列出和卸载插件", () => {
    const pluginSource = path.join(rootDir, "plugin-source");
    fs.mkdirSync(pluginSource, { recursive: true });
    fs.writeFileSync(path.join(pluginSource, "manifest.json"), JSON.stringify({ id: "plugin-a", name: "Plugin A", version: "1.0.0" }));
    fs.writeFileSync(path.join(pluginSource, "index.js"), "export default 1;", "utf8");

    const manager = new PluginManager(path.join(rootDir, "plugins"));

    expect(manager.install(pluginSource)).toEqual(expect.objectContaining({ success: true, pluginId: "plugin-a" }));
    expect(manager.load("plugin-a")).toEqual(expect.objectContaining({ success: true, plugin: expect.objectContaining({ loaded: true }) }));
    expect(manager.list()).toEqual(expect.objectContaining({ success: true, plugins: expect.arrayContaining([expect.objectContaining({ id: "plugin-a" })]) }));
    expect(manager.getResourcePath("plugin-a", "index.js")).toBe(path.join(rootDir, "plugins", "plugin-a", "index.js"));
    expect(manager.uninstall("plugin-a")).toEqual({ success: true });
  });

  test("ResourcePackManager 可以安装、应用、列出和卸载资源包", () => {
    const packsDir = path.join(rootDir, "resources");
    const manager = new ResourcePackManager(packsDir);
    const packPath = path.join(rootDir, "pack-alpha");
    fs.mkdirSync(packPath, { recursive: true });
    fs.writeFileSync(path.join(packPath, "manifest.json"), JSON.stringify({ id: "pack-alpha", name: "Pack Alpha", version: "1.0.0" }));
    fs.writeFileSync(path.join(packPath, "theme.css"), "body {}", "utf8");

    expect(manager.install(packPath)).toEqual(expect.objectContaining({ success: true, packId: "pack-alpha" }));
    expect(manager.apply("pack-alpha")).toEqual({ success: true });
    expect(manager.list()).toEqual(expect.objectContaining({ success: true, packs: expect.arrayContaining([expect.objectContaining({ id: "pack-alpha", active: true })]) }));
    expect(manager.getResourcePath("theme.css")).toBe(path.join(packsDir, "pack-alpha", "theme.css"));
    expect(manager.uninstall("pack-alpha")).toEqual({ success: true });
  });

  test("SecureStorageManager 会组织目录并生成授权 token 与统计信息", () => {
    const manager = new SecureStorageManager(rootDir);

    const saveToken = manager.authorizeSave("slotA");
    const pluginToken = manager.authorizePlugin("plugin-a");
    const resourceToken = manager.authorizeResourcePack("pack-a");

    expect(manager.getDirectory("saves")).toBe(path.join(rootDir, "HoundWhiteboard", "saves"));
    expect(saveToken).toEqual(expect.objectContaining({ type: "save", permissions: ["read", "write", "delete"] }));
    expect(pluginToken).toEqual(expect.objectContaining({ type: "plugin", permissions: ["read", "ls"] }));
    expect(resourceToken).toEqual(expect.objectContaining({ type: "resource", permissions: ["read", "ls"] }));
    expect(manager.getStats()).toEqual({
      saves: 0,
      plugins: 0,
      resourcePacks: 0,
      activeResourcePack: null,
    });
  });
});