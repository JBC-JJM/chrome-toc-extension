# 网页目录阅读器 (TOC Reader)

> 一个油猴脚本（Tampermonkey / Violentmonkey），自动提取网页标题结构，生成悬浮目录面板。

## ✨ 功能特性

- 📋 **自动提取** H1~H6 标题，生成结构化目录
- 🖱️ **点击跳转** 平滑滚动到对应位置
- 🔍 **实时搜索** 快速过滤标题关键词
- 🎯 **滚动高亮** 自动标记当前阅读位置
- 🪟 **拖拽移动** 面板可自由拖拽定位
- 💾 **状态记忆** 记住面板显示/隐藏状态
- 🔄 **SPA 支持** 路由变化时自动刷新目录
- 🌐 **全站适用** 匹配所有 `http/https` 网页

## 📦 安装方式

### 方式一：直接安装（推荐）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 点击 [安装脚本](https://raw.githubusercontent.com/JBC-JJM/chrome-toc-extension/main/toc-reader.user.js)
3. 在弹出页面点击「安装」即可

### 方式二：手动安装

1. 打开 Tampermonkey → 新建脚本
2. 复制 `toc-reader.user.js` 全部内容粘贴进去
3. 保存（Ctrl+S）

## 🚀 使用说明

| 操作 | 说明 |
|------|------|
| 右侧「目录」按钮 | 显示/隐藏目录面板 |
| 点击目录项 | 平滑跳转到对应标题 |
| 搜索框输入 | 实时过滤标题 |
| 拖拽面板顶部 | 移动面板位置 |
| ↺ 刷新按钮 | 重新扫描页面标题 |
| ✕ 关闭按钮 | 隐藏面板 |

## 🖼️ 效果预览

面板默认固定在页面右侧，显示当前页面所有标题层级（H1~H6），滚动时自动高亮当前位置。

## 🛠️ 开发

```bash
git clone https://github.com/JBC-JJM/chrome-toc-extension.git
cd chrome-toc-extension
# 直接编辑 toc-reader.user.js，在浏览器中刷新页面即可看到效果
```

## 📄 License

MIT
