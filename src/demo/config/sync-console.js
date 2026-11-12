/**
 * @file 同步控制台辅助
 * @description 在 window.hwb 挂载控制台快速命令：同步配置、撤销/重做、同步摘要与调试查询（Mac 调出控制台为 Command+Option+I）。
 * @module demo/config/sync-console
 * @author Zhou Chenyu
 */

import { dagToMermaid } from "../../ui/devices-dag/index.js";
import { broadcastHitChanged } from "./hit-changed-broadcast.js";

/** 中继地址存储键 */
const RELAY_KEY = "hwb-relay";
/** 身份覆盖存储键 */
const SOURCE_KEY = "hwb-source";
/** 板目录覆盖存储键 */
const BOARD_KEY = "hwb-board";

/**
 * 安装同步控制台辅助
 * @param {Object} [options={}] - 安装选项
 * @param {() => Object} [options.getBoard] - 惰性取 Board 实例（调试命令经它触达 BoardApi 与 UI 侧状态）
 * @returns {void}
 *
 * @description
 * 同步配置命令：setRelay / setSource / setBoard（设置后自动刷新）、status（只读打印）、off（清除配置回离线）。
 * 操作命令：undo / redo。
 * 调试命令：digest / tree / repair / reconnect 与调试工具全套查询
 * （chunkLoad / chunks / objectLoad / objects / aom / hit / board / viewport / devices）。
 * help 打印全部命令用法。重复安装不覆盖已有 hwb。
 */
