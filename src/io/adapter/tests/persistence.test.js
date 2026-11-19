/**
 * @file 持久化适配器测试
 * @author Zhou Chenyu
 */

import { createMemoryDriver } from "../../driver/memory.js";
import { createPersistenceAdapter } from "../persistence.js";

const ROOT_ID = "root-1";

function setup() {
  const driver = createMemoryDriver({ rootId: ROOT_ID });
  const adapter = createPersistenceAdapter({ driver, rootId: ROOT_ID });
  return { driver, adapter };
}

describe("createPersistenceAdapter", () => {
  test("save/load 区块元数据往返", async () => {
    const { adapter } = setup();
    const metadata = {
      tierGraph: [{ id: 1, kind: "tier" }],
      objectCoverIndex: [{ id: 2 }],
      objectTypes: [["dev-x/core/1", "StrokeObject"]],
    };

    expect(await adapter.saveChunkMetadata(0, metadata)).toBe(true);

    const loaded = await adapter.loadChunkMetadata(0);
    expect(loaded.tierGraph).toEqual(metadata.tierGraph);
    expect(loaded.objectCoverIndex).toEqual(metadata.objectCoverIndex);
    expect(loaded.objectTypes).toEqual(metadata.objectTypes);
  });

  test("缺失的区块元数据返回空结构", async () => {
    const { adapter } = setup();
    const loaded = await adapter.loadChunkMetadata(99);
    expect(loaded).toEqual({ tierGraph: [], objectCoverIndex: [], objectTypes: [] });
  });

  test("非法 chunkId 被拒绝", async () => {
    const { adapter } = setup();
    expect(await adapter.loadChunkMetadata(1.5)).toEqual({
      tierGraph: [],
      objectCoverIndex: [],
      objectTypes: [],
    });
    expect(await adapter.saveChunkMetadata("0", { tierGraph: [] })).toBe(false);
  });

  test("损坏的元数据文件返回空结构", async () => {
    const { driver, adapter } = setup();
    await driver.write(ROOT_ID, "chunks/0.json", "{broken");
    const loaded = await adapter.loadChunkMetadata(0);
    expect(loaded).toEqual({ tierGraph: [], objectCoverIndex: [], objectTypes: [] });
  });

  test("save/load 对象批量往返", async () => {
    const { adapter } = setup();
    const objects = [
      { id: "dev-x/core/1", type: "StrokeObject", points: [1, 2, 3] },
      { id: "dev-x/core/2", type: "Container", children: [] },
    ];

    expect(await adapter.saveObjects(objects)).toBe(true);

    const loaded = await adapter.loadObjects(["dev-x/core/1", "dev-x/core/2"]);
    expect(loaded).toHaveLength(2);
    expect(loaded.find((o) => o.id === "dev-x/core/1").points).toEqual([1, 2, 3]);
  });

  test("loadObjects 跳过缺失对象", async () => {
    const { adapter } = setup();
    await adapter.saveObjects([{ id: "dev-x/core/1", type: "X" }]);
    const loaded = await adapter.loadObjects(["dev-x/core/1", "dev-x/core/2", "dev-x/core/3"]);
    expect(loaded.map((o) => o.id)).toEqual(["dev-x/core/1"]);
  });

  test("对象文件命名与 session-store 一致（encodeURIComponent）", async () => {
    const { driver, adapter } = setup();
    await adapter.saveChunkMetadata(7, { tierGraph: ["t"], objectCoverIndex: [] });
    await adapter.saveObjects([{ id: "dev-x/core/42", type: "Y" }]);

    const chunkRaw = await driver.read(ROOT_ID, "chunks/7.json");
    expect(JSON.parse(chunkRaw).tierGraph).toEqual(["t"]);

    const objectRaw = await driver.read(ROOT_ID, "objects/dev-x%2Fcore%2F42.json");
    expect(JSON.parse(objectRaw).type).toBe("Y");
  });

  test("deleteObject 删除对象文件", async () => {
    const { adapter } = setup();
    await adapter.saveObjects([{ id: "dev-x/core/5", type: "Z" }]);
    expect(await adapter.deleteObject("dev-x/core/5")).toBe(true);
    expect(await adapter.loadObjects(["dev-x/core/5"])).toEqual([]);
  });

  test("损坏的对象 JSON 被跳过", async () => {
    const { driver, adapter } = setup();
    await driver.write(ROOT_ID, "objects/dev-x%2Fcore%2F9.json", "{oops");
    expect(await adapter.loadObjects(["dev-x/core/9"])).toEqual([]);
  });

  test("非法对象 id 显式抛错（不再静默空转）", async () => {
    const { adapter } = setup();
    await expect(adapter.loadObjects([42])).rejects.toThrow(TypeError);
    await expect(adapter.saveObjects([{ id: 42, type: "Y" }])).rejects.toThrow(TypeError);
    await expect(adapter.deleteObject(null)).rejects.toThrow(TypeError);
  });

  test("非数组参数返回安全值", async () => {
    const { adapter } = setup();
    expect(await adapter.loadObjects(null)).toEqual([]);
    expect(await adapter.saveObjects("nope")).toBe(false);
  });
});
