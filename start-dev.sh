#!/bin/bash
# PhotoTree 本地开发环境启动脚本

echo "🚀 启动 PhotoTree 本地开发环境..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js"
    exit 1
fi

# 检查数据库环境变量
if [ -z "$DATABASE_URL" ]; then
    echo "⚠️  未设置 DATABASE_URL 环境变量"
    echo "提示: 请在 .env 文件中配置数据库连接信息"
    echo ""
fi

# 进入后端目录
cd backend

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 启动后端服务
echo "🔥 启动后端服务 (端口 3000)..."
npm start &
BACKEND_PID=$!

# 等待后端启动
sleep 3

# 打开管理后台
echo ""
echo "📊 打开管理后台..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open admin/index.html
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open admin/index.html
fi

echo ""
echo "✅ 启动完成！"
echo ""
echo "🌐 前端地址: http://localhost:3000"
echo "📊 管理后台: 已在浏览器中打开"
echo ""
echo "按 Ctrl+C 停止服务..."

# 等待用户中断
wait $BACKEND_PID
