import { Board } from "../board.js";
import { Page } from "../page.js";

describe("Board page grid", () => {
  test("Page 的回字形 id 与二维坐标应可双向转换", () => {
    const samples = [
      [1, 0, 0],
      [2, 1, 0],
      [3, 1, 1],
      [5, -1, 1],
      [9, 1, -1],
      [10, 2, -1],
      [13, 2, 2],
      [17, -2, 2],
    ];

    for (const [id, x, y] of samples) {
      expect(Page.idToCoordinate(id)).toEqual({ x, y });
      expect(Page.coordinateToId(x, y)).toBe(id);
    }
  });

  test("Page 应能判断 id 与坐标是否匹配", () => {
    const validPage = Page.fromId(3);
    const invalidPage = Page.fromId(3);
    invalidPage.id = -1; // 强制设置非法 id

    expect(Page.isValidPageIdentity(3, 1, 1)).toBe(true);
    expect(Page.isValidPageIdentity(3, 2, 0)).toBe(false);
    expect(validPage.isValid()).toBe(true);
    expect(invalidPage.isValid()).toBe(false);
  });

  test("Board 应按需实例化当前页与其周围页", () => {
    const board = new Board();
    board.pageOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    board.pageIds = new Set(board.pageOrder);

    const currentPage = board.getPageById(1);
    const neighborhood = board.getPagesAroundCoordinate(
      currentPage.x,
      currentPage.y,
    );

    expect(currentPage).toEqual(expect.objectContaining({ id: 1, x: 0, y: 0 }));
    expect(
      neighborhood.map((page) => page.id).sort((left, right) => left - right),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(board.pageMap.size).toBe(9);
  });

  test("Board 的左右邻页应基于二维坐标解析", () => {
    const board = new Board();
    board.pageOrder = [1, 2, 4, 6, 8];
    board.pageIds = new Set(board.pageOrder);

    const center = board.getPageById(1);

    expect(board.getNeighborPage(center, "right")).toEqual(
      expect.objectContaining({ id: 2, x: 1, y: 0 }),
    );
    expect(board.getNeighborPage(center, "left")).toEqual(
      expect.objectContaining({ id: 6, x: -1, y: 0 }),
    );
    expect(board.getNeighborPage(center, "up")).toEqual(
      expect.objectContaining({ id: 4, x: 0, y: 1 }),
    );
    expect(board.getNeighborPage(center, "down")).toEqual(
      expect.objectContaining({ id: 8, x: 0, y: -1 }),
    );
  });
});
