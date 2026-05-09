# Hound Whiteboard UI 组件库

基于 React 的 UI 结构性重构组件库。

## 结构

```
src/ui/
├── components/
│   └── App.jsx           # 示例应用
├── utils/
│   ├── structures/       # 结构组件
│   │   ├── DynamicRowList.jsx
│   │   ├── DynamicColumnList.jsx
│   │   ├── DynamicGrid.jsx
│   │   ├── ResponsiveSplitLayout.jsx
│   │   ├── Pagination.jsx
│   │   └── index.js
│   └── templates/        # 模板组件
│       ├── Text.jsx
│       ├── Icon.jsx
│       ├── IconWithText.jsx
│       ├── DisplayBox.jsx
│       ├── DisplayBoxWithText.jsx
│       ├── MenuButton.jsx
│       ├── FloatingCapsuleSwitcher.jsx
│       └── index.js
├── styles/
│   ├── components.css
│   └── index.css
└── index.html            # 入口文件
```

## 组件说明

### 结构组件

- **DynamicRowList**: 动态行列表，支持水平排列并自动换行
- **DynamicColumnList**: 动态列列表，支持垂直排列
- **DynamicGrid**: 动态网格，单元格自适应宽度
- **ResponsiveSplitLayout**: 响应式分割布局，根据屏幕宽度自动切换水平/垂直排列
- **Pagination**: 分页组件，支持页码导航

### 模板组件

- **Text**: 文本组件，支持多种大小和样式
- **Icon**: 图标组件
- **IconWithText**: 大图标下方居中显示文字
- **DisplayBox**: 展示框组件
- **DisplayBoxWithText**: 展示框下方居中显示文字
- **MenuButton**: 带菜单的展示按钮
- **FloatingCapsuleSwitcher**: 浮动胶囊/贴壁切换器

## 使用方法

直接在浏览器中打开 `src/ui/index.html` 即可查看示例。
