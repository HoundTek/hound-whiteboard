# CLI 文档

本文档提供 Hound Whiteboard 命令行前端（`src/cli/`）的概述与使用说明：写操作经当前 owner 执行（daemon RPC 或 GUI owner 的本地 RPC），读操作可经 daemon 查询或直读板文件，全程 Node 环境，不依赖 Worker 与渲染管线。

> [!NOTE]
>
> **当前状态**：daemon 管理（start/hold/release/stop/status，按 name 注册表寻址，引用计数模型）、`create` 离线建板、`.hwb` 打包（export/import）、十五个板命令、daemon 连接与直读双寻址、GUI owner claim 与本地 owner RPC 端点（GUI 自己落盘，relay 只管跨机）、`--json` 输出契约、并发安全（RPC 串行队列 + 持板侧原子 id 分配）与端到端测试均已落地。

## 定位

CLI 是白板的**第二前端**：写命令（add/delete/undo/redo/choose/unchoose/modify）经当前 owner 的 WebSocket RPC 执行（daemon owner 走 daemon RPC；GUI owner 走本地 owner RPC，请求携带 CLI source）；读命令（info/list/show/inspect/ops/tree/choices）既可经 daemon 查询，也可 `--path` 直读板文件（零写盘）。

## daemon 与注册表

每块板由一个 **owner** 独占持有并落盘：GUI 打开板时是 owner；无 GUI 时 daemon 可以成为 owner。daemon 有 **owner / proxy 两态**：无活 owner 时它 claim 板目录、持板落盘并开 WebSocket RPC；GUI 持盘时它不写盘，只把 CLI RPC 转发给 GUI owner。daemon 有全局唯一的 **name**（字符集 `[A-Za-z0-9._-]`，不含中文），启动时登记到注册表 `~/.hound-whiteboard/daemons/<name>.json`（条目含 name/rootPath/pid/port/source/boardId/mode/refCount/startedAt），停止时注销。

### 引用计数

daemon 进程内维护引用计数（创建者引用 1）：

| 动作                                         | 计数                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `daemon start`（新创建） | 初始 1（创建者引用，需 release 释放） |
| `daemon start`（同名同板已存活，幂等）       | +1（重复 start 是"增加持有"而非报错）                                          |
| `hwb daemon release --name <名>`             | -1；归零 → daemon 自动退出                                                     |
| `hwb daemon stop --name <名>`                | 强制归零、无条件关闭                                                           |

- **start 幂等**：重复 `start`（同名同板）是引用 +1 而非报错——误操作（不知情地两次 start）不会被打断，也不会被一次 release 误关；同名不同板报错；同板不同名在 GUI owner 持盘时允许（启动 proxy），在 daemon owner 持盘时拒绝
- 自洽性：CLI hold 持有引用时 release 不会把 daemon 降到 0，daemon 不会中途消失
- refCount 不持久化：daemon 重启/僵尸覆盖后重置为 1；注册表条目镜像当前值供 `status` 展示
- CLI 短命令不计数（用之前确保 daemon 在，用完不持有）

```bash
hwb daemon start --name board1 --path ~/boards/a [--source 身份] [--relay ws://...] [--board-id 房间]
hwb daemon status [--name board1]        # 显示 refCount；省略 name 列出全部（含僵尸条目）
hwb daemon start --name board1 --path ~/boards/a   # 同名同板已存活：引用 +1（幂等，不重启）
hwb daemon release --name board1         # 引用 -1，归零自动退出
hwb daemon stop --name board1            # 强制归零关闭
```

- **后台启动**：`daemon start` 以 detached 子进程拉起 daemon 并等待就绪（注册表条目出现 + 端口可连通）后立即返回，终端可继续使用
- **唯一性**：board 目录的写权由 `.owner.json` owner claim 标记（ownerId/pid/source/transport/claimedAt）；name 与存活 daemon 重复拒绝；活 daemon owner 存在时拒绝第二个 daemon；活 GUI owner 存在时启动 proxy daemon。僵尸条目（进程已死）可覆盖。启动窗口由板目录 owner 锁 `.owner.lock` 互斥（O_EXCL 抢锁、持有者 pid 判活、死 pid 的 stale 锁自动回收），并发 start 只有一个进程能进入，启动完成后锁即释放
- **板必须已存在**：先用 `create` 离线建板，再 `daemon start`
- **强制关闭**：`daemon stop` 无条件关闭；关闭过程 single-flight，进入关闭状态即拒绝新任务，随后排空已接收任务、落盘（owner 模式）并清理板目录 `.owner.json`（仅 owner 模式）与注册表条目。重复 shutdown 与信号触发等待同一清理承诺。
- **中继**：仅 owner 模式连中继（`--relay`）；proxy 模式不连 relay，GUI owner 自己直连 relay。`--board-id` 指定 relay 房间，决定与其他端会合；省略时取板目录路径

