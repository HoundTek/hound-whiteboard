/**
 * @file demo 边级 prefix handler 构造器
 * @description 提供键盘 trigger 信号到 position/scale/flush/displacement/debug 等信号的转换构造器。
 * @module demo/config/prefix-builders
 * @author Zhou Chenyu
 */

import { SIGNAL_TYPES } from "../../core/ui-thread/devices-dag/dag-core/signal-types.js";

/**
 * 构建键盘触发信号转发 prefix handler
 * @description
 * 过滤出 trigger 信号并返回，路由依赖 defaultRoute 自动走边。
 * @returns {{ handler: import("../../core/devices-dag/dag-type.js").DevicesDAGHandler }}
 */
function buildKeyboardTriggerForwardNodeConfig() {
  return {
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();
      return ctx.routeToChild(ctx.defaultRoute || "", triggerSignals);
    },
  };
}

/**
 * 构建视口位置移动 prefix handler
 * @description
 * 将 trigger 信号转为 position 信号，目标位置 = viewport.origin + (baseStep / zoom) * direction。
 * viewport 从 handlerContext.context 获取；路由依赖 defaultRoute。
 * @param {{ x: number, y: number }} direction - 位移方向（单位向量）
 * @param {number} [baseStep=200] - 缩放为 1 时的位移步长
 * @returns {{ handler: import("../../core/devices-dag/dag-type.js").DevicesDAGHandler }}
 */
function buildViewportPositionNodeConfig(direction, baseStep = 200) {
  return {
    handler(packet, ctx = {}) {
      const viewport = ctx?.services?.viewport;
      const zoom = viewport?.zoom ?? 1;
      const step = baseStep / zoom;
      const delta = {
        x: (direction?.x ?? 0) * step,
        y: (direction?.y ?? 0) * step,
      };
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();

      return ctx.routeToChild(ctx.defaultRoute || "", [
        ...triggerSignals.map((signal) =>
          ctx.signal(
            "position",
            {
              x: (viewport?.origin?.x ?? 0) + (delta?.x ?? 0),
              y: (viewport?.origin?.y ?? 0) + (delta?.y ?? 0),
            },
            {
              code: signal?.context?.code,
              key: signal?.context?.key,
              sourceType: signal.type,
            },
          ),
        ),
      ]);
    },
  };
}

/**
 * 构建视口缩放 prefix handler
 * @description
 * 将 trigger 信号转为 scale 信号，缩放值由 scaleTransformer 函数计算。
 * viewport 从 handlerContext.context 获取；路由依赖 defaultRoute。
 * @param {(currentZoom: number) => number} scaleTransformer - 缩放变换函数
 * @returns {{ handler: import("../../core/devices-dag/dag-type.js").DevicesDAGHandler }}
 */
function buildViewportScaleNodeConfig(scaleTransformer) {
  return {
    handler(packet, ctx = {}) {
      const viewport = ctx?.services?.viewport;
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();

      return ctx.routeToChild(ctx.defaultRoute || "", [
        ...triggerSignals.map((signal) =>
          ctx.signal("scale", scaleTransformer(viewport?.zoom ?? 1), {
            code: signal?.context?.code,
            key: signal?.context?.key,
            sourceType: signal.type,
          }),
        ),
      ]);
    },
  };
}

/**
 * 构建视口刷新 prefix handler
 * @description 将 trigger 信号转为 flush 信号，路由依赖 defaultRoute。
 * @returns {{ handler: import("../../core/devices-dag/dag-type.js").DevicesDAGHandler }}
 */
function buildViewportFlushNodeConfig() {
  return {
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();
      return ctx.routeToChild(ctx.defaultRoute || "", [
        ...triggerSignals.map((signal) =>
          ctx.signal("flush", undefined, {
            code: signal?.context?.code,
            key: signal?.context?.key,
            sourceType: signal.type,
          }),
        ),
      ]);
    },
  };
}

/**
 * 构建 WASD 方向键移动 prefix handler
 * @description 将 trigger 信号转为 displacement 信号，附上对应方向向量。
 * @param {string} code - 键位编码（如 "KeyW"）
 * @param {{ x: number, y: number }} vector - 方向向量
 * @returns {{ handler: import("../../core/devices-dag/dag-type.js").DevicesDAGHandler }}
 */
function buildWasdNodeConfig(code, vector) {
  return {
    handler(packet, ctx = {}) {
      const movementSignals = packet.signals
        .filter(
          (signal) =>
            signal.type === SIGNAL_TYPES.TRIGGER ||
            signal.type === SIGNAL_TYPES.TRIGGER_REPEAT,
        )
        .map((signal) =>
          ctx.signal(
            "displacement",
            { ...vector },
            {
              code,
              key: signal?.context?.key,
              sourceType: signal.type,
            },
          ),
        );

      if (movementSignals.length === 0) return ctx.stop();
      return ctx.routeToChild(ctx.defaultRoute || "", movementSignals);
    },
  };
}

/**
 * 构建键盘调试 prefix handler
 * @description 将 trigger 信号转为指定调试类型的信号。type 可以是静态字符串、
 * 动态函数 (signals) => string，或 (signals) => ({ type, context })。
 * @param {string | ((signals: object[]) => string | { type: string, context?: Object })} type - 调试信号类型或解析函数
 * @param {Object} [debugContext={}] - 调试上下文附加数据（默认合并到 signal.context）
 * @returns {{ handler: import("../../core/devices-dag/dag-type.js").DevicesDAGHandler }}
 */
function buildKeyboardDebugNodeConfig(type, debugContext = {}) {
  return {
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();

      const resolved = typeof type === "function" ? type(triggerSignals) : type;
      const signalType =
        typeof resolved === "object" ? resolved.type : resolved;
      const signalContext = {
        ...debugContext,
        ...(typeof resolved === "object" ? resolved.context : undefined),
      };

      return ctx.routeToChild(ctx.defaultRoute || "", [
        ctx.signal(signalType, undefined, signalContext),
      ]);
    },
  };
}

export {
  buildKeyboardDebugNodeConfig,
  buildKeyboardTriggerForwardNodeConfig,
  buildViewportFlushNodeConfig,
  buildViewportPositionNodeConfig,
  buildViewportScaleNodeConfig,
  buildWasdNodeConfig,
};
