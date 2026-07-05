import fs from "fs";
import os from "os";
import path from "path";

import { handleCoreFileOperateRequest } from "../file-operate-bridge-main.js";
import { CORE_FILE_OPERATE_ACTIONS } from "../file-operate-bridge-common.js";

describe("file-operate-bridge-main", () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "hound-core-file-bridge-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("应能创建白板根目录结构", () => {
    const boardRoot = path.join(tempRoot, "board");
    const boardMeta = { type: "board", version: "0.1.0" };

    const result = handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT,
      payload: {
        rootPath: boardRoot,
        boardMeta,
        config: { width: 1920, height: 1080 },
      },
    });

    expect(result).toBe(true);
    expect(fs.existsSync(path.join(boardRoot, "meta.json"))).toBe(true);
    expect(fs.existsSync(path.join(boardRoot, "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(boardRoot, "chunks"))).toBe(true);
    expect(fs.existsSync(path.join(boardRoot, "objects"))).toBe(true);
  });

  test("应能创建区块存储并写入连接与 trace", () => {
    const boardRoot = path.join(tempRoot, "board");

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT,
      payload: {
        rootPath: boardRoot,
        boardMeta: { type: "board", version: "0.1.0" },
        config: { width: 1000, height: 800 },
      },
    });

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_CHUNK_STORAGE,
      payload: {
        rootPath: boardRoot,
        chunkId: 1,
      },
    });

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.WRITE_CHUNK_CONNECTION,
      payload: {
        rootPath: boardRoot,
        connection: { count: 1, order: [1], size: 1 },
      },
    });

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.WRITE_TRACE,
      payload: {
        rootPath: boardRoot,
        trace: { onChunk: 1, offset: 0 },
      },
    });

    expect(fs.existsSync(path.join(boardRoot, "chunks", "1"))).toBe(true);
    expect(fs.existsSync(path.join(boardRoot, "objects"))).toBe(true);
    expect(
      fs.existsSync(path.join(boardRoot, "chunks", "connection.json")),
    ).toBe(true);
    expect(fs.existsSync(path.join(boardRoot, "trace.json"))).toBe(true);
  });

  test("应能加载白板快照并在缺失 trace 时给默认值", () => {
    const boardRoot = path.join(tempRoot, "board");

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT,
      payload: {
        rootPath: boardRoot,
        boardMeta: { type: "board", version: "0.1.0" },
        config: { width: 800, height: 600 },
      },
    });

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.WRITE_CHUNK_CONNECTION,
      payload: {
        rootPath: boardRoot,
        connection: { count: 2, order: [2, 3], size: 2 },
      },
    });

    const snapshot = handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.LOAD_BOARD_SNAPSHOT,
      payload: {
        rootPath: boardRoot,
        expectedBoardMeta: { type: "board", version: "0.1.0" },
      },
    });

    expect(snapshot.config).toEqual({ width: 800, height: 600 });
    expect(snapshot.connection).toEqual({ count: 2, order: [2, 3], size: 2 });
    expect(snapshot.trace).toEqual({ onChunk: 2, offset: 0 });
  });

  test("应能保存并读取区块元数据（层叠图 + 覆盖索引合并）", () => {
    const boardRoot = path.join(tempRoot, "board");

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT,
      payload: {
        rootPath: boardRoot,
        boardMeta: { type: "board", version: "0.1.0" },
        config: { width: 800, height: 600 },
      },
    });

    const metadata = {
      tierGraph: [[1, [2, 3]]],
      objectCoverIndex: [[15, [1, 2]]],
    };
    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.SAVE_CHUNK_METADATA,
      payload: {
        rootPath: boardRoot,
        chunkId: 1,
        tierGraph: metadata.tierGraph,
        objectCoverIndex: metadata.objectCoverIndex,
      },
    });

    const loaded = handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.LOAD_CHUNK_METADATA,
      payload: {
        rootPath: boardRoot,
        chunkId: 1,
      },
    });

    expect(loaded).toEqual(metadata);
  });

  test("应能按 ID 批量读取扁平对象 JSON", () => {
    const boardRoot = path.join(tempRoot, "board");

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT,
      payload: {
        rootPath: boardRoot,
        boardMeta: { type: "board", version: "0.1.0" },
        config: { width: 800, height: 600 },
      },
    });

    fs.mkdirSync(path.join(boardRoot, "objects"), { recursive: true });
    fs.writeFileSync(
      path.join(boardRoot, "objects", "100.json"),
      JSON.stringify({ id: 100, type: "basic" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(boardRoot, "objects", "101.json"),
      JSON.stringify({ id: 101, type: "basic" }),
      "utf8",
    );

    const objects = handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.LOAD_OBJECTS,
      payload: {
        rootPath: boardRoot,
        objectIds: [100, 101],
      },
    });

    expect(objects).toEqual([
      { id: 100, type: "basic" },
      { id: 101, type: "basic" },
    ]);
  });

  test("应能批量保存对象到扁平存储", () => {
    const boardRoot = path.join(tempRoot, "board");

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT,
      payload: {
        rootPath: boardRoot,
        boardMeta: { type: "board", version: "0.1.0" },
        config: { width: 800, height: 600 },
      },
    });

    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.SAVE_OBJECTS,
      payload: {
        rootPath: boardRoot,
        objects: [
          { id: 200, type: "basic" },
          { id: 201, type: "basic" },
        ],
      },
    });

    const objectFiles = fs
      .readdirSync(path.join(boardRoot, "objects"))
      .sort();
    expect(objectFiles).toEqual(["200.json", "201.json"]);

    const objects = handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.LOAD_OBJECTS,
      payload: {
        rootPath: boardRoot,
        objectIds: [200, 201],
      },
    });
    expect(objects).toEqual([
      { id: 200, type: "basic" },
      { id: 201, type: "basic" },
    ]);
  });
});
