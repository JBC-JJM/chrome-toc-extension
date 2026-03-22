// ==UserScript==
// @name         网页目录阅读器 (TOC Reader)
// @namespace    https://github.com/JBC-JJM/chrome-toc-extension
// @version      1.0.0
// @description  自动提取网页标题结构，生成悬浮目录面板，支持点击跳转、折叠展开、拖拽移动
// @author       JBC-JJM
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── 常量 ────────────────────────────────────────────────────────────────────
  const PANEL_ID   = 'toc-reader-panel';
  const TOGGLE_ID  = 'toc-reader-toggle';
  const STORAGE_KEY = 'toc_reader_visible';

  // ─── 样式注入 ─────────────────────────────────────────────────────────────────
  GM_addStyle(`
    #${TOGGLE_ID} {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: 999999;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 6px 0 0 6px;
      padding: 10px 6px;
      cursor: pointer;
      font-size: 13px;
      writing-mode: vertical-rl;
      letter-spacing: 2px;
      box-shadow: -2px 0 8px rgba(0,0,0,0.2);
      transition: background 0.2s;
      user-select: none;
    }
    #${TOGGLE_ID}:hover { background: #4338ca; }

    #${PANEL_ID} {
      position: fixed;
      top: 60px;
      right: 16px;
      width: 280px;
      max-height: 70vh;
      z-index: 999998;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      transition: opacity 0.2s, transform 0.2s;
    }
    #${PANEL_ID}.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(20px);
    }

    .toc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #4f46e5;
      color: #fff;
      border-radius: 10px 10px 0 0;
      cursor: move;
      user-select: none;
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
      gap: 6px;
    }
    .toc-btn {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      border-radius: 4px;
      padding: 2px 7px;
      cursor: pointer;
      font-size: 12px;
      transition: background 0.15s;
    }
    .toc-btn:hover { background: rgba(255,255,255,0.35); }

    .toc-search {
      padding: 8px 10px;
      border-bottom: 1px solid #f3f4f6;
    }
    .toc-search input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 12px;
      outline: none;
      transition: border-color 0.2s;
    }
    .toc-search input:focus { border-color: #4f46e5; }

    .toc-body {
      overflow-y: auto;
      padding: 6px 0;
      flex: 1;
    }
    .toc-body::-webkit-scrollbar { width: 4px; }
    .toc-body::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }

    .toc-item {
      display: flex;
      align-items: center;
      padding: 5px 14px;
      cursor: pointer;
      color: #374151;
      line-height: 1.4;
      transition: background 0.15s, color 0.15s;
      border-left: 3px solid transparent;
    }
    .toc-item:hover {
      background: #f5f3ff;
      color: #4f46e5;
      border-left-color: #4f46e5;
    }
    .toc-item.active {
      background: #ede9fe;
      color: #4f46e5;
      border-left-color: #4f46e5;
      font-weight: 600;
    }
    .toc-item.hidden-item { display: none; }

    .toc-level-badge {
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 700;
      color: #9ca3af;
      margin-right: 6px;
      min-width: 18px;
    }
    .toc-item[data-level="1"] { padding-left: 14px; }
    .toc-item[data-level="2"] { padding-left: 22px; }
    .toc-item[data-level="3"] { padding-left: 30px; }
    .toc-item[data-level="4"] { padding-left: 38px; }
    .toc-item[data-level="5"] { padding-left: 46px; }
    .toc-item[data-level="6"] { padding-left: 54px; }

    .toc-empty {
      padding: 20px;
      text-align: center;
      color: #9ca3af;
      font-size: 12px;
    }

    .toc-footer {
      padding: 6px 14px;
      border-top: 1px solid #f3f4f6;
      font-size: 11px;
      color: #9ca3af;
      text-align: right;
    }

    .toc-highlight {
      background: #fef08a;
      border-radius: 2px;
    }
  `);

  // ─── 工具函数 ─────────────────────────────────────────────────────────────────
  function getHeadings() {
    const selectors = 'h1, h2, h3, h4, h5, h6';
    const nodes = Array.from(document.querySelectorAll(selectors));
    return nodes.filter(el => {
      const text = el.textContent.trim();
      return text.length > 0 && text.length < 300;
    });
  }

  function ensureId(el, idx) {
    if (!el.id) el.id = `toc-anchor-${idx}`;
    return el.id;
  }

  function scrollToHeading(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQ = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(escapedQ, 'gi'), m => `<span class="toc-highlight">${m}</span>`);
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─── 构建面板 ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    panel.innerHTML = `
      <div class="toc-header" id="toc-drag-handle">
        <div class="toc-header-title">📋 网页目录</div>
        <div class="toc-header-actions">
          <button class="toc-btn" id="toc-refresh-btn" title="刷新目录">↺</button>
          <button class="toc-btn" id="toc-close-btn" title="关闭">✕</button>
        </div>
      </div>
      <div class="toc-search">
        <input type="text" id="toc-search-input" placeholder="搜索标题…" />
      </div>
      <div class="toc-body" id="toc-body"></div>
      <div class="toc-footer" id="toc-footer">共 0 个标题</div>
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

  function renderToc(query = '') {
    const body   = document.getElementById('toc-body');
    const footer = document.getElementById('toc-footer');
    if (!body) return;

    body.innerHTML = '';

    if (headingData.length === 0) {
      body.innerHTML = '<div class="toc-empty">未检测到标题结构</div>';
      footer.textContent = '共 0 个标题';
      return;
    }

    const lowerQ = query.toLowerCase();
    let visibleCount = 0;

    headingData.forEach(({ level, text, id }) => {
      const item = document.createElement('div');
      item.className = 'toc-item';
      item.dataset.level = level;
      item.dataset.id = id;

      const badge = document.createElement('span');
      badge.className = 'toc-level-badge';
      badge.textContent = `H${level}`;

      const label = document.createElement('span');
      label.innerHTML = highlightText(text, query);

      item.appendChild(badge);
      item.appendChild(label);

      if (lowerQ && !text.toLowerCase().includes(lowerQ)) {
        item.classList.add('hidden-item');
      } else {
        visibleCount++;
      }

      item.addEventListener('click', () => {
        document.querySelectorAll('.toc-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        scrollToHeading(id);
      });

      body.appendChild(item);
    });

    footer.textContent = query
      ? `找到 ${visibleCount} / ${headingData.length} 个标题`
      : `共 ${headingData.length} 个标题`;
  }

  function refreshHeadings() {
    const headings = getHeadings();
    headingData = headings.map((el, idx) => ({
      level: parseInt(el.tagName[1]),
      text:  el.textContent.trim(),
      id:    ensureId(el, idx),
    }));
    renderToc(document.getElementById('toc-search-input')?.value || '');
  }

  // ─── 拖拽逻辑 ─────────────────────────────────────────────────────────────────
  function enableDrag(panel, handle) {
    let dragging = false, ox = 0, oy = 0;

    handle.addEventListener('mousedown', e => {
      dragging = true;
      ox = e.clientX - panel.getBoundingClientRect().left;
      oy = e.clientY - panel.getBoundingClientRect().top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      let x = e.clientX - ox;
      let y = e.clientY - oy;
      x = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  x));
      y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, y));
      panel.style.left  = x + 'px';
      panel.style.top   = y + 'px';
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => { dragging = false; });
  }

  // ─── 滚动高亮当前标题 ─────────────────────────────────────────────────────────
  function setupScrollSpy() {
    const onScroll = () => {
      const scrollY = window.scrollY + 80;
      let current = null;
      headingData.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top + window.scrollY <= scrollY) {
          current = id;
        }
      });
      document.querySelectorAll('.toc-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === current);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ─── 初始化 ───────────────────────────────────────────────────────────────────
  function init() {
    // 避免重复注入
    if (document.getElementById(PANEL_ID)) return;

    const panel  = buildPanel();
    const toggle = buildToggleBtn();
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    // 读取上次可见状态
    const visible = GM_getValue(STORAGE_KEY, true);
    if (!visible) panel.classList.add('hidden');

    // 首次加载目录
    refreshHeadings();

    // 拖拽
    enableDrag(panel, document.getElementById('toc-drag-handle'));

    // 滚动高亮
    setupScrollSpy();

    // 搜索
    document.getElementById('toc-search-input').addEventListener('input', e => {
      renderToc(e.target.value.trim());
    });

    // 刷新按钮
    document.getElementById('toc-refresh-btn').addEventListener('click', refreshHeadings);

    // 关闭按钮
    document.getElementById('toc-close-btn').addEventListener('click', () => {
      panel.classList.add('hidden');
      GM_setValue(STORAGE_KEY, false);
    });

    // 悬浮切换按钮
    toggle.addEventListener('click', () => {
      const isHidden = panel.classList.toggle('hidden');
      GM_setValue(STORAGE_KEY, !isHidden);
      if (!isHidden) refreshHeadings();
    });

    // SPA 路由变化时自动刷新
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(refreshHeadings, 800);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // DOM 就绪后执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
