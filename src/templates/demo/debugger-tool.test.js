import { jest } from "@jest/globals";
import { DebuggerTool } from "./debugger-tool.js";

describe("DebuggerTool", () => {
  let board;
  let tool;
  let consoleLogSpy;
  let consoleWarnSpy;

  beforeEach(() => {
    board = {
      chunkLoaded: new Map(),
      objectLoaded: new Map(),
      getChunkById: jest.fn(),
      activeObjectManager: { name: "aom" },
    };
    tool = new DebuggerTool();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  test("logs loaded chunk list", () => {
    board.chunkLoaded.set(1, { chunk: { id: 1, isLoad: true }, tempLoadedCount: 1, fullLoadedCount: 0 });
    tool.process({ signals: [{ type: "debug:chunkload" }] }, { board });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[debugger-tool] loaded chunks:",
      expect.arrayContaining([
        expect.objectContaining({ chunkId: 1, isLoad: true, tempLoadedCount: 1 }),
      ]),
    );
  });

  test("logs loaded object list", () => {
    board.objectLoaded.set(11, { obj: { id: 11 }, loadedCount: 2 });
    tool.process({ signals: [{ type: "debug:objectload" }] }, { board });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[debugger-tool] loaded objects:",
      expect.arrayContaining([
        expect.objectContaining({ objectId: 11, loadedCount: 2, object: { id: 11 } }),
      ]),
    );
  });

  test("logs chunk instance by id", () => {
    board.getChunkById.mockReturnValue({ id: 42, data: "chunk" });
    tool.process({ signals: [{ type: "debug:chunk", context: { id: 42 } }] }, { board });
    expect(consoleLogSpy).toHaveBeenCalledWith("[debugger-tool] chunk 42:", { id: 42, data: "chunk" });
  });

  test("warns when chunk id is missing", () => {
    tool.process({ signals: [{ type: "debug:chunk", context: {} }] }, { board });
    expect(consoleWarnSpy).toHaveBeenCalledWith("[debugger-tool] debug:chunk requires context.id");
  });

  test("warns when chunk is not found", () => {
    board.getChunkById.mockReturnValue(undefined);
    tool.process({ signals: [{ type: "debug:chunk", context: { id: 99 } }] }, { board });
    expect(consoleWarnSpy).toHaveBeenCalledWith("[debugger-tool] chunk 99 not found");
  });

  test("logs activeObjectManager and board instance as snapshots", () => {
    tool.process(
      {
        signals: [
          { type: "debug:aom" },
          { type: "debug:board" },
        ],
      },
      { board },
    );

    const aomSnapshot = consoleLogSpy.mock.calls[0][1];
    expect(aomSnapshot).toEqual(
      expect.objectContaining({
        manager: expect.any(Object),
        activeObjectCount: 0,
        activeObjectIds: [],
        activeObjectIndexIds: [],
        layerCount: 0,
        layers: [],
        onLayer: [],
      }),
    );
    expect(aomSnapshot.manager).toEqual(board.activeObjectManager);
    expect(aomSnapshot.manager).not.toBe(board.activeObjectManager);

    const boardSnapshot = consoleLogSpy.mock.calls[1][1];
    expect(boardSnapshot).not.toBe(board);
    expect(boardSnapshot).toHaveProperty("chunkLoaded");
  });

  test("duplicate: aom", () => {
    tool.process(
      {
        signals: [
          { type: "debug:aom" },
          { type: "debug:aom" },
        ],
      },
      { board },
    );

    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    const firstCall = consoleLogSpy.mock.calls[0];
    const secondCall = consoleLogSpy.mock.calls[1];
    expect(firstCall[0]).toBe("[debugger-tool] activeObjectManager summary:");
    expect(secondCall[0]).toBe("[debugger-tool] activeObjectManager summary:");
    expect(firstCall[1]).toEqual(secondCall[1]);
  });
});
