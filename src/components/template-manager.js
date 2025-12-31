/**
 * @file 模板管理模块
 * @module template-manager
 * @description 功能:
 * - 模板生命周期管理(创建、读取、更新、删除)
 * - 模板元数据管理
 * - 模板IPC通信
 */

const winManager = require('./window-manager');
const { File, Directory, FilenameRandomPool } = require('../utils/io');

let templatesDir, templatePool;
const templateMeta = {
  type: 'template',
  version: '0.1.0'
};

/**
 * 初始化模板管理器
 * @function init
 * @param {Object} app - Electron应用对象
 */
function init(app) {
  const userDataDir = Directory.parse(app.getPath('userData'));
  templatesDir = userDataDir.cd('data').cd('templates').make();
  templatePool = new FilenameRandomPool(templatesDir);
}

/**
 * 保存模板
 * @function saveTemplate
 * @param {Object} template - 模板对象
 * @param {File} [template.texture] - 纹理文件(当前未使用)
 * @param {string} [template.backgroundColor] - 背景色(十六进制)
 * @param {string} [template.backgroundImage] - 背景图片路径
 * @param {string} template.name - 模板名称
 * @returns {Object} 结果对象
 * @returns {string} [returns.id] - 模板ID
 * @returns {Object} [returns.data] - 模板数据
 * @returns {string} returns.data.name - 模板名称
 */
function saveTemplate(template) {
  const tempDir = templatePool.generate();
  console.log(templatePool.dir);
  const templateID = tempDir.name;

  let templateData = {
    name: template.name,
    background: template.backgroundColor,
    backgroundType: 'solid'
  };

  if (template.backgroundImage) {
    const imgFile = File.parse(template.backgroundImage);
    const destImgFile = tempDir.peek('backgroundImage', imgFile.extension);
    imgFile.cp(destImgFile);
    templateData.background = imgFile.extension;
    templateData.backgroundType = 'image';
  }

  tempDir.peek('meta', 'json').writeJSON(templateMeta);
  tempDir.peek('template', 'json').writeJSON(templateData);

  return {
    id: templateID,
    data: templateData,
    imgFile: tempDir.cd(templateID).peek('backgroundImage', templateData.background)
  };
}

/**
 * 加载所有模板
 * @function loadTemplateAll
 * @returns {Array} 模板数组
 */
function loadTemplateAll() {
  const templateDirs = templatesDir.lsDir().filter(dir => {
    const metaFile = dir.peek('meta', 'json');
    if (!metaFile.exist()) return false;
    return metaFile.catJSON().type === 'template';
  });

  return templateDirs.map(dir => {
    const templateData = dir.peek('template', 'json').catJSON();
    return {
      id: dir.name,
      data: templateData,
      imgPath: dir.peek('backgroundImage', templateData.background).getPath()
    };
  });
}

/**
 * 根据ID加载模板
 * @function loadTemplateByID
 * @param {string} templateID - 模板ID
 * @returns {Object|null} 模板信息对象或null
 */
function loadTemplateByID(templateID) {
  const tempDir = templatesDir.cd(templateID);
  if (!tempDir.exist()) return null;
  const templateData = tempDir.peek('template', 'json').catJSON();
  return {
    id: templateID,
    data: templateData,
    imgPath: tempDir.peek('backgroundImage', templateData.background).getPath()
  };
}

/**
 * 删除模板
 * @function removeTemplate
 * @param {string} templateID - 模板ID
 */
function removeTemplate(templateID) {
  templatePool.remove(templateID);
}

/**
 * 重命名模板
 * @function renameTemplate
 * @param {string} templateID - 模板ID
 * @param {string} newName - 新名称
 * @returns {string} 新模板ID
 */
function renameTemplate(templateID, newName) {
  const newDir = templatePool.rename(templateID);
  const infoFile = newDir.peek('template', 'json');
  let templateJSON = infoFile.catJSON();
  templateJSON.name = newName;
  infoFile.writeJSON(templateJSON);
  return newDir.name;
}

/**
 * 设置模板操作IPC处理器
 * @function setupTemplateOperationIPC
 * @param {Object} ipc - IPC主进程对象
 * @param {Object} windows - 窗口对象集合
 */
function setupTemplateOperationIPC(ipc, windows) {
  ipc.on('new-template-result', (event, result) => {
    const templateInfo = saveTemplate(result);
    windows.NewFile.webContents.send('new-template-adding', {
      info: templateInfo,
      result: result
    });
  });

  ipc.handle('template-load-buttons', async (event, windowNow) => {
    return loadTemplateAll();
  });

  ipc.handle('template-remove', async (event, templateID, windowNow) => {
    removeTemplate(templateID);
    return templateID;
  });

  ipc.handle('template-rename', async (event, templateID, name, windowNow) => {
    const newID = renameTemplate(templateID, name);
    return newID;
  });

  ipc.on('template-edit', (event, templateID) => {
    const info = loadTemplateByID(templateID);
    if (info) {
      const pathStr = File.parse(info.imgPath).unPeek().getPath();
      windows.NewTemplate = winManager.createModalWindow(
        'new-template.html',
        windows.NewFile,
        {
          width: 800,
          height: 600,
          minWidth: 800,
          minHeight: 600
        }
      );
      setTimeout(() => {
        windows.NewTemplate.webContents.send(
          'init-new-template-from-other-template',
          info.data,
          pathStr,
          templateID
        );
      }, 100);
    }
  });

  ipc.on('template-copy', (event, templateID) => {
    const info = loadTemplateByID(templateID);
    if (info) {
      const pathStr = File.parse(info.imgPath).unPeek().getPath();
      windows.NewTemplate = winManager.createModalWindow(
        'new-template.html',
        windows.NewFile,
        {
          width: 800,
          height: 600,
          minWidth: 800,
          minHeight: 600
        }
      );
      setTimeout(() => {
        windows.NewTemplate.webContents.send(
          'init-new-template-from-other-template',
          info.data,
          pathStr,
          null
        );
      }, 100);
    }
  });
}

module.exports = {
  init,
  saveTemplate,
  loadTemplateByID,
  loadTemplateAll,
  removeTemplate,
  renameTemplate,
  setupTemplateOperationIPC
};
