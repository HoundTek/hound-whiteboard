/**
 * @file awareness overlay
 * @description 协作感知装饰层：远程命名选择的按来源着色框与来源标签，只画不存。
 * @module ui/components/renderer/awareness-overlay
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../../../kernel/range/index.js";
import {
  getSummaryWorldRect,
  worldToScreenPoint,
} from "./ui-overlay-factory.js";

/**
 * awareness 标签的屏幕高度（像素）
 * @type {number}
 */
const AWARENESS_LABEL_HEIGHT = 16;

/**
 * 本端光标上报的节流间隔（毫秒）
 * @type {number}
 */
const CURSOR_REPORT_THROTTLE_MS = 50;

/**
 * 远程光标的过期时长（毫秒，无更新即消失）
 * @type {number}
 */
const CURSOR_EXPIRY_MS = 3000;

/**
 * 来源标识的默认取色（稳定哈希 → HSL 色相环）
 * @param {string} source - 来源标识
 * @returns {string} CSS 颜色
 */
function defaultResolveColor(source) {
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash * 31 + source.charCodeAt(i)) | 0) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 75%, 45%)`;
}

/**
 * 协作感知装饰层
 * @class
 * @description
 * 远程命名选择的可视化：经 BoardApi RPC 拉取 queryRemoteChoices 与对象摘要缓存，
 * 作为 UiRenderer overlay provider 按来源着色画框并标注来源与 choice 名。
 * 远程注册表的变更经 worker 的 awareness 消息驱动刷新；缓存不进任何文档状态（只画不存）。
 */
class AwarenessOverlay {
  /**
   * BoardApi RPC 面
   * @type {Object}
   * @private
   */
  #boardApi;

  /**
   * 视口实例
   * @type {import("../orchestration/viewport.js").Viewport}
   * @private
   */
  #viewport;

  /**
   * 来源取色函数
   * @type {(source: string) => string}
   * @private
   */
  #resolveColor;

  /**
   * 远程选择分组缓存
   * @type {{ source: string, name: string|undefined, color: string, summaries: Object[] }[]}
   * @private
   */
  #groups = [];

  /**
   * 进行中的刷新（串行化）
   * @type {Promise<void> | null}
   * @private
   */
  #refreshPromise = null;

  /**
   * 刷新期间又到通知的待办标记
   * @type {boolean}
   * @private
   */
  #refreshPending = false;

  /**
   * overlay provider 引用（注销用）
   * @type {Function | null}
   * @private
   */
  #provider = null;

  /**
   * awareness 消息监听引用（解除用）
   * @type {Function | null}
   * @private
   */
  #listener = null;

  /**
   * 远程光标缓存（来源 → 光标状态）
   * @type {Map<string, { point: { x: number, y: number }, color: string, lastSeen: number, expiryTimer: ReturnType<typeof setTimeout> | null }>}
   * @private
   */
  #cursors = new Map();

  /**
   * 本端光标上报的 pointermove 监听引用
   * @type {Function | null}
   * @private
   */
  #pointerMoveListener = null;

  /**
   * 本端光标上次上报时刻
   * @type {number}
   * @private
   */
  #cursorLastSentAt = 0;

  /**
   * 本端光标尾随上报定时器
   * @type {ReturnType<typeof setTimeout> | null}
   * @private
   */
  #cursorTrailingTimer = null;

  /**
   * 本端光标最新世界坐标（尾随上报用）
   * @type {{ x: number, y: number } | null}
   * @private
   */
  #cursorLatestWorld = null;

  /**
   * 远程手势中间帧预览表（对象 id → 预览状态）
   * @description 只画不存：position 后帧盖前帧，append 按序累积；
   * 远程注册表刷新时裁掉不在任何远程选择中的条目，peer-left 按来源清理。
   * @type {Map<string, { source: string, position?: { x: number, y: number }, transform?: Object, appended?: Map<string, any[]> }>}
   * @private
   */
  #previews = new Map();

  /**
   * 分子预览索引（molId → 该分子涉及的对象 id 集）
   * @description mol-end / mol-abort 按分子清理预览；peer-left 与断线时同步清空。
   * @type {Map<string, Set<string>>}
   * @private
   */
  #molIndex = new Map();

  /**
   * 分子消息水位与结束墓碑
   * @type {Map<string, {source: string, seq: number, closed: boolean}>}
   * @private
   */
  #molStates = new Map();

  /**
   * @param {Object} options - 选项
   * @param {Object} options.boardApi - BoardApi RPC 面（须含 queryRemoteChoices 与 queryObjects）
   * @param {import("../orchestration/viewport.js").Viewport} options.viewport - 视口实例
   * @param {(source: string) => string} [options.resolveColor] - 来源取色函数（缺省稳定哈希取色）
   */
  constructor({ boardApi, viewport, resolveColor } = {}) {
    if (!boardApi || !viewport) {
      throw new TypeError("AwarenessOverlay requires boardApi and viewport.");
    }
    this.#boardApi = boardApi;
    this.#viewport = viewport;
    this.#resolveColor = resolveColor ?? defaultResolveColor;
  }

  /**
   * 启动装饰层：注册 overlay provider 与 awareness 消息监听，并做首次拉取
   * @returns {void}
   */
  start() {
    if (this.#provider !== null) return;
    this.#provider = () => this.#collectEntries();
    this.#viewport.registerUiOverlayProvider(this.#provider, {
      invalidate: false,
    });
    this.#listener = (message) => this.#handleAwarenessMessage(message);
    this.#viewport.addAwarenessListener(this.#listener);
    this.#startCursorReporting();
    void this.refresh();
  }

  /**
   * 停止装饰层：注销 provider 与监听并清空缓存
   * @returns {void}
   */
  stop() {
    if (this.#provider !== null) {
      this.#viewport.unregisterUiOverlayProvider(this.#provider, {
        invalidate: false,
      });
      this.#provider = null;
    }
    if (this.#listener !== null) {
      this.#viewport.removeAwarenessListener(this.#listener);
      this.#listener = null;
    }
    this.#stopCursorReporting();
    for (const cursor of this.#cursors.values()) {
      if (cursor.expiryTimer !== null) clearTimeout(cursor.expiryTimer);
    }
    this.#cursors.clear();
    this.#previews.clear();
    this.#molIndex.clear();
    this.#molStates.clear();
    this.#groups = [];
    this.#viewport.uiRenderer?.invalidateViewport?.();
  }

  /**
   * 处理 awareness 下行消息
   * @param {Object} message - awareness 消息（{awarenessType, source, data}）
   * @returns {void}
   * @private
   */
  #handleAwarenessMessage(message) {
    switch (message?.awarenessType) {
      case "remote-activity":
        this.#dropPreviewsByIds(message.data?.ids);
        void this.refresh();
        return;
      case "cursor":
        this.#applyRemoteCursor(message.source, message.data?.point);
        return;
      case "mol-begin":
      case "mol-amend":
      case "mol-end":
      case "mol-abort":
        this.#applyMolMessage(message.source, message.data);
        return;
      case "peer-left":
        this.#dropRemoteCursor(message.source);
        this.#dropSourcePreviews(message.source);
        return;
      case "disconnect":
        // 本端断线：对端手势与光标状态全部不可信，重连后各自重建
        this.#clearAllRemotePresence();
        return;
      default:
        return;
    }
  }

  /**
   * 清空全部远程在场状态（本端断线时调用）
   * @returns {void}
   * @private
   */
  #clearAllRemotePresence() {
    for (const cursor of this.#cursors.values()) {
      if (cursor.expiryTimer !== null) clearTimeout(cursor.expiryTimer);
    }
    this.#cursors.clear();
    this.#previews.clear();
    this.#molIndex.clear();
    this.#molStates.clear();
    this.#viewport.uiRenderer?.invalidateViewport?.();
  }

  /**
   * 清理通知涉及的对象预览（手势 commit/discard 后预览使命结束）
   * @param {string[]} [ids] - 远程选择变更涉及的对象 id 列表
   * @returns {void}
   * @private
   */
  #dropPreviewsByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    let changed = false;
    for (const id of ids) {
      if (this.#previews.delete(id)) {
        changed = true;
      }
    }
    if (changed) {
      this.#viewport.uiRenderer?.invalidateViewport?.();
    }
  }

  /**
   * 应用 amend 通道的分子消息（mol-begin / mol-amend / mol-end / mol-abort）
   * @param {string} source - 来源标识
   * @param {Object} data - 分子消息数据
   * @returns {void}
   * @private
   *
   * @description
   * mol-begin 建预览条目（创建型取 create 快照，修改型取 before 的 position）；
   * mol-amend 滚动更新（position 绝对覆盖、transform 覆盖、data 按键合并、append 累积）；
   * mol-end / mol-abort 按 #molIndex 清除该分子全部预览。
   */
  #applyMolMessage(source, data) {
    if (typeof source !== "string") return;
    let changed = false;
    switch (data?.kind) {
      case "mol-begin": {
        if (typeof data.molId !== "string" || !Array.isArray(data.entries)) {
          return;
        }
        if (this.#molStates.has(data.molId)) return;
        this.#molStates.set(data.molId, { source, seq: 0, closed: false });
        for (const entry of data.entries) {
          if (typeof entry?.objectId !== "string") continue;
          const preview = this.#previews.get(entry.objectId) ?? { source };
          if (preview.source !== source) continue;
          preview.appended = new Map();
          preview.replacements = [];
          if (entry.create && typeof entry.create === "object") {
            preview.type = entry.create.type;
            preview.property = { ...(entry.create.property ?? {}) };
            preview.data = { ...(entry.create.data ?? {}) };
            if (entry.create.transform) {
              preview.transform = { ...entry.create.transform };
            }
            this.#applyPreviewPosition(preview, entry.create.position);
          } else {
            this.#applyPreviewPosition(preview, entry.before?.position);
          }
          this.#previews.set(entry.objectId, preview);
          this.#indexMolObject(data.molId, entry.objectId);
          changed = true;
        }
        break;
      }
      case "mol-amend": {
        if (!Array.isArray(data.mols)) return;
        for (const mol of data.mols) {
          if (typeof mol?.molId !== "string" || !Array.isArray(mol.entries)) {
            continue;
          }
          const state = this.#molStates.get(mol.molId);
          if (!state || state.closed || state.source !== source) continue;
          if (typeof mol.seq === "number") {
            if (mol.seq <= state.seq) continue;
            state.seq = mol.seq;
          }
          for (const entry of mol.entries) {
            if (typeof entry?.objectId !== "string") continue;
            const preview = this.#previews.get(entry.objectId);
            if (!preview || preview.source !== source) continue;
            const patch = entry.patch;
            if (patch && typeof patch === "object") {
              this.#applyPreviewPosition(preview, patch.position);
              if (patch.transform && typeof patch.transform === "object") {
                preview.transform = { ...patch.transform };
              }
              if (patch.data && typeof patch.data === "object") {
                preview.data = { ...preview.data, ...patch.data };
              }
              if (typeof patch.append?.key === "string") {
                if (!preview.appended) preview.appended = new Map();
                const items = preview.appended.get(patch.append.key) ?? [];
                items.push(...(patch.append.items ?? []));
                preview.appended.set(patch.append.key, items);
              }
            }
            this.#indexMolObject(mol.molId, entry.objectId);
            changed = true;
          }
        }
        break;
      }
      case "mol-end":
      case "mol-abort": {
        if (typeof data.molId !== "string") return;
        this.#molStates.set(data.molId, { source, seq: Infinity, closed: true });
        if (this.#molStates.size > 1000) {
          this.#molStates.delete(this.#molStates.keys().next().value);
        }
        const ids = this.#molIndex.get(data.molId);
        if (ids !== undefined) {
          this.#molIndex.delete(data.molId);
          for (const objectId of ids) {
            if (this.#previews.delete(objectId)) changed = true;
          }
        }
        break;
      }
      default:
        return;
    }
    if (changed) {
      this.#viewport.uiRenderer?.invalidateViewport?.();
    }
  }

  /**
   * 覆盖预览条目的位置（坐标无效时不动）
   * @param {Object} preview - 预览条目
   * @param {*} position - 候选世界坐标（patch.position 为绝对坐标，直接覆盖）
   * @returns {void}
   * @private
   */
  #applyPreviewPosition(preview, position) {
    if (typeof position?.x === "number" && typeof position?.y === "number") {
      preview.position = { x: position.x, y: position.y };
    }
  }

  /**
   * 登记分子涉及的对象 id（mol-end / mol-abort 按分子清理用）
   * @param {string} molId - 分子 id
   * @param {string} objectId - 对象 id
   * @returns {void}
   * @private
   */
  #indexMolObject(molId, objectId) {
    let ids = this.#molIndex.get(molId);
    if (ids === undefined) {
      ids = new Set();
      this.#molIndex.set(molId, ids);
    }
    ids.add(objectId);
  }

  /**
   * 清理某来源的全部预览（对端离开）
   * @param {string} source - 来源标识
   * @returns {void}
   * @private
   */
  #dropSourcePreviews(source) {
    let changed = false;
    for (const [molId, state] of this.#molStates) {
      if (state.source === source) this.#molStates.delete(molId);
    }
    for (const [objectId, preview] of this.#previews) {
      if (preview.source === source) {
        this.#previews.delete(objectId);
        changed = true;
      }
    }
    if (changed) {
      // 分子索引同步剔除已删对象，避免残留悬空 id
      for (const [molId, ids] of this.#molIndex) {
        for (const objectId of [...ids]) {
          if (!this.#previews.has(objectId)) ids.delete(objectId);
        }
        if (ids.size === 0) this.#molIndex.delete(molId);
      }
      this.#viewport.uiRenderer?.invalidateViewport?.();
    }
  }

  /**
   * 裁掉不在任何远程选择中的预览（手势结束或被撤销后的归位）
   * @returns {void}
   * @private
   *
   * @description
   * 创建中预览（含创建上下文）不在此裁剪：其对象从未进入远程注册表，
   * 清理由 mol-end / mol-abort、remote-activity 通知的 ids 与 peer-left 承担。
   */
  #prunePreviews() {
    const held = new Set();
    for (const group of this.#groups) {
      for (const summary of group.summaries) {
        held.add(summary.id);
      }
    }
    for (const [objectId, preview] of [...this.#previews]) {
      if (preview.type !== undefined) continue;
      if (!held.has(objectId)) {
        this.#previews.delete(objectId);
      }
    }
  }

  /**
   * 登记远程光标位置（含过期调度）
   * @param {string} source - 来源标识
   * @param {{ x: number, y: number }} point - 世界坐标
   * @returns {void}
   * @private
   */
  #applyRemoteCursor(source, point) {
    if (
      typeof source !== "string" ||
      typeof point?.x !== "number" ||
      typeof point?.y !== "number"
    ) {
      return;
    }
    const existing = this.#cursors.get(source);
    if (existing?.expiryTimer) {
      clearTimeout(existing.expiryTimer);
    }
    const expiryTimer = setTimeout(() => {
      this.#dropRemoteCursor(source);
    }, CURSOR_EXPIRY_MS);
    this.#cursors.set(source, {
      point: { x: point.x, y: point.y },
      color: this.#resolveColor(source),
      lastSeen: Date.now(),
      expiryTimer,
    });
    this.#viewport.uiRenderer?.invalidateViewport?.();
  }

  /**
   * 移除远程光标（过期或对端离开）
   * @param {string} source - 来源标识
   * @returns {void}
   * @private
   */
  #dropRemoteCursor(source) {
    const existing = this.#cursors.get(source);
    if (!existing) return;
    if (existing.expiryTimer !== null) clearTimeout(existing.expiryTimer);
    this.#cursors.delete(source);
    this.#viewport.uiRenderer?.invalidateViewport?.();
  }

  /**
   * 启动本端光标上报（pointermove 节流）
   * @returns {void}
   * @private
   */
  #startCursorReporting() {
    const canvas = this.#viewport.canvas;
    if (typeof canvas?.addEventListener !== "function") return;
    this.#pointerMoveListener = (event) => {
      const world = this.#viewport.screenToWorld?.({
        x: event.clientX,
        y: event.clientY,
      });
      if (!world) return;
      this.#cursorLatestWorld = { x: world.x, y: world.y };
      const now = Date.now();
      const elapsed = now - this.#cursorLastSentAt;
      if (elapsed >= CURSOR_REPORT_THROTTLE_MS) {
        this.#cursorLastSentAt = now;
        this.#viewport.sendAwareness({
          kind: "cursor",
          point: this.#cursorLatestWorld,
        });
      } else if (this.#cursorTrailingTimer === null) {
        // 尾随补发：手势停下前的最后位置不丢
        this.#cursorTrailingTimer = setTimeout(() => {
          this.#cursorTrailingTimer = null;
          this.#cursorLastSentAt = Date.now();
          if (this.#cursorLatestWorld) {
            this.#viewport.sendAwareness({
              kind: "cursor",
              point: this.#cursorLatestWorld,
            });
          }
        }, CURSOR_REPORT_THROTTLE_MS - elapsed);
      }
    };
    canvas.addEventListener("pointermove", this.#pointerMoveListener);
  }

  /**
   * 停止本端光标上报
   * @returns {void}
   * @private
   */
  #stopCursorReporting() {
    const canvas = this.#viewport.canvas;
    if (this.#pointerMoveListener !== null) {
      canvas?.removeEventListener?.("pointermove", this.#pointerMoveListener);
      this.#pointerMoveListener = null;
    }
    if (this.#cursorTrailingTimer !== null) {
      clearTimeout(this.#cursorTrailingTimer);
      this.#cursorTrailingTimer = null;
    }
    this.#cursorLatestWorld = null;
  }

  /**
   * 重新拉取远程选择状态并刷新装饰
   * @returns {Promise<void>}
   *
   * @description
   * 刷新串行执行；刷新期间到达的通知合并为一次追加刷新。
   */
  refresh() {
    if (this.#refreshPromise !== null) {
      this.#refreshPending = true;
      return this.#refreshPromise;
    }
    this.#refreshPromise = (async () => {
      try {
        const choices = await this.#boardApi.queryRemoteChoices();
        const ids = [...new Set(choices.flatMap((c) => c.ids))];
        const summaries =
          ids.length > 0 ? await this.#boardApi.queryObjects(ids) : [];
        const byId = new Map(summaries.map((s) => [s.id, s]));
        this.#groups = choices.map((choice) => ({
          source: choice.source,
          name: choice.name,
          color: this.#resolveColor(choice.source),
          summaries: choice.ids
            .map((id) => byId.get(id))
            .filter(Boolean),
        }));
        this.#prunePreviews();
        this.#viewport.uiRenderer?.invalidateViewport?.();
      } catch {
        // RPC 失败（板已销毁等）：保留旧缓存，等待下次通知
      } finally {
        this.#refreshPromise = null;
        if (this.#refreshPending) {
          this.#refreshPending = false;
          void this.refresh();
        }
      }
    })();
    return this.#refreshPromise;
  }

  /**
   * 收集当前应绘制的 awareness 条目
   * @returns {import("./ui-overlay-factory.js").UiOverlayEntry[]}
   * @private
   */
  #collectEntries() {
    const entries = [];
    for (const group of this.#groups) {
      let unionRect;
      for (const summary of group.summaries) {
        // 手势中间帧预览：框随预览位置画（只画不存，commit 到达后按记录归位）
        const preview = this.#previews.get(summary.id);
        const effective = preview?.position
          ? { ...summary, position: preview.position }
          : summary;
        const worldRect = getSummaryWorldRect(effective);
        if (!worldRect) continue;
        entries.push({
          source: `awareness-choice:${group.source}`,
          objectId: summary.id,
          type: "rect",
          geometry: { worldRect },
          style: {
            strokeStyle: group.color,
            lineWidth: 1.5,
            lineDash: [6, 3],
          },
        });
        unionRect = unionRect ? unionRect.union(worldRect) : worldRect;
      }
      const labelEntry = this.#createLabelEntry(group, unionRect);
      if (labelEntry) {
        entries.push(labelEntry);
      }
    }
    for (const [source, cursor] of this.#cursors) {
      entries.push(this.#createCursorEntry(source, cursor));
    }
    for (const [objectId, preview] of this.#previews) {
      if (preview.type === undefined) continue;
      const entry = this.#createCreationEntry(objectId, preview);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /**
   * 计算预览的列表属性有效值（初始 data + 追加 + 替换）
   * @param {Object} preview - 预览状态
   * @param {string} key - 列表属性名（如 points）
   * @returns {any[]} 有效列表
   * @private
   */
  #effectiveListItems(preview, key) {
    const base = Array.isArray(preview.data?.[key]) ? preview.data[key] : [];
    const appended = preview.appended?.get(key) ?? [];
    const combined = [...base, ...appended];
    for (const replacement of preview.replacements ?? []) {
      if (
        replacement.key === key &&
        Number.isInteger(replacement.index) &&
        replacement.index >= 0 &&
        replacement.index < combined.length
      ) {
        combined[replacement.index] = replacement.item;
      }
    }
    return combined;
  }

  /**
   * 生成创建中对象的预览条目（只画不存）
   * @param {string} objectId - 对象 id
   * @param {Object} preview - 预览状态（含创建上下文与中间帧）
   * @returns {import("./ui-overlay-factory.js").UiOverlayEntry | undefined}
   * @private
   *
   * @description
   * 笔/多边形按有效 points 画路径，圆/椭圆按半径画轮廓；统一按来源着色半透明，
   * 与 commit 后的正式渲染区分。
   */
  #createCreationEntry(objectId, preview) {
    const color = this.#resolveColor(preview.source);
    const position = preview.position ?? { x: 0, y: 0 };

    if (preview.type === "StrokeObject" || preview.type === "PolygonObject") {
      const worldPoints = this.#effectiveListItems(preview, "points")
        .filter((p) => typeof p?.x === "number" && typeof p?.y === "number")
        .map((p) => ({ x: position.x + p.x, y: position.y + p.y }));
      if (worldPoints.length === 0) return undefined;
      const xs = worldPoints.map((p) => p.x);
      const ys = worldPoints.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const closed = preview.type === "PolygonObject";
      const lineWidth = Number.isFinite(preview.property?.width)
        ? preview.property.width
        : 2;
      // 描边以路径为中心向两侧延展，边界外扩防止脏区裁剪
      const pad = lineWidth / 2 + 1;
      const worldRect = new RectangleRange(
        minX - pad,
        minY - pad,
        Math.max(...xs) - minX + pad * 2,
        Math.max(...ys) - minY + pad * 2,
      );
      return {
        source: `awareness-creation:${preview.source}`,
        objectId,
        type: "rect",
        geometry: { worldRect },
        draw: (context, runtime) => {
          const pts = worldPoints
            .map((p) => worldToScreenPoint(p, runtime?.viewport))
            .filter(Boolean);
          if (pts.length === 0 || !context) return;
          context.save?.();
          context.globalAlpha = 0.6;
          if (typeof context.strokeStyle !== "undefined") {
            context.strokeStyle = color;
          }
          context.lineWidth = lineWidth;
          context.lineJoin = "round";
          context.lineCap = "round";
          context.beginPath?.();
          context.moveTo?.(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i += 1) {
            context.lineTo?.(pts[i].x, pts[i].y);
          }
          if (closed && pts.length > 2) context.closePath?.();
          context.stroke?.();
          context.restore?.();
        },
      };
    }

    if (preview.type === "CircleObject" || preview.type === "EllipseObject") {
      const radiusX =
        preview.type === "CircleObject"
          ? preview.data?.radius
          : preview.data?.radiusX;
      const radiusY =
        preview.type === "CircleObject"
          ? preview.data?.radius
          : preview.data?.radiusY;
      if (!(radiusX > 0) || !(radiusY > 0)) return undefined;
      const worldRect = new RectangleRange(
        position.x - radiusX,
        position.y - radiusY,
        radiusX * 2,
        radiusY * 2,
      );
      return {
        source: `awareness-creation:${preview.source}`,
        objectId,
        type: "rect",
        geometry: { worldRect },
        draw: (context, runtime) => {
          const viewport = runtime?.viewport;
          const center = worldToScreenPoint(position, viewport);
          if (!center || !context) return;
          const zoom = viewport?.zoom ?? 1;
          context.save?.();
          context.globalAlpha = 0.6;
          if (typeof context.strokeStyle !== "undefined") {
            context.strokeStyle = color;
          }
          context.lineWidth = 1.5;
          context.beginPath?.();
          context.ellipse?.(
            center.x,
            center.y,
            radiusX * zoom,
            radiusY * zoom,
            0,
            0,
            Math.PI * 2,
          );
          context.stroke?.();
          context.restore?.();
        },
      };
    }

    return undefined;
  }

  /**
   * 生成远程光标条目（着色圆点 + 来源标签）
   * @param {string} source - 来源标识
   * @param {{ point: { x: number, y: number }, color: string }} cursor - 光标状态
   * @returns {import("./ui-overlay-factory.js").UiOverlayEntry}
   * @private
   */
  #createCursorEntry(source, cursor) {
    return {
      source: `awareness-cursor:${source}`,
      type: "point",
      // 边界需覆盖圆点与右侧来源标签文本，避免脏区增量重绘时文字被裁
      geometry: { worldPoint: cursor.point, radius: 12 + source.length * 4 },
      draw: (context, runtime) => {
        const point = runtime?.entry?.geometry?.screenPoint;
        if (!point || !context) return;
        context.save?.();
        if (typeof context.fillStyle !== "undefined") {
          context.fillStyle = cursor.color;
        }
        context.beginPath?.();
        context.arc?.(point.x, point.y, 5, 0, Math.PI * 2);
        context.fill?.();
        context.font = "11px sans-serif";
        context.textBaseline = "top";
        context.fillText?.(source, point.x + 9, point.y + 6);
        context.restore?.();
      },
    };
  }

  /**
   * 生成一组远程选择的来源标签条目
   * @param {{ source: string, name: string|undefined, color: string }} group - 远程选择分组
   * @param {RectangleRange | undefined} unionRect - 分组的世界组合矩形
   * @returns {import("./ui-overlay-factory.js").UiOverlayEntry | undefined}
   * @private
   */
  #createLabelEntry(group, unionRect) {
    if (!unionRect) return undefined;
    const label = group.name
      ? `${group.source} · ${group.name}`
      : group.source;
    const screenRect = this.#viewport.worldRectToScreenRect?.(unionRect, 0);
    if (!screenRect) return undefined;
    // 标签贴组合框上方；出屏时退到框内顶部
    const top = Math.max(2, screenRect.top - AWARENESS_LABEL_HEIGHT - 4);
    const color = group.color;
    return {
      source: `awareness-label:${group.source}`,
      type: "rect",
      geometry: {
        screenRect: new RectangleRange(
          screenRect.left,
          top,
          label.length * 7 + 10,
          AWARENESS_LABEL_HEIGHT,
        ),
      },
      draw: (context, runtime) => {
        const rect = runtime?.entry?.geometry?.screenRect;
        if (!rect || !context) return;
        context.save?.();
        if (typeof context.fillStyle !== "undefined") {
          context.fillStyle = color;
        }
        context.globalAlpha = 0.85;
        context.fillRect?.(rect.left, rect.top, rect.width, rect.height);
        context.globalAlpha = 1;
        if (typeof context.fillStyle !== "undefined") {
          context.fillStyle = "#ffffff";
        }
        context.font = "11px sans-serif";
        context.textBaseline = "middle";
        context.fillText?.(
          label,
          rect.left + 5,
          rect.top + rect.height / 2,
        );
        context.restore?.();
      },
    };
  }
}

export { AwarenessOverlay, defaultResolveColor };
