# QQ原生表情名称来源与范围

此表只解释 OneBot `face` 段的数字编号；名称不是对发送者心情、语气或意图的判断，也不是动作授权。`sface`、`bface`、`mface`、商城图片及普通Unicode表情不套用数字face映射。

2026-10-28核对本机已安装来源：

- SnowLuma `@snowluma/runtime` 2.1.1 的 `data/sys-face-catalog.json`（schemaVersion 1）。安装包 `index.mjs` 的 `bindSystemFaceCatalog` 通过 `JsonSysFaceCatalogStorage` 读取该文件，并在QQ会话建立后预热目录。采用文件中数字 `qSid` 与 `qDes` 的准确对应，移除名称前的单个 `/`；不把 `emCode` 或 `qCid` 当作OneBot face编号。
- 固定 `cortico-world-qq` 0.2.5 的 `src/qface-map.ts` 提供已有275条NapCat QSid/QDes兼容名称。当前桥接目录没有覆盖的108个旧编号继续作为兼容兜底，未因目录差异删除原有理解。

桥接目录共403个包内条目、367个唯一qSid；其中68项的qSid是Unicode emoji，均排除出数字face表。数字编号299个，与旧表合并为407个，新增132个。重复包条目没有出现同一数字编号不同名称的歧义。当前目录的181名为“戳一戳”、317名为“菜汪”；旧“骚扰”“菜狗”保留在aliases，主名称以当前桥接为准。

确切本地源文件SHA256、目录原始fetchedAt、固定包版本、过滤计数和映射版本记录在 `qq-face-map.json`。这是已安装目录的快照，不能声称覆盖所有未来QQ表情或所有客户端；以后更新必须重新核对来源。陌生数字编号保留原编号、名称未知，不采用聊天段自报name/summary补猜。非法编号、Unicode qSid、浮点和超长值不归一成已知表情。

`qq-segment-details.mjs` 统一输出 `native-face`、规范化face_id、准确名称、来源版本及未知状态；它不下载表情、读取图像或把原生face变成图片附件。群/私聊段、已解析的来源内引用和转发历史节点应复用这一描述；原始发送人、引用对象、历史作者及动作权限仍由各自可信传输链决定。
