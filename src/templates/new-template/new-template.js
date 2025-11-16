/**
 * @file 新建模板
 * @description 功能:
 * - 模板背景配置（纯色/图片）
 * - 纹理选择
 * - 模板预览
 * - 模板创建确认
 */

const { directory } = require('../../utils/io');

const Toast = require('../../utils/ui/toast');
const toast = new Toast();

// DOM 元素
const chooseTextureBtn = document.getElementById('new-template-foreground-import');
const solidOpt = document.getElementById('new-template-background-options-solid');
const imageOpt = document.getElementById('new-template-background-options-image');
const imagePath = document.getElementById('new-template-background-options-image-text');
const color = document.getElementById('new-template-background-options-color');
const nameInput = document.getElementById('new-template-name-template-input');
const previewScreen = document.getElementById('new-template-preview-screen');
const imageChooseBtn = document.getElementById('new-template-background-options-image-upload');
const confirmBtn = document.getElementById('yes-or-no-button-yes');
const cancelBtn = document.getElementById('yes-or-no-button-no');

/**
 * 模板创建结果对象
 * @type {Object}
 * @property {string} texture - 所选纹理路径
 * @property {string} backgroundColor - 背景颜色（如果是纯色）
 * @property {string} backgroundImage - 背景图片路径（如果是图片）
 * @property {string} name - 模板名称
 */
let result = {
  texture: null,
  backgroundColor: null,
  backgroundImage: null,
  name: null
};

let backgroundImage = '';
let deleteID = null;

// 初始化预览
previewScreenFlush();

/**
 * 根据当前设置更新预览屏幕
 * @function previewScreenFlush
 */
function previewScreenFlush() {
  if (imageOpt.checked) {
    previewScreen.style.background = `url("${backgroundImage.replace(/\\/g, "\\\\")}") no-repeat center center/cover`;
    result.backgroundImage = backgroundImage;
  } else if (solidOpt.checked) {
    previewScreen.style.background = color.value;
    result.backgroundColor = color.value;
  }
}

/**
 * 通过闪烁元素来应用视觉反馈
 * @function blink
 * @param {HTMLElement} element - 要应用闪烁效果的元素
 */
function blink(element) {
  element.classList.add('blinking');
  setTimeout(() => element.classList.remove('blinking'), 500);
}

// 背景选项更改监听器
solidOpt.addEventListener('change', () => {
  previewScreenFlush();
});

imageOpt.addEventListener('change', () => {
  previewScreenFlush();
});

/**
 * 图片选择的 IPC 事件监听器
 * @event image-choose
 * @listens HTMLElement#click
 */
imageChooseBtn.addEventListener('click', async () => {
  const result = await ipc.invoke('open-img-file', 'NewTemplate');
  if (result) {
    imagePath.innerHTML = result[0];
    backgroundImage = result[0];
    if (!imageOpt.checked) {
      imageOpt.checked = true;
    }
    previewScreenFlush();
  }
});

/**
 * 纹理选择的 IPC 事件监听器
 * @event texture-choose
 * @listens HTMLElement#click
 */
chooseTextureBtn.addEventListener('click', async () => {
  const result = await ipc.invoke('open-hmq-file', 'NewTemplate');
  if (result) {
    // TODO: 实现纹理系统
    previewScreenFlush();
  }
});

color.addEventListener('change', () => {
  if (solidOpt.checked) {
    previewScreenFlush();
  }
});

/**
 * 取消按钮的 IPC 事件监听器
 * @event cancel-click
 * @listens HTMLElement#click
 */
cancelBtn.addEventListener('click', () => {
  ipc.send('close-window', 'NewTemplate');
});

/**
 * 确认按钮的 IPC 事件监听器
 * @event confirm-click
 * @listens HTMLElement#click
 */
confirmBtn.addEventListener('click', async () => {
  result.texture = chooseTextureBtn.value;

  if (nameInput.value === '') {
    nameInput.focus();
    blink(nameInput);
    toast.warning('请输入样式名');
    return;
  }

  result.name = nameInput.value;

  if (deleteID) {
    await ipc.invoke('template-remove', deleteID, 'NewFile');
  }

  ipc.send('new-template-result', result);
  ipc.send('close-window', 'NewTemplate');
});

/**
 * 从现有模板初始化模板的 IPC 事件监听器
 * @event init-new-template-from-other-template
 * @listens ipc#init-new-template-from-other-template
 * @param {Object} templateInfo - 源模板信息
 * @param {string} pathStr - 模板目录路径
 * @param {string} prevID - 要删除的先前模板 ID（可选）
 */
ipc.on('init-new-template-from-other-template', (event, templateInfo, pathStr, prevID) => {
  nameInput.value = templateInfo.name;
  result.name = nameInput.value;

  if (templateInfo.backgroundType === 'solid') {
    solidOpt.checked = true;
    color.value = templateInfo.background;
  } else {
    imageOpt.checked = true;
    backgroundImage = directory.parse(pathStr)
      .peek('backgroundImage', templateInfo.background)
      .getPath();
  }

  deleteID = prevID;
  previewScreenFlush();
});
