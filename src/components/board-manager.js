/**
 * @file 白板管理模块
 * @module board-manager
 * @description 功能:
 * - 白板生命周期管理(创建、打开、保存)
 * - 页面管理
 * - 模板应用
 */

const winManager = require('./window-manager');
const { FilenameRandomPool, Directory, File } = require('../utils/io');

let templatesDir;

/**
 * 白板元数据常量
 */
const boardMeta = {
  type: 'board',
  version: '0.1.0'
};

/**
 * 页面元数据常量
 */
const pageMeta = {
  type: 'page',
  version: '0.1.0'
};

/**
 * 初始化白板管理器
 * @function init
 * @param {Object} app - Electron应用对象
 */
function init(app) {
  templatesDir = new Directory(app.getPath('userData'), 'data').cd("templates").existOrMake();
}

/**
 * 创建空白白板
 * @function createEmptyBoard
 * @param {Object} boardInfo - 白板信息
 * @param {string} boardInfo.filePath - 白板文件路径
 * @param {string} boardInfo.templateID - 要应用的模板ID
 * @param {number} boardInfo.width - 白板的宽度
 * @param {number} boardInfo.height - 白板的高度
 */
function createEmptyBoard(boardInfo) {
  // 创建根目录
  const boardFile = File.parse(boardInfo.filePath);
  const tempDir = new Directory(boardFile.address, boardFile.name).rmWhenExist().make();

  // [FIXME] 不应在此处创建文件结构，而应由 BoardManager 负责。

  // 创建元数据文件
  tempDir.peek("meta", "json").writeJSON(boardMeta);
  tempDir.peek("config", "json").writeJSON({
    width: boardInfo.width,
    height: boardInfo.height,
  });

  // 创建页面目录
  tempDir.cd("pages").make();

  // 生成第一页
  const pagePool = new FilenameRandomPool(tempDir.cd("pages"));
  const firstPageDir = pagePool.generate();
  const firstPageID = firstPageDir.name;

  // 创建页面元数据和数据
  firstPageDir.peek("meta", "json").writeJSON(pageMeta);
  firstPageDir.cd("assets").make();
  firstPageDir.peek("page", "json").writeJSON({
    strokes: [],
    assets: []
  });

  // 创建页面列表
  tempDir.peek("pages", "json").writeJSON([
    {
      templateID: boardInfo.templateID,
      pageID: firstPageID
    }
  ]);

  // 复制模板资源
  tempDir.cd("templates");
  templatesDir.cd(boardInfo.templateID)
              .cp(tempDir.cd("templates").cd(boardInfo.templateID));

  // 压缩并隐藏临时目录
  tempDir.compress(boardFile, false);
  tempDir.hide();
}

/**
 * 向白板添加新页面
 * @function addPage
 * @param {FilenameRandomPool} pool - 文件名随机池实例
 * @param {string} templateID - 要应用的模板ID
 * @returns {Object} 结果对象
 * @returns {FilenameRandomPool} pool - 更新后的文件名随机池
 * @returns {string} pageID - 新页面ID
 */
function addPage(pool, templateID) {
  const newPageDir = pool.generate();

  // 创建页面元数据和数据
  newPageDir.peek('meta', 'json').writeJSON(pageMeta);
  newPageDir.peek('page', 'json').writeJSON({
    strokes: [],
    assets: []
  });
  newPageDir.cd('assets').make();

  return {
    pool: pool,
    pageID: newPageDir.name
  };
}

/**
 * 打开白板文件
 * @function openBoard
 * @param {File} boardFile - 要打开的.hwb文件
 * @returns {BrowserWindow} 浏览器窗口实例
 */
function openBoard(boardFile) {
  let win = winManager.createFullScreenWindow('whiteboard');

  const fileDir = new Directory(boardFile.address, boardFile.name);
  Directory.getHideResult(fileDir).rmWhenExist();

  // 提取并隐藏临时目录
  const tempDir = boardFile.extract(fileDir).hide();

  // 加载完成后发送路径到渲染进程
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('board-opened', tempDir.getPath());
  });
  return win;
}

/**
 * 保存白板
 * @function saveBoard
 * @param {Directory} boardDir - 要保存的白板目录
 */
function saveBoard(boardDir) {
  const boardFile = new File(boardDir.address, boardDir.name.substring(1), 'hwb').rmWhenExist();
  boardDir.compress(boardFile, true);
}

module.exports = {
  openBoard,
  saveBoard,
  createEmptyBoard,
  addPage,
  init
};
