# 第三方来源与外部依赖

本存档不是重新许可全部文件的声明。保留原文件版权与许可标记；相关第三方权利仍适用。

| 依赖 | 已观察来源/版本 | 本次范围 |
| --- | --- | --- |
| Coopanion / Cortico | https://github.com/Pal-AI-Lab/Coopanion ，已安装 manifest 为 0.2.8、AGPL-3.0-or-later | 仅当前集成核心 core-output-recovery.ts 与本地扩展源码；完整 vendor runtime 未打包。集成核心包含上游代码，不应将它全部声明为原创。 |
| QQ 扩展 | 原固定独立安装目录，历史运维资料记录 0.2.5 | 未打包；需核对安装来源及兼容性。 |
| SnowLuma | 原本地 SnowLuma v2.1.1 安装目录 | 未打包；需安装并重新登录账号。 |
| DeepSeek Harness | @deepseek-ai/dsh 0.2.1-rc.2，原 D:/Deepseek/app | npm 包与锁文件未打包；只保留本地编写的代理/启动/执行器源码。 |
| DSH 费用记录与诊断模块 | D:/Deepseek/spending-book.mjs、provider-diagnostics.mjs | 两份项目外自有集成源码经脱敏复制到 companion/dsh；源哈希单独记录。 |
| Node.js / Python / cryptography | 由现有本机运行时提供 | 未打包；Node 必须支持原代码使用的 node:sqlite 等能力，Python 恢复工具需要 cryptography。未验证最低版本组合。 |
| 媒体与工作间依赖 | ffmpeg/imageio-ffmpeg、sherpa-onnx、SenseVoice、esbuild、Windows AppContainer | 二进制、模型和安装状态未打包；配置仅保留脱敏示例，不证明已安装。 |
| QQ 表情映射 | companion/qq-face-sources.md 所列公共来源 | 保留公共映射及来源说明；图片素材未打包，不作通用素材许可承诺。 |

现有程序采用 Windows 专用启动与权限机制，仍有绝对路径、固定端口和外部模块导入。
本次未从网络拉取或重新验证第三方源码，以上版本来自本地代码与已安装 manifest。
