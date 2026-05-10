import fs from "fs";
import os from "os";
import path from "path";
import { safeIO } from "../api/safe-io.js";

describe("safe-io 对外 API", () => {
  let rootDir;

  const createAuthorizedBase = () => safeIO.BaseDir([rootDir]);

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-"));
    safeIO.reset();
  });

  afterEach(() => {
    safeIO.reset();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test("register 可以接受已存在的目录", () => {
    const result = safeIO.register(rootDir);

    expect(result.isSome()).toBe(true);
    expect(result.unwrap()).toBe(rootDir);
  });

  test("未注册授权根目录时 open 返回 null", () => {
    const base = createAuthorizedBase();

    expect(safeIO.open(base, safeIO.File("note", "txt"))).toBeNull();
  });

  test("已注册根目录下的文件可以通过 open 获得句柄", () => {
    safeIO.register(rootDir);
    fs.writeFileSync(path.join(rootDir, "note.txt"), "hello", "utf8");

    const base = createAuthorizedBase();
    const handle = safeIO.open(base, safeIO.File("note", "txt"));

    expect(handle).not.toBeNull();
    expect(handle.path).toBe(path.join(rootDir, "note.txt"));
    expect(handle.permissions.read).toBe(true);
    expect(handle.permissions.write).toBe(false);
  });

  test("reset 会清空之前注册的根目录", () => {
    safeIO.register(rootDir);
    safeIO.reset();

    const base = createAuthorizedBase();

    expect(safeIO.open(base, safeIO.Dir("subdir"))).toBeNull();
  });
});