/**
 * 笔画创建工具
 * @module core/tools/creator/stroke-creator
 * @author Zhou Chenyu
 */

import { StrokeObject } from "../../objects/stroke/stroke.js";
import { ObjectCreatorTool } from "./obj-creator.js";

class StrokeCreatorTool extends ObjectCreatorTool {
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

  beginObjectCreation(interaction) {
    this.obj.setPoints(this.obj.points.concat([interaction.position]));
  }

  updateObjectCreation(interaction) {
    this.obj.setPoints(this.obj.points.concat([interaction.position]));
  }

  completeObjectCreation(interaction) {
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