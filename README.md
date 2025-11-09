# WhatsApp Bot React Native App

这是一个在 Android 上运行 WhatsApp Bot 的 React Native 应用。

## 远程构建说明

由于 nodejs-mobile-react-native 不支持在 Windows 上构建，我们使用 GitHub Actions 在 Linux 环境中自动构建。

### 步骤：

1. **创建 GitHub 仓库**（如果还没有）
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/你的用户名/仓库名.git
   git push -u origin main
   ```

2. **触发构建**
   - 方式 1：推送代码到 GitHub 会自动触发构建
   - 方式 2：在 GitHub 仓库页面 -> Actions -> Android Build -> Run workflow（手动触发）

3. **下载 APK**
   - 构建完成后，在 Actions 页面找到你的 workflow run
   - 点击进入，找到 "Artifacts" 部分
   - 下载 `app-debug` 文件
   - 解压后得到 `app-debug.apk`

4. **安装到手机**
   ```bash
   adb install -r app-debug.apk
   ```

### 本地开发（不需要构建）

如果只是修改 JavaScript 代码：

1. 启动 Metro bundler：
   ```bash
   npx react-native start
   ```

2. 在手机上打开应用，摇一摇打开开发者菜单，点击 "Reload"

## 项目结构

- `App.js` - React Native UI
- `nodejs-assets/nodejs-project/main.js` - WhatsApp Bot 核心逻辑
- `nodejs-assets/nodejs-project/Baileys-6.7.21/` - Baileys 库源码

## 配置

### 代理设置

在 `main.js` 中修改代理配置（如果需要）：

```javascript
const proxyUrl = 'socks5h://你的IP:端口';
```

### 浏览器标识

```javascript
browser: Browsers.appropriate('Chrome')
```

## 故障排除

### 405 错误
如果遇到 405 "Method Not Allowed" 错误：
1. 检查 Baileys 版本是否最新
2. 尝试清除认证信息：取消注释 `clearAuthInfo()`
3. 更换浏览器标识

### DNS 超时
如果遇到 DNS 解析超时：
1. 检查网络连接
2. 启用代理配置
3. 检查防火墙设置
