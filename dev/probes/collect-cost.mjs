/**
 * @file 缩小方向静态层的收集成本
 * @description 视口缩到 5% 后测量 collectStaticDrawables 的耗时，用于定位随区块数膨胀的查找路径。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";
const origOff = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = class { constructor(w,h){ const c=createCanvas(w,h); c.transferToImageBitmap=()=>{const s=createCanvas(w,h); s.getContext("2d").drawImage(c,0,0); return s;}; return c; } };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const { ViewportCore } = await import("../../src/renderers/canvas/viewport-core.js");
const { BoardCore } = await import("../../src/kernel/board/board-core.js");
const { StrokeObject } = await import("../../src/kernel/objects/stroke/stroke.js");
const { Vector } = await import("../../src/kernel/utils/math.js");

const W=900,H=700;
const boardCore = new BoardCore({ width: 1024, height: 1024 });
const viewport = new ViewportCore({ boardCore, viewportId: "ab", width: W, height: H, postRenderFrame() {}, tiles: true });
viewport.onViewportChange({ origin:{x:0,y:0}, zoom:1, viewportSize:{width:W,height:H}, force:true });
await new Promise(r=>setTimeout(r,80));
const renderer = viewport.renderer, aom = boardCore.activeObjectManager;
aom.renderHooks = { requestActiveRender(o=[]){renderer.invalidateActiveObjects(o);viewport.markFrameDirty();}, requestStaticRender(c=[]){renderer.invalidateChunks(c);viewport.markFrameDirty();}, requestStaticRenderForObjects(o=[],c=[],p){renderer.invalidateCachedObjects(o,{previousWorldRects:p});viewport.markFrameDirty();}, requestViewportRender(){viewport.markFrameDirty();} };
for (let i=0;i<600;i++){ const points=[]; for(let k=0;k<30;k++) points.push({x:k*3,y:Math.sin(k)*18}); const s=new StrokeObject(i+1,new Vector((i%22)*40,Math.floor(i/22)*40),{color:"#222",width:3},{points}); boardCore.registerObjectInstance(s); aom.add([s]); aom.apply([s]); }
viewport.flushRenderFrame();
viewport.onViewportChange({ origin:{x:0,y:0}, zoom:0.05, viewportSize:{width:W,height:H}, force:true });
viewport.flushRenderFrame();
await new Promise(r=>setTimeout(r,400));
viewport.flushRenderFrame();
const chunks = viewport.chunkLoader.getLoadedChunks().length;
let best = Infinity, sum = 0;
for (let i=0;i<5;i++){ const t=performance.now(); renderer.collectStaticDrawables(); const d=performance.now()-t; best=Math.min(best,d); sum+=d; }
console.log(`已载区块 ${chunks} | collect 中位 ${(sum/5).toFixed(2)}ms | 最快 ${best.toFixed(2)}ms`);
process.exit(0);
