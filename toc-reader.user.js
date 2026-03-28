// ==UserScript==
// @name         网页目录阅读器 (TOC Reader) 
// @namespace    https://github.com/JBC-JJM/chrome-toc-extension
// @version      1.9.1
// @description  自动提取网页标题结构，生成悬浮目录面板，支持点击跳转、折叠展开、拖拽移动、智能主题、独立记忆位置大小、文本格式统一隔离、智能隐藏、SPA单页适配
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
  const SIZE_KEY = 'toc_reader_size';
  const TOGGLE_POS_KEY = 'toc_reader_toggle_pos';
  const SITE_VISIBLE_KEY = 'toc_reader_site_visible_';
  const SCRIPT_VERSION = '1.9.1';
  const EXCLUDED_DOMAINS_KEY = 'toc_reader_excluded_domains';

  // ─── 动态存储键（针对当前域名独立记录） ───────────────────────────────────────────
  function getSitePositionKey() { return POSITION_KEY + '_' + location.hostname; }
  function getSiteSizeKey() { return SIZE_KEY + '_' + location.hostname; }
  function getSiteVisibleKey() { return SITE_VISIBLE_KEY + location.hostname; }

  // ─── 站点特定配置 ────────────────────────────────────────────────────────────
  const SITE_SETTINGS = {
    'jianshu.com': { contentSelector: '.ouvJEz', offset: 20 },
    'zhuanlan.zhihu.com': { contentSelector: 'article', offset: 56 },
    'www.zhihu.com': { contentSelector: '.reader-chapter-content', offset: 56 },
    'mp.weixin.qq.com': { contentSelector: '.rich_media_content', offset: 20 },
    'cnodejs.org': { contentSelector: '#content', offset: 20 },
    'blog.csdn.net': { contentSelector: '#mainBox', offset: 60 },
    'www.csdn.net': { offset: 60 },
    'juejin.cn': {
      contentSelector: function () { return location.pathname.includes('/book/') ? '.book-body' : '.article'; },
      offset: 20
    },
    'dev.to': { contentSelector: 'article', offset: 56 },
    'medium.com': { contentSelector: 'article' },
    'github.com': {
      contentSelector: function () {
        var selectors = ['.entry-content', '#wiki-body', '.comment .comment-body'];
        return selectors.find(function (s) { return document.querySelector(s); }) || null;
      },
      offset: 60
    },
    'developer.mozilla.org': { contentSelector: '#content' },
    'docs.djangoproject.com': { contentSelector: '#docs-content' },
    'www.cnblogs.com': { contentSelector: '#main' },
    'vuejs.org': { contentSelector: 'main > div' },
    'reddit.com': { contentSelector: '[data-testid="post-container"]', offset: 20 },
  };

  function getSiteConfig() {
    var hostname = location.hostname;
    return SITE_SETTINGS[hostname] || null;
  }

  // ─── 样式注入 ─────────────────────────────────────────────────────────────────
  var TOCReaderStyle = '\n\
    /* ── 强制格式统一与全局盒模型 ── */\n\
    #' + PANEL_ID + ' * {\n\
      box-sizing: border-box !important;\n\
    }\n\
\n\
    /* ── 悬浮按钮 ── */\n\
    #' + TOGGLE_ID + ' {\n\
      position: fixed;\n\
      top: 50%;\n\
      right: 0;\n\
      transform: translateY(-50%);\n\
      z-index: 999999;\n\
      background: linear-gradient(135deg, #6366f1, #8b5cf6);\n\
      color: #fff;\n\
      border: none;\n\
      border-radius: 8px 0 0 8px;\n\
      padding: 10px 6px;\n\
      cursor: move;\n\
      font-size: 13px;\n\
      font-weight: 600;\n\
      writing-mode: vertical-rl;\n\
      letter-spacing: 3px;\n\
      box-shadow: -2px 0 12px rgba(99,102,241,0.4);\n\
      transition: all 0.25s cubic-bezier(.4,0,.2,1);\n\
      user-select: none;\n\
    }\n\
    #' + TOGGLE_ID + ':hover {\n\
      background: linear-gradient(135deg, #4f46e5, #7c3aed);\n\
      padding-right: 10px;\n\
      box-shadow: -4px 0 20px rgba(99,102,241,0.5);\n\
    }\n\
    #' + TOGGLE_ID + '.dragging { cursor: grabbing; opacity: 0.8; }\n\
\n\
    /* ── 面板主体 ── */\n\
    #' + PANEL_ID + ' {\n\
      position: fixed;\n\
      top: 60px;\n\
      right: 16px;\n\
      width: 280px;\n\
      height: 60%;\n\
      min-width: 200px;\n\
      min-height: 200px;\n\
      max-width: 520px;\n\
      max-height: 90vh;\n\
      z-index: 999998;\n\
      background: var(--toc-bg, #ffffff);\n\
      border: 1px solid var(--toc-border, rgba(0,0,0,0.08));\n\
      border-radius: 12px;\n\
      box-shadow: 0 8px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04);\n\
      display: flex;\n\
      flex-direction: column;\n\
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;\n\
      font-size: 14px;\n\
      color: var(--toc-text, #1f2937);\n\
      overflow: hidden;\n\
      transition: opacity 0.25s cubic-bezier(.4,0,.2,1), transform 0.25s cubic-bezier(.4,0,.2,1), background 0.3s, border-color 0.3s;\n\
    }\n\
    #' + PANEL_ID + '.hidden {\n\
      opacity: 0;\n\
      pointer-events: none;\n\
      transform: translateX(24px) scale(0.97);\n\
    }\n\
\n\
    /* ── 深色主题 ── */\n\
    #' + PANEL_ID + '[colorscheme="dark"] {\n\
      --toc-bg: #1a1b2e;\n\
      --toc-border: rgba(255,255,255,0.08);\n\
      --toc-text: #e5e7eb;\n\
      --toc-muted: #6b7280;\n\
      --toc-item-hover: rgba(99,102,241,0.12);\n\
      --toc-item-active: rgba(99,102,241,0.2);\n\
      --toc-active-color: #a5b4fc;\n\
      --toc-header-bg: linear-gradient(135deg, #312e81, #4338ca);\n\
      --toc-scrollbar: #374151;\n\
    }\n\
\n\
    /* ── 亮色主题变量 ── */\n\
    #' + PANEL_ID + '[colorscheme="light"] {\n\
      --toc-bg: #ffffff;\n\
      --toc-border: rgba(0,0,0,0.08);\n\
      --toc-text: #1f2937;\n\
      --toc-muted: #9ca3af;\n\
      --toc-item-hover: rgba(99,102,241,0.06);\n\
      --toc-item-active: rgba(99,102,241,0.12);\n\
      --toc-active-color: #4f46e5;\n\
      --toc-header-bg: linear-gradient(135deg, #6366f1, #8b5cf6);\n\
      --toc-scrollbar: #e5e7eb;\n\
    }\n\
\n\
    /* ── 自定义调整大小手柄 ── */\n\
    .toc-resize-handle {\n\
      position: absolute;\n\
      right: 0; bottom: 0;\n\
      width: 18px; height: 18px;\n\
      cursor: nwse-resize;\n\
      z-index: 10;\n\
    }\n\
    .toc-resize-handle::before,\n\
    .toc-resize-handle::after {\n\
      content: "";\n\
      position: absolute;\n\
      border-radius: 1px;\n\
      transition: opacity 0.2s;\n\
    }\n\
    .toc-resize-handle::before {\n\
      right: 4px; bottom: 4px;\n\
      width: 8px; height: 1.5px;\n\
      background: var(--toc-muted, #9ca3af);\n\
      transform: rotate(-45deg);\n\
    }\n\
    .toc-resize-handle::after {\n\
      right: 4px; bottom: 4px;\n\
      width: 5px; height: 1.5px;\n\
      background: var(--toc-muted, #9ca3af);\n\
      transform: rotate(-45deg);\n\
      bottom: 7px; right: 2px;\n\
    }\n\
    .toc-resize-handle:hover::before,\n\
    .toc-resize-handle:hover::after { opacity: 1; background: var(--toc-active-color, #6366f1); }\n\
\n\
    /* ── 头部 ── */\n\
    .toc-header {\n\
      display: flex;\n\
      align-items: center;\n\
      justify-content: space-between;\n\
      padding: 9px 12px;\n\
      background: var(--toc-header-bg, linear-gradient(135deg, #6366f1, #8b5cf6));\n\
      color: #fff;\n\
      cursor: move;\n\
      user-select: none;\n\
      flex-shrink: 0;\n\
      backdrop-filter: blur(8px);\n\
    }\n\
    .toc-header-title {\n\
      font-weight: 600;\n\
      font-size: 12.5px;\n\
      display: flex;\n\
      align-items: center;\n\
      gap: 6px;\n\
      letter-spacing: 0.3px;\n\
    }\n\
    .toc-header-actions { display: flex; gap: 3px; }\n\
    .toc-btn {\n\
      background: rgba(255,255,255,0.15);\n\
      border: none;\n\
      color: #fff;\n\
      border-radius: 6px;\n\
      padding: 3px 7px;\n\
      cursor: pointer;\n\
      font-size: 12px;\n\
      line-height: 1;\n\
      transition: all 0.15s;\n\
      display: flex;\n\
      align-items: center;\n\
      justify-content: center;\n\
    }\n\
    .toc-btn:hover { background: rgba(255,255,255,0.28); transform: scale(1.08); }\n\
    .toc-btn:active { transform: scale(0.95); }\n\
\n\
    /* ── 目录列表 ── */\n\
    .toc-body {\n\
      overflow-y: auto;\n\
      padding: 2px 0;\n\
      flex: 1;\n\
      min-height: 0;\n\
    }\n\
    .toc-body::-webkit-scrollbar { width: 3px; }\n\
    .toc-body::-webkit-scrollbar-track { background: transparent; }\n\
    .toc-body::-webkit-scrollbar-thumb { background: var(--toc-scrollbar, #e5e7eb); border-radius: 3px; }\n\
    .toc-body::-webkit-scrollbar-thumb:hover { background: var(--toc-muted, #9ca3af); }\n\
\n\
    .toc-item {\n\
      display: flex;\n\
      align-items: center;\n\
      padding: 2px 10px 2px;\n\
      cursor: pointer;\n\
      color: var(--toc-text, #1f2937);\n\
      line-height: 1.5;\n\
      font-size: 13px;\n\
      transition: all 0.12s ease;\n\
      border-left: 2.5px solid transparent;\n\
      position: relative;\n\
      gap: 5px;\n\
    }\n\
    .toc-item:hover {\n\
      background: var(--toc-item-hover, rgba(99,102,241,0.06));\n\
      color: var(--toc-active-color, #4f46e5);\n\
      border-left-color: var(--toc-active-color, #4f46e5);\n\
    }\n\
    .toc-item.active {\n\
      background: var(--toc-item-active, rgba(99,102,241,0.12));\n\
      color: var(--toc-active-color, #4f46e5);\n\
      border-left-color: var(--toc-active-color, #4f46e5);\n\
      font-weight: 600;\n\
    }\n\
\n\
    /* 强力隔离网页文本样式干扰 */\n\
    .toc-text {\n\
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;\n\
      font-size: inherit !important;\n\
      font-weight: inherit !important;\n\
      font-style: normal !important;\n\
      text-decoration: none !important;\n\
      text-transform: none !important;\n\
      letter-spacing: normal !important;\n\
      word-spacing: normal !important;\n\
      line-height: 1.5 !important;\n\
      background: transparent !important;\n\
      color: inherit !important;\n\
      margin: 0 !important;\n\
      padding: 0 !important;\n\
      overflow: hidden !important;\n\
      text-overflow: ellipsis !important;\n\
      white-space: nowrap !important;\n\
      flex: 1 !important;\n\
      min-width: 0 !important;\n\
    }\n\
\n\
    /* ── 折叠按钮 ── */\n\
    .toc-collapse-btn {\n\
      width: 14px; height: 14px;\n\
      display: inline-flex;\n\
      align-items: center;\n\
      justify-content: center;\n\
      color: var(--toc-muted, #9ca3af);\n\
      cursor: pointer;\n\
      font-size: 8px;\n\
      transition: transform 0.2s cubic-bezier(.4,0,.2,1), color 0.15s;\n\
      flex-shrink: 0;\n\
      border-radius: 3px;\n\
    }\n\
    .toc-collapse-btn:hover { color: var(--toc-active-color, #6366f1); background: var(--toc-item-hover, rgba(99,102,241,0.06)); }\n\
    .toc-collapse-btn.collapsed { transform: rotate(-90deg); }\n\
    .toc-collapse-btn.empty { visibility: hidden; }\n\
\n\
    /* ── 标题级别圆点 ── */\n\
    .toc-level-dot {\n\
      width: 4px; height: 4px;\n\
      border-radius: 50%;\n\
      flex-shrink: 0;\n\
      background: var(--toc-muted, #d1d5db);\n\
      transition: all 0.15s;\n\
    }\n\
    .toc-item[data-level="1"] .toc-level-dot { background: #6366f1; width: 6px; height: 6px; box-shadow: 0 0 4px rgba(99,102,241,0.4); }\n\
    .toc-item[data-level="2"] .toc-level-dot { background: #8b5cf6; width: 5px; height: 5px; }\n\
    .toc-item[data-level="3"] .toc-level-dot { background: #a78bfa; }\n\
    .toc-item[data-level="4"] .toc-level-dot { background: #c084fc; }\n\
    .toc-item[data-level="5"] .toc-level-dot { background: #e879f9; width: 3px; height: 3px; }\n\
    .toc-item[data-level="6"] .toc-level-dot { background: #f472b6; width: 3px; height: 3px; }\n\
\n\
    .toc-item[data-level="1"] { padding-left: 10px; font-size: 13.5px; font-weight: 600; }\n\
    .toc-item[data-level="2"] { padding-left: 18px; font-size: 13px; }\n\
    .toc-item[data-level="3"] { padding-left: 24px; font-size: 12.5px; }\n\
    .toc-item[data-level="4"] { padding-left: 30px; font-size: 12.5px; color: var(--toc-muted, #6b7280); }\n\
    .toc-item[data-level="5"] { padding-left: 36px; font-size: 12px; color: var(--toc-muted, #6b7280); }\n\
    .toc-item[data-level="6"] { padding-left: 42px; font-size: 12px; color: var(--toc-muted, #6b7280); }\n\
    .toc-item[data-level="1"].active, .toc-item[data-level="2"].active { color: var(--toc-active-color, #4f46e5); }\n\
    .toc-item[data-level="3"].active, .toc-item[data-level="4"].active,\n\
    .toc-item[data-level="5"].active, .toc-item[data-level="6"].active {\n\
      color: var(--toc-active-color, #4f46e5); font-weight: 600;\n\
    }\n\
\n\
    .toc-children.collapsed { display: none; }\n\
\n\
    .toc-empty {\n\
      padding: 32px 16px;\n\
      text-align: center;\n\
      color: var(--toc-muted, #9ca3af);\n\
      font-size: 12px;\n\
      line-height: 1.6;\n\
    }\n\
    .toc-empty-icon { font-size: 28px; margin-bottom: 8px; opacity: 0.5; }\n\
\n\
    /* ── Toast ── */\n\
    #toc-reader-toast {\n\
      position: fixed;\n\
      left: 50%; bottom: 28px;\n\
      transform: translateX(-50%) translateY(12px);\n\
      z-index: 999999;\n\
      background: rgba(17,24,39,0.88);\n\
      backdrop-filter: blur(12px);\n\
      color: #fff;\n\
      font-size: 12.5px;\n\
      padding: 8px 16px;\n\
      border-radius: 8px;\n\
      opacity: 0;\n\
      transition: all 0.25s cubic-bezier(.4,0,.2,1);\n\
      pointer-events: none;\n\
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);\n\
    }\n\
    #toc-reader-toast.show {\n\
      opacity: 1;\n\
      transform: translateX(-50%) translateY(0);\n\
    }\n\
  ';
  GM_addStyle(TOCReaderStyle);

  // ─── 工具函数 ─────────────────────────────────────────────────────────────────
  function showToast(message, duration) {
    duration = duration || 1800;
    var el = document.getElementById('toc-reader-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toc-reader-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () { el.classList.remove('show'); }, duration);
  }

  function isVisible(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function getHeadings() {
    var config = getSiteConfig();
    var selector = config && config.contentSelector;
    var root;
    if (selector) {
      if (typeof selector === 'function') selector = selector();
      root = document.querySelector(selector);
    } else {
      root = document.body;
    }
    if (!root) return [];
    var nodes = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    return nodes.filter(function (el) {
      var text = getHeadingText(el);
      return isVisible(el) && isValidHeadingText(text) && text.length < 300;
    });
  }

  function isValidHeadingText(text) {
    if (!text || text.length < 2) return false;
    var lower = text.toLowerCase().trim();
    if (lower === 'undefined' || lower === 'null' || lower === 'nan' || lower === 'loading...' || lower === 'loading') return false;
    if (/^\S+\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|json|xml|html?)$/i.test(text)) return false;
    var inv = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200b\ufeff]/g) || []).length;
    if (inv / text.length > 0.3) return false;
    return true;
  }

  function getHeadingText(el) {
    var itTarget = el.querySelector('.immersive-translate-target-wrapper .immersive-translate-target') ||
                   el.querySelector('.immersive-translate-target');
    if (itTarget && itTarget.innerText && itTarget.innerText.trim()) {
      return itTarget.innerText.trim().replace(/\s+/g, ' ');
    }
    var text = el.innerText || el.textContent;
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function ensureId(el, idx) {
    if (!el.id) {
      var id = el.getAttribute('id');
      if (!id) {
        var anchor = el.querySelector('.anchor') || el.querySelector('a');
        if (anchor) id = anchor.getAttribute('id') || (anchor.hash || '').replace(/^#/, '');
      }
      if (!id) {
        id = 'toc-anchor-' + idx;
        el.setAttribute('id', id);
      }
      el.id = id;
    }
    return el.id;
  }

  function getFixedHeaderHeight() {
    var config = getSiteConfig();
    var customOffset = (config && typeof config.offset === 'number') ? config.offset : 0;
    var maxH = 0;

    var selectors = ['header', 'nav', '.header', '.navbar', '.AppHeader', '#header', '#csdn-toolbar'];
    document.querySelectorAll(selectors.join(',')).forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.top <= 10 && rect.width > window.innerWidth * 0.5 && rect.height > 10 && rect.height < 250) {
        var style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          maxH = Math.max(maxH, rect.height);
        }
      }
    });

    var topEl = document.elementFromPoint(window.innerWidth / 2, 5);
    if (topEl && topEl.tagName !== 'BODY' && topEl.tagName !== 'HTML') {
      var style = window.getComputedStyle(topEl);
      if (style.position === 'fixed' || style.position === 'sticky') {
        maxH = Math.max(maxH, topEl.getBoundingClientRect().height);
      }
    }

    return Math.max(customOffset, maxH) + 15;
  }

  function scrollToHeading(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var offset = getFixedHeaderHeight();
    var rect = el.getBoundingClientRect();
    var scrollTop = window.scrollY + rect.top - offset;
    window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
  }

  // ─── 构建面板 ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('colorscheme', 'light');

    panel.innerHTML = '<div class="toc-header" id="toc-drag-handle">' +
      '<div class="toc-header-title"><span style="font-size:14px">\u2630</span> \u76EE\u5F55</div>' +
      '<div class="toc-header-actions">' +
      '<button class="toc-btn" id="toc-lock-btn" title="\u7981\u6B62\u5728\u672C\u7AD9\u542F\u7528">\uD83D\uDD12</button>' + // 🔒 表示禁止
      '<button class="toc-btn" id="toc-theme-btn" title="\u5207\u6362\u4E3B\u9898">\uD83C\uDF19</button>' +
      '<button class="toc-btn" id="toc-collapse-btn" title="\u6298\u53E0/\u5C55\u5F00">\u25BE</button>' +
      '<button class="toc-btn" id="toc-refresh-btn" title="\u5237\u65B0">\u21BA</button>' +
      '<button class="toc-btn" id="toc-close-btn" title="\u5173\u95ED">\u2715</button>' +
      '</div></div>' +
      '<div class="toc-body" id="toc-body"></div>' +
      '<div class="toc-resize-handle" id="toc-resize-handle"></div>';

    return panel;
  }

  function buildToggleBtn() {
    var btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.textContent = '\u76EE\u5F55';
    btn.title = '\u663E\u793A/\u9690\u85CF\u7F51\u9875\u76EE\u5F55';
    return btn;
  }

  // ─── 渲染目录列表 ─────────────────────────────────────────────────────────────
  var headingData = [];
  var treeData = [];

  function buildTocTree(headings) {
    var tree = [];
    var stack = [];
    headings.forEach(function (heading) {
      var node = {
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

  function renderToc() {
    var body = document.getElementById('toc-body');
    if (!body) return;
    body.innerHTML = '';
    if (headingData.length === 0) {
      body.innerHTML = '<div class="toc-empty"><div class="toc-empty-icon">\uD83D\uDCC4</div>\u672A\u68C0\u6D4B\u5230\u6807\u9898\u7ED3\u6784</div>';
      return;
    }
    treeData = buildTocTree(headingData);
    renderTree(treeData, body, 0);
  }

  function renderTree(nodes, container, depth) {
    nodes.forEach(function (node) {
      var item = document.createElement('div');
      item.className = 'toc-item';
      item.dataset.level = node.level;
      item.dataset.id = node.id;

      var collapseBtn = document.createElement('span');
      collapseBtn.className = 'toc-collapse-btn';
      if (node.children.length > 0) {
        collapseBtn.innerHTML = '\u25BC';
        collapseBtn.title = '\u6298\u53E0/\u5C55\u5F00';
        collapseBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleChildren(item);
        });
      } else {
        collapseBtn.className += ' empty';
      }

      var dot = document.createElement('span');
      dot.className = 'toc-level-dot';

      var text = document.createElement('span');
      text.className = 'toc-text';
      text.textContent = node.text;
      text.title = node.text;

      item.appendChild(collapseBtn);
      item.appendChild(dot);
      item.appendChild(text);

      item.addEventListener('click', function () {
        document.querySelectorAll('.toc-item').forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');
        scrollFollowPaused = true;
        clearTimeout(scrollPauseTimer);
        scrollPauseTimer = setTimeout(function () { scrollFollowPaused = false; }, 2000);
        scrollToHeading(node.id);
      });

      container.appendChild(item);

      if (node.children.length > 0) {
        var childContainer = document.createElement('div');
        childContainer.className = 'toc-children';
        container.appendChild(childContainer);
        renderTree(node.children, childContainer, depth + 1);
      }
    });
  }

  function toggleChildren(item) {
    var childContainer = item.nextElementSibling;
    if (childContainer && childContainer.classList.contains('toc-children')) {
      var isCollapsed = childContainer.classList.toggle('collapsed');
      var btn = item.querySelector('.toc-collapse-btn');
      if (btn) btn.classList.toggle('collapsed', isCollapsed);
    }
  }

  function getNodePath(nodeId) {
    function findParent(nodes, targetId, currentPath) {
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.id === targetId) return currentPath.concat(node.id);
        if (node.children.length > 0) {
          var result = findParent(node.children, targetId, currentPath.concat(node.id));
          if (result) return result;
        }
      }
      return null;
    }
    return findParent(treeData, nodeId, []) || [nodeId];
  }

  // 🌟 核心修复1：重构刷新和强制隐藏逻辑
  function refreshHeadings() {
    var headings = getHeadings();
    var panel = document.getElementById(PANEL_ID);
    var toggle = document.getElementById(TOGGLE_ID);
    
    if (!panel || !toggle) return;

    headingData = headings.map(function (el, idx) {
      return {
        level: parseInt(el.tagName[1]),
        text: getHeadingText(el),
        id: ensureId(el, idx),
        el: el
      };
    });

    // 少于等于 1 个标题时，面板和按钮全部强制隐藏
    if (headingData.length <= 1) {
      panel.classList.add('hidden');
      toggle.style.display = 'none';
      return;
    }

    renderToc();

    // 标题充足时，判断用户设定的展开/折叠状态
    var siteKey = getSiteVisibleKey();
    var visible = GM_getValue(siteKey, null);
    if (visible === null) visible = true; // 默认展开面板

    if (!visible) {
      panel.classList.add('hidden');
      toggle.style.display = ''; // 显示悬浮按钮（恢复默认 inline-block）
    } else {
      panel.classList.remove('hidden');
      toggle.style.display = 'none'; // 隐藏悬浮按钮
    }
  }

  // ─── 拖拽逻辑 ─────────────────────────────────────────────────────────────────
  function enableDrag(panel, handle) {
    var dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('.toc-btn')) return;
      dragging = true;
      var rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - ox));
      var y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - oy));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      var rect = panel.getBoundingClientRect();
      GM_setValue(getSitePositionKey(), { left: rect.left, top: rect.top });
    });
  }

  function enableResize(panel) {
    var handle = document.getElementById('toc-resize-handle');
    if (!handle) return;
    var resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = panel.offsetWidth; startH = panel.offsetHeight;
    });
    document.addEventListener('mousemove', function (e) {
      if (!resizing) return;
      panel.style.width = Math.max(200, Math.min(520, startW + e.clientX - startX)) + 'px';
      panel.style.height = Math.max(200, Math.min(window.innerHeight * 0.9, startH + e.clientY - startY)) + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!resizing) return;
      resizing = false;
      GM_setValue(getSiteSizeKey(), { width: panel.style.width, height: panel.style.height });
    });
  }

  // ─── 滚动高亮 + 自动展开 ──────────────────────────────────────────────────────
  var lastActiveId = null;
  var scrollFollowPaused = false;
  var scrollPauseTimer = null;

  function setupScrollSpy() {
    var onScroll = function () {
      var fh = getFixedHeaderHeight();
      var scrollY = window.scrollY + fh + 20;
      var current = null;
      for (var i = headingData.length - 1; i >= 0; i--) {
        var id = headingData[i].id;
        var el = document.getElementById(id);
        if (el && (window.scrollY + el.getBoundingClientRect().top) <= scrollY) {
          current = id;
          break;
        }
      }
      if (current === lastActiveId) return;
      lastActiveId = current;
      document.querySelectorAll('.toc-item').forEach(function (item) {
        item.classList.toggle('active', item.dataset.id === current);
      });
      if (current && !scrollFollowPaused) {
        expandPathForId(current);
        var activeItem = document.querySelector('.toc-item[data-id="' + current + '"]');
        if (activeItem) activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 500);
  }

  function expandPathForId(nodeId) {
    var path = getNodePath(nodeId);
    path.forEach(function (id) {
      var item = document.querySelector('.toc-item[data-id="' + id + '"]');
      if (item) {
        var childContainer = item.nextElementSibling;
        if (childContainer && childContainer.classList.contains('toc-children') && childContainer.classList.contains('collapsed')) {
          childContainer.classList.remove('collapsed');
          var btn = item.querySelector('.toc-collapse-btn');
          if (btn) btn.classList.remove('collapsed');
        }
      }
    });
  }

  // ─── 主题管理 ─────────────────────────────────────────────────────────────────
  function setTheme(mode, persist) {
    var panel = document.getElementById(PANEL_ID);
    var toggleBtn = document.getElementById('toc-theme-btn');
    if (!panel || !toggleBtn) return;
    var isDark;
    if (mode === 'auto') {
      isDark = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) || false;
    } else {
      isDark = mode === 'dark';
    }
    panel.setAttribute('colorscheme', isDark ? 'dark' : 'light');
    toggleBtn.textContent = isDark ? '\u2600\uFE0F' : '\uD83C\uDF19';
    if (persist !== false) GM_setValue(THEME_KEY, mode);
  }

  function cycleTheme() {
    var current = GM_getValue(THEME_KEY, 'auto');
    var modes = ['auto', 'light', 'dark'];
    var next = modes[(modes.indexOf(current) + 1) % modes.length];
    setTheme(next);
    showToast(next === 'auto' ? '\u4E3B\u9898: \u8DDF\u968F\u7CFB\u7EDF' : next === 'light' ? '\u4E3B\u9898: \u4EAE\u8272' : '\u4E3B\u9898: \u6697\u8272');
  }

  function initThemeListener() {
    if (!window.matchMedia) return;
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (mql.addEventListener) mql.addEventListener('change', function () {
      if (GM_getValue(THEME_KEY, 'auto') === 'auto') setTheme('auto', false);
    });
  }

  // ─── 排除域名管理 ──────────────────────────────────────────────────────────────
  function getExcludedDomains() {
    return GM_getValue(EXCLUDED_DOMAINS_KEY, []);
  }
  function addExcludedDomain(domain) {
    var list = getExcludedDomains();
    if (list.indexOf(domain) === -1) { list.push(domain); GM_setValue(EXCLUDED_DOMAINS_KEY, list); }
  }
  function removeExcludedDomain(domain) {
    var list = getExcludedDomains();
    list = list.filter(function (d) { return d !== domain; });
    GM_setValue(EXCLUDED_DOMAINS_KEY, list);
  }
  function isDomainExcluded() {
    var domain = location.hostname;
    return getExcludedDomains().indexOf(domain) !== -1;
  }

  // ─── 菜单命令 ─────────────────────────────────────────────────────────────────
  function initMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    var excluded = isDomainExcluded();
    var toggleCommandName = excluded ? '✅ 启用本站目录 (移除排除)' : '❌ 禁用本站目录 (加入排除)';

    GM_registerMenuCommand(toggleCommandName, function () {
      if (excluded) {
        removeExcludedDomain(location.hostname);
        showToast('已启用本站目录，即将刷新页面');
      } else {
        addExcludedDomain(location.hostname);
        showToast('已禁用本站目录，即将刷新页面');
      }
      setTimeout(function() { location.reload(); }, 1000);
    });

    if (excluded) return;

    GM_registerMenuCommand('\u4E3B\u9898: \u8DDF\u968F\u7CFB\u7EDF', function () { setTheme('auto'); });
    GM_registerMenuCommand('\u4E3B\u9898: \u4EAE\u8272', function () { setTheme('light'); });
    GM_registerMenuCommand('\u4E3B\u9898: \u6697\u8272', function () { setTheme('dark'); });
    GM_registerMenuCommand('\u5237\u65B0\u76EE\u5F55', refreshHeadings);
  }

  // ─── 悬浮按钮拖拽 ───────────────────────────────────────────────────────────
  function enableToggleDrag(btn) {
    var dragging = false, hasMoved = false, startX = 0, startY = 0, startTop = 0;
    var savedPos = GM_getValue(TOGGLE_POS_KEY, null);
    if (savedPos) {
      var top = parseInt(savedPos.top);
      if (!isNaN(top) && top >= 0 && top <= window.innerHeight) {
        btn.style.top = savedPos.top + 'px';
        btn.style.right = savedPos.right + 'px';
      }
    }
    btn.addEventListener('mousedown', function (e) {
      dragging = true; hasMoved = false;
      startX = e.clientX; startY = e.clientY;
      startTop = btn.getBoundingClientRect().top;
      btn.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      if (!hasMoved) return;
      btn.style.top = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, startTop + dy)) + 'px';
      btn.style.transform = 'none';
    });
    document.addEventListener('mouseup', function () {
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
    initMenu();

    if (document.getElementById(PANEL_ID)) return;
    if (isDomainExcluded()) return;

    var panel = buildPanel();
    var toggle = buildToggleBtn();
    
    // 默认给 toggle 加上隐藏，这样在未加载完时不会闪烁出现
    toggle.style.display = 'none';
    
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    // 载入本站独立记录的位置和大小
    var savedPos = GM_getValue(getSitePositionKey(), null);
    if (savedPos) {
      panel.style.left = savedPos.left + 'px';
      panel.style.top = savedPos.top + 'px';
      panel.style.right = 'auto';
    }
    var savedSize = GM_getValue(getSiteSizeKey(), null);
    if (savedSize) {
      if (savedSize.width) panel.style.width = savedSize.width;
      if (savedSize.height) panel.style.height = savedSize.height;
    }

    // 初始化时交由 refreshHeadings 控制面板显示隐藏逻辑
    refreshHeadings();
    
    enableDrag(panel, document.getElementById('toc-drag-handle'));
    enableResize(panel);
    setupScrollSpy();
    setTheme(GM_getValue(THEME_KEY, 'auto'), false);
    initThemeListener();

    // 绑定禁止本站按钮事件 (锁按钮)
    document.getElementById('toc-lock-btn').addEventListener('click', function () {
      addExcludedDomain(location.hostname);
      document.getElementById(PANEL_ID).remove();
      document.getElementById(TOGGLE_ID).remove();
      showToast('\u5DF2\u7981\u6B62\u5728\u672C\u7AD9\u542F\u7528\uFF0C\u53EF\u901A\u8FC7\u83DC\u5355\u6062\u590D');
    });

    document.getElementById('toc-refresh-btn').addEventListener('click', refreshHeadings);

    document.getElementById('toc-collapse-btn').addEventListener('click', function () {
      var allCollapsed = document.querySelectorAll('.toc-children.collapsed').length > 0;
      document.querySelectorAll('.toc-children').forEach(function (el) { el.classList.toggle('collapsed', !allCollapsed); });
      document.querySelectorAll('.toc-collapse-btn').forEach(function (btn) {
        if (!btn.classList.contains('empty')) btn.classList.toggle('collapsed', !allCollapsed);
      });
      showToast(allCollapsed ? '\u5DF2\u5168\u90E8\u5C55\u5F00' : '\u5DF2\u5168\u90E8\u6298\u53E0');
    });

    document.getElementById('toc-theme-btn').addEventListener('click', cycleTheme);

    var siteKey = getSiteVisibleKey();
    document.getElementById('toc-close-btn').addEventListener('click', function () {
      panel.classList.add('hidden');
      toggle.style.display = '';
      GM_setValue(siteKey, false);
    });

    var headerEl = document.getElementById('toc-drag-handle');
    headerEl.addEventListener('dblclick', function (e) {
      if (e.target.closest('.toc-btn')) return;
      panel.classList.add('hidden');
      toggle.style.display = '';
      GM_setValue(siteKey, false);
    });

    toggle.addEventListener('click', function () {
      if (toggle.classList.contains('was-dragged')) { toggle.classList.remove('was-dragged'); return; }
      panel.classList.remove('hidden');
      toggle.style.display = 'none';
      GM_setValue(siteKey, true);
      refreshHeadings();
    });

    enableToggleDrag(toggle);

    // 🌟 核心修复2：全方位 SPA 路由劫持（专治 GitHub 的局部刷新）
    var handleSPA = function() {
      // 局部刷新需要时间渲染 DOM，所以设定延迟拉取
      setTimeout(refreshHeadings, 800);
      setTimeout(refreshHeadings, 2000); // 慢网兜底
    };

    // GitHub 和部分现代网站的专属事件
    document.addEventListener("turbo:render", handleSPA);
    document.addEventListener("turbo:load", handleSPA);
    document.addEventListener("pjax:end", handleSPA);

    // 通用 History 路由劫持
    var originalPushState = history.pushState;
    history.pushState = function() {
        originalPushState.apply(this, arguments);
        handleSPA();
    };
    var originalReplaceState = history.replaceState;
    history.replaceState = function() {
        originalReplaceState.apply(this, arguments);
        handleSPA();
    };
    window.addEventListener('popstate', handleSPA);

    // 经典 MutationObserver 备用
    var lastUrl = location.href;
    new MutationObserver(function () {
      if (location.href !== lastUrl) { 
        lastUrl = location.href; 
        handleSPA();
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
