# 在自己的电脑运行后端与网页

需要 Node.js 22 或更新版本（推荐 Node.js 24 LTS）和 Git。无需 Python、Docker、数据库或模型 API Key，就能启动当前模拟游戏。

## 一次启动后端和网页

在终端 / PowerShell 中执行：

```bash
git clone https://github.com/panzersaikou/FX_BATTLER.git
cd FX_BATTLER
npm ci
npm run build
npm start
```

保持这个终端开着，然后在同一台电脑的浏览器打开 **http://127.0.0.1:3001**。

`npm run build` 生成网页文件；`npm start` 启动后端，并由它提供网页和 `/api` 接口。不需要另开前端服务器，也不要双击 `dist/index.html`。这与下载的单文件离线 HTML 是两种运行方式：只有连接这个后端的网页可以调用外部 Agent。

停止服务按 **Ctrl+C**；下次仍在项目根目录执行 `npm start` 即可。修改前端或更新代码后，重新运行 `npm run build`，再启动。

## 稍后启用 Agent

把根目录 `.env.example` 复制成 `.env`。macOS / Linux：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

在编辑器中打开 `.env`，按供应商填写，去掉这些项前面的 `#`：

```dotenv
AGENT_API_KEY=你的实际密钥
AGENT_BASE_URL=https://api.openai.com/v1
AGENT_MODEL=实际可调用的模型名称
AGENT_MODE=external
```

这里的基地址是 OpenAI 的示例；其他兼容服务填写自己的基地址，不能填网页聊天地址，也不需追加 `/chat/completions`。

保存后 Ctrl+C 停止服务，再运行 `npm start`，刷新网页并开启新局。世界导演会显示配置状态。没有密钥时仍可用本地导演正常玩。

`.env` 已被 Git 忽略；密钥只配置到你自己的后端，不填写到网页或提交到 GitHub。供应商格式差异、输出参数和限额见 [Agent 接入说明](event-director.md)。

## 开发时自动刷新

需要边改代码边看效果，可以改用：

```bash
npm run dev
```

然后打开 **http://127.0.0.1:5173**。该命令同时启动前端 5173 和后端 3001，前端自动代理 API。不要同时运行 `npm start` 和 `npm run dev`，两者都需要后端端口 3001。

## 检查是否运行成功

浏览器打开 **http://127.0.0.1:3001/api/health** 应看到 JSON，其中 `ok` 为 `true`。`agent: "unconfigured"` 只表示尚未配置模型，不影响本地游戏；`configured` 表示配置已加载，并不证明远端认证成功。

- `node` / `npm` 不是有效命令：安装 Node.js 后重新打开终端。
- `EADDRINUSE`：已有程序占用 3001。先停止之前启动的服务；也可在 `.env` 修改 `PORT`，并使用对应网页地址。开发模式的 Vite 代理默认仍指向 3001，修改端口时需同步代理。
- 页面 404：确认从项目根目录执行过 `npm run build`，再重启 `npm start`。
- 外部 Agent 按钮不可用：检查 `.env` 文件位置、Key/模型名是否填写及是否重启，并阅读界面的配置提示。
- 模型任务降级：查看世界导演的失败原因，核对供应商、模型权限、输出格式和联网条件。

会话目前保存在后端内存，重启会丢失；代码上传 GitHub 不会自动运行后端，也不会自动把游戏部署到公网。默认仅监听本机。需要他人联网使用时，应另外处理部署、认证、持久化和访问入口。
