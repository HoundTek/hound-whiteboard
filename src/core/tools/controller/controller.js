/**
 * 控制杆基类
 * @module core/tools/controller/controller
 * @author Zhou Chenyu
 */

import { Vector } from "../../../utils/math.js";

/**
 * 控制杆基类
 * @class
 * @author Zhou Chenyu
 * @description
 * 控制杆用于对象的调整和变换操作。
 * 通过控制杆，用户可以对对象进行缩放、旋转等操作。
 * 控制杆通常附加在对象的边界上，用户可以通过拖动控制杆来调整对象的属性。
 *
 * 控制杆的具体实现应继承此类并实现其特定功能。
 * 控制杆应包括位置、类型等属性。由前端根据对象的类型和状态动态生成控制杆的 React 组件。
 *
 * 基于闭包传入实现具体的交互逻辑。
 * @abstract
 */
class Controller {
  /**
   * 控制杆位置
   * @type {Vector}
   */
  position;

  /**
   * 控制杆的 DOM 元素
   * @type {HTMLDivElement}
   */
  handle;

  /**
   * @constructor
   * @param {Vector} position - 控制杆位置
   */
  constructor(position) {
    this.position = position;
  }

  /**
   * @param {Vector} position
   */
  setPosition(position) {
    this.position = position;
    this.onDrag?.(position);
  }

  /**
   * 拖动事件的回调函数，当用户拖动控制杆时调用该函数，并传入新的位置。
   * @type {(newPosition: Vector) => void}
   */
  onDrag;

  /**
   * 创建并返回控制杆的 DOM 元素
   * @returns {HTMLDivElement} 控制杆的 DOM 元素
   * @description 在 addHandle 之前调用。
   */
  preAddHandle() {
    const handle = document.createElement("div");
    handle.className = "controller-handle";
    return handle;
  }

  /**
   * 创建并返回控制杆的把手，添加到指定的 HTML 元素中。
   * @param {HTMLElement} htmlElement - 把手将被添加到的 HTML 元素
   * @returns {HTMLDivElement} 控制杆的把手
   * @description 把手只能添加一次。重复调用会移除之前的把手并创建一个新的把手。
   * 把手的位置会根据控制杆的位置进行设置，并且会添加简单的拖动事件监听器来更新控制杆的位置。
   */
  addHandle(htmlElement) {
    if (this.handle) {
      // 如果控制杆已经存在，则先移除旧的控制杆
      this.handle.remove();
    }
    this.handle = this.preAddHandle();

    this.handle.style.left = `${this.position.x}px`;
    this.handle.style.top = `${this.position.y}px`;

    // 简单的拖拽事件
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    this.handle.addEventListener("mousedown", (e) => {
      isDragging = true;
      offsetX = e.offsetX;
      offsetY = e.offsetY;
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const newX = e.clientX - offsetX;
      const newY = e.clientY - offsetY;
      this.handle.style.left = `${newX}px`;
      this.handle.style.top = `${newY}px`;
      this.setPosition(new Vector(newX, newY));
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      document.body.style.userSelect = "";
    });

    htmlElement.appendChild(this.handle);
    return this.handle;
  }
}

export {
  Controller,
};
