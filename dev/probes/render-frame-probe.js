/**
 * @file 渲染帧指纹诊断器
 * @description
 * 在 UI 侧对「Worker 产出的位图」与「合成后的显示画布」各取一份降采样指纹，
 * 出现单帧内容突变时输出该帧元数据，用于定位闪烁发生在哪一层。
 * @author Zhou Chenyu
 */

/**
 * 指纹采样网格边长
 * @description 33×33 = 1089 个采样点，足够检出整幅或大面积突变，开销约 0.2ms。
 */
const PROBE_SAMPLE_GRID = 33;

/**
 * 环形缓冲区保留的帧数
 */
const PROBE_HISTORY_LIMIT = 180;

/**
 * 单帧平均亮度突变阈值（0-255）
 * @description 超过该值视为异常帧；正常绘制时相邻帧均值变化远小于此。
 */
const PROBE_LUMA_JUMP_THRESHOLD = 6;

/**
 * 异常帧需要连续保持的帧数上限
 * @description 突变后超过该帧数仍未恢复则不再提示"已恢复"。
 */
const PROBE_RECOVER_WINDOW = 6;

/**
 * A-B-A 判定中两帧视为"相同"的逐点差异容差
 * @description 同一内容重复渲染时逐点差应接近 0，留 1 个单位的量化余量。
 */
const PROBE_SAME_POINT_TOLERANCE = 1;

/**
 * A-B-A 判定中两帧视为"相同"的最大差异点比例
 * @description 允许极少量边缘抖动，超过则不算回到同一画面。
 */
const PROBE_SAME_POINT_RATIO = 0.02;

/**
 * A-B-A 判定中"中间帧确有变化"的最小差异点数
 * @description 防止单点量化噪声被当成闪烁。
 */
const PROBE_SPIKE_MIN_POINTS = 4;

/**
 * A-B-A 判定中"中间帧差异"相对"回归残差"的最小倍数
 * @description
 * 用相对判据而非固定比例，才能同时容纳整幅闪烁与局部小对象闪烁：
 * 中间帧必须比"回到基线"的残差明显得多，才算真的闪了一下。
 */
const PROBE_SPIKE_RELATIVE_FACTOR = 3;

/**
 * 是否为该次采样启用记录
 * @param {{ enabled?: boolean }} [options={}] - 选项
 * @returns {boolean}
 */
function isProbeEnabled(options = {}) {
  return options.enabled === true;
}

/**
 * 创建帧指纹探针
 * @description
 * 探针把画布降采样到固定网格后读回像素，计算平均亮度与逐点指纹。
 * 同一帧对位图与显示画布分别采样，两者突变时刻是否一致即为分层依据：
 * - 位图突变 → 问题在 Worker 产出
 * - 仅显示画布突变 → 问题在 UI 合成
 * @param {{
 *   enabled?: boolean,
 *   gridSize?: number,
 *   historyLimit?: number,
 *   lumaJumpThreshold?: number,
 *   createCanvas?: (width: number, height: number) => any,
 *   logger?: (message: string, payload?: Object) => void,
 * }} [options={}] - 探针选项
 * @returns {{
 *   enabled: boolean,
 *   sampleFrame: (meta: Object) => Object | null,
 *   getHistory: () => Array<Object>,
 *   getAnomalies: () => Array<Object>,
 *   reset: () => void,
 * }}
 */
