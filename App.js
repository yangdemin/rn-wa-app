import React, {useEffect, useState} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Button,
  ScrollView,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import nodejs from 'nodejs-mobile-react-native';

function App() {
  const [messages, setMessages] = useState([]);
  const [nodeStatus, setNodeStatus] = useState('Starting...');
  const [qrCode, setQrCode] = useState(null); // 存储二维码数据

  useEffect(() => {
    // 启动 Node.js 进程
    nodejs.start('main.js');
    
    // 监听来自 Node.js 的消息
    nodejs.channel.addListener('message', (msg) => {
      console.log('Message from Node.js raw:', msg);
      // Node 端我们统一发送 JSON 字符串，兼容旧的纯文本回显
      try {
        const data = JSON.parse(msg);
        if (data && data.type === 'log') {
          const text = `[NODE ${data.level}] ${data.message}`;
          // 将日志追加到界面
          setMessages(prev => [...prev, text]);
          // 同时把日志抛给 RN 的 console，这样会出现在 Metro 和 logcat 中
          console.log(text);
        } else if (data && data.type === 'ready') {
          setMessages(prev => [...prev, `Node.js: ${data.message}`]);
          setNodeStatus('Node.js is ready');
        } else if (data && data.type === 'wa_started') {
          setMessages(prev => [...prev, `WhatsApp Bot: ${data.message}`]);
        } else if (data && data.type === 'status') {
          setMessages(prev => [...prev, `Status: ${data.message}`]);
        } else if (data && data.type === 'network_test') {
          // 网络测试结果
          const summary = `🌐 网络测试: ${data.success}/${data.total} 成功`;
          setMessages(prev => [...prev, summary]);
          data.results.forEach(r => {
            const icon = r.status === 'success' ? '✅' : '❌';
            setMessages(prev => [...prev, `${icon} ${r.test}: ${r.details}`]);
          });
        } else if (data && data.type === 'error') {
          // 错误消息
          setMessages(prev => [...prev, `❌ 错误: ${data.error || data.message}`]);
        } else if (data && data.type === 'qr') {
          // 二维码 - 显示在界面上
          setMessages(prev => [...prev, `📱 收到二维码，请扫描登录 WhatsApp`]);
          setQrCode(data.qrCode); // 保存二维码数据用于显示
          console.log('二维码数据:', data.qrCode);
        } else if (data && data.type === 'connected') {
          // 连接成功 - 清除二维码
          setMessages(prev => [...prev, `✅ ${data.message}`]);
          setQrCode(null);
        } else {
          // 未知的结构化消息，展示 JSON
          setMessages(prev => [...prev, `Node.js: ${JSON.stringify(data)}`]);
        }
      } catch (e) {
        // 不是 JSON，按旧行为直接展示
        setMessages(prev => [...prev, `Node.js: ${msg}`]);
        if (msg === 'Node was initialized.') {
          setNodeStatus('Node.js is running!');
        }
      }
    });

    // 清理函数
    return () => {
      nodejs.channel.removeAllListeners('message');
    };
  }, []);

  const sendMessage = () => {
    const msg = `Hello from React Native at ${new Date().toLocaleTimeString()}`;
    nodejs.channel.send(msg);
    setMessages(prev => [...prev, `React Native: ${msg}`]);
  };

  const startWhatsApp = () => {
    nodejs.channel.send(JSON.stringify({
      command: 'start_wa'
    }));
    setMessages(prev => [...prev, `React Native: 发送启动 WhatsApp 命令`]);
  };

  const testNetwork = () => {
    nodejs.channel.send(JSON.stringify({
      command: 'test_network'
    }));
    setMessages(prev => [...prev, `React Native: 开始网络测试...`]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.title}>WhatsApp Bot</Text>
        <Text style={styles.status}>{nodeStatus}</Text>
        
        {/* 显示二维码 */}
        {qrCode && (
          <View style={styles.qrContainer}>
            <Text style={styles.qrTitle}>📱 请使用 WhatsApp 扫描二维码登录</Text>
            <View style={styles.qrCodeWrapper}>
              <QRCode
                value={qrCode}
                size={250}
                color="black"
                backgroundColor="white"
              />
            </View>
            <Text style={styles.qrHint}>打开 WhatsApp → 设置 → 已连接的设备 → 连接设备</Text>
          </View>
        )}
        
        <View style={styles.buttonContainer}>
          <Button title="发送消息" onPress={sendMessage} />
          <View style={styles.buttonSpacer} />
          <Button title="启动 WhatsApp" onPress={startWhatsApp} color="#25D366" />
        </View>
        
        <View style={styles.buttonContainer}>
          <Button title="🌐 测试网络连接" onPress={testNetwork} color="#007AFF" />
        </View>
        
        <ScrollView style={styles.messageContainer}>
          <Text style={styles.subtitle}>Messages:</Text>
          {messages.map((msg, index) => (
            <Text key={index} style={styles.message} selectable={true}>
              {msg}
            </Text>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  body: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
    textAlign: 'center',
  },
  status: {
    fontSize: 16,
    color: '#28a745',
    marginBottom: 20,
    textAlign: 'center',
  },
  qrContainer: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#25D366',
    marginBottom: 15,
    textAlign: 'center',
  },
  qrCodeWrapper: {
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 15,
  },
  qrHint: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 10,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  buttonSpacer: {
    width: 10,
  },
  messageContainer: {
    flex: 1,
    marginTop: 20,
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  message: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});

export default App;
