import { jest } from "@jest/globals";
import os from "os";
import path from "path";

import { Directory } from "../../../utils/filesys/io.js";
import { Board } from "../board.js";
import { Page } from "../page.js";

describe("Multiple PageLoader", () => {
  function getPageLoadState(board, pageId) {
    return board.pageLoaded.get(pageId);
  }

  function createBoardHarness() {
    const board = new Board();
    const page1 = Page.fromId(6);
    const page2 = Page.fromId(1);
    const page3 = Page.fromId(2);

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
      page.downgradeToTemp = jest.fn(function downgradeToTemp() {
        this.isLoad = true;
        this.isTempLoad = true;
        return true;
      });
    }

    board.rootPath = path.join(os.tmpdir(), "houndwhiteboard-board-test");
    for (const page of [page1, page2, page3]) {
      board.pageLoaded.set(page.id, {
        page,
        tempLoadedCount: 0,
        fullLoadedCount: 0,
        loaderStrategy: new Map(),
      });
    }
    const pageLoader = board.createPageLoader();

    return { board, pageLoader, page1, page2, page3 };
  }

  test("PageLoader 的临时加载请求应由 Board 执行", () => {
    const { board, pageLoader, page1, page2 } = createBoardHarness();

    pageLoader.initPage(page1);
    pageLoader.expandBufferRightTempLoad();

    expect(page2.loadTemp).toHaveBeenCalledTimes(1);
    expect(getPageLoadState(board, 1).tempLoadedCount).toBe(1);
    expect(pageLoader.getLoadedPages()).toEqual([page1, page2]);
  });

  test("完整加载升级应把页从临时加载计数迁移到完整加载计数", () => {
    const { board, pageLoader, page1, page2 } = createBoardHarness();

    pageLoader.initPage(page1);
    pageLoader.expandBufferRightTempLoad();
    pageLoader.forceMoveCurrentRightFullLoad();

    expect(page2.loadTemp).toHaveBeenCalledTimes(1);
    expect(page2.loadFull).toHaveBeenCalledTimes(1);
    expect(getPageLoadState(board, 1).tempLoadedCount).toBe(0);
    expect(getPageLoadState(board, 1).fullLoadedCount).toBe(1);
    expect(pageLoader.pageNow).toBe(page2);
  });

  test("缓冲区淘汰时应调用对应页的卸载方法", () => {
    const { board, pageLoader, page1, page2, page3 } = createBoardHarness();

    pageLoader.pagesLoadedLimit = 2;
    pageLoader.initPage(page2);
    page2.isLoad = true;
    page2.isTempLoad = false;
    getPageLoadState(board, 1).fullLoadedCount = 1;

    pageLoader.expandBufferRightTempLoad();
    pageLoader.forceMoveCurrentLeftFullLoad();

    expect(page3.unloadTemp).toHaveBeenCalledTimes(1);
    expect(pageLoader.getLoadedPages()).toEqual([page1, page2]);
    expect(getPageLoadState(board, 2).tempLoadedCount).toBe(0);
  });

  test("多个 PageLoader 共用一页时，单个卸载请求不应真正卸载该页", () => {
    const { board, pageLoader, page1, page2 } = createBoardHarness();
    const pageLoader2 = board.createPageLoader(2, "plm-2");

    pageLoader.initPage(page1);
    pageLoader2.initPage(page1);

    pageLoader.expandBufferRightTempLoad();
    pageLoader2.expandBufferRightTempLoad();

    expect(getPageLoadState(board, 1).tempLoadedCount).toBe(2);

    const firstShrink = pageLoader.shrinkBufferRight();

    expect(firstShrink).toBe(true);
    expect(getPageLoadState(board, 1).tempLoadedCount).toBe(1);
    expect(page2.unloadTemp).not.toHaveBeenCalled();
    expect(page2.isLoad).toBe(true);

    const secondShrink = pageLoader2.shrinkBufferRight();

    expect(secondShrink).toBe(true);
    expect(page2.unloadTemp).toHaveBeenCalledTimes(1);
    expect(getPageLoadState(board, 1).tempLoadedCount).toBe(0);
    expect(page2.isLoad).toBe(false);
  });

  test("完整加载持有者释放后，若仍有临时持有者，应降级为临时加载", () => {
    const { board, pageLoader, page1, page2 } = createBoardHarness();
    const pageLoader2 = board.createPageLoader(2, "plm-2");

    pageLoader.initPage(page1);
    pageLoader2.initPage(page1);

    pageLoader.expandBufferRightFullLoad();
    pageLoader2.expandBufferRightTempLoad();

    expect(getPageLoadState(board, 1).fullLoadedCount).toBe(1);
    expect(getPageLoadState(board, 1).tempLoadedCount).toBe(1);
    expect(page2.isTempLoad).toBe(false);

    const shrunk = pageLoader.shrinkBufferRight();

    expect(shrunk).toBe(true);
    expect(page2.downgradeToTemp).toHaveBeenCalledTimes(1);
    expect(page2.unload).not.toHaveBeenCalled();
    expect(page2.unloadTemp).not.toHaveBeenCalled();
    expect(getPageLoadState(board, 1).fullLoadedCount).toBe(0);
    expect(getPageLoadState(board, 1).tempLoadedCount).toBe(1);
    expect(page2.isLoad).toBe(true);
    expect(page2.isTempLoad).toBe(true);
  });
});
