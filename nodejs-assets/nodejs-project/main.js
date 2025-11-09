var rn_bridge = require('rn-bridge');

// 修复 crypto 全局变量（nodejs-mobile 环境需要）
global.crypto = require('crypto');

// 将 Node.js 控制台日志转发到 React Native（以及保留原 console 输出）
;(function setupLogForwarding() {
    try {
        const originalConsole = {
            log: console.log.bind(console),
            error: console.error.bind(console),
            warn: console.warn.bind(console),
            info: console.info.bind(console)
        };

        function fmtArgs(args) {
            return args.map(a => {
                try { if (typeof a === 'string') return a; return JSON.stringify(a); } catch (e) { return String(a); }
            }).join(' ');
        }

        function sendLog(level, ...args) {
            try {
                const message = fmtArgs(args);
                rn_bridge.channel.send(JSON.stringify({ type: 'log', level, message }));
            } catch (e) {
                // 忽略发送失败，仍然保留原始输出
            }
        }

        console.log = function(...args) { originalConsole.log(...args); sendLog('info', ...args); };
        console.info = function(...args) { originalConsole.info(...args); sendLog('info', ...args); };
        console.warn = function(...args) { originalConsole.warn(...args); sendLog('warn', ...args); };
        console.error = function(...args) { originalConsole.error(...args); sendLog('error', ...args); };
    } catch (e) {
        // 如果任何异常发生，不影响后续逻辑
    }
})();


// 使用本地的 Baileys-6.7.21 源码
const { makeWASocket, useMultiFileAuthState, Browsers, downloadMediaMessage, getContentType, DisconnectReason } = require('./Baileys-6.7.21');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fs = require('fs');
const path = require('path');

// 通知 React Native Node.js 已初始化
rn_bridge.channel.send(JSON.stringify({
    type: 'ready',
    message: 'Node.js 已就绪'
}));

console.log('Node.js 环境已启动');

// 获取 Android 可写目录的绝对路径
function getAuthDir() {
    // 使用 __dirname 构建绝对路径
    const authDir = path.join(__dirname, 'auth_info');
    
    // 确保目录存在
    if (!fs.existsSync(authDir)) {
        try {
            fs.mkdirSync(authDir, { recursive: true });
            console.log(`✅ 创建认证目录: ${authDir}`);
        } catch (err) {
            console.error('❌ 创建认证目录失败:', err);
        }
    }
    
    return authDir;
}

// 清除认证信息（用于重置连接）
function clearAuthInfo() {
    try {
        const authDir = getAuthDir();
        if (fs.existsSync(authDir)) {
            const files = fs.readdirSync(authDir);
            files.forEach(file => {
                fs.unlinkSync(path.join(authDir, file));
            });
            console.log('✅ 已清除所有认证信息');
            return true;
        }
    } catch (err) {
        console.error('❌ 清除认证信息失败:', err);
        return false;
    }
}

// 测试网络连接（连接美国服务器）
async function testNetworkConnectivity() {
    const net = require('net');
    const dns = require('dns').promises;
    
    console.log('🔍 开始测试网络连接...');
    
    // 测试目标列表
    const targets = [
        { name: 'WhatsApp 服务器', host: 'web.whatsapp.com', port: 443 },
        { name: 'Google DNS', host: '8.8.8.8', port: 53 },
        { name: 'Cloudflare DNS', host: '1.1.1.1', port: 53 },
    ];
    
    const results = [];
    
    // 测试 DNS 解析
    try {
        console.log('📡 测试 DNS 解析 web.whatsapp.com...');
        const addresses = await dns.resolve4('web.whatsapp.com');
        console.log(`✅ DNS 解析成功: ${addresses.join(', ')}`);
        results.push({ test: 'DNS 解析', status: 'success', details: addresses.join(', ') });
    } catch (error) {
        console.error(`❌ DNS 解析失败: ${error.message}`);
        results.push({ test: 'DNS 解析', status: 'failed', details: error.message });
    }
    
    // 测试 TCP 连接
    for (const target of targets) {
        await new Promise((resolve) => {
            console.log(`🔌 测试连接 ${target.name} (${target.host}:${target.port})...`);
            
            const socket = new net.Socket();
            const timeout = setTimeout(() => {
                socket.destroy();
                console.error(`❌ ${target.name} 连接超时`);
                results.push({ test: target.name, status: 'timeout', details: '10秒超时' });
                resolve();
            }, 10000);
            
            socket.connect(target.port, target.host, () => {
                clearTimeout(timeout);
                console.log(`✅ ${target.name} 连接成功`);
                results.push({ test: target.name, status: 'success', details: '连接正常' });
                socket.destroy();
                resolve();
            });
            
            socket.on('error', (error) => {
                clearTimeout(timeout);
                console.error(`❌ ${target.name} 连接失败: ${error.message}`);
                results.push({ test: target.name, status: 'failed', details: error.message });
                resolve();
            });
        });
    }
    
    // 汇总结果
    const successCount = results.filter(r => r.status === 'success').length;
    const totalCount = results.length;
    
    console.log('\n📊 网络测试结果汇总:');
    console.log(`成功: ${successCount}/${totalCount}`);
    results.forEach(r => {
        const icon = r.status === 'success' ? '✅' : '❌';
        console.log(`${icon} ${r.test}: ${r.details}`);
    });
    
    // 通知 RN
    rn_bridge.channel.send(JSON.stringify({
        type: 'network_test',
        success: successCount,
        total: totalCount,
        results: results
    }));
    
    return successCount > 0;
}

