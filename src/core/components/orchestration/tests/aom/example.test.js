import { Board } from "../../board.js";
import { CircleObject } from "../../../../objects/graph/circle.js";
import { DirectedGraph } from "../../../../utils/directed-graph.js";
import { Vector } from "../../../../utils/math.js";

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

function createExampleBoard() {
  const board = new Board();
  board.width = 1000;
  board.height = 1000;

  const chunk = board.getChunkById(1);
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
    const object = new CircleObject(positions[name], objectId, 10);
    objects[name] = object;
    board.addObject(object, 1);
    chunk.objectManager.setObjectCoverChunks(objectId, [1]);
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

  return { board, chunk, objects };
}

function expectLayer(layer, { active, activeObjects, inactiveGraphData }) {
  expect(layer.active).toBe(active);
  expect(layer.activeObjects).toEqual(new Set(activeObjects));
  expect(
    layer.inactiveGraph.equals(DirectedGraph.parse(inactiveGraphData)),
  ).toBe(true);
}

describe("ActiveObjectManager/example", () => {
  test("示例三：discard 后保留的 inactive layer 仍会影响后续 apply", () => {
    const { board, chunk, objects } = createExampleBoard();

    board.activeObjectManager.choose(
      new Set([objects.C, objects.E, objects.H]),
    );
    board.activeObjectManager.choose(new Set([objects.G]));
    board.activeObjectManager.discard(new Set([objects.G]));

    expect(board.activeObjectManager.layerOrder.length).toBe(3);
    expectLayer(board.activeObjectManager.layerOrder[2], {
      active: false,
      activeObjects: [ID.G],
      inactiveGraphData: [],
    });

    objects.C.position = new Vector(100, 100);
    objects.E.position = new Vector(300, 0);
    objects.H.position = new Vector(400, 0);

    board.activeObjectManager.apply(new Set([objects.C, objects.E, objects.H]));

    expect(board.activeObjectManager.layerOrder.length).toBe(0);
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

  test("示例四：先选 C 再选 B，discard C 后应清掉底部 inactive 前缀层", () => {
    const { board, objects } = createExampleBoard();

    board.activeObjectManager.choose(new Set([objects.C]));
    board.activeObjectManager.choose(new Set([objects.B]));

    expect(board.activeObjectManager.layerOrder.length).toBe(2);
    expectLayer(board.activeObjectManager.layerOrder[0], {
      active: true,
      activeObjects: [ID.C],
      inactiveGraphData: [],
    });
    expectLayer(board.activeObjectManager.layerOrder[1], {
      active: true,
      activeObjects: [ID.B],
      inactiveGraphData: [[ID.A, []]],
    });

    board.activeObjectManager.discard(new Set([objects.C]));

    expect(board.activeObjectManager.layerOrder.length).toBe(1);
    expectLayer(board.activeObjectManager.layerOrder[0], {
      active: true,
      activeObjects: [ID.B],
      inactiveGraphData: [[ID.A, []]],
    });

    board.activeObjectManager.discard(new Set([objects.B]));
    expect(board.activeObjectManager.layerOrder.length).toBe(0);
  });

  test("示例五：先选 C、E、H，再选 D 时应在最下方插入新的活动层", () => {
    const { board, objects } = createExampleBoard();

    board.activeObjectManager.choose(
      new Set([objects.C, objects.E, objects.H]),
    );
    board.activeObjectManager.choose(new Set([objects.D]));

    expect(board.activeObjectManager.layerOrder.length).toBe(3);
    expectLayer(board.activeObjectManager.layerOrder[0], {
      active: true,
      activeObjects: [ID.D],
      inactiveGraphData: [],
    });
    expectLayer(board.activeObjectManager.layerOrder[1], {
      active: true,
      activeObjects: [ID.E, ID.H],
      inactiveGraphData: [[ID.F, []]],
    });
    expectLayer(board.activeObjectManager.layerOrder[2], {
      active: true,
      activeObjects: [ID.C],
      inactiveGraphData: [
        [ID.B, [ID.A]],
        [ID.A, []],
      ],
    });
  });

  test("示例二：选择 C、E、H 时，F 应与 E、H 同层", () => {
    const { board, objects } = createExampleBoard();

    board.activeObjectManager.choose(
      new Set([objects.C, objects.E, objects.H]),
    );

    expect(board.activeObjectManager.layerOrder.length).toBe(2);
    expectLayer(board.activeObjectManager.layerOrder[0], {
      active: true,
      activeObjects: [ID.E, ID.H],
      inactiveGraphData: [[ID.F, []]],
    });
    expectLayer(board.activeObjectManager.layerOrder[1], {
      active: true,
      activeObjects: [ID.C],
      inactiveGraphData: [
        [ID.B, [ID.A]],
        [ID.A, []],
      ],
    });
  });
});
