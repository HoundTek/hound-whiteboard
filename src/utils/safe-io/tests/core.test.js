import path from "path";
import { BaseDir, Dir, File, cd, createBaseDir, father, isValidName, resolvePath } from "../core/safe-io-core.js";

describe("safe-io 核心路径 DSL", () => {
  test("可以校验路径片段名称", () => {
    expect(isValidName("assets")).toBe(true);
    expect(isValidName("..")).toBe(false);
    expect(isValidName("bad/name")).toBe(false);
    expect(isValidName("trailing.")).toBe(false);
  });

  test("可以创建并导航 BaseDir", () => {
    const base = createBaseDir(["workspace", "safe-io"]);
    const child = cd(base, "fixtures");

    expect(child.segments).toEqual(["workspace", "safe-io", "fixtures"]);
    expect(father(child).segments).toEqual(base.segments);
    expect(father(createBaseDir([]))).toBeNull();
  });

  test("可以把目录和文件条目解析成拼接路径", () => {
    const base = BaseDir(["tmp", "safe-io"]);

    expect(resolvePath(base, Dir("logs"))).toBe(path.join("tmp", "safe-io", "logs"));
    expect(resolvePath(base, File("audit", "txt"))).toBe(path.join("tmp", "safe-io", "audit.txt"));
  });
});