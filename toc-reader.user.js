// ==UserScript==
// @name         网页目录阅读器 (TOC Reader)
// @namespace    https://github.com/JBC-JJM/chrome-toc-extension
// @version      1.4.0
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
    if (typeof setting === 'function') return setting();
    return setting;
  }

  // ─── 样式注入 ─────────────────────────────────────────────────────────────────
  const TOCReaderStyle = `
    #${TOGGLE_ID} {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: 999999;
      background: var(--toc-active-color, #4f46e5);
      color: #fff;
      border: none;
      border-radius: 6px 0 0 6px;
      padding: 10px 6px;
      cursor: move;
      font-size: 13px;
      writing-mode: vertical-rl;
      letter-spacing: 2px;
      box-shadow: -2px 0 8px rgba(0,0,0,0.2);
      transition: background 0.2s;
      user-select: none;
    }
    #${TOGGLE_ID}:hover { background: #4338ca; }
    #${TOGGLE_ID}.dragging { cursor: grabbing; }

    #${PANEL_ID} {
      position: fixed;
      top: 60px;
      right: 16px;
      width: 280px;
      height: 60%;
      min-width: 180px;
      min-height: 200px;
      max-width: 500px;
      max-height: 90vh;
      z-index: 999998;
      background: var(--toc-bg, #fff);
      border: 1px solid var(--toc-border, #e5e7eb);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      transition: opacity 0.2s, transform 0.2s, background 0.3s, border-color 0.3s;
      color: var(--toc-text, #374151);
      overflow: hidden;
    }

    /* 自定义调整大小手柄 */
    .toc-resize-handle {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      z-index: 10;
    }
    .toc-resize-handle::before {
      content: '';
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 8px;
      height: 8px;
      border-right: 2px solid #9ca3af;
      border-bottom: 2px solid #9ca3af;
      opacity: 0.5;
      transition: opacity 0.2s;
    }
    .toc-resize-handle:hover::before { opacity: 1; }
    #${PANEL_ID}[colorscheme="dark"] .toc-resize-handle::before { border-color: #6b7280; }
    #${PANEL_ID}.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(20px);
    }

    /* 深色主题 */
    #${PANEL_ID}[colorscheme="dark"] {
      --toc-bg: #1f2937;
      --toc-border: #374151;
      --toc-text: #f3f4f6;
      --toc-active-bg: #3730a3;
      --toc-active-color: #a5b4fc;
    }
    #${PANEL_ID}[colorscheme="dark"] .toc-item:hover {
      background: #374151;
      color: #a5b4fc;
    }
    #${PANEL_ID}[colorscheme="dark"] .toc-item.active {
      background: #3730a3;
      color: #a5b4fc;
    }
    #${PANEL_ID}[colorscheme="dark"] .toc-collapse-btn { color: #9ca3af; }

    .toc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--toc-active-color, #4f46e5);
      color: #fff;
      border-radius: 9px 9px 0 0;
      cursor: move;
      user-select: none;
      flex-shrink: 0;
    }
    .toc-header-title {
      font-weight: 600;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .toc-header-actions {
      display: flex;
      gap: 4px;
    }
    .toc-btn {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 11px;
      transition: background 0.15s;
    }
    .toc-btn:hover { background: rgba(255,255,255,0.35); }

    .toc-body {
      overflow-y: auto;
      padding: 4px 0;
      flex: 1;
      min-height: 0;
    }
    .toc-body::-webkit-scrollbar { width: 4px; }
    .toc-body::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }

    .toc-item {
      display: flex;
      align-items: center;
      padding: 3px 12px;
      cursor: pointer;
      color: var(--toc-text, #374151);
      line-height: 1.3;
      transition: background 0.15s, color 0.15s;
      border-left: 3px solid transparent;
    }
    .toc-item:hover {
      background: var(--toc-hover-bg, #f5f3ff);
      color: var(--toc-active-color, #4f46e5);
      border-left-color: var(--toc-active-color, #4f46e5);
    }
    .toc-item.active {
      background: var(--toc-active-bg, #ede9fe);
      color: var(--toc-active-color, #4f46e5);
      border-left-color: var(--toc-active-color, #4f46e5);
      font-weight: 600;
    }

    /* 折叠按钮 */
    .toc-collapse-btn {
      width: 14px;
      height: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 4px;
      color: #9ca3af;
      cursor: pointer;
      font-size: 9px;
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .toc-collapse-btn:hover { color: var(--toc-active-color, #4f46e5); }
    .toc-collapse-btn.collapsed { transform: rotate(-90deg); }
    .toc-collapse-btn.empty { visibility: hidden; }

    /* 标题级别标识 - 圆点 */
    .toc-level-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      margin-right: 8px;
      flex-shrink: 0;
      background: #d1d5db;
    }
    .toc-item[data-level="1"] .toc-level-dot { background: #4f46e5; width: 7px; height: 7px; }
    .toc-item[data-level="2"] .toc-level-dot { background: #7c3aed; }
    .toc-item[data-level="3"] .toc-level-dot { background: #a855f7; }
    .toc-item[data-level="4"] .toc-level-dot { background: #d946ef; }
    .toc-item[data-level="5"] .toc-level-dot { background: #ec4899; }
    .toc-item[data-level="6"] .toc-level-dot { background: #f43f5e; }

    .toc-item[data-level="1"] { padding-left: 12px; }
    .toc-item[data-level="2"] { padding-left: 20px; }
    .toc-item[data-level="3"] { padding-left: 28px; }
    .toc-item[data-level="4"] { padding-left: 36px; }
    .toc-item[data-level="5"] { padding-left: 44px; }
    .toc-item[data-level="6"] { padding-left: 52px; }

    /* 子目录 */
    .toc-children.collapsed { display: none; }

    .toc-empty {
      padding: 20px;
      text-align: center;
      color: #9ca3af;
      font-size: 12px;
    }

    #toc-reader-toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%) translateY(10px);
      z-index: 999999;
      background: rgba(0, 0, 0, 0.78);
      color: #fff;
      font-size: 13px;
      padding: 8px 12px;
      border-radius: 8px;
      opacity: 0;
      transition: all .2s ease;
    }
    #toc-reader-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  `;
  GM_addStyle(TOCReaderStyle);

  // ─── 工具函数 ─────────────────────────────────────────────────────────────────
  function showToast(message, duration = 1600) {
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
        <div class="toc-header-title">📋 目录</div>
        <div class="toc-header-actions">
          <button class="toc-btn" id="toc-theme-btn" title="切换主题">🌙</button>
          <button class="toc-btn" id="toc-collapse-btn" title="折叠/展开">▾</button>
          <button class="toc-btn" id="toc-refresh-btn" title="刷新">↺</button>
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

    headings.forEach((heading, idx) => {
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
      body.innerHTML = '<div class="toc-empty">未检测到标题结构</div>';
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
        collapseBtn.title = '点击折叠/展开';
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
        scrollToHeading(node.id);
        
        // 点击时只展开当前路径，折叠其他
        if (node.children.length > 0) {
          expandOnlyPath(node);
        }
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

  // 切换单个节点的展开/折叠
  function toggleChildren(item) {
    const childContainer = item.nextElementSibling;
    if (childContainer && childContainer.classList.contains('toc-children')) {
      const isCollapsed = childContainer.classList.toggle('collapsed');
      const btn = item.querySelector('.toc-collapse-btn');
      if (btn) btn.classList.toggle('collapsed', isCollapsed);
    }
  }

  // 只展开当前点击的路径，其他全部折叠
  function expandOnlyPath(clickedNode) {
    // 先折叠所有
    document.querySelectorAll('.toc-children').forEach(el => {
      el.classList.add('collapsed');
    });
    document.querySelectorAll('.toc-collapse-btn').forEach(btn => {
      if (!btn.classList.contains('empty')) {
        btn.classList.add('collapsed');
      }
    });

    // 找到当前节点的父节点链
    const path = getNodePath(clickedNode.id);
    
    // 展开路径上的节点
    path.forEach(nodeId => {
      const item = document.querySelector(`.toc-item[data-id="${nodeId}"]`);
      if (item) {
        const childContainer = item.nextElementSibling;
        if (childContainer && childContainer.classList.contains('toc-children')) {
          childContainer.classList.remove('collapsed');
          const btn = item.querySelector('.toc-collapse-btn');
          if (btn) btn.classList.remove('collapsed');
        }
      }
    });
  }

  function getNodePath(nodeId) {
    const path = [nodeId];
    
    function findParent(nodes, targetId, currentPath) {
      for (const node of nodes) {
        if (node.id === targetId) {
          return currentPath.concat(node.id);
        }
        if (node.children.length > 0) {
          const result = findParent(node.children, targetId, currentPath.concat(node.id));
          if (result) return result;
        }
      }
      return null;
    }
    
    const result = findParent(treeData, nodeId, []);
    return result || path;
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

    // 找不到目录时自动隐藏面板
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
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newW = Math.max(180, Math.min(500, startW + dx));
      const newH = Math.max(200, Math.min(window.innerHeight * 0.9, startH + dy));
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      GM_setValue(SIZE_KEY, { width: panel.style.width, height: panel.style.height });
    });
  }

  // ─── 滚动高亮当前标题 ─────────────────────────────────────────────────────────
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

      document.querySelectorAll('.toc-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === current);
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 500);
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

    if (persist) {
      GM_setValue(THEME_KEY, mode);
    }
  }

  function cycleTheme() {
    const current = GM_getValue(THEME_KEY, 'auto');
    const modes = ['auto', 'light', 'dark'];
    const idx = modes.indexOf(current);
    const next = modes[(idx + 1) % modes.length];
    setTheme(next);
    showToast(`主题: ${next === 'auto' ? '跟随系统' : next === 'light' ? '亮色' : '暗色'}`);
  }

  function initThemeListener() {
    if (!window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (GM_getValue(THEME_KEY, 'auto') === 'auto') {
        setTheme('auto', false);
      }
    };
    if (mql.addEventListener) mql.addEventListener('change', handler);
  }

  // ─── 菜单命令 ─────────────────────────────────────────────────────────────────
  function initMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    const themeMode = GM_getValue(THEME_KEY, 'auto');
    const mark = (m) => (themeMode === m ? '✅ ' : '');

    GM_registerMenuCommand(`${mark('auto')}主题: 跟随系统`, () => setTheme('auto'));
    GM_registerMenuCommand(`${mark('light')}主题: 亮色模式`, () => setTheme('light'));
    GM_registerMenuCommand(`${mark('dark')}主题: 暗色模式`, () => setTheme('dark'));
    GM_registerMenuCommand('🔄 刷新目录', refreshHeadings);
  }

  // ─── 悬浮按钮拖拽 ───────────────────────────────────────────────────────────
  function enableToggleDrag(btn) {
    let dragging = false, hasMoved = false, startX = 0, startY = 0, startTop = 0;

    // 恢复保存的位置
    const savedPos = GM_getValue(TOGGLE_POS_KEY, null);
    if (savedPos) {
      btn.style.top = savedPos.top + 'px';
      btn.style.right = savedPos.right + 'px';
    }

    btn.addEventListener('mousedown', e => {
      dragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      startTop = btn.getBoundingClientRect().top;
      btn.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      if (!hasMoved) return;
      const newTop = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, startTop + dy));
      btn.style.top = newTop + 'px';
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

    // 读取保存的位置
    const savedPos = GM_getValue(POSITION_KEY, null);
    if (savedPos) {
      panel.style.left = savedPos.left + 'px';
      panel.style.top = savedPos.top + 'px';
      panel.style.right = 'auto';
    }

    // 读取保存的大小
    const savedSize = GM_getValue(SIZE_KEY, null);
    if (savedSize) {
      if (savedSize.width) panel.style.width = savedSize.width;
      if (savedSize.height) panel.style.height = savedSize.height;
    }

    // 读取可见状态
    const visible = GM_getValue(STORAGE_KEY, true);
    if (!visible) panel.classList.add('hidden');

    // 首次加载目录
    refreshHeadings();

    // 拖拽
    enableDrag(panel, document.getElementById('toc-drag-handle'));

    // 拖拽调整大小
    enableResize(panel);

    // 滚动高亮
    setupScrollSpy();

    // 主题
    setTheme(GM_getValue(THEME_KEY, 'auto'), false);
    initThemeListener();

    // 刷新按钮
    document.getElementById('toc-refresh-btn').addEventListener('click', refreshHeadings);

    // 折叠按钮
    document.getElementById('toc-collapse-btn').addEventListener('click', () => {
      // 全部折叠/展开切换
      const allCollapsed = document.querySelectorAll('.toc-children.collapsed').length > 0;
      document.querySelectorAll('.toc-children').forEach(el => {
        el.classList.toggle('collapsed', !allCollapsed);
      });
      document.querySelectorAll('.toc-collapse-btn').forEach(btn => {
        if (!btn.classList.contains('empty')) {
          btn.classList.toggle('collapsed', !allCollapsed);
        }
      });
      showToast(allCollapsed ? '已全部展开' : '已全部折叠');
    });

    // 主题按钮
    document.getElementById('toc-theme-btn').addEventListener('click', cycleTheme);

    // 关闭按钮
    document.getElementById('toc-close-btn').addEventListener('click', () => {
      panel.classList.add('hidden');
      GM_setValue(STORAGE_KEY, false);
    });

    // 悬浮切换按钮
    toggle.addEventListener('click', (e) => {
      // 如果刚拖拽完，忽略这次点击
      if (toggle.classList.contains('was-dragged')) {
        toggle.classList.remove('was-dragged');
        return;
      }
      const isHidden = panel.classList.toggle('hidden');
      GM_setValue(STORAGE_KEY, !isHidden);
      if (!isHidden) refreshHeadings();
    });

    // 悬浮按钮可拖拽移动
    enableToggleDrag(toggle);

    // SPA 路由变化时自动刷新
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(refreshHeadings, 800);
      }
    }).observe(document.body, { childList: true, subtree: true });

    // 菜单
    initMenu();
  }

  // DOM 就绪后执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
