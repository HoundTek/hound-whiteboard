const {
  PageLoadManager,
  PAGE_LOAD_MANAGER_EVENTS,
} = require("../page-load-manager");
const { PageManager } = require("../page-manager");
const { EventBus } = require("../../utils/event-bus");

describe("PageLoadManager", () => {
  function createPages() {
    const page1 = new PageManager(1);
    const page2 = new PageManager(2);
    const page3 = new PageManager(3);

    PageManager.connectTwoPage(page1, page2);
    PageManager.connectTwoPage(page2, page3);

    return { page1, page2, page3 };
  }

  test("forceMoveCurrentRightTempLoad 应该请求加载并移动当前页", () => {
    const bus = new EventBus();
    const loader = new PageLoadManager(3, bus);
    const { page1, page2 } = createPages();
    const loadHandler = jest.fn();

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.resetCurrentPage(page1);
    const changed = loader.forceMoveCurrentRightTempLoad();

    expect(changed).toBe(true);
    expect(loader.pageNow).toBe(page2);
    expect(loader.getLoadedPages()).toEqual([page1, page2]);
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
    const loader = new PageLoadManager(3, bus);
    const { page1, page2 } = createPages();
    const loadHandler = jest.fn();

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.resetCurrentPage(page1);
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
    const loader = new PageLoadManager(2, bus);
    const { page1, page2, page3 } = createPages();
    const unloadHandler = jest.fn();

    bus.on(PAGE_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.resetCurrentPage(page2);
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
});