import { CircleObject } from "../../../objects/graph/circle.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Vector } from "../../../utils/math.js";
import { createBoardCoreAomFixture } from "../../../../test-support/aom-fixtures.js";

const ID = Object.freeze({
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
});

/**
 * 创建示例图对应的 BoardCore 测试夹具
 * @returns {{
 *   boardCore: import("../../board-core.js").BoardCore,
 *   chunk: import("../../../chunk/chunk.js").Chunk,
 *   objects: Record<string, CircleObject>,
 * }}
 */
function createExampleBoard() {
  const { boardCore, ensureLoadedChunk, seedBoardObject } =
    createBoardCoreAomFixture({
      width: 1000,
      height: 1000,
      chunkIds: [1],
    });
  const chunk = ensureLoadedChunk(1);

  const positions = {
    A: new Vector(0, 0),
    B: new Vector(0, 0),
    C: new Vector(0, 0),
    D: new Vector(0, 0),
    E: new Vector(20, 0),
    F: new Vector(20, 0),
    G: new Vector(100, 100),
    H: new Vector(0, 0),
  };

  const objects = {};
  for (const [name, objectId] of Object.entries(ID)) {
    const object = new CircleObject(
      objectId,
      positions[name],
      {},
      { radius: 10 },
    );
    objects[name] = object;
    seedBoardObject(object, { coveredChunkIds: [1] });
  }

  chunk.objectManager.staticGraph = DirectedGraph.parse([
    [ID.A, []],
    [ID.B, [ID.A]],
    [ID.C, [ID.B]],
    [ID.D, [ID.C, ID.E]],
    [ID.E, [ID.A, ID.F]],
    [ID.F, []],
    [ID.G, []],
    [ID.H, [ID.C]],
  ]);

  return { boardCore, chunk, objects };
}

/**
 * 断言 layer 的活动态与静态图结构
 * @param {import("../../active-object-manager.js").Layer} layer - 待断言的层
 * @param {{
 *   active: boolean,
 *   activeObjects: number[],
 *   inactiveGraphData: Array<[number, number[]]>,
 * }} options - 期望值
 */
function expectLayer(layer, { active, activeObjects, inactiveGraphData }) {
  expect(layer.active).toBe(active);
  expect(layer.activeObjects).toEqual(new Set(activeObjects));
  expect(
    layer.inactiveGraph.equals(DirectedGraph.parse(inactiveGraphData)),
  ).toBe(true);
}

describe("ActiveObjectManager/example", () => {
  test("示例三：discard 后保留的 inactive layer 仍会影响后续 apply", async () => {
    const { boardCore, chunk, objects } = createExampleBoard();
    const aom = boardCore.activeObjectManager;

    await aom.choose(new Set([objects.C, objects.E, objects.H]));
    await aom.choose(new Set([objects.G]));
    aom.discard(new Set([objects.G]));

    expect(aom.layerOrder.length).toBe(3);
    expectLayer(aom.layerOrder[2], {
      active: false,
      activeObjects: [ID.G],
      inactiveGraphData: [],
    });

    objects.C.position = new Vector(100, 100);
    objects.E.position = new Vector(300, 0);
    objects.H.position = new Vector(400, 0);

    aom.apply(new Set([objects.C, objects.E, objects.H]));

    expect(aom.layerOrder.length).toBe(0);
    expect(
      chunk.objectManager.staticGraph.equals(
        DirectedGraph.parse([
          [ID.A, []],
          [ID.B, [ID.A]],
          [ID.C, [ID.G]],
          [ID.D, []],
          [ID.E, []],
          [ID.F, []],
          [ID.G, []],
          [ID.H, []],
        ]),
      ),
    ).toBe(true);
  });

  test("示例四：先选 C 再选 B，discard C 后应清掉底部 inactive 前缀层", async () => {
    const { boardCore, objects } = createExampleBoard();
    const aom = boardCore.activeObjectManager;

    await aom.choose(new Set([objects.C]));
    await aom.choose(new Set([objects.B]));

    expect(aom.layerOrder.length).toBe(2);
    expectLayer(aom.layerOrder[0], {
      active: true,
      activeObjects: [ID.C],
      inactiveGraphData: [],
    });
    expectLayer(aom.layerOrder[1], {
      active: true,
      activeObjects: [ID.B],
      inactiveGraphData: [[ID.A, []]],
    });

    aom.discard(new Set([objects.C]));

    expect(aom.layerOrder.length).toBe(1);
    expectLayer(aom.layerOrder[0], {
      active: true,
      activeObjects: [ID.B],
      inactiveGraphData: [[ID.A, []]],
    });

    aom.discard(new Set([objects.B]));
    expect(aom.layerOrder.length).toBe(0);
  });

  test("示例五：先选 C、E、H，再选 D 时应在最下方插入新的活动层", async () => {
    const { boardCore, objects } = createExampleBoard();
    const aom = boardCore.activeObjectManager;

    await aom.choose(new Set([objects.C, objects.E, objects.H]));
    await aom.choose(new Set([objects.D]));

    expect(aom.layerOrder.length).toBe(3);
    expectLayer(aom.layerOrder[0], {
      active: true,
      activeObjects: [ID.D],
      inactiveGraphData: [],
    });
    expectLayer(aom.layerOrder[1], {
      active: true,
      activeObjects: [ID.E, ID.H],
      inactiveGraphData: [[ID.F, []]],
    });
    expectLayer(aom.layerOrder[2], {
      active: true,
      activeObjects: [ID.C],
      inactiveGraphData: [
        [ID.B, [ID.A]],
        [ID.A, []],
      ],
    });
  });

  test("示例二：选择 C、E、H 时，F 应与 E、H 同层", async () => {
    const { boardCore, objects } = createExampleBoard();
    const aom = boardCore.activeObjectManager;

    await aom.choose(new Set([objects.C, objects.E, objects.H]));

    expect(aom.layerOrder.length).toBe(2);
    expectLayer(aom.layerOrder[0], {
      active: true,
      activeObjects: [ID.E, ID.H],
      inactiveGraphData: [[ID.F, []]],
    });
    expectLayer(aom.layerOrder[1], {
      active: true,
      activeObjects: [ID.C],
      inactiveGraphData: [
        [ID.B, [ID.A]],
        [ID.A, []],
      ],
    });
  });
});