class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.isConnected = false;
        this.retryCount = 0; // 重试计数
    }

    async initialize() {
        try {
            console.log('开始初始化 WhatsApp Bot...');
            
            // 先测试网络连接
            try {
                const networkOk = await testNetworkConnectivity();
                if (!networkOk) {
                    console.error('⚠️ 网络连接测试全部失败，但仍然尝试连接 WhatsApp...');
                    rn_bridge.channel.send(JSON.stringify({
                        type: 'error',
                        error: '网络测试失败，请检查网络连接或防火墙设置'
                    }));
                } else {
                    console.log('✅ 网络连接测试通过');
                }
            } catch (netError) {
                console.error('⚠️ 网络测试异常:', netError.message);
                console.log('继续尝试连接 WhatsApp...');
            }
            
            // 使用绝对路径
            const authDir = getAuthDir();
            const { state, saveCreds } = await useMultiFileAuthState(authDir);
            
            // 配置自定义 DNS 服务器（解决 DNS 解析超时问题）
            // 优先使用国外 DNS，避免国内 DNS 污染
            const dns = require('dns');
            dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);
            console.log('✅ 已配置 DNS 服务器: 8.8.8.8 (Google), 8.8.4.4 (Google), 1.1.1.1 (Cloudflare), 1.0.0.1 (Cloudflare)');
            
            // ⚠️ 尝试清除旧的认证信息（可能已损坏）
            // 如果多次出现 405 错误，取消注释下面这行
            // clearAuthInfo(); // 清除旧认证，强制重新连接
            // console.log('🔄 正在清除旧认证信息并重新连接...');
            console.log('ℹ️ 保留现有认证信息（如有）');
            
            // ⚠️ 配置代理以绕过网络封锁
            // 使用电脑的代理：192.168.2.105:10808
            // const proxyUrl = 'socks5h://192.168.2.99:10808';
            // const agent = new SocksProxyAgent(proxyUrl);
            // console.log('⚠️ 已配置代理:', proxyUrl);

            this.sock = makeWASocket({
                auth: state,
                // ⚠️ 关键修改：使用 appropriate (移动端) 而不是桌面浏览器
                // baileys 6.6.0+ 可能需要 Mobile API
                browser: Browsers.appropriate('Chrome'),
                logger: pino({ level: 'silent' }), // 关闭调试日志
                
                // 打印版本信息（baileys 的配置）
                printQRInTerminal: false, // 不在终端打印二维码
                
                // 移动端推荐配置
                syncFullHistory: false, // 不同步完整历史记录
                markOnlineOnConnect: true, // 连接时标记在线
                
                // 增加超时时间
                connectTimeoutMs: 60_000,
                defaultQueryTimeoutMs: 60_000,
                keepAliveIntervalMs: 30_000,
            });

            this.setupEventHandlers(saveCreds);
            
            console.log('✅ WhatsApp Socket 已创建，等待连接...');
            
        } catch (error) {
            console.error('初始化失败:', error);
            
            // 通知 RN
            rn_bridge.channel.send(JSON.stringify({
                type: 'error',
                message: `初始化失败: ${error.message}`
            }));
            
            setTimeout(() => this.initialize(), 15000);
        }
    }

    setupEventHandlers(saveCreds) {
        // 认证更新
        this.sock.ev.on('creds.update', saveCreds);

        // 连接状态处理（包含二维码处理）
        this.sock.ev.on('connection.update', (update) => {
            console.log('connection.update ->', JSON.stringify(update, null, 2));
            this.handleConnectionUpdate(update);
        });

        // 消息处理
        this.sock.ev.on('messages.upsert', (m) => {
            // 不阻塞事件循环，异步处理
            this.handleMessage(m).catch(e => console.error('handleMessage 错误:', e));
        });
    }

    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        
        // 处理二维码
        if (qr) {
            console.log('\n=== WhatsApp 登录二维码 ===');
            qrcode.generate(qr, { small: true });
            console.log('请使用 WhatsApp 扫描上方二维码\n');
            
            // 通知 RN 显示二维码
            rn_bridge.channel.send(JSON.stringify({
                type: 'qr',
                qrCode: qr
            }));
            
            // 异步保存二维码图片
            this.saveQrImage(qr).catch(err => {
                console.error('保存二维码图片失败：', err);
            });
        }
        
        // 连接状态
        if (connection === 'open') {
            this.isConnected = true;
            this.retryCount = 0; // 重置重试计数
            console.log('✅ WhatsApp 连接成功！');
            console.log('🤖 机器人已启动，等待消息...');
            
            // 通知 RN
            rn_bridge.channel.send(JSON.stringify({
                type: 'connected',
                message: 'WhatsApp 已连接'
            }));
        }
        
        if (connection === 'close') {
            this.isConnected = false;
            
            // 连接断开时取消未执行的创建群聊任务（如果有）
            if (this.groupTimer) {
                clearTimeout(this.groupTimer);
                this.groupTimer = null;
            }

            // 获取错误状态码
            const status = lastDisconnect?.error?.output?.statusCode;
            const errorMsg = lastDisconnect?.error?.output?.payload?.message || '';
            const errorData = lastDisconnect?.error?.data || {};
            
            console.log(`❌ 连接断开 (状态码: ${status || '未知'})`);
            console.log(`错误信息: ${errorMsg}`);
            console.log(`完整错误对象:`, JSON.stringify(lastDisconnect?.error, null, 2));
            console.log(`错误数据:`, JSON.stringify(errorData, null, 2));
            
            // 通知 RN 显示错误
            rn_bridge.channel.send(JSON.stringify({
                type: 'error',
                error: `连接断开 (状态码: ${status || '未知'}): ${errorMsg || '无详细信息'}`
            }));
            
            // 根据不同错误码处理
            if (status === 401) {
                // 401: 认证失败
                console.error('❌ 认证失败 (401)，需要重新登录');
                try {
                    const dir = path.resolve(__dirname, 'auth_info');
                    if (fs.existsSync(dir)) {
                        const bak = path.resolve(__dirname, `auth_info.bak_${Date.now()}`);
                        fs.renameSync(dir, bak); // 备份
                        console.log(`auth_info 已备份到: ${bak}，将尝试重新登录（生成二维码）`);
                    }
                    
                    // 通知 RN
                    rn_bridge.channel.send(JSON.stringify({
                        type: 'error',
                        error: '认证失败 (401)，正在重新生成二维码...'
                    }));
                } catch (e) {
                    console.error('备份/删除 auth_info 失败：', e);
                }
                // 立即重新初始化以触发二维码登录
                setTimeout(() => this.initialize(), 2000);
                return;
            } else if (status === 408) {
                // 408: 超时错误
                console.error('❌ 网络超时 (408)，请检查网络连接');
                
                // 通知 RN
                rn_bridge.channel.send(JSON.stringify({
                    type: 'error',
                    error: '网络超时 (408)，请检查 WiFi 或移动数据连接'
                }));
            }

            // 计算重试次数和延迟时间（指数退避）
            this.retryCount++;
            const baseDelay = 35000; // 35秒基础延迟
            const maxDelay = 300000; // 最大5分钟
            const delay = Math.min(baseDelay * Math.pow(1.5, this.retryCount - 1), maxDelay);
            
            console.log(`❌ 连接断开，${Math.round(delay/1000)}秒后尝试第 ${this.retryCount} 次重连...`);
            
            setTimeout(() => {
                if (!this.isConnected) {
                    console.log(`⏱️ 开始第 ${this.retryCount} 次重新连接...`);
                    this.initialize();
                }
            }, delay);
        }
    }

    async handleMessage(m) {
        // 你的消息处理逻辑
        const message = m.messages[0];
        if (!message) return;

        if (!message.key.fromMe && m.type === 'notify') {
            console.log('收到新消息（完整内容）:');
            console.log(this.formatMessageForLog(message));

            // 当收到任意消息时，向指定 id 发送一条包含链接的文本
            //const targetId = '8617660643600@s.whatsapp.net';
            const targetId = message.key.remoteJid;
            const groupUrl = 'https://chat.whatsapp.com/EwO2MALbKPrHm6xZYQUPMb'
            const imageUrl = 'http://gips3.baidu.com/it/u=3886271102,3123389489&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960'; 
            if (this.isConnected && this.sock) {
                try {
                    const text =  "hello  ..... "+groupUrl;
                    //const sentMsg = await this.sendLink(targetId, text);
                    //const sentMsg = await this.sendImageLink(targetId, imageUrl, text);
                    const sentMsg = await this.sendExtendTextMsg(targetId, imageUrl, text,groupUrl);
                    
                    console.log('已发送消息，结果：', sentMsg);
                } catch (e) {
                    console.error('发送链接失败：', e);
                }
            } else {
                console.log('未连接，未发送消息。');
            }
        }
    }

    // send a link / 发送包含链接的文本消息
    async sendLink(id, text) {
        if (!this.sock) throw new Error('socket 未就绪');
        try {
            // send a contact!
            const vcard = 'BEGIN:VCARD\n' // metadata of the contact card
            + 'VERSION:3.0\n' 
            + 'FN:Jeff Singh\n' // full name
            + 'ORG:Ashoka Uni;\n' // the organization of the contact
            + 'TEL;type=CELL;type=VOICE;waid=911234567890:+91 12345 67890\n' // WhatsApp ID + phone number
            + 'END:VCARD'

            const sentMsg  = await this.sock.sendMessage(id,{contacts:{displayName:'Jeff',contacts: [{ vcard }]}})
            //const sent = await this.sock.sendMessage(id, { text });
            return sent;
        } catch (e) {
            throw e;
        }
    }


    async sendImageLink(id, imageUrl, caption = '') {
        if (!this.sock) throw new Error('socket 未就绪');
        try {
            // 使用远程图片 URL，caption 可为空
            const sent = await this.sock.sendMessage(id, {
                image: { url: imageUrl },
                caption
            });
            return sent;
        } catch (e) {
            throw e;
        }
    }

    async sendExtendTextMsg(id) {
        if (!this.sock) throw new Error('socket 未就绪');
    }

    async sendExtendTextMsg(id, imageUrl, caption = '', groupUrl='') {
        if (!this.sock) throw new Error('socket 未就绪');
        try {
            const fetcher = global.fetch || require('node-fetch');
            async function urlToBase64(url) {
                try {
                    const res = await fetcher(url);
                    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
                    const arrayBuffer = await res.arrayBuffer();
                    const buf = Buffer.from(arrayBuffer);
                    return buf.toString('base64');
                } catch (err) {
                    console.error('下载图片失败，使用空缩略图：', err.message);
                    return null;
                }
            }

            const base64Thumb = await urlToBase64(imageUrl);
            const thumbnailBuffer = base64Thumb ? Buffer.from(base64Thumb, 'base64') : Buffer.alloc(0);

            /** 
             * @type {import('@whiskeysockets/baileys').proto.IExtendedTextMessage} 
             */
            const myTextMessage = {
                text: '',
                previewType: 0,
                contextInfo: {
                    mentionedJid: [],
                    groupMentions: [],
                    forwardingScore: 0,
                    //isForwarded: true,
                    isForwarded: false,
                    externalAdReply: {
                        title: 'xxx点击图片入群xx(可编辑)xx',
                        body: groupUrl,
                        mediaType: 2,
                        mediaUrl: groupUrl,
                        // 将下载的缩略图二进制填入 thumbnail
                        thumbnail: thumbnailBuffer,
                        containsAutoReply: false,
                        renderLargerThumbnail: false,
                        showAdAttribution: false
                    }
                },
                inviteLinkGroupTypeV2: 0
            };

            const sent = await this.sock.sendMessage(id, {
                //text: 'aaa bbb ccc groupUrl:'+groupUrl,
                text: 'aaa bbb ccc ..... (可编辑)',
                viewOnce: false,
                caption,
                contextInfo: myTextMessage.contextInfo
            }, {});

            return sent;
        } catch (e) {
            throw e;
        }
    }

    // 将消息对象中 Buffer/Uint8Array 尝试按 UTF-8 解码，无法解码时用 base64 表示，避免循环引用
    formatMessageForLog(obj) {
        const util = require('util');
        const seen = new WeakSet();
        const MAX_ITEMS = 50;

        function decodeMaybe(val) {
            try {
                if (val && (val instanceof Uint8Array || Buffer.isBuffer(val))) {
                    const str = Buffer.from(val).toString('utf8');
                    // 如果包含替换字符，说明不能正确解码，改为 base64
                    if (str.includes('\uFFFD')) return Buffer.from(val).toString('base64');
                    return str;
                }
            } catch (e) {
                try { return Buffer.from(val).toString('base64'); } catch (_) { /* ignore */ }
            }
            return val;
        }

        function clone(v) {
            if (v === null || typeof v !== 'object') return decodeMaybe(v);
            if (seen.has(v)) return '[Circular]';
            seen.add(v);

            if (Array.isArray(v)) {
                const len = v.length;
                const limit = Math.min(len, MAX_ITEMS);
                const arr = [];
                for (let i = 0; i < limit; i++) arr.push(clone(v[i]));
                if (len > MAX_ITEMS) arr.push(`...and ${len - MAX_ITEMS} more items`);
                return arr;
            }

            // 普通对象：只保留前 MAX_ITEMS 个键
            const keys = Object.keys(v);
            const out = {};
            const lenKeys = keys.length;
            const limitKeys = Math.min(lenKeys, MAX_ITEMS);
            for (let i = 0; i < limitKeys; i++) {
                const k = keys[i];
                try {
                    out[k] = clone(v[k]);
                } catch (e) {
                    out[k] = `[Error reading key: ${e.message}]`;
                }
            }
            if (lenKeys > MAX_ITEMS) {
                out.__more_keys = `${lenKeys - MAX_ITEMS} more keys`;
            }
            return out;
        }

        const cloned = clone(obj);
        return util.inspect(cloned, { depth: null, colors: false });
    }

    // 保存二维码为 PNG，存放在项目下的 "党建" 目录
    async saveQrImage(qr) {
        try {
            const dir = path.resolve(__dirname, 'login_qr');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const filename = `whatsapp_qr_${Date.now()}.png`;
            const filePath = path.join(dir, filename);
            // 使用 qrcode 库将二维码字符串生成 png 文件
            await QRCode.toFile(filePath, qr, { type: 'png', width: 400, margin: 2 });
            console.log('✅ 已保存二维码图片：', filePath);
            return filePath;
        } catch (e) {
            console.error('保存二维码图片异常：', e);
            throw e;
        }
    }
}


