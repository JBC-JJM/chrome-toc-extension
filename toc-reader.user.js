// ==UserScript==
// @name         网页目录阅读器 (TOC Reader)
// @namespace    https://github.com/JBC-JJM/chrome-toc-extension
// @version      1.6.0
// @description  自动提取网页标题结构，生成悬浮目录面板，支持点击跳转、折叠展开、拖拽移动、智能主题、百度翻译
// @author       JBC-JJM
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      fanyi-api.baidu.com
// @connect      fanyi.baidu.com
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/tocbot/4.18.2/tocbot.min.js
// ==/UserScript==

(function () {
  'use strict';

  // ─── 常量 ────────────────────────────────────────────────────────────────────
  const PANEL_ID = 'toc-reader-panel';
  const TOGGLE_ID = 'toc-reader-toggle';
  const STORAGE_KEY = 'toc_reader_visible';
  const THEME_KEY = 'toc_reader_theme';
  const POSITION_KEY = 'toc_reader_position';
  const COLLAPSE_KEY = 'toc_reader_collapse';
  const SIZE_KEY = 'toc_reader_size';
  const TOGGLE_POS_KEY = 'toc_reader_toggle_pos';
  const BAIDU_APPID_KEY = 'toc_reader_baidu_appid';
  const BAIDU_SECRETKEY_KEY = 'toc_reader_baidu_secretkey';

  let isTranslated = false;
  let translatedData = {};

  // ─── 站点特定配置 ────────────────────────────────────────────────────────────
  const SITE_SETTINGS = {
    'jianshu.com': { contentSelector: '.ouvJEz', scrollSmoothOffset: -20 },
    'zhuanlan.zhihu.com': { contentSelector: 'article', scrollSmoothOffset: -52 },
    'www.zhihu.com': { contentSelector: '.reader-chapter-content', scrollSmoothOffset: -52 },
    'mp.weixin.qq.com': { contentSelector: '.rich_media_content', scrollSmoothOffset: -20 },
    'cnodejs.org': { contentSelector: '#content', scrollSmoothOffset: -20 },
    'juejin.cn': {
      contentSelector: () => location.pathname.includes('/book/') ? '.book-body' : '.article',
      scrollSmoothOffset: -20
    },
    'dev.to': { contentSelector: 'article', scrollSmoothOffset: -56 },
    'medium.com': { contentSelector: 'article' },
    'github.com': {
      contentSelector: () => {
        const selectors = ['.entry-content', '#wiki-body', '.comment .comment-body'];
        return selectors.find(s => document.querySelector(s)) || null;
      },
      scrollSmoothOffset: -60
    },
    'developer.mozilla.org': { contentSelector: '#content' },
    'docs.djangoproject.com': { contentSelector: '#docs-content' },
    'www.cnblogs.com': { contentSelector: '#main' },
    'vuejs.org': { contentSelector: 'main > div' },
    'reddit.com': { contentSelector: '[data-testid="post-container"]', scrollSmoothOffset: -20 },
  };

  function getSiteConfig() {
    const hostname = location.hostname;
    const setting = SITE_SETTINGS[hostname];
    if (!setting) return null;
    return setting;
  }

  // ─── 样式注入 ─────────────────────────────────────────────────────────────────
  const TOCReaderStyle = `
    /* ── 悬浮按钮 ── */
    #${TOGGLE_ID} {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: 999999;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      border: none;
      border-radius: 8px 0 0 8px;
      padding: 10px 6px;
      cursor: move;
      font-size: 13px;
      font-weight: 600;
      writing-mode: vertical-rl;
      letter-spacing: 3px;
      box-shadow: -2px 0 12px rgba(99,102,241,0.4);
      transition: all 0.25s cubic-bezier(.4,0,.2,1);
      user-select: none;
    }
    #${TOGGLE_ID}:hover {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      padding-right: 10px;
      box-shadow: -4px 0 20px rgba(99,102,241,0.5);
    }
    #${TOGGLE_ID}.dragging { cursor: grabbing; opacity: 0.8; }

    /* ── 面板主体 ── */
    #${PANEL_ID} {
      position: fixed;
      top: 60px;
      right: 16px;
      width: 280px;
      height: 60%;
      min-width: 200px;
      min-height: 200px;
      max-width: 520px;
      max-height: 90vh;
      z-index: 999998;
      background: var(--toc-bg, #ffffff);
      border: 1px solid var(--toc-border, rgba(0,0,0,0.08));
      border-radius: 12px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      font-size: 13px;
      color: var(--toc-text, #1f2937);
      overflow: hidden;
      transition: opacity 0.25s cubic-bezier(.4,0,.2,1), transform 0.25s cubic-bezier(.4,0,.2,1), background 0.3s, border-color 0.3s;
    }
    #${PANEL_ID}.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(24px) scale(0.97);
    }

    /* ── 深色主题 ── */
    #${PANEL_ID}[colorscheme="dark"] {
      --toc-bg: #1a1b2e;
      --toc-border: rgba(255,255,255,0.08);
      --toc-text: #e5e7eb;
      --toc-muted: #6b7280;
      --toc-item-hover: rgba(99,102,241,0.12);
      --toc-item-active: rgba(99,102,241,0.2);
      --toc-active-color: #a5b4fc;
      --toc-header-bg: linear-gradient(135deg, #312e81, #4338ca);
      --toc-scrollbar: #374151;
      --toc-overlay: rgba(0,0,0,0.6);
      --toc-modal-bg: #1f2237;
    }

    /* ── 亮色主题变量 ── */
    #${PANEL_ID}[colorscheme="light"] {
      --toc-bg: #ffffff;
      --toc-border: rgba(0,0,0,0.08);
      --toc-text: #1f2937;
      --toc-muted: #9ca3af;
      --toc-item-hover: rgba(99,102,241,0.06);
      --toc-item-active: rgba(99,102,241,0.12);
      --toc-active-color: #4f46e5;
      --toc-header-bg: linear-gradient(135deg, #6366f1, #8b5cf6);
      --toc-scrollbar: #e5e7eb;
      --toc-overlay: rgba(0,0,0,0.35);
      --toc-modal-bg: #ffffff;
    }

    /* ── 自定义调整大小手柄 ── */
    .toc-resize-handle {
      position: absolute;
      right: 0; bottom: 0;
      width: 18px; height: 18px;
      cursor: nwse-resize;
      z-index: 10;
    }
    .toc-resize-handle::before,
    .toc-resize-handle::after {
      content: '';
      position: absolute;
      border-radius: 1px;
      transition: opacity 0.2s;
    }
    .toc-resize-handle::before {
      right: 4px; bottom: 4px;
      width: 8px; height: 1.5px;
      background: var(--toc-muted, #9ca3af);
      transform: rotate(-45deg);
    }
    .toc-resize-handle::after {
      right: 4px; bottom: 4px;
      width: 5px; height: 1.5px;
      background: var(--toc-muted, #9ca3af);
      transform: rotate(-45deg);
      bottom: 7px; right: 2px;
    }
    .toc-resize-handle:hover::before,
    .toc-resize-handle:hover::after { opacity: 1; background: var(--toc-active-color, #6366f1); }

    /* ── 头部 ── */
    .toc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 12px;
      background: var(--toc-header-bg, linear-gradient(135deg, #6366f1, #8b5cf6));
      color: #fff;
      cursor: move;
      user-select: none;
      flex-shrink: 0;
      backdrop-filter: blur(8px);
    }
    .toc-header-title {
      font-weight: 600;
      font-size: 12.5px;
      display: flex;
      align-items: center;
      gap: 6px;
      letter-spacing: 0.3px;
    }
    .toc-header-actions {
      display: flex;
      gap: 3px;
    }
    .toc-btn {
      background: rgba(255,255,255,0.15);
      border: none;
      color: #fff;
      border-radius: 6px;
      padding: 3px 7px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .toc-btn:hover { background: rgba(255,255,255,0.28); transform: scale(1.08); }
    .toc-btn:active { transform: scale(0.95); }

    /* ── 目录列表 ── */
    .toc-body {
      overflow-y: auto;
      padding: 2px 0;
      flex: 1;
      min-height: 0;
    }
    .toc-body::-webkit-scrollbar { width: 3px; }
    .toc-body::-webkit-scrollbar-track { background: transparent; }
    .toc-body::-webkit-scrollbar-thumb {
      background: var(--toc-scrollbar, #e5e7eb);
      border-radius: 3px;
    }
    .toc-body::-webkit-scrollbar-thumb:hover { background: var(--toc-muted, #9ca3af); }

    .toc-item {
      display: flex;
      align-items: center;
      padding: 2px 10px 2px;
      cursor: pointer;
      color: var(--toc-text, #1f2937);
      line-height: 1.4;
      font-size: 12px;
      transition: all 0.12s ease;
      border-left: 2.5px solid transparent;
      position: relative;
      gap: 5px;
    }
    .toc-item:hover {
      background: var(--toc-item-hover, rgba(99,102,241,0.06));
      color: var(--toc-active-color, #4f46e5);
      border-left-color: var(--toc-active-color, #4f46e5);
    }
    .toc-item.active {
      background: var(--toc-item-active, rgba(99,102,241,0.12));
      color: var(--toc-active-color, #4f46e5);
      border-left-color: var(--toc-active-color, #4f46e5);
      font-weight: 600;
    }
    .toc-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    /* ── 折叠按钮 ── */
    .toc-collapse-btn {
      width: 14px; height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--toc-muted, #9ca3af);
      cursor: pointer;
      font-size: 8px;
      transition: transform 0.2s cubic-bezier(.4,0,.2,1), color 0.15s;
      flex-shrink: 0;
      border-radius: 3px;
    }
    .toc-collapse-btn:hover { color: var(--toc-active-color, #6366f1); background: var(--toc-item-hover, rgba(99,102,241,0.06)); }
    .toc-collapse-btn.collapsed { transform: rotate(-90deg); }
    .toc-collapse-btn.empty { visibility: hidden; }

    /* ── 标题级别圆点 ── */
    .toc-level-dot {
      width: 4px; height: 4px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--toc-muted, #d1d5db);
      transition: all 0.15s;
    }
    .toc-item[data-level="1"] .toc-level-dot { background: #6366f1; width: 6px; height: 6px; box-shadow: 0 0 4px rgba(99,102,241,0.4); }
    .toc-item[data-level="2"] .toc-level-dot { background: #8b5cf6; width: 5px; height: 5px; }
    .toc-item[data-level="3"] .toc-level-dot { background: #a78bfa; }
    .toc-item[data-level="4"] .toc-level-dot { background: #c084fc; }
    .toc-item[data-level="5"] .toc-level-dot { background: #e879f9; width: 3px; height: 3px; }
    .toc-item[data-level="6"] .toc-level-dot { background: #f472b6; width: 3px; height: 3px; }

    .toc-item[data-level="1"] { padding-left: 10px; font-size: 12.5px; font-weight: 600; }
    .toc-item[data-level="2"] { padding-left: 18px; }
    .toc-item[data-level="3"] { padding-left: 24px; font-size: 11.5px; }
    .toc-item[data-level="4"] { padding-left: 30px; font-size: 11.5px; color: var(--toc-muted, #6b7280); }
    .toc-item[data-level="5"] { padding-left: 36px; font-size: 11px; color: var(--toc-muted, #6b7280); }
    .toc-item[data-level="6"] { padding-left: 42px; font-size: 11px; color: var(--toc-muted, #6b7280); }
    .toc-item[data-level="1"].active, .toc-item[data-level="2"].active { color: var(--toc-active-color, #4f46e5); }
    .toc-item[data-level="3"].active, .toc-item[data-level="4"].active,
    .toc-item[data-level="5"].active, .toc-item[data-level="6"].active {
      color: var(--toc-active-color, #4f46e5); font-weight: 600;
    }

    /* ── 子目录容器 ── */
    .toc-children.collapsed { display: none; }

    .toc-empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--toc-muted, #9ca3af);
      font-size: 12px;
      line-height: 1.6;
    }
    .toc-empty-icon { font-size: 28px; margin-bottom: 8px; opacity: 0.5; }

    /* ── Toast 提示 ── */
    #toc-reader-toast {
      position: fixed;
      left: 50%; bottom: 28px;
      transform: translateX(-50%) translateY(12px);
      z-index: 999999;
      background: rgba(17,24,39,0.88);
      backdrop-filter: blur(12px);
      color: #fff;
      font-size: 12.5px;
      padding: 8px 16px;
      border-radius: 8px;
      opacity: 0;
      transition: all 0.25s cubic-bezier(.4,0,.2,1);
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    }
    #toc-reader-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    /* ── 设置弹窗 ── */
    .toc-settings-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--toc-overlay, rgba(0,0,0,0.35));
      z-index: 9999990;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s;
      backdrop-filter: blur(4px);
    }
    .toc-settings-overlay.show { opacity: 1; }
    .toc-settings-modal {
      background: var(--toc-modal-bg, #fff);
      border-radius: 14px;
      padding: 24px;
      width: 340px;
      max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      transform: scale(0.92) translateY(8px);
      transition: transform 0.25s cubic-bezier(.4,0,.2,1);
      color: var(--toc-text, #1f2937);
    }
    .toc-settings-overlay.show .toc-settings-modal {
      transform: scale(1) translateY(0);
    }
    .toc-settings-title {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toc-settings-group {
      margin-bottom: 14px;
    }
    .toc-settings-label {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--toc-muted, #6b7280);
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .toc-settings-input {
      width: 100%;
      padding: 8px 12px;
      border: 1.5px solid var(--toc-border, rgba(0,0,0,0.1));
      border-radius: 8px;
      font-size: 13px;
      background: var(--toc-bg, #fff);
      color: var(--toc-text, #1f2937);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      box-sizing: border-box;
    }
    .toc-settings-input:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
    }
    .toc-settings-input::placeholder { color: var(--toc-muted, #9ca3af); }
    .toc-settings-hint {
      font-size: 11px;
      color: var(--toc-muted, #9ca3af);
      margin-top: 4px;
      line-height: 1.4;
    }
    .toc-settings-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 20px;
    }
    .toc-settings-btn {
      padding: 7px 18px;
      border: none;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .toc-settings-btn-cancel {
      background: var(--toc-border, rgba(0,0,0,0.08));
      color: var(--toc-text, #1f2937);
    }
    .toc-settings-btn-cancel:hover { opacity: 0.7; }
    .toc-settings-btn-save {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      box-shadow: 0 2px 8px rgba(99,102,241,0.35);
    }
    .toc-settings-btn-save:hover { box-shadow: 0 4px 14px rgba(99,102,241,0.45); transform: translateY(-1px); }
    .toc-settings-btn-save:active { transform: translateY(0); }
  `;
  GM_addStyle(TOCReaderStyle);

  // ─── 工具函数 ─────────────────────────────────────────────────────────────────
  function showToast(message, duration = 1800) {
    let el = document.getElementById('toc-reader-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toc-reader-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove('show'), duration);
  }

  function getHeadings() {
    const config = getSiteConfig();
    const root = config?.contentSelector
      ? document.querySelector(typeof config.contentSelector === 'function' ? config.contentSelector() : config.contentSelector)
      : document.body;
    if (!root) return [];
    const nodes = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    return nodes.filter(el => {
      const text = el.textContent.trim();
      return text.length > 0 && text.length < 300;
    });
  }

  function ensureId(el, idx) {
    if (!el.id) {
      let id = el.getAttribute('id');
      if (!id) {
        const anchor = el.querySelector('.anchor') || el.querySelector('a');
        id = anchor?.getAttribute('id') || anchor?.hash?.replace(/^#/, '');
      }
      if (!id) {
        id = `toc-anchor-${idx}`;
        el.setAttribute('id', id);
      }
      el.id = id;
    }
    return el.id;
  }

  function getScrollOffset() {
    const config = getSiteConfig();
    return config?.scrollSmoothOffset || 0;
  }

  function scrollToHeading(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = getScrollOffset();
    const rect = el.getBoundingClientRect();
    const scrollTop = window.scrollY + rect.top + offset;
    window.scrollTo({ top: scrollTop, behavior: 'smooth' });
  }

  // ─── 构建面板 ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('colorscheme', 'light');

    panel.innerHTML = `
      <div class="toc-header" id="toc-drag-handle">
        <div class="toc-header-title"><span style="font-size:14px">☰</span> 目录</div>
        <div class="toc-header-actions">
          <button class="toc-btn" id="toc-theme-btn" title="切换主题">🌙</button>
          <button class="toc-btn" id="toc-translate-btn" title="翻译目录（百度）">译</button>
          <button class="toc-btn" id="toc-collapse-btn" title="折叠/展开">▾</button>
          <button class="toc-btn" id="toc-refresh-btn" title="刷新">↻</button>
          <button class="toc-btn" id="toc-settings-btn" title="翻译设置">⚙</button>
          <button class="toc-btn" id="toc-close-btn" title="关闭">✕</button>
        </div>
      </div>
      <div class="toc-body" id="toc-body"></div>
      <div class="toc-resize-handle" id="toc-resize-handle"></div>
    `;

    return panel;
  }

  function buildToggleBtn() {
    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.textContent = '目录';
    btn.title = '显示/隐藏网页目录';
    return btn;
  }

  // ─── 渲染目录列表 ─────────────────────────────────────────────────────────────
  let headingData = [];
  let treeData = [];

  function buildTocTree(headings) {
    const tree = [];
    const stack = [];

    headings.forEach(heading => {
      const node = {
        level: heading.level,
        text: heading.text,
        id: heading.id,
        children: [],
        parent: null,
        el: heading.el
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        tree.push(node);
      } else {
        stack[stack.length - 1].children.push(node);
        node.parent = stack[stack.length - 1];
      }

      stack.push(node);
    });

    return tree;
  }

  function renderToc(expandOnly = null) {
    const body = document.getElementById('toc-body');
    if (!body) return;

    body.innerHTML = '';

    if (headingData.length === 0) {
      body.innerHTML = '<div class="toc-empty"><div class="toc-empty-icon">📄</div>未检测到标题结构<br><span style="font-size:11px;opacity:0.7">点击 ↻ 刷新重试</span></div>';
      return;
    }

    treeData = buildTocTree(headingData);
    renderTree(treeData, body, 0, expandOnly);
  }

  function renderTree(nodes, container, depth, expandOnly = null) {
    nodes.forEach(node => {
      const item = document.createElement('div');
      item.className = 'toc-item';
      item.dataset.level = node.level;
      item.dataset.id = node.id;

      // 折叠按钮
      const collapseBtn = document.createElement('span');
      collapseBtn.className = 'toc-collapse-btn';
      if (node.children.length > 0) {
        collapseBtn.innerHTML = '▼';
        collapseBtn.title = '折叠/展开';
        collapseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleChildren(item);
        });
      } else {
        collapseBtn.className += ' empty';
      }

      // 级别圆点
      const dot = document.createElement('span');
      dot.className = 'toc-level-dot';

      // 标题文字
      const text = document.createElement('span');
      text.className = 'toc-text';
      text.textContent = isTranslated && translatedData[node.id] ? translatedData[node.id] : node.text;

      item.appendChild(collapseBtn);
      item.appendChild(dot);
      item.appendChild(text);

      item.addEventListener('click', () => {
        document.querySelectorAll('.toc-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        scrollToHeading(node.id);
      });

      container.appendChild(item);

      // 渲染子节点
      if (node.children.length > 0) {
        const childContainer = document.createElement('div');
        childContainer.className = 'toc-children';
        container.appendChild(childContainer);
        renderTree(node.children, childContainer, depth + 1, expandOnly);
      }
    });
  }

  function toggleChildren(item) {
    const childContainer = item.nextElementSibling;
    if (childContainer && childContainer.classList.contains('toc-children')) {
      const isCollapsed = childContainer.classList.toggle('collapsed');
      const btn = item.querySelector('.toc-collapse-btn');
      if (btn) btn.classList.toggle('collapsed', isCollapsed);
    }
  }

  function getNodePath(nodeId) {
    function findParent(nodes, targetId, currentPath) {
      for (const node of nodes) {
        if (node.id === targetId) return currentPath.concat(node.id);
        if (node.children.length > 0) {
          const result = findParent(node.children, targetId, currentPath.concat(node.id));
          if (result) return result;
        }
      }
      return null;
    }
    return findParent(treeData, nodeId, []) || [nodeId];
  }

  function refreshHeadings() {
    const headings = getHeadings();
    headingData = headings.map((el, idx) => ({
      level: parseInt(el.tagName[1]),
      text: el.textContent.trim(),
      id: ensureId(el, idx),
      el: el
    }));
    isTranslated = false;
    translatedData = {};
    const transBtn = document.getElementById('toc-translate-btn');
    if (transBtn) { transBtn.textContent = '译'; transBtn.title = '翻译目录（百度）'; }
    renderToc();

    const panel = document.getElementById(PANEL_ID);
    if (headingData.length === 0 && panel && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
    }
  }

  // ─── 拖拽逻辑 ─────────────────────────────────────────────────────────────────
  function enableDrag(panel, handle) {
    let dragging = false, ox = 0, oy = 0;

    handle.addEventListener('mousedown', e => {
      if (e.target.closest('.toc-btn')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      let x = e.clientX - ox;
      let y = e.clientY - oy;
      x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, x));
      y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, y));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      const rect = panel.getBoundingClientRect();
      GM_setValue(POSITION_KEY, { left: rect.left, top: rect.top });
    });
  }

  // ─── 大小拖拽调整 ───────────────────────────────────────────────────────────
  function enableResize(panel) {
    const handle = document.getElementById('toc-resize-handle');
    if (!handle) return;

    let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = panel.offsetWidth;
      startH = panel.offsetHeight;
    });

    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      const newW = Math.max(200, Math.min(520, startW + e.clientX - startX));
      const newH = Math.max(200, Math.min(window.innerHeight * 0.9, startH + e.clientY - startY));
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      GM_setValue(SIZE_KEY, { width: panel.style.width, height: panel.style.height });
    });
  }

  // ─── 滚动高亮 + 自动展开 ──────────────────────────────────────────────────────
  let lastActiveId = null;

  function setupScrollSpy() {
    const offset = 100;
    const onScroll = () => {
      const scrollY = window.scrollY + offset;
      let current = null;

      for (let i = headingData.length - 1; i >= 0; i--) {
        const { id } = headingData[i];
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top + window.scrollY <= scrollY) {
          current = id;
          break;
        }
      }

      if (current === lastActiveId) return;
      lastActiveId = current;

      document.querySelectorAll('.toc-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === current);
      });

      if (current) {
        expandPathForId(current);
        const activeItem = document.querySelector(`.toc-item[data-id="${current}"]`);
        if (activeItem) {
          activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 500);
  }

  function expandPathForId(nodeId) {
    const path = getNodePath(nodeId);
    path.forEach(id => {
      const item = document.querySelector(`.toc-item[data-id="${id}"]`);
      if (item) {
        const childContainer = item.nextElementSibling;
        if (childContainer && childContainer.classList.contains('toc-children') && childContainer.classList.contains('collapsed')) {
          childContainer.classList.remove('collapsed');
          const btn = item.querySelector('.toc-collapse-btn');
          if (btn) btn.classList.remove('collapsed');
        }
      }
    });
  }

  // ─── 主题管理 ─────────────────────────────────────────────────────────────────
  function setTheme(mode, persist = true) {
    const panel = document.getElementById(PANEL_ID);
    const toggleBtn = document.getElementById('toc-theme-btn');
    if (!panel || !toggleBtn) return;

    let isDark;
    if (mode === 'auto') {
      isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } else {
      isDark = mode === 'dark';
    }

    panel.setAttribute('colorscheme', isDark ? 'dark' : 'light');
    toggleBtn.textContent = isDark ? '☀️' : '🌙';
    if (persist) GM_setValue(THEME_KEY, mode);
  }

  function cycleTheme() {
    const current = GM_getValue(THEME_KEY, 'auto');
    const modes = ['auto', 'light', 'dark'];
    const next = modes[(modes.indexOf(current) + 1) % modes.length];
    setTheme(next);
    showToast(next === 'auto' ? '主题: 跟随系统' : next === 'light' ? '主题: 亮色' : '主题: 暗色');
  }

  function initThemeListener() {
    if (!window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (mql.addEventListener) mql.addEventListener('change', () => {
      if (GM_getValue(THEME_KEY, 'auto') === 'auto') setTheme('auto', false);
    });
  }

  // ─── 菜单命令 ─────────────────────────────────────────────────────────────────
  function initMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    const themeMode = GM_getValue(THEME_KEY, 'auto');
    const mark = (m) => (themeMode === m ? '✅ ' : '');
    GM_registerMenuCommand(`${mark('auto')}主题: 跟随系统`, () => setTheme('auto'));
    GM_registerMenuCommand(`${mark('light')}主题: 亮色`, () => setTheme('light'));
    GM_registerMenuCommand(`${mark('dark')}主题: 暗色`, () => setTheme('dark'));
    GM_registerMenuCommand('🔄 刷新目录', refreshHeadings);
    GM_registerMenuCommand('⚙ 翻译设置', showSettingsModal);
  }

  // ─── 悬浮按钮拖拽 ───────────────────────────────────────────────────────────
  function enableToggleDrag(btn) {
    let dragging = false, hasMoved = false, startX = 0, startY = 0, startTop = 0;

    const savedPos = GM_getValue(TOGGLE_POS_KEY, null);
    if (savedPos) {
      btn.style.top = savedPos.top + 'px';
      btn.style.right = savedPos.right + 'px';
    }

    btn.addEventListener('mousedown', e => {
      dragging = true; hasMoved = false;
      startX = e.clientX; startY = e.clientY;
      startTop = btn.getBoundingClientRect().top;
      btn.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      if (!hasMoved) return;
      btn.style.top = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, startTop + dy)) + 'px';
      btn.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      btn.classList.remove('dragging');
      if (hasMoved) {
        btn.classList.add('was-dragged');
        GM_setValue(TOGGLE_POS_KEY, { top: btn.style.top, right: btn.style.right });
      }
    });
  }

  // ─── 百度翻译设置弹窗 ─────────────────────────────────────────────────────────
  function showSettingsModal() {
    // 移除已有弹窗
    document.querySelector('.toc-settings-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'toc-settings-overlay';

    const savedAppId = GM_getValue(BAIDU_APPID_KEY, '') || '';
    const savedSecret = GM_getValue(BAIDU_SECRETKEY_KEY, '') || '';

    overlay.innerHTML = `
      <div class="toc-settings-modal">
        <div class="toc-settings-title">⚙ 百度翻译配置</div>
        <div class="toc-settings-group">
          <div class="toc-settings-label">APP ID</div>
          <input class="toc-settings-input" id="toc-baidu-appid" type="text" placeholder="输入百度翻译 APP ID" value="${savedAppId}">
        </div>
        <div class="toc-settings-group">
          <div class="toc-settings-label">密钥 (Secret Key)</div>
          <input class="toc-settings-input" id="toc-baidu-secretkey" type="password" placeholder="输入百度翻译密钥" value="${savedSecret}">
        </div>
        <div class="toc-settings-hint">
          前往 <a href="https://fanyi-api.baidu.com/" target="_blank" style="color:#6366f1;text-decoration:none">fanyi-api.baidu.com</a> 注册获取 APP ID 和密钥。<br>
          标准版每月免费 200 万字符。
        </div>
        <div class="toc-settings-actions">
          <button class="toc-settings-btn toc-settings-btn-cancel" id="toc-settings-cancel">取消</button>
          <button class="toc-settings-btn toc-settings-btn-save" id="toc-settings-save">保存</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 250);
    };

    overlay.querySelector('#toc-settings-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#toc-settings-save').addEventListener('click', () => {
      const appId = overlay.querySelector('#toc-baidu-appid').value.trim();
      const secret = overlay.querySelector('#toc-baidu-secretkey').value.trim();
      GM_setValue(BAIDU_APPID_KEY, appId);
      GM_setValue(BAIDU_SECRETKEY_KEY, secret);
      close();
      showToast(appId ? '翻译配置已保存' : '翻译配置已清除');
    });
  }

  // ─── 百度翻译功能 ──────────────────────────────────────────────────────────────
  function detectPageLang() {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) {
      const code = htmlLang.split('-')[0].toLowerCase();
      if (code === 'zh') return 'zh';
      return code;
    }
    const sample = document.body?.innerText?.slice(0, 300) || '';
    return (sample.match(/[\u4e00-\u9fff]/g) || []).length > sample.length * 0.1 ? 'zh' : 'en';
  }

  function getTranslateLangPair() {
    const pageLang = detectPageLang();
    // zh -> en, en -> zh, others -> zh
    if (pageLang === 'zh') return { from: 'zh', to: 'en' };
    if (pageLang === 'en') return { from: 'en', to: 'zh' };
    return { from: 'auto', to: 'zh' };
  }

  function baiduSign(query, salt, secretKey) {
    const str = query + salt + secretKey;
    // Simple MD5 using SubtleCrypto
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    // FNV-1a is NOT MD5. We need proper MD5 for Baidu API.
    // Let's use a simple approach: use native crypto
    return md5(str);
  }

  // Simple MD5 implementation (no external dependency)
  function md5(string) {
    function md5cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
    }
    function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function md51(s) {
      let n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i;
      for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
      s = s.substring(i - 64);
      let tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
      for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) { md5cycle(state, tail); tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]; }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    }
    function md5blk(s) {
      let md5blks = [], i;
      for (i = 0; i < 64; i += 4) md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
      return md5blks;
    }
    function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
    function rhex(n) {
      let s = '', j;
      for (j = 0; j < 4; j++) s += ('0' + ((n >> (j * 8 + 4)) & 0x0F).toString(16) + (n >> (j * 8) & 0x0F).toString(16)).slice(-2);
      return s;
    }
    const x = md51(string);
    return rhex(x[0]) + rhex(x[1]) + rhex(x[2]) + rhex(x[3]);
  }

  function translateTextBaidu(text, from, to, appId, secretKey) {
    return new Promise((resolve) => {
      const salt = Date.now().toString();
      const sign = md5(appId + text + salt + secretKey);
      const params = new URLSearchParams({
        q: text,
        from: from,
        to: to,
        appid: appId,
        salt: salt,
        sign: sign,
      });

      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`,
        onload(response) {
          if (response.status === 200) {
            try {
              const data = JSON.parse(response.responseText);
              if (data.trans_result && data.trans_result.length > 0) {
                resolve(data.trans_result[0].dst);
                return;
              }
              // Error code
              if (data.error_code) {
                console.warn('[TOC Reader] Baidu Translate error:', data.error_code, data.error_msg);
                resolve(text);
                return;
              }
            } catch (e) {
              console.warn('[TOC Reader] Parse error:', e);
            }
          }
          resolve(text);
        },
        onerror() { resolve(text); },
        ontimeout() { resolve(text); }
      });
    });
  }

  async function toggleTranslate() {
    const btn = document.getElementById('toc-translate-btn');
    if (!btn) return;

    if (isTranslated) {
      isTranslated = false;
      btn.textContent = '译';
      btn.title = '翻译目录（百度）';
      renderToc();
      showToast('已恢复原文');
      return;
    }

    // 检查配置
    const appId = GM_getValue(BAIDU_APPID_KEY, '');
    const secretKey = GM_getValue(BAIDU_SECRETKEY_KEY, '');
    if (!appId || !secretKey) {
      showToast('请先配置百度翻译 APP ID 和密钥');
      showSettingsModal();
      return;
    }

    btn.textContent = '…';
    btn.title = '翻译中...';
    showToast('正在翻译目录...');

    const { from, to } = getTranslateLangPair();
    translatedData = {};

    const batchSize = 5;
    for (let i = 0; i < headingData.length; i += batchSize) {
      const batch = headingData.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(h => translateTextBaidu(h.text, from, to, appId, secretKey))
      );
      batch.forEach((h, idx) => { translatedData[h.id] = results[idx]; });
    }

    isTranslated = true;
    btn.textContent = '文';
    btn.title = '恢复原文';
    renderToc();
    showToast('翻译完成');
  }

  // ─── 初始化 ────────────────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = buildPanel();
    const toggle = buildToggleBtn();
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    const savedPos = GM_getValue(POSITION_KEY, null);
    if (savedPos) { panel.style.left = savedPos.left + 'px'; panel.style.top = savedPos.top + 'px'; panel.style.right = 'auto'; }

    const savedSize = GM_getValue(SIZE_KEY, null);
    if (savedSize) { if (savedSize.width) panel.style.width = savedSize.width; if (savedSize.height) panel.style.height = savedSize.height; }

    const visible = GM_getValue(STORAGE_KEY, true);
    if (!visible) panel.classList.add('hidden');

    refreshHeadings();
    enableDrag(panel, document.getElementById('toc-drag-handle'));
    enableResize(panel);
    setupScrollSpy();
    setTheme(GM_getValue(THEME_KEY, 'auto'), false);
    initThemeListener();

    document.getElementById('toc-refresh-btn').addEventListener('click', refreshHeadings);

    document.getElementById('toc-collapse-btn').addEventListener('click', () => {
      const allCollapsed = document.querySelectorAll('.toc-children.collapsed').length > 0;
      document.querySelectorAll('.toc-children').forEach(el => el.classList.toggle('collapsed', !allCollapsed));
      document.querySelectorAll('.toc-collapse-btn').forEach(btn => { if (!btn.classList.contains('empty')) btn.classList.toggle('collapsed', !allCollapsed); });
      showToast(allCollapsed ? '已全部展开' : '已全部折叠');
    });

    document.getElementById('toc-theme-btn').addEventListener('click', cycleTheme);
    document.getElementById('toc-translate-btn').addEventListener('click', toggleTranslate);

    document.getElementById('toc-settings-btn').addEventListener('click', showSettingsModal);

    document.getElementById('toc-close-btn').addEventListener('click', () => {
      panel.classList.add('hidden');
      GM_setValue(STORAGE_KEY, false);
    });

    toggle.addEventListener('click', (e) => {
      if (toggle.classList.contains('was-dragged')) { toggle.classList.remove('was-dragged'); return; }
      const isHidden = panel.classList.toggle('hidden');
      GM_setValue(STORAGE_KEY, !isHidden);
      if (!isHidden) refreshHeadings();
    });

    enableToggleDrag(toggle);

    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(refreshHeadings, 800); }
    }).observe(document.body, { childList: true, subtree: true });

    initMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
