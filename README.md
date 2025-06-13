# OVH 抢购面板

## 📸 界面预览

### 主面板
![主面板](https://raw.githubusercontent.com/coolci/OVH/main/UI/MAIN.png)

### 服务器列表
![服务器列表](https://raw.githubusercontent.com/coolci/OVH/main/UI/SERVERS.png)

### 抢购队列
![抢购队列](https://raw.githubusercontent.com/coolci/OVH/main/UI/QUEUE.png)

### 抢购历史
![抢购历史](https://raw.githubusercontent.com/coolci/OVH/main/UI/HISTORY.png)

### 抢购日志
![抢购日志](https://raw.githubusercontent.com/coolci/OVH/main/UI/LOG.png)

### API设置
![API设置](https://raw.githubusercontent.com/coolci/OVH/main/UI/API.png)

## ⚙️ 配置说明

运行之前请修改以下文件中的 API 配置：

1. 在 `/src/pages` 目录下
2. 在 `/src/context` 目录下

找到以下代码：
```javascript
// Backend API URL (update this to match your backend)
const API_URL = 'http://localhost:5000/api';
```

修改为你的实际服务器地址：
```javascript
const API_URL = 'http://你的服务器IP:5000/api';
```

## 📝 注意事项

- 请确保服务器 IP 地址正确
- 确保服务器端口 5000 已开放
- 确保 API 服务正常运行