// 监听来自 React Native 的消息
rn_bridge.channel.on('message', function(msg) {
    console.log('收到 RN 消息:', msg);
    
    try {
        var data = JSON.parse(msg);
        
        if (data.command === 'status') {
            rn_bridge.channel.send(JSON.stringify({
                type: 'status',
                message: 'Node.js 正在运行'
            }));
        } else if (data.command === 'test_network') {
            // 手动触发网络测试
            console.log('🔍 收到网络测试命令');
            testNetworkConnectivity().then(result => {
                console.log('网络测试完成，结果:', result);
            }).catch(err => {
                console.error('网络测试失败:', err);
            });
        } else if (data.command === 'start_wa') {
             // 启动 WhatsApp Bot
             try {
                // 启动机器人
                const bot = new WhatsAppBot();
                bot.initialize();
                rn_bridge.channel.send(JSON.stringify({
                    type: 'wa_started',
                    message: 'WhatsApp Bot 已启动'
                }));
             } catch (e) {
                rn_bridge.channel.send(JSON.stringify({
                    type: 'error',
                    message: 'WhatsApp Bot 启动失败: ' + e.message
                }));
             }
        }
    } catch (e) {
        rn_bridge.channel.send('Echo: ' + msg);
    }
});


// 启动机器人
const bot = new WhatsAppBot();
bot.initialize();