function installSyncConsole({ getBoard } = {}) {
  if (globalThis.hwb !== undefined) return;

  /**
   * 取 Board 实例（未注入或尚未就绪时为 null）
   * @returns {Object|null} Board 实例
   */
  const boardOf = () => (typeof getBoard === "function" ? (getBoard() ?? null) : null);

  /**
   * 取 BoardApi（board 未就绪时为 null）
   * @returns {Object|null} BoardApi 或 RPC 代理
   */
  const apiOf = () => boardOf()?.getBoardApi?.() ?? null;

  /**
   * 经 BoardApi 调用并打印结果，异常兜底
   * @param {string} label - 命令展示名
   * @param {(api: Object) => Promise<*>} action - 调用动作
   * @returns {void}
   */
  const invoke = (label, action) => {
    const api = apiOf();
    if (!api) {
      console.warn(`hwb.${label}：board 未就绪`);
      return;
    }
    Promise.resolve()
      .then(() => action(api))
      .then((result) => console.log(`hwb.${label}`, result ?? "完成"))
      .catch((error) => console.error(`hwb.${label} 失败：`, error));
  };

  /**
   * 向 Worker 发送调试请求（fire-and-forget，输出在 Worker 控制台）
   * @param {string} query - 调试查询名
   * @param {Record<string, any>} [extra={}] - 附加参数
   * @returns {void}
   */
  const debug = (query, extra = {}) => {
    const api = apiOf();
    if (!api?.requestDebug) {
      console.warn("hwb：board 未就绪，调试请求未发送");
      return;
    }
    api.requestDebug(query, extra);
    console.log(`hwb：已发送调试查询 ${query}（输出见控制台）`);
  };

  /**
   * 归一化 id 列表参数（单值转数组，未传为 undefined）
   * @param {*} value - 入参
   * @returns {Array|undefined} id 列表
   */
  const idsOf = (value) => {
    if (value === undefined || value === null) return undefined;
    return Array.isArray(value) ? value : [value];
  };

  /**
   * 本地 undo/redo 后广播 hit 变更（与 dom-adapters 键盘路径同语义：让工具清理失效选中）
   * @param {Object} board - Board 实例
   * @param {string[]} forcedEndMolIds - 被强制闭合的分子 id 列表
   * @returns {void}
   */
  const notifyHitChanged = (board, forcedEndMolIds = []) => {
    if (!board?.signalsEventBus) return;
    broadcastHitChanged(board, board.viewports?.keys?.().next().value, {
      forcedEndMolIds,
    });
  };

  globalThis.hwb = {
    /**
     * 设置同步中继地址并刷新
     * @param {string} url - 形如 ws://192.168.1.5:8377 的地址
     * @returns {void}
     */
    setRelay(url) {
      if (typeof url !== "string" || url === "") {
        console.warn("hwb.setRelay(url)：url 形如 ws://192.168.1.5:8377");
        return;
      }
      globalThis.localStorage?.setItem(RELAY_KEY, url);
      console.log(`已设置中继：${url}，刷新中…`);
      globalThis.location?.reload?.();
    },

    /**
     * 设置身份覆盖并刷新（同机多窗口需互不相同）
     * @param {string} source - 身份标识
     * @returns {void}
     */
    setSource(source) {
      if (typeof source !== "string" || source === "") {
        console.warn("hwb.setSource(source)：source 为非空字符串");
        return;
      }
      globalThis.localStorage?.setItem(SOURCE_KEY, source);
      console.log(`已设置身份：${source}，刷新中…`);
      globalThis.location?.reload?.();
    },

    /**
     * 设置板目录覆盖并刷新（同机多窗口需互不相同）
     * @param {string} board - 板目录路径
     * @returns {void}
     */
    setBoard(board) {
      if (typeof board !== "string" || board === "") {
        console.warn("hwb.setBoard(board)：board 为板目录路径");
        return;
      }
      globalThis.localStorage?.setItem(BOARD_KEY, board);
      console.log(`已设置板目录：${board}，刷新中…`);
      globalThis.location?.reload?.();
    },

    /**
     * 打印当前同步配置
     * @returns {void}
     */
    status() {
      const storage = globalThis.localStorage;
      console.log(
        "HWB 同步配置",
        JSON.stringify(
          {
            relay: storage?.getItem(RELAY_KEY) ?? "(离线)",
            source: storage?.getItem(SOURCE_KEY) ?? "(设备自动身份)",
            board: storage?.getItem(BOARD_KEY) ?? "(默认 demo-board)",
          },
          null,
          2,
        ),
      );
    },

    /**
     * 清除全部同步配置并刷新（回到离线）
     * @returns {void}
     */
    off() {
      const storage = globalThis.localStorage;
      storage?.removeItem(RELAY_KEY);
      storage?.removeItem(SOURCE_KEY);
      storage?.removeItem(BOARD_KEY);
      console.log("已清除同步配置，刷新中…");
      globalThis.location?.reload?.();
    },

    /**
     * 打印全部 hwb.* 命令用法
     * @returns {void}
     */
    help() {
      console.log(`HWB 控制台命令
同步配置
  hwb.setRelay(url)            设置中继地址（形如 ws://192.168.1.5:8377），自动刷新
  hwb.setSource(source)        设置本端身份（同机多窗口需互不相同），自动刷新
  hwb.setBoard(path)           设置板目录路径，自动刷新
  hwb.status()                 打印当前同步配置
  hwb.off()                    清除全部同步配置回离线，自动刷新
操作
  hwb.undo()                   撤销
  hwb.redo()                   重做
同步调试
  hwb.digest()                 打印本端同步摘要（stateHash / chainHash / openMols）
  hwb.tree()                   打印时间回溯树结构（queryUndoTree）
  hwb.repair()                 手动触发日志重放自愈（repairStateFromLog）
  hwb.reconnect()              关闭并重建全部同步通道（relay / daemon）
调试查询
  hwb.chunkLoad()              区块加载状态
  hwb.chunks(ids?)             区块静态图详情（ids 为区块 id 或数组，缺省全部已载）
  hwb.objectLoad()             对象加载状态
  hwb.objects(ids?, chunks?)   对象详情（按对象 id 或区块 id，缺省全部已载）
  await hwb.inspect(ids)       对象诊断详情（返回数据，可在代码里继续处理）
  hwb.aom()                    AOM 分层状态
  hwb.hit()                    hit 全景（回溯树 / 日志 / 对象状态 / 操作数据）
  hwb.board()                  白板摘要
  hwb.viewport(ids?)           视口信息（缺省全部视口）
  hwb.devices(mode?)           设备图（mode "mermaid" 输出 Mermaid，缺省树形文本）`);
    },

    /**
     * 撤销（经 BoardApi，完成后广播 hit 变更清理失效选中）
     * @returns {void}
     */
    undo() {
      invoke("undo", async (api) => {
        const result = await api.undo();
        notifyHitChanged(boardOf(), result?.forcedEndMolIds ?? []);
        return result;
      });
    },

    /**
     * 重做（经 BoardApi，完成后广播 hit 变更清理失效选中）
     * @returns {void}
     */
    redo() {
      invoke("redo", async (api) => {
        const result = await api.redo();
        notifyHitChanged(boardOf(), result?.forcedEndMolIds ?? []);
        return result;
      });
    },

    /**
     * 打印本端同步摘要（内容校验和 / 链校验和 / 未闭合分子数）
     * @returns {void}
     */
    digest() {
      invoke("digest", async (api) => {
        const [stateHash, chainHash, openMols] = await Promise.all([
          api.queryStateHash(),
          api.queryChainHash(),
          api.queryOpenMols(),
        ]);
        return {
          stateHash,
          chainHash,
          openMols: Array.isArray(openMols) ? openMols.length : openMols,
        };
      });
    },

    /**
     * 打印时间回溯树结构（活动链 / HEAD / 可重做栈 / 节点视图）
     * @returns {void}
     */
    tree() {
      invoke("tree", (api) => api.queryUndoTree());
    },

    /**
     * 手动触发日志重放自愈（效果层分歧修复）
     * @returns {void}
     */
    repair() {
      invoke("repair", (api) => api.repairStateFromLog());
    },

    /**
     * 关闭并重建全部同步通道（relay 协调器与 daemon 协作通道）
     * @returns {void}
     */
    reconnect() {
      debug("reconnect");
    },

    /**
     * 区块加载状态（Worker 侧输出）
     * @returns {void}
     */
    chunkLoad() {
      debug("chunkLoadState");
    },

    /**
     * 区块静态图详情（Worker 侧输出）
     * @param {number|number[]} [ids] - 区块 id 或数组（缺省全部已载区块）
     * @returns {void}
     */
    chunks(ids) {
      debug("chunksDetail", { chunkIds: idsOf(ids) });
    },

    /**
     * 对象加载状态（Worker 侧输出）
     * @returns {void}
     */
    objectLoad() {
      debug("objectLoadState");
    },

    /**
     * 对象详情（Worker 侧输出）
     * @param {string|string[]} [ids] - 对象 id 或数组
     * @param {number|number[]} [chunks] - 区块 id 或数组（按区块取对象）
     * @returns {void}
     */
    objects(ids, chunks) {
      debug("objectsDetail", { objectIds: idsOf(ids), chunkIds: idsOf(chunks) });
    },

    /**
     * 对象诊断详情（返回数据，可在控制台继续处理）
     * @description 与 objects 的分工：objects 在 Worker 侧打印，inspect 把数据带回本端。
     * @param {string|string[]} ids - 对象 id 或数组
     * @returns {Promise<import("../../kernel/types/types.js").ObjectDetails[]>|void} 详情列表
     */
    inspect(ids) {
      const idList = idsOf(ids);
      if (idList.length === 0) {
        console.warn("hwb.inspect(ids)：需要对象 id 或 id 数组");
        return;
      }
      const api = apiOf();
      if (!api) {
        console.warn("hwb.inspect：board 未就绪");
        return;
      }
      return api.queryObjectDetails(idList);
    },

    /**
     * AOM 分层状态（Worker 侧输出）
     * @returns {void}
     */
    aom() {
      debug("aomState");
    },

    /**
     * hit 全景：回溯树 / 日志 / 对象状态 / 操作数据（Worker 侧输出）
     * @returns {void}
     */
    hit() {
      debug("hitState");
    },

    /**
     * 白板摘要（Worker 侧输出）
     * @returns {void}
     */
    board() {
      debug("boardState");
    },

    /**
     * 视口信息（UI 侧打印，缺省全部视口）
     * @param {string|string[]} [ids] - 视口 id 或数组
     * @returns {void}
     */
    viewport(ids) {
      const board = boardOf();
      if (!board?.viewports) {
        console.warn("hwb.viewport：board 未就绪");
        return;
      }
      const wanted = idsOf(ids);
      const entries =
        wanted && wanted.length > 0
          ? wanted.map((id) => board.viewports.get(String(id))).filter(Boolean)
          : [...board.viewports.values()];
      console.log(
        "hwb.viewport",
        entries.map((vp) => ({
          viewportId: vp.viewportId,
          origin: { x: vp.origin.x, y: vp.origin.y },
          zoom: vp.zoom,
          width: vp.width,
          height: vp.height,
        })),
      );
    },

    /**
     * 设备图（UI 侧打印）
     * @param {string} [mode] - "mermaid" 输出 Mermaid 格式，缺省树形文本
     * @returns {void}
     */
    devices(mode) {
      const board = boardOf();
      const dag = board?.devicesDAG;
      if (!dag) {
        console.warn("hwb.devices：board 未就绪或缺少设备图");
        return;
      }
      if (mode === "mermaid") {
        console.log("hwb.devices (mermaid):\n" + dagToMermaid(dag, { orientation: "TD" }));
        return;
      }
      console.log("hwb.devices:\n" + dag.toString());
    },
  };
}

export { installSyncConsole };
