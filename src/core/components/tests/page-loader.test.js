import { jest } from "@jest/globals";
import { PageLoader, PAGE_LOAD_MANAGER_EVENTS } from "../page-loader.js";
import { Page } from "../page.js";
import { EventBus } from "../../utils/event-bus.js";

describe("PageLoader", () => {
  function createPages() {
    const page1 = Page.fromCoordinate(0, 0);
    const page2 = Page.fromCoordinate(1, 0);
    const page3 = Page.fromCoordinate(2, 0);

    Page.connectTwoPage(page1, page2);
    Page.connectTwoPage(page2, page3);

    return { page1, page2, page3 };
  }

  test("forceMoveCurrentRightTempLoad 应该请求加载并移动当前页", () => {
    const bus = new EventBus();
    const loader = new PageLoader(3, bus);
    const { page1, page2 } = createPages();
    const loadHandler = jest.fn();

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.initPage(page1);
    const changed = loader.forceMoveCurrentRightTempLoad();

    expect(changed).toBe(true);
    expect(loader.pageNow).toBe(page2);
    expect(loader.getLoadedPages()).toEqual([page1, page2]);
    expect(loader.pagesLoaded.has(page1.id)).toBe(true);
    expect(loader.pagesLoaded.has(page2.id)).toBe(true);
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        page: page2,
        strategy: "temp",
        source: "force-move",
        alreadyBuffered: false,
      }),
    );
  });

  test("expandBufferRightFullLoad 应该在不移动当前页的情况下扩展缓冲区", () => {
    const bus = new EventBus();
    const loader = new PageLoader(3, bus);
    const { page1, page2 } = createPages();
    const loadHandler = jest.fn();

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.initPage(page1);
    const expanded = loader.expandBufferRightFullLoad();

    expect(expanded).toBe(true);
    expect(loader.pageNow).toBe(page1);
    expect(loader.getLoadedPages()).toEqual([page1, page2]);
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        page: page2,
        strategy: "full",
        source: "expand-buffer",
      }),
    );
  });

  test("缓冲区超限时应淘汰反方向页并发出卸载请求", () => {
    const bus = new EventBus();
    const loader = new PageLoader(2, bus);
    const { page1, page2, page3 } = createPages();
    const unloadHandler = jest.fn();

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.initPage(page2);
    loader.expandBufferRightTempLoad();
    loader.forceMoveCurrentLeftFullLoad();

    expect(loader.pageNow).toBe(page1);
    expect(loader.getLoadedPages()).toEqual([page1, page2]);
    expect(unloadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        page: page3,
        source: "buffer-limit",
      }),
    );
  });

  test("shrinkBufferRight 应该移除右边界，但不能移除当前页", () => {
    const bus = new EventBus();
    const loader = new PageLoader(3, bus);
    const { page1, page2, page3 } = createPages();
    const unloadHandler = jest.fn();

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.initPage(page1);
    loader.expandBufferRightTempLoad();
    loader.expandBufferRightTempLoad();

    const shrunk = loader.shrinkBufferRight();

    expect(shrunk).toBe(true);
    expect(loader.pageNow).toBe(page1);
    expect(loader.getLoadedPages()).toEqual([page1, page2]);
    expect(unloadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        page: page3,
        source: "shrink-buffer",
      }),
    );
  });

  test("shrinkBufferLeft 在当前页位于左边界时不应收缩", () => {
    const bus = new EventBus();
    const loader = new PageLoader(3, bus);
    const { page1, page2 } = createPages();
    const unloadHandler = jest.fn();

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.initPage(page1);
    loader.expandBufferRightTempLoad();

    const shrunk = loader.shrinkBufferLeft();

    expect(shrunk).toBe(false);
    expect(loader.getLoadedPages()).toEqual([page1, page2]);
    expect(unloadHandler).not.toHaveBeenCalled();
  });

  test("forceMoveCurrentUpTempLoad 应该支持二维邻页导航", () => {
    const bus = new EventBus();
    const page1 = Page.fromId(1);
    const pageUp = Page.fromId(4);
    const loadHandler = jest.fn();
    const loader = new PageLoader(3, bus, undefined, (page, direction) => {
      if (page === page1 && direction === "up") return pageUp;
      if (page === pageUp && direction === "down") return page1;
      return undefined;
    });

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.initPage(page1);
    const changed = loader.forceMoveCurrentUpTempLoad();

    expect(changed).toBe(true);
    expect(loader.pageNow).toBe(pageUp);
    expect(loader.getLoadedPages()).toEqual([pageUp, page1]);
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        page: pageUp,
        strategy: "temp",
        source: "force-move",
        alreadyBuffered: false,
      }),
    );
  });

  test("二维缓冲区向右扩展时应加载整条右边界", () => {
    const bus = new EventBus();
    const page1 = Page.fromCoordinate(0, 0);
    const pageUp = Page.fromCoordinate(0, 1);
    const pageRight = Page.fromCoordinate(1, 0);
    const pageUpRight = Page.fromCoordinate(1, 1);
    const loadHandler = jest.fn();
    const pages = new Map([
      ["0,0", page1],
      ["0,1", pageUp],
      ["1,0", pageRight],
      ["1,1", pageUpRight],
    ]);
    const loader = new PageLoader(0, bus, undefined, (page, direction) => {
      const delta = {
        right: [1, 0],
        left: [-1, 0],
        up: [0, 1],
        down: [0, -1],
      }[direction];
      if (!delta) return undefined;
      return pages.get(`${page.x + delta[0]},${page.y + delta[1]}`);
    });

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.initPage(page1);
    loader.expandBufferUpTempLoad();
    const expanded = loader.expandBufferRightTempLoad();

    expect(expanded).toBe(true);
    expect(loader.getLoadedPages()).toEqual([
      pageUp,
      pageUpRight,
      page1,
      pageRight,
    ]);
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({ page: pageRight, direction: "right" }),
    );
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({ page: pageUpRight, direction: "right" }),
    );
  });

  test("initPagesAroundCoordinate 应清空旧缓冲区并按区域重建", () => {
    const bus = new EventBus();
    const loader = new PageLoader(0, bus);

    loader.initPage(Page.fromCoordinate(5, 5));
    const pages = loader.initPagesAroundCoordinate(0, 0, 1);

    expect(loader.pageNow).toEqual(expect.objectContaining({ id: 1, x: 0, y: 0 }));
    expect(loader.pagesLoadedCount).toBe(9);
    expect(
      pages.map((page) => page.id).sort((left, right) => left - right),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
