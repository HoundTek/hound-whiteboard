import fs from "fs";
import os from "os";
import path from "path";

import { DirectedGraph } from "../../utils/directed-graph.js";
import { Vector } from "../../utils/math.js";
import { handleCoreFileOperateRequest } from "../../bridges/file-operate-bridge-main.js";
import { CORE_FILE_OPERATE_ACTIONS } from "../../bridges/file-operate-bridge-common.js";
import { PageObjectManager } from "../page-object-manager.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";

describe("PageObjectManager", () => {
  let tempRoot;
  let originalBridge;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "hound-page-object-manager-"),
    );
    originalBridge = globalThis.__houndCoreFileOps;
    globalThis.__houndCoreFileOps = {
      call: async ({ action, payload }) =>
        handleCoreFileOperateRequest(null, { action, payload }),
    };
  });

  afterEach(() => {
    if (originalBridge === undefined) {
      delete globalThis.__houndCoreFileOps;
    } else {
      globalThis.__houndCoreFileOps = originalBridge;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("应随层叠图一起持久化对象覆盖页索引", async () => {
    const boardRoot = path.join(tempRoot, "board");
    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT,
      payload: {
        rootPath: boardRoot,
        boardMeta: { type: "board", version: "0.1.0" },
        config: { width: 800, height: 600 },
      },
    });

    const pageObjectManager = new PageObjectManager(1);
    pageObjectManager.staticGraph = DirectedGraph.parse([
      [15, [18]],
      [18, []],
    ]);
    pageObjectManager.setObjectCoverPages(15, [1, 2]);
    pageObjectManager.setObjectCoverPages(18, [1, 2, 3]);

    await pageObjectManager.saveTierGraph(boardRoot);

    const restoredManager = new PageObjectManager(1);
    await restoredManager.loadTierGraph(boardRoot);

    expect(
      restoredManager.staticGraph.equals(pageObjectManager.staticGraph),
    ).toBe(true);
    expect(restoredManager.serializeObjectCoverPages()).toEqual([
      [15, [1, 2]],
      [18, [1, 2, 3]],
    ]);
  });

  test("应基于对象 range 精确计算覆盖页，而不是仅按 bounding box 粗算", () => {
    const pageObjectManager = new PageObjectManager(1);
    const stroke = new StrokeObject(new Vector(0, 0), 15, 1);
    stroke.setPathPoints([
      new Vector(1, 1),
      new Vector(19, 1),
      new Vector(19, 19),
    ]);

    const coveredPages = pageObjectManager.syncObjectCoverPagesForObject(
      stroke,
      10,
      10,
    );

    expect(
      Array.from(coveredPages).sort((left, right) => left - right),
    ).toEqual([1, 2, 3]);

    expect(pageObjectManager.getObjectCoverPages(15)).toEqual(
      new Set([1, 2, 3]),
    );

    expect(pageObjectManager.getObjectCoverPages(15).has(4)).toBe(false);
  });
});
