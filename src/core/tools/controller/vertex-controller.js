/**
 * 顶点控制杆类
 * @module tools/controller/vertex-controller
 * @author Zhou Chenyu
 */

import { Vector } from "../../../utils/math.js";
import { Controller } from "./controller.js";

/**
 * 顶点控制杆类
 * @class
 * @author Zhou Chenyu
 * @description
 * 顶点控制杆用于对象的顶点调整操作。
 * 通过顶点控制杆，用户可以对对象的顶点进行移动、调整等操作。
 * 顶点控制杆通常附加在对象的顶点上，用户可以通过拖动顶点控制杆来调整对象的形状。
 */
class VertexController extends Controller {
  constructor(position) {
    super(position);
  }

  preAddHandle() {
    const handle = document.createElement("div");
    handle.className = "vertex-controller-handle";
    return handle;
  }
}

export {
  VertexController,
};