### GUI owner 与 daemon 代理

GUI 打开持久化板时经 Rust `start_owner_rpc` claim 板目录并开本地 owner RPC 端点（host/port/token）；GUI 自己落盘，不再探测/spawn/连接 daemon。CLI `--path` 经该端点读写，请求携带 CLI source；owner 端按 source 切换 `HitCommitter`，CLI 的 undo/redo 只作用于自己的操作。CLI `--daemon <name>` 可启动 proxy daemon，由它把 RPC 转发给 GUI owner；proxy 不写 `.owner.json`，daemon 停止后 GUI claim 不受影响。已有活 daemon owner 时 GUI 开板失败，提示先停止对应 daemon。GUI 正常关窗走销毁路径，停止 owner RPC 并释放 claim；宿主进程被强杀时 claim 端口探测会判 stale，下次开板可回收。本机端（CLI/TUI/MCP/GUI）之间不走 relay；relay 只承载跨机协作。

## 命令寻址

- **写命令**（add/delete/undo/redo/choose/unchoose/modify）：`--daemon <name>` 经 daemon RPC；`--path` 先探测当前 owner，daemon owner 同走 RPC，GUI owner 走本地 owner RPC（带 token 与 CLI source），无 owner 时自治直写自己分片
- **读命令**（info/list/show/inspect/ops/tree/choices）：`--daemon <name>` 经 daemon 查询，或 `--path <板目录>` 直读板文件（不接 daemon），二选一且互斥
- **create**：离线建板，只认 `--path`
- `--daemon` 与 `--path` 同时给出时报错

## 板路径与数据参数

- **板路径**：`--path` 支持 `~` 家目录展开（如 `--path ~/hound-whiteboard/test-board`）。读命令直读时板目录必须存在（板标志文件 `board.json`）；`daemon start` 时板必须已存在
- **--data**：`add` 的 `--data` 必传（StrokeObject 无默认数据）；传 JSON 字符串（shell 转义麻烦时）或以 `@` 开头传 JSON 文件路径，如 `--data @stroke.json`（PowerShell 中需加引号 `"@stroke.json"`；文件路径支持 `~` 展开）。宽松 JSON 解析兼容裸属性名、单引号与裸字符串值（PowerShell 吃掉内嵌双引号后的 `{color: #000}` 这类形态）；布尔/null/数字不受影响。
- **--property**：`add` 与 `modify` 的样式属性（颜色/线宽等，如 `--property '{color: #f00, width: 3}'`）；与 `--data`（几何数据，如 points）分开传入。
- **undo 目标**：`undo [<操作id>]` 可显式指定撤销目标（`info` 输出的 `chain` 列表，如 `dev-b57m/op-1`）；省略时各撤各的，只撤销本端最近操作。daemon 身份跨重启稳定（见下文"通用标志"的 `--source`），撤销非本端最近的操作仍需显式传操作 id。

```bash
# 终端 1：建板并启动 daemon
$ hwb create --path ~/hound-whiteboard/test-board --width 800 --height 600
$ hwb daemon start --name board1 --path ~/hound-whiteboard/test-board --relay ws://127.0.0.1:8377 --board-id demo-board

# 终端 2：写操作经 daemon，读操作可直读
$ hwb add --daemon board1 --type StrokeObject --data "@stroke.json"
$ hwb list --path ~/hound-whiteboard/test-board
$ hwb info --daemon board1
$ hwb undo --daemon board1
```

## 命令面

```text
hwb <命令> [--daemon <名> | --path <板目录>] [--标志 值]
```

