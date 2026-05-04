/**
 * 笔画创建工具
 * @module core/tools/creator/stroke-creator
 * @author Zhou Chenyu
 */

import { StrokeObject } from "../../objects/stroke/stroke.js";
import { SingleGestureObjectCreatorTool } from "./obj-creator.js";

class StrokeCreatorTool extends SingleGestureObjectCreatorTool {
  /**
   * 当前正在创建的笔画对象
   * @type {StrokeObject}
   */
  obj;

  constructor() {
    super();
  }

  create(p, id, pageId) {
    this.obj = new StrokeObject(p, id, pageId);
  }

  beginCreationGesture(interaction) {
    this.obj.setPoints(this.obj.points.concat([interaction.position]));
  }

  updateCreationGesture(interaction) {
    this.obj.setPoints(this.obj.points.concat([interaction.position]));
  }

  completeCreationGesture(interaction) {
    if (interaction.position) {
      this.obj.setPoints(this.obj.points.concat([interaction.position]));
    }
  }

  reset() {
    this.obj = null;
  }
}

export {
  StrokeCreatorTool,
};