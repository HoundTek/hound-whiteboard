import { jest } from "@jest/globals";

import { handleDebugQuery } from "../debug-helper.js";
import { BoardApi } from "../../kernel/api/board-api.js";
import { BoardCore } from "../../kernel/board/board-core.js";
import { createDefaultAomRenderHooks } from "../../kernel/board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../kernel/board/persistence-adapter.js";
import { logBus } from "../../utils/log/log-bus.js";
import { AdaptiveSampler } from "../../utils/log/adaptive-sampler.js";

function createBoardCore() {
  return new BoardCore({
    width: 800,
    height: 600,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
}

function captureDebugEntries() {
  const entries = [];
  const handler = (entry) => {
    if (entry?.logger === "DebugHelper") entries.push(entry);
  };
  logBus.on("DEBUG", handler);
  return {
    entries,
    stop: () => logBus.off("DEBUG", handler),
  };
}

describe("debug-helper", () => {
  test("objectsDetail 应按字符串 id 查到对象而不是报 not found", () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);

    api.createObject("StrokeObject", {
      id: "1",
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    });
    api.commitObjects(["1"]);

    const capture = captureDebugEntries();
    try {
      handleDebugQuery(boardCore, "objectsDetail", { objectIds: ["1"] });
    } finally {
      capture.stop();
    }

    const detailEntry = capture.entries.find((entry) =>
      entry.args?.some(
        (arg) => Array.isArray(arg) && arg.length > 0 && arg[0]?.id === "1",
      ),
    );
    expect(detailEntry).toBeDefined();

    const details = detailEntry.args.find(Array.isArray);
    expect(details[0].error).toBeUndefined();
    expect(details[0].type).toBe("StrokeObject");
  });

  test("chunkLoadState 应区分 FULL / TEMP / 写缓冲与空壳", () => {
    const boardCore = createBoardCore();
    const fullChunk = boardCore.getChunkById(1);
    fullChunk.isLoad = true;
    fullChunk.isTempLoad = false;
    boardCore.chunkLoaded.set(1, {
      chunk: fullChunk,
      tempLoadedCount: 0,
      fullLoadedCount: 1,
      loaderStrategy: new Map([["viewer", "full"]]),
    });

    const tempChunk = boardCore.getChunkById(2);
    tempChunk.isLoad = true;
    tempChunk.isTempLoad = true;
    boardCore.chunkLoaded.set(2, {
      chunk: tempChunk,
      tempLoadedCount: 1,
      fullLoadedCount: 0,
      loaderStrategy: new Map([["aom", "temp"]]),
    });

    const writeChunk = boardCore.getChunkById(3);
    writeChunk.isLoad = false;
    writeChunk.isTempLoad = false;
    writeChunk.objectManager = {
      staticGraph: { getNodes: () => ["a/1", "a/2"] },
    };
    boardCore.chunkLoaded.set(3, {
      chunk: writeChunk,
      tempLoadedCount: 0,
      fullLoadedCount: 0,
      loaderStrategy: new Map(),
    });

    const emptyChunk = boardCore.getChunkById(4);
    emptyChunk.isLoad = false;
    emptyChunk.isTempLoad = false;
    boardCore.chunkLoaded.set(4, {
      chunk: emptyChunk,
      tempLoadedCount: 0,
      fullLoadedCount: 0,
      loaderStrategy: new Map(),
    });

    const capture = captureDebugEntries();
    const sampleSpy = jest
      .spyOn(AdaptiveSampler.prototype, "sample")
      .mockReturnValue(true);
    try {
      handleDebugQuery(boardCore, "chunkLoadState");
    } finally {
      capture.stop();
      sampleSpy.mockRestore();
    }

    const chunkEntry = capture.entries.find((entry) =>
      entry.args?.some((arg) => Array.isArray(arg) && arg[0]?.kind),
    );
    expect(chunkEntry).toBeDefined();
    const rows = chunkEntry.args.find(Array.isArray);
    const byId = new Map(rows.map((row) => [row.chunkId, row]));

    expect(byId.get(1)).toMatchObject({
      kind: "FULL",
      isLoad: true,
      isTempLoad: false,
      loaderCount: 1,
    });
    expect(byId.get(2)).toMatchObject({
      kind: "TEMP",
      isLoad: true,
      isTempLoad: true,
      loaderCount: 1,
    });
    expect(byId.get(3)).toMatchObject({
      kind: "WRITE_BUFFER",
      isLoad: false,
      hasGraph: true,
      graphNodes: 2,
    });
    expect(byId.get(4)).toMatchObject({
      kind: "EMPTY",
      isLoad: false,
      hasGraph: false,
      graphNodes: 0,
    });
  });
});
