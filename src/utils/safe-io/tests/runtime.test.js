import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";

import { FS } from "../runtime/fs.js";
import { Hide } from "../runtime/hide.js";
import { Zip } from "../runtime/zip.js";

describe("safe-io runtime 层", () => {
  let rootDir;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-runtime-"));
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test("FS 可以读取、写入、检查存在并删除已有文件", () => {
    const filePath = path.join(rootDir, "note.txt");
    fs.writeFileSync(filePath, "hello", "utf8");

    expect(FS.exists(filePath, rootDir)).toBe(true);
    expect(FS.read(filePath, "utf8", rootDir)).toBe("hello");
    expect(FS.write(filePath, "updated", "utf8", rootDir)).toBe(true);
    expect(FS.read(filePath, "utf8", rootDir)).toBe("updated");
    expect(FS.rm(filePath, rootDir)).toBe(true);
    expect(FS.exists(filePath, rootDir)).toBe(false);
  });

  test("FS 可以列目录、读取状态并返回真实路径", () => {
    const visibleFile = path.join(rootDir, "note.txt");
    const hiddenFile = path.join(rootDir, ".secret");
    fs.writeFileSync(visibleFile, "note", "utf8");
    fs.writeFileSync(hiddenFile, "secret", "utf8");

    const entries = FS.ls(rootDir, rootDir);
    const stat = FS.stat(visibleFile, rootDir);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "note.txt", isFile: true, hidden: false }),
        expect.objectContaining({ name: ".secret", isFile: true, hidden: true }),
      ])
    );
    expect(stat).toEqual(expect.objectContaining({ size: 4, isSymlink: false, realPath: visibleFile }));
    expect(FS.realPath(visibleFile)).toBe(fs.realpathSync(visibleFile));
  });

  test("FS 可以复制和移动已有文件", () => {
    const sourceFile = path.join(rootDir, "source.txt");
    const copiedFile = path.join(rootDir, "copy.txt");
    const movedFile = path.join(rootDir, "moved.txt");
    fs.writeFileSync(sourceFile, "copy-me", "utf8");
    fs.writeFileSync(copiedFile, "placeholder", "utf8");
    fs.writeFileSync(movedFile, "placeholder", "utf8");

    expect(FS.cp(sourceFile, copiedFile, rootDir)).toBe(true);
    expect(fs.readFileSync(copiedFile, "utf8")).toBe("copy-me");
    expect(FS.mv(sourceFile, movedFile, rootDir)).toBe(true);
    expect(fs.existsSync(sourceFile)).toBe(false);
    expect(fs.readFileSync(movedFile, "utf8")).toBe("copy-me");
  });

  test("Hide 可以识别点前缀文件", () => {
    expect(Hide.isDotPrefixed(path.join(rootDir, ".secret"))).toBe(true);
    expect(Hide.isDotPrefixed(path.join(rootDir, "visible"))).toBe(false);
  });

  test("Zip 可以创建、追加、列出并解压压缩包", () => {
    const sourceDir = path.join(rootDir, "folder");
    const nestedFile = path.join(sourceDir, "note.txt");
    const extraFile = path.join(rootDir, "extra.txt");
    const zipPath = path.join(rootDir, "archive.zip");
    const extractDir = path.join(rootDir, "unzipped");

    fs.mkdirSync(sourceDir);
    fs.writeFileSync(nestedFile, "folder-content", "utf8");
    fs.writeFileSync(extraFile, "extra-content", "utf8");

    expect(Zip.createEmpty(zipPath)).toBe(true);
    expect(Zip.addFile(zipPath, extraFile, "extra.txt")).toBe(true);
    expect(Zip.fromFolder(sourceDir, zipPath)).toBe(true);

    const entries = Zip.list(zipPath);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.stringContaining("note.txt") }),
      ])
    );

    expect(Zip.extractTo(zipPath, extractDir)).toBe(true);
    expect(fs.existsSync(path.join(extractDir, "note.txt"))).toBe(true);
  });
});