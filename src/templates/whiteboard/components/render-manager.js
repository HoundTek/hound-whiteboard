/**
 * @file 渲染模块
 * @module render-manager
 * @description 功能:
 * - 将 Quark 转为 ctx 操作
 * - 处理多边形渲染
 * - 处理图像渲染
 * - 处理文字渲染
 */

class RenderManager {
  constructor(canvas) {
    this.canvas = canvas;
  }

  /**
   * @param {Object} quark - 被序列化后的 quark
   * @param {"solidPolygon" | "img" | "text"} quark.type - quark 的类型
   * @param {Object} quark.position - 位置
   * @param {number} quark.position.x - 横坐标
   * @param {number} quark.position.y - 纵坐标
   * @param {number[2][2]} quark.transform - transform 矩阵
   * @param {string} quark.mixture - 混合模式
   * @param {string} quark.color - 颜色 (solidPolygon, text)
   * @param {number} quark.size - 文本大小 (text)
   * @param {string} quark.text - 文本文字 (text)
   * @param {string} quark.font - 文本字体 (text)
   * @param {number} quark.width - 图片宽度 (img)
   * @param {number} quark.height - 图片高度 (img)
   * @param {string} quark.src - 图片路径 (img)
   * @param {number[][]} quark.points - 多边形顶点集 (solidPolygon)
   * @example
   * // 欲渲染多边形
   * renderQuark({
   *   type: "solidPolygon",
   *   position: { x: 100, y: 100 },
   *   mixture: "source-over",
   *   points: [[0, 0], [100, 100], [0, 100]],
   *   color : "#000000"
   * });
   *
   * @example
   * // 欲渲染图片
   * renderQuark({
   *   type: "img",
   *   position: { x: 100, y: 100 },
   *   transform: [[1, 0], [0, 1]],
   *   mixture: "source-over",
   *   src: "/home/zhouc_yu/Pictures/Wallpapers/archbtw.png",
   *   width: 1920,
   *   height: 1200
   * });
   *
   * @example
   * // 欲渲染文字
   * renderQuark({
   *   type: "text",
   *   position: { x: 100, y: 100 },
   *   transform: [[1, 0], [0, 1]],
   *   mixture: "source-over",
   *   text: "This is an example text.",
   *   font: "Noto Sans CJK SC",
   *   size: 24,
   *   color: "#000000"
   * });
   * @author Steven & Zhou Chenyu
   */
  renderQuark(quark) {
    console.log(quark);
    const ctx = this.canvas.getContext("2d");
    ctx.save();
    const { type, position, transform, mixture } = quark;
    ctx.setTransform(
      transform ? transform[0][0] : 1,
      transform ? transform[1][0] : 0,
      transform ? transform[0][1] : 0,
      transform ? transform[1][1] : 1,
      position.x,
      position.y
    );
    console.log(transform);
    ctx.globalCompositeOperation = mixture;
    if (type === "solidPolygon") {
      const { points, color } = quark;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      console.log("move to ", points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        console.log("line to ", points[i][0], points[i][1]);
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.fillStyle = color;
      ctx.closePath();
      ctx.fill();
    } else if (type === "img"){
      const { src, width, height } = quark;
      const img = new Image();
      img.src = src;
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
      };
    } else if (type === "text") {
      const { text, font, size, color } = quark;
      ctx.font = `${size}px ${font}`;
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
    }
    ctx.restore();
  }

  /**
   * 
   * @param {BasicObject} obj - 要渲染的对象
   */
  renderObject(obj) {
    const quarks = obj.getQuarks();
    quarks.forEach((quark) => {this.renderQuark(quark.serialize());});
  }
};

module.exports = RenderManager;
