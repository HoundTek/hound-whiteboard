/**
 * @file Node IoDriver 测试
 * @author Zhou Chenyu
 */

import fs from "fs";
import os from "os";
import path from "path";

import { createNodeDriver } from "../node.js";
import { bindRoot, isIoDriver } from "../io-driver.js";

const ROOT_ID = "local";

/** @type {string} 临时根目录 */
let tmpRoot = "";

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hwb-io-node-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function setup() {
  const driver = createNodeDriver(tmpRoot);
  const d = bindRoot(driver, ROOT_ID);
  return { driver, d };
}

describe("createNodeDriver", () => {
  test("满足 IoDriver 契约", () => {
    expect(isIoDriver(createNodeDriver(tmpRoot))).toBe(true);
  });
});

describe("node fs 操作", () => {
  test("write/read 往返真实文件", async () => {
    const { d } = await setup();
    const writeOk = await d.write("a.txt", "hello");
    const fileExists = fs.existsSync(path.join(tmpRoot, "a.txt"));

    // safe() 会把 fs 错误吞成 false，失败时先区分「写入被拒」与「文件消失」
    expect({ writeOk, fileExists }).toEqual({ writeOk: true, fileExists: true });
    expect(await d.read("a.txt")).toBe("hello");
  });

  test("write 自动创建父目录", async () => {
    const { d } = await setup();
    await d.write("chunks/0.json", "{}");
    expect(fs.existsSync(path.join(tmpRoot, "chunks", "0.json"))).toBe(true);
  });

  test("read 不存在文件返回 null", async () => {
    const { d } = await setup();
    expect(await d.read("nope.txt")).toBe(null);
  });

  test("ls 列出真实目录条目", async () => {
    const { d } = await setup();
    await d.write("a/b.txt", "1");
    await d.write("a/.hidden", "2");

    const entries = await d.ls("a");
    const names = entries.map((e) => e.name);
    expect(names).toContain("b.txt");
    expect(names).toContain(".hidden");

    const b = entries.find((e) => e.name === "b.txt");
    expect(b.isFile).toBe(true);
    expect(b.isDir).toBe(false);
    expect(b.hidden).toBe(false);
  });

  test("stat 返回大小与时间戳", async () => {
    const { d } = await setup();
    await d.write("f.txt", "12345");
    const stat = await d.stat("f.txt");
    expect(stat.size).toBe(5);
    expect(stat.isFile).toBe(true);
    expect(typeof stat.modifiedAt).toBe("number");
  });

  test("rm 删除文件与目录", async () => {
    const { d } = await setup();
    await d.write("tree/a.txt", "x");
    expect(await d.rm("tree")).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, "tree"))).toBe(false);
  });

  test("cp/mv 复制与移动", async () => {
    const { d } = await setup();
    await d.write("src.txt", "data");
    expect(await d.cp("src.txt", "copy.txt")).toBe(true);
    expect(await d.read("copy.txt")).toBe("data");
    expect(await d.mv("src.txt", "moved.txt")).toBe(true);
    expect(await d.read("moved.txt")).toBe("data");
    expect(await d.exists("src.txt")).toBe(false);
  });

  test("非法相对路径与越界被拒绝", async () => {
    const { d } = await setup();
    expect(await d.read("../escape")).toBe(null);
    expect(await d.write("/abs", "x")).toBe(false);
    expect(await d.write("a\\b", "x")).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, "..", "escape"))).toBe(false);
  });

  test("符号链接指向 root 外时读取被拒绝", async () => {
    const { d } = await setup();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hwb-io-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    try {
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(tmpRoot, "link.txt"));
    } catch (e) {
      // Windows 无开发者模式 / 非特权环境无法创建符号链接时跳过
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }

    expect(await d.read("link.txt")).toBe(null);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe("node hide 操作", () => {
  test("hide/unhide 往返且路径语义一致", async () => {
    const { d } = await setup();
    await d.write("secret.txt", "data");

    const hidden = await d.hide("secret.txt");
    expect(hidden.success).toBe(true);
    expect(hidden.path).not.toBe("secret.txt");
    expect(await d.isHidden(hidden.path)).toBe(true);
    expect(await d.exists("secret.txt")).toBe(false);

    const unhidden = await d.unhide(hidden.path);
    expect(unhidden.success).toBe(true);
    expect(await d.read(unhidden.path)).toBe("data");
    expect(await d.isHidden(unhidden.path)).toBe(false);
  });

  test("hide 不存在的路径返回 null", async () => {
    const { d } = await setup();
    expect(await d.hide("nope")).toBe(null);
  });
});

describe("node zip 操作", () => {
  test("zipFrom/zipExtract/zipList 往返", async () => {
    const { d } = await setup();
    await d.mkdir("pack");
    await d.write("pack/a.txt", "alpha");
    await d.write("pack/sub/b.txt", "beta");

    expect(await d.zipFrom("pack", "pack.zip")).toBe(true);

    const entries = await d.zipList("pack.zip");
    expect(entries.some((e) => e.name.endsWith("a.txt"))).toBe(true);
    expect(entries.some((e) => e.name.endsWith("b.txt"))).toBe(true);

    expect(await d.zipExtract("pack.zip", "out")).toBe(true);
    expect(await d.read("out/a.txt")).toBe("alpha");
    expect(await d.read("out/sub/b.txt")).toBe("beta");
  });

  test("zipList 非 zip 文件返回空数组", async () => {
    const { d } = await setup();
    await d.write("plain.txt", "x");
    expect(await d.zipList("plain.txt")).toEqual([]);
  });
});

describe("node 根目录注册", () => {
  test("registerRoot 返回 local rootId", async () => {
    const { driver } = await setup();
    const { rootId } = await driver.registerRoot(tmpRoot);
    expect(rootId).toBe("local");
  });

  test("registerRoot 拒绝空路径", async () => {
    const { driver } = await setup();
    const { rootId } = await driver.registerRoot("");
    expect(rootId).toBe("");
  });
});
