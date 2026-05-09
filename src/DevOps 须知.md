> 已有功能尚未完全迁移，建议开发员优先处理此分支的重构工作。

# 【VIBE】 APP 的文件安全系统已经全面升级，GPT 回复如下：


下面是一份**针对你当前 safe-io + capability token + preload 架构的「开发操作员迁移手册」**，重点不是讲概念，而是让你或团队可以**按步骤安全迁移旧代码到新结构**。

---

# 🧭 safe-io 架构迁移操作员手册（Operator Manual）

版本：v2 capability architecture
适用范围：Electron App（contextIsolation + preload + IPC verify + registry）

---

# 1. 📌 总体迁移目标

## ✔ 目标结构

最终系统必须满足：

```text
Renderer (UI only)
    ↓ safeIO API (preload bridge)
Preload (whitelist + token guard)
    ↓ IPC (strict channels)
Main Process
    ↓ verify + permission + registry
Capability FS / User / Theme / Locale Layer
```

---

## ❌ 必须消除的旧模式

迁移过程中必须清理：

* ❌ window.fileUtils
* ❌ fetch 读取本地文件
* ❌ C:/Users/... 路径逻辑
* ❌ renderer 决定数据来源
* ❌ 直接 fs / node 调用（renderer）
* ❌ “fallback策略写在 UI 层”

---

# 2. 🔐 核心安全原则（必须遵守）

## 原则 A：Renderer 无 IO 权限

Renderer 只允许：

```js
safeIO.user.load()
safeIO.theme.load()
safeIO.locale.load()
```

---

## 原则 B：所有 IO 必须经过 capability token

所有 API 必须满足：

```js
(token) => IPC => verify(token) => handle
```

---

## 原则 C：Preload 是唯一可信桥

preload 只做：

* channel 白名单
* token shape check
* 参数透传

❌ 不做业务逻辑
❌ 不做 fallback
❌ 不做路径判断

---

# 3. 📦 模块迁移清单

## Step 1：UserManager 迁移

### ❌ 删除

```js
fetch(profilePath)
window.fileUtils.readJSON
this.userDataPath
```

### ✔ 改为

```js
await safeIO.user.load(userId, token)
await safeIO.user.save(userId, data, token)
```

---

## Step 2：LocaleManager 迁移

### ❌ 删除

* fetch locale json
* data/locales path
* fallback chain

### ✔ 改为

```js
await safeIO.locale.load(localeId, token)
```

---

## Step 3：ThemeManager 迁移

### ❌ 删除

* CSS主题 JSON fetch
* appdata路径拼接

### ✔ 改为

```js
await safeIO.theme.load(themeId, token)
await safeIO.theme.apply(themeId, token)
```

---

## Step 4：Icon system 迁移

### ✔ 改为统一 capability

```js
await safeIO.icon.load(iconPackId, token)
```

---

# 4. 🔄 数据流规则（必须理解）

## 原系统（危险）

```text
Renderer → fetch/fs → disk
```

问题：

* bypass IPC
* bypass permission
* 无审计

---

## 新系统（安全）

```text
Renderer
  → safeIO API
    → preload whitelist
      → ipcRenderer.invoke
        → verify(token)
          → registry handle
            → FS layer
```

---

# 5. 🔑 Token 使用规则

## 每个 API 调用必须：

```js
const token = getCapabilityToken()
```

然后：

```js
safeIO.user.load("u1", token)
```

---

## ❌ 禁止：

* 缓存 token 结构到 localStorage（长期）
* 在 renderer 伪造 token
* token 拼接字符串

---

# 6. 🧱 Preload 迁移检查表

必须满足：

## ✔ 白名单必须存在

```js
ALLOWED_CHANNELS.includes("user:load")
```

---

## ✔ 每个 domain API 映射

| Domain | Channel     |
| ------ | ----------- |
| user   | user:*      |
| locale | locale:load |
| theme  | theme:*     |
| fs     | fs:*        |

---

## ✔ 不允许

* 动态 channel 拼接
* channel = variable
* passthrough ipcRenderer

---

# 7. 🧪 验收标准（非常重要）

## ✔ Renderer 侧必须满足

* 没有 fetch 本地数据
* 没有路径字符串
* 没有 Node API
* 只调用 safeIO

---

## ✔ IPC 层必须满足

* 所有请求必须 verify(token)
* registry lookup 必须存在
* replay protection 开启

---

## ✔ FS 层必须满足

* 所有路径必须来自 handle
* 不接受 raw string path

---

# 8. ⚠️ 常见迁移错误（重点）

## ❌ 错误1：仍然在 renderer fetch

```js
fetch("./themes/dark.json")
```

👉 修复：移到 theme API

---

## ❌ 错误2：token 不透传

```js
safeIO.user.load(userId)
```

👉 必须：

```js
safeIO.user.load(userId, token)
```

---

## ❌ 错误3：manager 做 IO fallback

```js
fileUtils → fetch → local
```

👉 删除 fallback，全交给 backend

---

## ❌ 错误4：renderer 拼路径

```js
"C:/Users/.../data"
```

👉 完全禁止

---

# 9. 🧭 推荐迁移顺序（很关键）

按风险从低到高：

### 1️⃣ UserManager

### 2️⃣ LocaleManager

### 3️⃣ ThemeManager

### 4️⃣ Icon system

### 5️⃣ FS 全面替换（最高风险）

---

# 10. 🧠 架构总结（操作员必须记住）

一句话：

> Renderer 不再“访问数据”，只“请求能力”

---

# 🚀 如果你下一步要继续升级

你这个架构已经到一个关键点了，下一步通常是：

### 🔥 capability SDK 化（强烈推荐）

把：

```js
safeIO.user.load()
safeIO.theme.load()
```

升级成：

```js
api.user.load()
api.theme.apply()
```

并自动：

* 注入 token
* 自动权限检查
* 类型约束

---

如果你愿意，我可以帮你下一步做：

> 🧠 “完整 capability SDK + 类型系统 + 权限bitmask统一设计”

这会让你的 IPC 系统从“安全”升级到“工程级可扩展平台”。