| 命令                                                                                                  | 说明                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `daemon start --name <名> --path <板目录> [--source <身份>] [--relay <中继地址>] [--board-id <房间>]` | 后台启动持板 daemon；同名同板已存活时引用 +1（幂等）                                                                                                                     |
| `daemon release --name <名>`                                                                          | 引用 -1；归零则 daemon 自动退出                                                                                                                                          |
| `daemon stop --name <名>`                                                                             | 强制归零关闭（无条件，清理 `.owner.json` 与注册表条目）                                                                                                                  |
| `daemon status [--name <名>]`                                                                         | 查单个 daemon（name/refCount/板目录/端口/身份/启动时间/存活）；省略 name 列出全部                                                                                        |
| `create --path <板目录> [--width 800] [--height 600]`                                                 | 离线创建空板；板目录已存在时报错                                                                                                                                         |
| `export --path <板目录> --out <文件.hwb>`                                                             | 导出板为 .hwb（zip 平铺，board.json 在根；不含 .owner.json 等运行时标记）                                                                                                |
| `import <文件.hwb> --path <板目录>`                                                                   | 导入 .hwb 建板（校验 zip 内 board.json 与 formatVersion；目标须为空/不存在）                                                                                             |
| `info`                                                                                                | 打印板元数据与统计（板配置、记录数、HEAD、活动链 chain、对象/trash 计数、id 计数器）                                                                                     |
| `list`                                                                                                | 列出活动对象（id、类型）与 trash 条目                                                                                                                                    |
| `show <对象id>`                                                                                       | 打印单个对象的序列化数据                                                                                                                                                 |
| `inspect <对象id...>`                                                                                 | 打印对象诊断详情：AOM 成员身份、引用计数、覆盖区块与几何数据快照                                                                                                         |
| `add --type <类型> [--data '<json>' \| "@文件"] [--property '<json>'] [--position x,y]`               | 创建并提交对象，打印新对象 id（写命令）                                                                                                                                  |
| `delete <对象id...>`                                                                                  | 删除对象（移入 trash，可撤销；写命令）                                                                                                                                   |
| `undo [<操作id>]` / `redo`                                                                            | 撤销 / 重做一步（写命令）                                                                                                                                                |
| `ops [--source 来源] [--type 类型] [--limit N]`                                                       | 打印操作记录明细（id/type/source/time/parentId/supraOpId/molId/supraId/discard/properties/payload）                                                                      |
| `tree`                                                                                                | 以缩进树打印时间回溯树（HEAD 与已撤销分支标记、重做栈；聚合节点以 `{choose+modify+unchoose}` 花括号包裹、多对象分子节点以方括号包裹、discard 型成员带 `(discard)` 后缀） |
| `choose <对象id...> --choice <名>`                                                                    | 把对象选入命名 choice（AOM 命名选择注册表权威；同一对象同时只属一个 choice；写命令）                                                                                     |
| `choices`                                                                                             | 列出全部 choice 及成员状态（驻留标 active；未恢复种子标 active:false）                                                                                                   |
| `unchoose <名> (--apply\|--discard)`                                                                  | 结束一个 choice：--apply 提交修改 / --discard 放弃修改（写命令）                                                                                                         |
| `modify <对象id> <修改标志>`                                                                          | 修改单对象；未选中时自动 choose→modify→commit 超分子会话，闭合折叠为一个聚合节点（写命令）                                                                               |
| `modify --choice <名> <修改标志>`                                                                     | 修改 choice 成员；增量逐对象换算，全量仅单成员 choice 允许（写命令）                                                                                                     |

修改标志：

- `--displacement dx,dy`：位置增量（choice/单对象均可）
- `--transform-delta a,b,c,d`：变换增量，左乘当前变换（choice/单对象均可）
- `--position x,y` / `--transform a,b,c,d` / `--property '<json>'` / `--data '<json>'|"@文件"`：全量（choice 仅单成员允许）

通用标志：

- `--daemon <名>`：目标 daemon（写命令优先；读命令与 `--path` 二选一）
- `--path <板目录>`：读命令直读板文件（零写盘）；写命令链路见下文"会话生命周期"；`create` 与 `daemon start` 指定板位置
- `--source <来源>`：daemon 启动时的协作身份（省略时按注册表 name→source 映射解析：首启生成 `daemon-*` 并持久化，重启后身份稳定），决定新对象 id 前缀（`<source>/<n>`）与操作记录 source
- `--json`：输出为纯 JSON（见下文输出契约）
- `-h` / `--help`：打印帮助（`hwb help <命令>` 查看单命令详情，见下文"帮助与国际化"）；`--version`：打印版本号
- `--width` / `--height`：仅 `create` 建板时生效

`--type` 取对象注册表中的类型名：`StrokeObject`、`CircleObject`、`EllipseObject`、`PolygonObject`。

