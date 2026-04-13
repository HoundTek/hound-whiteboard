import fs from "fs";
import os from "os";
import path from "path";

import {
  handleIOBridgeBatchRequest,
  handleIOBridgeRequest,
} from "../../io-bridge-main.js";

function toDirectoryPayload(dirPath) {
  const parsed = path.parse(dirPath);
  return {
    __houndType: "Directory",
    paths: [
      parsed.root,
      ...dirPath.slice(parsed.root.length).split(path.sep).filter(Boolean),
    ],
  };
}

describe("io-bridge-main", () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hound-io-bridge-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("应能处理 Directory.make 和 lsFile", () => {
    handleIOBridgeRequest(null, {
      target: toDirectoryPayload(path.join(tempRoot, "docs")),
      method: "make",
      args: [],
    });

    fs.writeFileSync(path.join(tempRoot, "docs", "note.txt"), "hello", "utf8");

    const files = handleIOBridgeRequest(null, {
      target: toDirectoryPayload(path.join(tempRoot, "docs")),
      method: "lsFile",
      args: [],
    });

    expect(files).toEqual([
      {
        __houndType: "File",
        dir: {
          __houndType: "Directory",
          paths: toDirectoryPayload(path.join(tempRoot, "docs")).paths,
        },
        name: "note",
        extension: "txt",
      },
    ]);
  });

  test("应能处理 File.write 和 cat", () => {
    const docsPath = path.join(tempRoot, "docs");
    fs.mkdirSync(docsPath, { recursive: true });
    const dirPaths = toDirectoryPayload(docsPath).paths;

    handleIOBridgeRequest(null, {
      target: {
        __houndType: "File",
        dir: {
          __houndType: "Directory",
          paths: dirPaths,
        },
        name: "note",
        extension: "txt",
      },
      method: "write",
      args: ["hello bridge"],
    });

    const content = handleIOBridgeRequest(null, {
      target: {
        __houndType: "File",
        dir: {
          __houndType: "Directory",
          paths: dirPaths,
        },
        name: "note",
        extension: "txt",
      },
      method: "cat",
      args: [],
    });

    expect(content).toBe("hello bridge");
  });

  test("应能顺序处理批量请求并返回最终目标状态", () => {
    const docsPath = path.join(tempRoot, "docs");
    fs.mkdirSync(docsPath, { recursive: true });
    const filePayload = {
      __houndType: "File",
      dir: toDirectoryPayload(docsPath),
      name: "note",
      extension: "txt",
    };

    const result = handleIOBridgeBatchRequest(null, {
      target: filePayload,
      operations: [
        { method: "write", args: ["hello batch"] },
        { method: "cat", args: [] },
      ],
    });

    expect(result).toEqual({
      results: [filePayload, "hello batch"],
      target: filePayload,
    });
  });
});