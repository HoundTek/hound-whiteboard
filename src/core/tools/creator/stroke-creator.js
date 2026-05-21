/**
 * 笔画创建工具
 * @module core/tools/creator/stroke-creator
 * @author Zhou Chenyu
 */

import { StrokeObject } from "../../objects/stroke/stroke.js";
import { SingleGestureObjectCreatorTool } from "./obj-creator.js";
import { Vector } from "../../utils/math.js";

/**
 * 笔画创建工具类
 * @class
 * @extends SingleGestureObjectCreatorTool
 * @description
 * 笔画创建工具允许用户在白板上绘制笔画对象。
 * 用户可以通过拖动来定义笔画的路径。
 * @author Zhou Chenyu
 */
class StrokeCreatorTool extends SingleGestureObjectCreatorTool {
  /**
   * 当前正在创建的笔画对象
   * @type {StrokeObject}
   */
  obj;

  constructor() {
    super();
  }

  create(p, id, ownerChunkId) {
    this.obj = new StrokeObject(p, id, ownerChunkId);
  }

  /**
   * 将世界坐标转换为对象局部坐标
   * @param {Vector} position
   * @returns {Vector}
   */
  toLocalPoint(position) {
    return position.sub(this.obj.position);
  }

  beginCreationGesture(interaction) {
    this.obj.setPathPoints(
      this.obj.localPathRange.points.concat([this.toLocalPoint(interaction.position)]),
    );
  }

  updateCreationGesture(interaction) {
    this.obj.setPathPoints(
      this.obj.localPathRange.points.concat([this.toLocalPoint(interaction.position)]),
    );
  }

  completeCreationGesture(interaction) {
    if (interaction.position) {
      this.obj.setPathPoints(
        this.obj.localPathRange.points.concat([
          this.toLocalPoint(interaction.position),
        ]),
      );
    }
  }

  reset() {
    this.obj = null;
  }
}

export { StrokeCreatorTool };
