// ==UserScript==
// @name         网页目录阅读器 (TOC Reader)
// @namespace    https://github.com/JBC-JJM/chrome-toc-extension
// @version      1.7.0
// @description  自动提取网页标题结构，生成悬浮目录面板，支持点击跳转、折叠展开、拖拽移动、智能主题
// @author       JBC-JJM
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
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
      font-size: 14px;
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
      line-height: 1.5;
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

    .toc-item[data-level="1"] { padding-left: 10px; font-size: 13.5px; font-weight: 600; }
    .toc-item[data-level="2"] { padding-left: 18px; font-size: 13px; }
    .toc-item[data-level="3"] { padding-left: 24px; font-size: 12.5px; }
    .toc-item[data-level="4"] { padding-left: 30px; font-size: 12.5px; color: var(--toc-muted, #6b7280); }
    .toc-item[data-level="5"] { padding-left: 36px; font-size: 12px; color: var(--toc-muted, #6b7280); }
    .toc-item[data-level="6"] { padding-left: 42px; font-size: 12px; color: var(--toc-muted, #6b7280); }
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
          <button class="toc-btn" id="toc-collapse-btn" title="折叠/展开">▾</button>
          <button class="toc-btn" id="toc-refresh-btn" title="刷新">↻</button>
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
      text.textContent = node.text;

      item.appendChild(collapseBtn);
      item.appendChild(dot);
      item.appendChild(text);

      item.addEventListener('click', () => {
        document.querySelectorAll('.toc-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        // 暂停滚动跟随展开 2 秒，避免覆盖用户手动折叠状态
        scrollFollowPaused = true;
        clearTimeout(setupScrollSpy._resumeTimer);
        setupScrollSpy._resumeTimer = setTimeout(() => { scrollFollowPaused = false; }, 2000);
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
  let scrollFollowPaused = false; // 点击跳转后暂停自动展开

  function setupScrollSpy() {
    const offset = 100;
    const onScroll = () => {
      // 高亮当前标题（始终执行）
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

      // 只有非暂停状态才自动展开路径
      if (current && !scrollFollowPaused) {
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