## 帮助与国际化

帮助分两层：**总览**（`hwb help` / `hwb --help` / `hwb -h`）按分组列出全部命令；**单命令帮助**（`hwb help <命令>` / `hwb <命令> --help` / `hwb <命令> -h`）给出该命令的用法行、说明、标志表与示例。daemon 子命令视为帮助主题：`hwb help daemon` 列出子命令，`hwb help daemon start` 或 `hwb daemon start --help` 展示子命令细节。

CLI 全部用户可见文本（帮助、错误消息、状态输出）走消息字典，语言跟随系统环境：`HWB_LANG` > `LC_ALL` > `LC_MESSAGES` > `LANG`，`zh` 前缀用中文，其余（含未设置）用英文；`HWB_LANG=zh_CN` / `HWB_LANG=en_US` 可显式覆盖。字典在 `src/cli/locales/`（`zh-CN.js` 为权威 key 集，缺 key 回退中文）；命令帮助的结构化 spec 在 `src/cli/help.js`（总览与单命令帮助均由其生成，单一事实来源）。

## .hwb 板包格式

`.hwb` 是板的单文件交换格式（zip 容器，后缀为 .hwb）：

- **内容**：zip 平铺板目录布局——`board.json` 在 zip 根，`objects/`、`trash/`、`hit/`、`chunks/` 与 `.cli-choices.json`（choice 种子）原样打包；`.owner.json`、锁文件与旧 `.daemon.json` 是运行时标记，不导出
- **导出**：`hwb export --path <板目录> --out foo.hwb`，离线读操作（不接 daemon），对 daemon 正在持有的板同样安全（写操作响应前均已落盘）
- **导入**：`hwb import foo.hwb --path <板目录>`，校验 zip 内 `board.json` 存在且 `formatVersion` 与当前版本一致，目标目录须为空或不存在；导入后即是一块可被 `daemon start` 持有的新板
- **格式版本**：随 `board.json` 的 `formatVersion` 字段（当前 1），跨版本导入报错

## 输出契约

所有命令支持 `--json` 标志，输出分两种模式：

- **默认（人类可读）**：`create` 输出 `板已创建：<路径>`；`export`/`import` 输出 `已导出/已导入：<路径>`；`daemon start/stop/status` 输出状态文本；`info` 输出板配置/记录/活动链/计数行；`list` 输出对象与 trash 行列表；`show` 输出 `id 类型` 标题加数据，`inspect` 每个对象一行状态摘要加详情 JSON；`ops` 每条记录一行；`tree` 输出缩进回溯树；`undo`/`redo`/`delete`/`choose`/`unchoose`/`modify` 输出 `xxx ok（...）` 文本；`add` 输出单行对象 id（脚本捕获用）。
- **`--json`（纯 JSON）**：所有命令 stdout 只输出一个可整体 `JSON.parse` 的结构——`info`/`list`/`show`/`inspect`/`ops`/`choices` 输出查询面原始结构，`tree` 输出回溯树原始结构，`daemon status` 输出条目（含 `alive`），`export`/`import` 输出 `{"out"|"root", ...}`，`add` 输出 `{"id": ...}`，`undo`/`redo` 输出 `{"undone" 或 "redone" 布尔, "targetNodeId"}`，`delete` 输出 `{"deleted": [...]}`，`modify` 输出 `{"objectId" 或 "choice", "committed" 或 "pending"}`，`unchoose` 输出 `{"choice", "action", "dropped"}`。

错误一律经 stderr 打印并以退出码 1 结束，不混入 stdout。

> [!NOTE]
>
> 带 `--json` 的输出一定是 JSON；不带 `--json` 的输出一定是人类可读文本（`add` 的单行 id 视为文本）。脚本化使用请显式传 `--json`。

## choice 与查改语义

choice 是命名选择（类比 GUI 里多套互不相干的选择）。**AOM 的命名选择注册表是权威状态**：在册成员必然在板上且处于活动状态。同一对象同时只属一个 choice（choose 新 choice 时自动从旧 choice 摘出）。choice 名不可为空、不可含 `/`、不可以 `~` 开头（`~` 是匿名选择的保留名）；不同端的同名 choice 互不相同（内核以 `"{source}/{choice}"` 形态区分）。

choose/unchoose 的日志记录均携带 choice 名，活动事件仅 choose 携带（unchoose/commit 按来源与对象注销）：全量重建（INIT / 哈希校验兜底）后远程端仍能看到对端的 choice 名。命名迁移（已活动对象改挂别的 choice）只经活动事件传播，不产生新记录。

