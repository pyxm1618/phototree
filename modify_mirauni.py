import re

# 读取文件
filepath = "/home/deploy/mirauni/backend/src/controllers/paymentController.js"
with open(filepath, "r") as f:
    content = f.read()

# 检查是否已经添加过
if "Phototree 转发逻辑" in content:
    print("已经添加过转发逻辑，跳过")
    exit(0)

# 1. 在文件开头添加 axios import（如果没有的话）
if "import axios from 'axios'" not in content:
    content = "import axios from 'axios';\n" + content

# 2. 找到 handleWechatNotify 函数并在开头添加转发逻辑
# 匹配箭头函数格式：export const handleWechatNotify = async (req, res) => {
pattern = r"(export\s+const\s+handleWechatNotify\s*=\s*async\s*\(\s*req\s*,\s*res\s*\)\s*=>\s*\{)"
forwarding_code = r'''\1
  // === Phototree 转发逻辑（新增）===
  if (req.query.app === 'phototree' && req.query.target) {
    try {
      const targetUrl = decodeURIComponent(req.query.target);
      if (!targetUrl.startsWith('https://aiguess.cn')) {
        productionLogger.warn('非法转发目标', { targetUrl });
        return res.status(200).json({ code: "SUCCESS", message: "OK" });
      }
      productionLogger.info('[Phototree] 转发回调', { targetUrl });
      axios.post(targetUrl, req.body, {
        headers: { ...req.headers, 'x-forwarded-from': 'mirauni' },
        timeout: 3000
      }).catch(err => productionLogger.error('[Phototree] 转发失败', { error: err.message }));
      return res.status(200).json({ code: "SUCCESS", message: "OK" });
    } catch (error) {
      productionLogger.error('[Phototree] 转发异常', { error: error.message });
      return res.status(200).json({ code: "SUCCESS", message: "OK" });
    }
  }
  // === Mirauni 原有逻辑 ===
'''

new_content = re.sub(pattern, forwarding_code, content, count=1)

if new_content == content:
    print("未找到 handleWechatNotify 函数，请检查")
    exit(1)

# 写回文件
with open(filepath, "w") as f:
    f.write(new_content)

print("✅ 转发逻辑添加成功！")
