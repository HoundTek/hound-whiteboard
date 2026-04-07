import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";

jest.unstable_mockModule("crypto", () => ({
  randomInt: jest.fn(),
}));

const { Directory, File, FilenameRandomPool } = await import("../io.js");
const { randomInt } = await import("crypto");

describe("io", () => {
  let rootPath;
  let rootDir;

  beforeEach(() => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "hound-io-"));
    rootDir = Directory.parse(rootPath);
    randomInt.mockReset();
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

  test("FilenameRandomPool 应识别现有目录并生成新目录", () => {
    rootDir.cd("7").make();
    rootDir.cd("9").make();
    rootDir.cd("misc").make();
    randomInt.mockReturnValueOnce(8);

    const pool = new FilenameRandomPool(rootDir, "Directory");
    const generatedDir = pool.generate();

    expect(pool.include("7")).toBe(true);
    expect(pool.include("9")).toBe(true);
    expect(generatedDir.name).toBe("8");
    expect(generatedDir.exist()).toBe(true);
  });

  test("FilenameRandomPool 应识别现有文件并支持重命名与删除", () => {
    rootDir.peek("12", "txt").write("occupied");
    rootDir.peek("note", "txt").write("ignored");
    randomInt.mockReturnValueOnce(13);

    const pool = new FilenameRandomPool(rootDir, "txt");
    const renamedFile = pool.rename("12");

    expect(pool.include("12")).toBe(false);
    expect(pool.include("13")).toBe(true);
    expect(renamedFile.name).toBe("13");
    expect(rootDir.peek("12", "txt").exist()).toBe(false);
    expect(rootDir.peek("13", "txt").cat()).toBe("occupied");

    expect(pool.remove("13")).toBe(true);
    expect(rootDir.peek("13", "txt").exist()).toBe(false);
  });
});