板目录的 `.cli-choices.json`（临时文件 rename 原子写）是**重启种子**而非运行时真相：daemon 重启后注册表随进程丢失，`choices` 以 `active:false` 标注未恢复的 choice，首次 `modify --choice` 触发自愈重选（携带 choice 名）重建注册表。

modify 的两条路径（写命令均经 daemon，语义统一为驻留）：

- **choice 路径**：增量标志逐成员换算（读各自当前值计算新值），修改驻留 AOM 活动对象（GUI 可实时看到选中与变化），`unchoose --apply` 一次性提交（修改与取消选择分子同属一个超分子，闭合折叠为一个聚合节点）。
- **单对象路径**：对象未选中时自动执行 choose→modify→commit 超分子会话（成员记录即时物化挂 supraId，endSupra 折叠为一个聚合节点）；对象已属某 choice 时按该 choice 语义修改（成员归属先查注册表，未驻留回退文件种子）。

choice 全量修改（--position/--transform/--property/--data）仅单成员 choice 允许；多成员 choice 请用增量标志。

## 会话生命周期

- **写命令**：`--daemon` 按 name 查注册表 → 连 owner daemon → 经 RPC 执行（owner 侧同步完成 + 响应前落盘）→ 断开；`--path` 先探测当前 owner：daemon owner 同走 RPC，GUI owner 经 token 连接本地 owner RPC（请求携带 CLI source），无 owner 时**自治**：自己加载（对象直读 + 各流归并）→ 执行 → 落自己分片（`hit/<cli-*>/` + `meta/<cli-*>.json` + 影响的对象文件）→ 关闭。自治身份取 `~/.hound-whiteboard/cli-identity.json`（首启生成 `cli-*` 持久化）
- **读命令直读**：CLI 进程内开 BoardApi 会话加载板（`writeMeta:false` 保持零写盘）→ 查询 → flush（指纹种子保证零写盘）→ 关闭。这个形态使每次直读都走一遍恢复路径——撤销、trash、id 续号在跨进程场景下的正确性被持续检验

## 关键设计点

- **并发安全**：持板侧 id 分配原子化（`addObject` 的计数上报在异步让出前完成），daemon 的 RPC 经串行队列逐个执行（invoke + 落盘不交错），关闭前排空 in-flight——多 CLI 并发不撞号、不丢操作
- **读命令零写盘**：直读会话挂接时以盘上对象、trash 条目、区块元数据与板元数据为调和种子（种子形状即 `loadAll` 的输出形状，trash 条目 id 在 `entry.data.id`），板元数据按排序指纹比对，值不变不落盘
- **板上配置优先**：`boardConfig.width/height` 是**区块边长**（决定盘上区块划分），重开时以 `board.json` 为准
- 白板没有尺寸概念：世界无限，`width/height` 只描述存储与载入的粒度，默认 1024，创建后不可更改
- **协作身份贯穿**：`--source` 在 daemon 启动时注入（省略时按注册表 name→source 映射分配独立 `daemon-*` 身份，不继承 GUI 身份——双写端不同 source，撞号结构性排除）；操作记录 source、Core 侧 id 子命名空间与对象 id 池同前缀；id 池计数经 `reportObjectIdCounter` 随板元数据持久化，跨进程续号

## 设计约束

- 无交互与渲染能力：CLI 面向文档操作，不表达视口、选择与 overlay 状态
- 写路径由 owner 独占（布局 v2）：owner 写日志流与对象文件（AOM 活动性仲裁）；GUI owner 写全部来源流，CLI daemon owner 写其负责的流。非 owner 不直接写目录，读命令直读已落盘状态，与 owner 无竞态
- daemon 是 CLI 的 owner/代理：写命令经 owner RPC（快路径）；无 owner 时 CLI 自治直写自己分片（慢路径，零依赖）；GUI owner 经本地 owner RPC 直连
- `--chunk-width` / `--chunk-height` 只在建板时生效；改区块边长会让盘上区块归属全部错位，因此创建后不可更改

## 相关文档

- [store-document.md](../../kernel/store/docs/store-document.md)
- [file-structure.md](../../docs/file-structure.md)
- [board-api-rpc-document.md](../../host/bridges/docs/board-api-rpc-document.md)
- [src/io/README.md](../../io/README.md)
