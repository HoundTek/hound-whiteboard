import fs from "fs";
import os from "os";
import path from "path";

const { Directory, File, FilenameRandomPool } = await import("../io.js");

/**
 * 让下一次 getRandomValues 返回指定的 uint32 值
 */
function mockNextRandomInt(value) {
  globalThis.crypto = {
    ...globalThis.crypto,
    getRandomValues: (buf) => {
      buf[0] = value;
      return buf;
    },
  };
}

function restoreCrypto() {
  // Node.js 内置 globalThis.crypto，重新赋回即可
  globalThis.crypto = globalThis.crypto;
}

describe("io", () => {
  let rootPath;
  let rootDir;

  beforeEach(() => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "hound-io-"));
    rootDir = Directory.parse(rootPath);
  });

  afterEach(() => {
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  test("Directory 和 File 应能完成基础读写与列举", () => {
    const docsDir = rootDir.cd("docs").make();
    const noteFile = docsDir.peek("note", "txt").write("hello world");

    expect(Array.isArray(docsDir.paths)).toBe(true);
    expect(docsDir.paths.at(-1)).toBe("docs");
    expect(docsDir.exist()).toBe(true);
    expect(docsDir.existFile("note", "txt")).toBe(true);
    expect(noteFile.cat()).toBe("hello world");
    expect(noteFile.dir.getPath()).toBe(docsDir.getPath());
    expect(docsDir.ls()).toEqual(["note.txt"]);
    expect(docsDir.lsDir()).toEqual([]);
    expect(docsDir.lsFile()).toEqual([new File(docsDir, "note", "txt")]);
  });

  test("File 应能写入 JSON、复制、移动和删除", () => {
    const jsonFile = rootDir.peek("data", "json").writeJSON({ ok: true });
    const copyDir = rootDir.cd("copy").make();
    const copiedFile = jsonFile.cp(copyDir);
    const movedFile = copiedFile.mv(rootDir.peek("renamed", "json"));

    expect(jsonFile.catJSON()).toEqual({ ok: true });
    expect(copiedFile.exist()).toBe(false);
    expect(movedFile.catJSON()).toEqual({ ok: true });

    movedFile.rm();
    expect(movedFile.exist()).toBe(false);
  });

  test("Directory 应能复制、移动和删除", () => {
    const sourceDir = rootDir.cd("source").make();
    sourceDir.peek("item", "txt").write("payload");
    const copiedDir = sourceDir.cp(rootDir.cd("copied"));
    const movedDir = copiedDir.mv(rootDir.cd("moved"));

    expect(copiedDir.exist()).toBe(false);
    expect(movedDir.peek("item", "txt").cat()).toBe("payload");

    movedDir.rm();
    expect(movedDir.exist()).toBe(false);
  });

  test("compress 和 extract 应能保留目录内容", () => {
    const assetsDir = rootDir.cd("assets").make();
    assetsDir.peek("hello", "txt").write("zip me");
    const archive = rootDir.peek("assets", "zip");
    const extractedDir = rootDir.cd("extracted").make();

    assetsDir.compress(archive);
    archive.extract(extractedDir);

    expect(archive.exist()).toBe(true);
    expect(extractedDir.peek("hello", "txt").cat()).toBe("zip me");
  });
});