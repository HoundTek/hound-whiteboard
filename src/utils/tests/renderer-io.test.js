import { jest } from "@jest/globals";

const bridge = {
  call: jest.fn(),
};

globalThis.__houndIOBridge = bridge;

const { Directory, File } = await import("../renderer-io.js");

describe("renderer-io", () => {
  beforeEach(() => {
    bridge.call.mockReset();
  });

  test("Directory 应保留本地路径计算能力", () => {
    const root = new Directory("/tmp", "demo");
    const child = root.cd("pages");
    const file = child.peek("note", "txt");

    expect(root.getPath()).toBe("/tmp/demo");
    expect(child.getPath()).toBe("/tmp/demo/pages");
    expect(file.getPath()).toBe("/tmp/demo/pages/note.txt");
  });

  test("Directory.lsFile 应通过 bridge 调用并恢复为 File 实例", async () => {
    bridge.call.mockResolvedValueOnce([
      {
        __houndType: "File",
        dir: { __houndType: "Directory", paths: ["/", "tmp", "demo"] },
        name: "note",
        extension: "txt",
      },
    ]);

    const directory = new Directory("/tmp/demo");
    const files = await directory.lsFile();

    expect(bridge.call).toHaveBeenCalledWith({
      target: { __houndType: "Directory", paths: ["/", "tmp", "demo"] },
      method: "lsFile",
      args: [],
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].getPath()).toBe("/tmp/demo/note.txt");
  });

  test("File 写入类方法应通过 bridge 异步执行", async () => {
    bridge.call.mockResolvedValueOnce({
      __houndType: "File",
      dir: { __houndType: "Directory", paths: ["/", "tmp", "demo"] },
      name: "note",
      extension: "txt",
    });

    const file = new File("/tmp/demo", "note", "txt");
    const result = await file.write("hello");

    expect(bridge.call).toHaveBeenCalledWith({
      target: {
        __houndType: "File",
        dir: { __houndType: "Directory", paths: ["/", "tmp", "demo"] },
        name: "note",
        extension: "txt",
      },
      method: "write",
      args: ["hello"],
    });
    expect(result).toBe(file);
  });

  test("File.mv 应恢复返回的 File 实例", async () => {
    bridge.call.mockResolvedValueOnce({
      __houndType: "File",
      dir: { __houndType: "Directory", paths: ["/", "tmp", "archive"] },
      name: "note",
      extension: "txt",
    });

    const source = new File("/tmp/demo", "note", "txt");
    const moved = await source.mv(new Directory("/tmp/archive"));

    expect(moved).toBeInstanceOf(File);
    expect(moved.getPath()).toBe("/tmp/archive/note.txt");
  });
});