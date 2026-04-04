const os = require("os");

const { Directory } = require("../../../utils/io");
const { BoardManager } = require("../board-manager");
const { PageManager } = require("../page-manager");

describe("BoardManager 页加载", () => {
  function createBoard() {
    const board = new BoardManager();
    const page1 = new PageManager(1);
    const page2 = new PageManager(2);
    const page3 = new PageManager(3);

    PageManager.connectTwoPage(page1, page2);
    PageManager.connectTwoPage(page2, page3);

    for (const page of [page1, page2, page3]) {
      page.loadFull = jest.fn(function loadFull() {
        this.isLoad = true;
        this.isTempLoad = false;
        return true;
      });
      page.loadTemp = jest.fn(function loadTemp() {
        this.isLoad = true;
        this.isTempLoad = true;
        return true;
      });
      page.unload = jest.fn(function unload() {
        this.isLoad = false;
        this.isTempLoad = false;
        return true;
      });
      page.unloadTemp = jest.fn(function unloadTemp() {
        this.isLoad = false;
        this.isTempLoad = false;
        return true;
      });
    }

    board.root = new Directory(os.tmpdir(), "houndwhiteboard-board-manager-test");
    board.directory = board.root;
    board.pageMap = new Map([
      [1, page1],
      [2, page2],
      [3, page3],
    ]);
    board.pageOrder = [1, 2, 3];

    return { board, page1, page2, page3 };
  }

  test("PageLoadManager 的临时加载请求应由 BoardManager 执行", () => {
    const { board, page1, page2 } = createBoard();

    board.pageLoadManager.resetCurrentPage(page1);
    board.pageLoadManager.expandBufferRightTempLoad();

    expect(page2.loadTemp).toHaveBeenCalledTimes(1);
    expect(board.pageTemporaryLoadedCount.get(2)).toBe(1);
    expect(board.loadedPages.toArray()).toEqual([page1, page2]);
  });

  test("完整加载升级应把页从临时加载计数迁移到完整加载计数", () => {
    const { board, page1, page2 } = createBoard();

    board.pageLoadManager.resetCurrentPage(page1);
    board.pageLoadManager.expandBufferRightTempLoad();
    board.pageLoadManager.forceMoveCurrentRightFullLoad();

    expect(page2.loadTemp).toHaveBeenCalledTimes(1);
    expect(page2.loadFull).toHaveBeenCalledTimes(1);
    expect(board.pageTemporaryLoadedCount.has(2)).toBe(false);
    expect(board.pageFullyLoadedCount.get(2)).toBe(1);
    expect(board.pageLoadManager.pageNow).toBe(page2);
  });

  test("缓冲区淘汰时应调用对应页的卸载方法", () => {
    const { board, page1, page2, page3 } = createBoard();

    board.pageLoadManager.pagesLoadedLimit = 2;
    board.pageLoadManager.resetCurrentPage(page2);
    page2.isLoad = true;
    page2.isTempLoad = false;
    board.pageFullyLoadedCount.set(2, 1);

    board.pageLoadManager.expandBufferRightTempLoad();
    board.pageLoadManager.forceMoveCurrentLeftFullLoad();

    expect(page3.unloadTemp).toHaveBeenCalledTimes(1);
    expect(board.loadedPages.toArray()).toEqual([page1, page2]);
    expect(board.pageTemporaryLoadedCount.has(3)).toBe(false);
  });
});