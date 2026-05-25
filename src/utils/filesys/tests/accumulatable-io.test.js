import { jest } from "@jest/globals";

const bridge = {
  callBatch: jest.fn(),
};

globalThis.__houndIOBridge = bridge;

const { Directory, File } = await import("../accumulatable-io.js");

describe("accumulatable-io", () => {
  beforeEach(() => {
    bridge.callBatch.mockReset();
  });

  test("应保留本地路径计算能力", () => {
    const root = new Directory("/tmp", "demo");
    const child = root.cd("chunks");
    const file = child.peek("note", "txt");

    expect(root.getPath()).toBe("/tmp/demo");
    expect(child.getPath()).toBe("/tmp/demo/chunks");
    expect(file.getPath()).toBe("/tmp/demo/chunks/note.txt");
  });

  test("flushAll 应批量发送并释放全部积压操作", async () => {
    bridge.callBatch.mockResolvedValueOnce({
      results: [
        {
          __houndType: "File",
          dir: { __houndType: "Directory", paths: ["/", "tmp", "demo"] },
          name: "note",
          extension: "txt",
        },
        true,
      ],
      target: {
        __houndType: "File",
        dir: { __houndType: "Directory", paths: ["/", "tmp", "demo"] },
        name: "note",
        extension: "txt",
      },
    });

    const file = new File("/tmp/demo", "note", "txt");
    const results = await file.write("hello").exist().flushAll();

    expect(bridge.callBatch).toHaveBeenCalledWith({
      target: {
        __houndType: "File",
        dir: { __houndType: "Directory", paths: ["/", "tmp", "demo"] },
        name: "note",
        extension: "txt",
      },
      operations: [
        { method: "write", args: ["hello"] },
        { method: "exist", args: [] },
      ],
    });
    expect(results[0]).toBeInstanceOf(File);
    expect(results[1]).toBe(true);
    expect(file.pendingOperations).toEqual([]);
  });

  test("flush(count) 应只释放前 count 个积压操作", async () => {
    bridge.callBatch.mockResolvedValueOnce({
      results: [
        {
          __houndType: "Directory",
          paths: ["/", "tmp", ".demo"],
        },
        true,
      ],
      target: {
        __houndType: "Directory",
        paths: ["/", "tmp", ".demo"],
      },
    });
    bridge.callBatch.mockResolvedValueOnce({
      results: [[]],
      target: {
        __houndType: "Directory",
        paths: ["/", "tmp", ".demo"],
      },
    });

    const directory = new Directory("/tmp/demo");
    directory.hide().exist().lsFile();

    const firstResults = await directory.flush(2);

    expect(firstResults[0]).toBeInstanceOf(Directory);
    expect(firstResults[1]).toBe(true);
    expect(directory.getPath()).toBe("/tmp/.demo");
    expect(directory.pendingOperations).toEqual([{ method: "lsFile", args: [] }]);

    const secondResults = await directory.flushAll();
    expect(secondResults).toEqual([[]]);
    expect(directory.pendingOperations).toEqual([]);
  });
});