function createRenderFrameProbe(options = {}) {
  const enabled = isProbeEnabled(options);
  const gridSize = options.gridSize ?? PROBE_SAMPLE_GRID;
  const historyLimit = options.historyLimit ?? PROBE_HISTORY_LIMIT;
  const lumaJumpThreshold =
    options.lumaJumpThreshold ?? PROBE_LUMA_JUMP_THRESHOLD;
  const createCanvasFn =
    options.createCanvas ??
    ((width, height) => {
      if (typeof OffscreenCanvas === "function") {
        return new OffscreenCanvas(width, height);
      }
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      return null;
    });
  const logger =
    options.logger ??
    ((message, payload) => {
      // eslint-disable-next-line no-console
      console.warn(message, payload);
    });

  /** 降采样用的临时画布 */
  let scratch = null;
  /** 已记录的帧历史 */
  const history = [];
  /** 检出的异常帧 */
  const anomalies = [];
  /**
   * 各层待确认的瞬变
   * @description 记录突变前的基线与已持续帧数，用于判定 A-B-A 瞬变。
   * @type {{ bitmap: Object|null, canvas: Object|null }}
   */
  const pendingSpikes = { bitmap: null, canvas: null };

  /**
   * 惰性创建降采样画布
   * @returns {any} 采样画布及其上下文
   */
  function ensureScratch() {
    if (scratch) return scratch;
    const canvas = createCanvasFn(gridSize, gridSize);
    const context = canvas?.getContext?.("2d") ?? null;
    if (!context) return null;
    scratch = { canvas, context };
    return scratch;
  }

  /**
   * 对源画布取降采样指纹
   * @param {any} source - 位图或画布
   * @param {number} width - 源宽度
   * @param {number} height - 源高度
   * @returns {{ luma: number, points: number[] } | null} 指纹
   */
  function fingerprint(source, width, height) {
    if (!source || !(width > 0) || !(height > 0)) return null;
    const target = ensureScratch();
    if (!target) return null;

    const { canvas, context } = target;
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    context.clearRect?.(0, 0, gridSize, gridSize);
    try {
      context.drawImage(source, 0, 0, width, height, 0, 0, gridSize, gridSize);
    } catch {
      return null;
    }

    let data = null;
    try {
      data = context.getImageData(0, 0, gridSize, gridSize).data;
    } catch {
      return null;
    }
    if (!data) return null;

    const points = new Array(gridSize * gridSize);
    let lumaSum = 0;
    for (let index = 0; index < points.length; index++) {
      const offset = index * 4;
      const alpha = data[offset + 3] / 255;
      // 透明像素按画布底色（白）参与亮度，否则空区域会被算成纯黑
      const luma =
        (data[offset] * 0.299 +
          data[offset + 1] * 0.587 +
          data[offset + 2] * 0.114) *
          alpha +
        255 * (1 - alpha);
      const rounded = Math.round(luma);
      points[index] = rounded;
      lumaSum += rounded;
    }

    return { luma: lumaSum / points.length, points };
  }

  /**
   * 比较两份指纹，返回变化量
   * @param {{luma: number, points: number[]} | null} previous - 上一帧指纹
   * @param {{luma: number, points: number[]} | null} current - 当前帧指纹
   * @returns {{ lumaDelta: number, changedPoints: number } | null}
   */
  function compare(previous, current) {
    if (!previous || !current) return null;
    let changedPoints = 0;
    for (let index = 0; index < current.points.length; index++) {
      if (Math.abs(current.points[index] - previous.points[index]) > 2) {
        changedPoints++;
      }
    }
    return {
      lumaDelta: current.luma - previous.luma,
      changedPoints,
    };
  }

  /**
   * 判断两份指纹是否描绘同一画面
   * @param {{points: number[]} | null} a - 指纹 A
   * @param {{points: number[]} | null} b - 指纹 B
   * @returns {{ same: boolean, diffPoints: number, total: number } | null}
   */
  function similarity(a, b) {
    if (!a || !b) return null;
    const total = Math.min(a.points.length, b.points.length);
    let diffPoints = 0;
    for (let index = 0; index < total; index++) {
      if (
        Math.abs(a.points[index] - b.points[index]) > PROBE_SAME_POINT_TOLERANCE
      ) {
        diffPoints++;
      }
    }
    return {
      same: diffPoints / total <= PROBE_SAME_POINT_RATIO,
      diffPoints,
      total,
    };
  }

  /**
   * 跟踪单层的突变与恢复
   * @description
   * 突变时记录突变前基线；后续帧回到基线附近即判定为 A-B-A 瞬变（闪烁签名），
   * 超过恢复窗口仍未回到基线则作废（属于真实的内容变化，不是闪烁）。
   * @param {"bitmap" | "canvas"} layer - 层名
   * @param {Object} record - 当前帧记录
   * @param {number | null} luma - 当前帧亮度
   * @param {number | null} baselineLuma - 上一帧亮度
   * @param {number | null} delta - 本帧亮度变化
   * @returns {Object | null} 瞬变确认信息
   */
  function trackSpike(layer, record, luma, baselineLuma, delta) {
    const pending = pendingSpikes[layer];

    if (pending) {
      pending.age += 1;
      const isRecovered =
        luma != null &&
        Math.abs(luma - pending.baselineLuma) < lumaJumpThreshold / 2;

      if (isRecovered) {
        pendingSpikes[layer] = null;
        return {
          layer,
          baselineLuma: pending.baselineLuma,
          spikeLuma: pending.spikeLuma,
          spikeDelta: pending.spikeDelta,
          recoveredAfterFrames: pending.age,
        };
      }

      if (pending.age > PROBE_RECOVER_WINDOW) {
        pendingSpikes[layer] = null;
      }
      return null;
    }

    if (delta != null && Math.abs(delta) >= lumaJumpThreshold) {
      pendingSpikes[layer] = {
        baselineLuma: baselineLuma ?? 0,
        spikeLuma: luma ?? 0,
        spikeDelta: delta,
        age: 1,
      };
    }
    return null;
  }

  /**
   * 检出指纹级 A-B-A 单帧瞬变
   * @description
   * 当前帧与两帧前的指纹一致、且中间帧与两者都不同，说明中间那一帧是
   * "闪一下又回来"，即用户感知的闪烁；真实内容推进不会满足该条件。
   * @param {"bitmap" | "canvas"} layer - 层名
   * @param {Object | undefined} twoAgo - 两帧前指纹
   * @param {Object | undefined} middle - 中间帧指纹
   * @param {Object | null} current - 当前帧指纹
   * @param {Object} record - 当前帧记录
   * @returns {Object | null} 瞬变确认信息
   */
  function detectAba(layer, twoAgo, middle, current, record) {
    if (!twoAgo || !middle || !current) return null;

    const backToBase = similarity(current, twoAgo);
    const middleDiffers = similarity(middle, twoAgo);
    if (!backToBase || !middleDiffers) return null;
    if (!backToBase.same) return null;
    const requiredPoints = Math.max(
      PROBE_SPIKE_MIN_POINTS,
      backToBase.diffPoints * PROBE_SPIKE_RELATIVE_FACTOR,
    );
    if (middleDiffers.diffPoints < requiredPoints) return null;

    const transient = {
      layer,
      kind: "aba",
      diffPoints: middleDiffers.diffPoints,
      total: middleDiffers.total,
      ratio: middleDiffers.diffPoints / middleDiffers.total,
      middleFrameId: record.previousFrameId ?? null,
      currentFrameId: record.frameId ?? null,
    };
    anomalies.push({ ...record, transient });
    if (anomalies.length > historyLimit) anomalies.shift();
    logger(
      layer === "bitmap"
        ? "[render-probe] A-B-A 单帧闪烁（Worker 产出层）"
        : "[render-probe] A-B-A 单帧闪烁（仅显示画布层 / UI 合成）",
      { ...record, transient },
    );
    return { ...record, transient };
  }

  /**
   * 压入一帧记录并检出异常
   * @param {Object} record - 帧记录
   * @returns {Object | null} 异常记录
   */
  function pushRecord(record) {
    history.push(record);
    if (history.length > historyLimit) history.shift();

    const previous = history[history.length - 2];
    const bitmapDelta = record.bitmapLumaDelta;
    const canvasDelta = record.canvasLumaDelta;
    const bitmapJump =
      bitmapDelta != null && Math.abs(bitmapDelta) >= lumaJumpThreshold;
    const canvasJump =
      canvasDelta != null && Math.abs(canvasDelta) >= lumaJumpThreshold;

    // 指纹级 A-B-A：n-1 与 n+1 描绘同一画面、而 n 与之不同 → 单帧瞬变
    // 该判据不依赖整体亮度，能抓到"局部对象闪一下"这类幅度较小的闪烁
    const twoFramesAgo = history[history.length - 3];
    const abaBitmap = detectAba(
      "bitmap",
      twoFramesAgo?.bitmapPrint,
      previous?.bitmapPrint,
      record.bitmapPrint,
      record,
    );
    if (abaBitmap) return abaBitmap;
    const abaCanvas = detectAba(
      "canvas",
      twoFramesAgo?.canvasPrint,
      previous?.canvasPrint,
      record.canvasPrint,
      record,
    );
    if (abaCanvas) return abaCanvas;

    // 先跟踪已有瞬变的恢复，再登记新的突变
    const recoveredBitmap = trackSpike(
      "bitmap",
      record,
      record.bitmapLuma,
      previous?.bitmapLuma ?? null,
      bitmapDelta,
    );
    const recoveredCanvas = trackSpike(
      "canvas",
      record,
      record.canvasLuma,
      previous?.canvasLuma ?? null,
      canvasDelta,
    );

    if (recoveredBitmap) {
      logger("[render-probe] A-B-A 瞬变已恢复：位图层（Worker 产出）", {
        ...record,
        transient: recoveredBitmap,
      });
      return { ...record, transient: recoveredBitmap };
    }

    if (recoveredCanvas) {
      logger("[render-probe] A-B-A 瞬变已恢复：仅显示画布层（UI 合成）", {
        ...record,
        transient: recoveredCanvas,
      });
      return { ...record, transient: recoveredCanvas };
    }

    if (!bitmapJump && !canvasJump) return null;

    anomalies.push(record);
    if (anomalies.length > historyLimit) anomalies.shift();
    logger(
      bitmapJump
        ? "[render-probe] 位图内容单帧突变（Worker 产出层）"
        : "[render-probe] 仅显示画布突变（UI 合成层）",
      record,
    );
    return record;
  }

  return {
    enabled,
    /**
     * 采样一帧
     * @param {{
     *   bitmap?: any,
     *   bitmapWidth?: number,
     *   bitmapHeight?: number,
     *   canvas?: any,
     *   canvasWidth?: number,
     *   canvasHeight?: number,
     *   meta?: Object,
     * }} frame - 帧采样输入
     * @returns {Object | null} 帧记录
     */
    sampleFrame(frame = {}) {
      if (!enabled) return null;

      const bitmapPrint = fingerprint(
        frame.bitmap,
        frame.bitmapWidth,
        frame.bitmapHeight,
      );
      const canvasPrint = fingerprint(
        frame.canvas,
        frame.canvasWidth,
        frame.canvasHeight,
      );
      if (!bitmapPrint && !canvasPrint) return null;

      const previous = history[history.length - 1];
      const bitmapDiff = compare(previous?.bitmapPrint, bitmapPrint);
      const canvasDiff = compare(previous?.canvasPrint, canvasPrint);

      const record = {
        at: Date.now(),
        ...(frame.meta ?? {}),
        previousFrameId: previous?.frameId ?? null,
        bitmapLuma: bitmapPrint?.luma ?? null,
        bitmapLumaDelta: bitmapDiff?.lumaDelta ?? null,
        bitmapChangedPoints: bitmapDiff?.changedPoints ?? null,
        canvasLuma: canvasPrint?.luma ?? null,
        canvasLumaDelta: canvasDiff?.lumaDelta ?? null,
        canvasChangedPoints: canvasDiff?.changedPoints ?? null,
        bitmapPrint,
        canvasPrint,
      };

      return pushRecord(record) ?? record;
    },
    /**
     * 取帧历史
     * @returns {Array<Object>} 历史帧记录（不含指纹点列）
     */
    getHistory() {
      return history.map(({ bitmapPrint, canvasPrint, ...rest }) => rest);
    },
    /**
     * 取检出的异常帧
     * @returns {Array<Object>} 异常帧记录
     */
    getAnomalies() {
      return anomalies.map(({ bitmapPrint, canvasPrint, ...rest }) => rest);
    },
    /**
     * 清空历史
     * @returns {void}
     */
    reset() {
      history.length = 0;
      anomalies.length = 0;
    },
  };
}

export {
  createRenderFrameProbe,
  PROBE_SAMPLE_GRID,
  PROBE_HISTORY_LIMIT,
  PROBE_LUMA_JUMP_THRESHOLD,
  PROBE_RECOVER_WINDOW,
};
