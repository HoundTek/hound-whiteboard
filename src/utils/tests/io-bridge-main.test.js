import fs from "fs";
import os from "os";
import path from "path";

import { handleIOBridgeRequest } from "../../io-bridge-main.js";

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
      target: {
        __houndType: "Directory",
        paths: tempRoot.split(path.sep).filter(Boolean).length === 0
          ? [path.parse(tempRoot).root]
          : [path.parse(tempRoot).root, ...tempRoot.slice(path.parse(tempRoot).root.length).split(path.sep).filter(Boolean), "docs"],
      },
      method: "make",
      args: [],
    });

    fs.writeFileSync(path.join(tempRoot, "docs", "note.txt"), "hello", "utf8");

    const files = handleIOBridgeRequest(null, {
      target: {
        __houndType: "Directory",
        paths: [path.parse(tempRoot).root, ...tempRoot.slice(path.parse(tempRoot).root.length).split(path.sep).filter(Boolean), "docs"],
      },
      method: "lsFile",
      args: [],
    });

    expect(files).toEqual([
      {
        __houndType: "File",
        dir: {
          __houndType: "Directory",
          paths: [path.parse(tempRoot).root, ...tempRoot.slice(path.parse(tempRoot).root.length).split(path.sep).filter(Boolean), "docs"],
        },
        name: "note",
        extension: "txt",
      },
    ]);
  });

  test("应能处理 File.write 和 cat", () => {
    const docsPath = path.join(tempRoot, "docs");
    fs.mkdirSync(docsPath, { recursive: true });
    const dirPaths = [path.parse(docsPath).root, ...docsPath.slice(path.parse(docsPath).root.length).split(path.sep).filter(Boolean)];

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
});