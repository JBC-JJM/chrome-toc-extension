// ==UserScript==
// @name         网页目录阅读器 (TOC Reader)
// @namespace    https://github.com/JBC-JJM/chrome-toc-extension
// @version      1.7.1
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

  // ─── 常量 ─────────────────────────────────────────────────────────
  const PANEL_ID = 'toc-reader-panel';
  const TOGGLE_ID = 'toc-reader-toggle';
  const STORAGE_KEY = 'toc_reader_visible';
  const THEME_KEY = 'toc_reader_theme';
  const POSITION_KEY = 'toc_reader_position';
  const COLLAPSE_KEY = 'toc_reader_collapse';
  const SIZE_KEY = 'toc_reader_size';
  const TOGGLE_POS_KEY = 'toc_reader_toggle_pos';
  const SITE_VISIBLE_KEY = 'toc_reader_site_visible_';
  const EXCLUDED_DOMAINS_KEY = 'toc_reader_excluded_domains';

  // ─── 站点特定配置 ─────────────────────────────────────────────────
  const SITE_SETTINGS = {
    'jianshu.com': { contentSelector: '.ouvJEz', scrollSmoothOffset: -20 },
    // 可在此添加其他站点的 contentSelector
  };

  // ─── 获取站点配置 ─────────────────────────────────────────────────
  function getSiteConfig() {
    let hostname = location.hostname;
    return SITE_SETTINGS[hostname] || null;
  }

  // ─── 标题提取与过滤 ──────────────────────────────────────────────
  function getHeadings() {
    let config = getSiteConfig();
    let selector = config && config.contentSelector;
    let root;
    if (selector) {
      if (typeof selector === 'function') selector = selector();
      root = document.querySelector(selector);
    }
    if (!root) root = document.body;
    // 查找所有 h1~h6
    var nodes = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    return nodes.filter(function (el) {
      // 排除头部、导航、侧栏、页脚等区域的标题
      if (el.closest('header, nav, aside, .sidebar, footer')) return false;
      let text = getHeadingText(el);
      // 仅过滤空文本或过短文本
      return text && text.length > 1;
    });
  }

  // 获取标题文本内容（兼容翻译插件等），最终回退使用原始 textContent
  function getHeadingText(el) {
    // (1) 查找沉浸式翻译的目标元素
    let itTarget = el.querySelector('.immersive-translate-target-wrapper .immersive-translate-target');
    if (itTarget && itTarget.textContent.trim()) {
      return itTarget.textContent.trim();
    }
    let itTarget2 = el.querySelector('.immersive-translate-target');
    if (itTarget2 && itTarget2.textContent.trim()) {
      return itTarget2.textContent.trim();
    }
    // (2) 如果原文隐藏，找可见的子节点
    let children = el.children;
    for (let i = 0; i < children.length; i++) {
      let child = children[i];
      let cls = child.className || '';
      if (cls.indexOf('immersive-translate') !== -1 && child.textContent.trim()) {
        let style = window.getComputedStyle(child);
        if (style.display !== 'none') {
          return child.textContent.trim();
        }
      }
    }
    // (3) 找第一个可见子文本节点
    let allChildren = el.querySelectorAll('*');
    for (let j = 0; j < allChildren.length; j++) {
      let c = allChildren[j];
      if (c.textContent.trim() && c.children.length === 0) {
        let s = window.getComputedStyle(c);
        if (s.display !== 'none' && s.visibility !== 'hidden') {
          return c.textContent.trim();
        }
      }
    }
    // (4) 回退：取元素的 textContent
    return el.textContent.trim();
  }

  // 确保每个标题有唯一 ID，以便跳转
  function ensureId(el, idx) {
    if (!el.id) {
      let id = el.getAttribute('id');
      if (!id) {
        let anchor = el.querySelector('.anchor') || el.querySelector('a');
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

  // ─── 站点可见性开关（排除域名列表）────────────────────────────────
  function getExcludedDomains() {
    // 从 localStorage 中读取域名数组
    let json = localStorage.getItem(EXCLUDED_DOMAINS_KEY) || '[]';
    try {
      return JSON.parse(json);
    } catch (e) {
      return [];
    }
  }
  function addExcludedDomain(domain) {
    let list = getExcludedDomains();
    if (!list.includes(domain)) {
      list.push(domain);
      localStorage.setItem(EXCLUDED_DOMAINS_KEY, JSON.stringify(list));
    }
  }
  function removeExcludedDomain(domain) {
    let list = getExcludedDomains().filter(d => d !== domain);
    localStorage.setItem(EXCLUDED_DOMAINS_KEY, JSON.stringify(list));
  }
  function isDomainExcluded() {
    return getExcludedDomains().indexOf(location.hostname) !== -1;
  }
  // 如果当前域名在排除列表中，则退出不显示目录
  if (isDomainExcluded()) { return; }

  // ─── 计算固定头部高度偏移 ──────────────────────────────────────────
  function getHeaderOffset() {
    let maxOffset = 0;
    // 常见的页头选择器
    let selectors = ['header', '.header', '.navbar', '.top-nav', '#header'];
    selectors.forEach(function(sel) {
      let el = document.querySelector(sel);
      if (!el) return;
      let style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        let h = el.offsetHeight || 0;
        let mb = parseInt(style.marginBottom) || 0;
        maxOffset = Math.max(maxOffset, h + mb);
      }
    });
    return maxOffset;
  }

  // ─── 滚动跳转到标题 ───────────────────────────────────────────────
  function getScrollOffset() {
    let config = getSiteConfig();
    return (config && config.scrollSmoothOffset) || 0;
  }
  function scrollToHeading(id) {
    let el = document.getElementById(id);
    if (!el) return;
    // 计算头部偏移
    let headerOffset = getHeaderOffset();
    let rect = el.getBoundingClientRect();
    // 目标滚动位置 = 当前 scrollY + 元素 top - 头部偏移
    let targetY = window.scrollY + rect.top - headerOffset;
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }

  // ─── 构建目录面板 ──────────────────────────────────────────────────
  function buildPanel() {
    let panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('colorscheme', 'light');
    panel.innerHTML = 
      '<div class="toc-header" id="toc-drag-handle">' +
        '<div class="toc-header-title"><span style="font-size:14px">&#9776;</span> 目录</div>' +
        '<div class="toc-header-actions">' +
          '<button class="toc-btn" id="toc-theme-btn" title="切换主题">🌙</button>' +
          '<button class="toc-btn" id="toc-exclude-btn" title="本站不再显示">🔒</button>' +
          '<button class="toc-btn" id="toc-collapse-btn" title="折叠/展开">▾</button>' +
          '<button class="toc-btn" id="toc-refresh-btn" title="刷新">↻</button>' +
          '<button class="toc-btn" id="toc-close-btn" title="关闭">✖</button>' +
        '</div>' +
      '</div>' +
      '<div class="toc-body" id="toc-body"></div>' +
      '<div class="toc-resize-handle" id="toc-resize-handle"></div>';
    return panel;
  }
  function buildToggleBtn() {
    let btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.textContent = '目录';
    btn.title = '显示/隐藏本页目录';
    return btn;
  }

  // ─── 生成树状目录数据并渲染 ────────────────────────────────────────
  let headingData = [], treeData = [];
  function buildTocTree(headings) {
    let tree = [], stack = [];
    headings.forEach(function (heading) {
      let node = {
        level: heading.level,
        text: heading.text,
        id: heading.id,
        children: [],
        parent: null,
        el: heading.el
      };
      // 构建层级关系
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
    let body = document.getElementById('toc-body');
    if (!body) return;
    body.innerHTML = '';
    if (headingData.length === 0) {
      body.innerHTML = '<div class="toc-empty"><div class="toc-empty-icon">📄</div>未检测到标题结构</div>';
      return;
    }
    treeData = buildTocTree(headingData);
    // 递归渲染
    function renderTree(nodes, container) {
      nodes.forEach(function (node) {
        let item = document.createElement('div');
        item.className = 'toc-item';
        item.dataset.level = node.level;
        item.dataset.id = node.id;

        let collapseBtn = document.createElement('span');
        collapseBtn.className = 'toc-collapse-btn';
        if (node.children.length > 0) {
          collapseBtn.innerHTML = '▾';
          collapseBtn.title = '折叠/展开';
          collapseBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleChildren(item);
          });
        } else {
          collapseBtn.classList.add('empty');
        }

        let dot = document.createElement('span');
        dot.className = 'toc-level-dot';

        let text = document.createElement('span');
        text.className = 'toc-text';
        text.textContent = node.text;

        item.appendChild(collapseBtn);
        item.appendChild(dot);
        item.appendChild(text);

        item.addEventListener('click', function () {
          document.querySelectorAll('.toc-item').forEach(function (i) { i.classList.remove('active'); });
          item.classList.add('active');
          scrollToHeading(node.id);
        });

        container.appendChild(item);

        if (node.children.length > 0) {
          let childContainer = document.createElement('div');
          childContainer.className = 'toc-children collapsed';
          container.appendChild(childContainer);
          renderTree(node.children, childContainer);
        }
      });
    }
    renderTree(treeData, body);
  }
  function toggleChildren(item) {
    let sub = item.nextElementSibling;
    if (sub && sub.classList.contains('toc-children')) {
      let collapsed = sub.classList.toggle('collapsed');
      let btn = item.querySelector('.toc-collapse-btn');
      if (btn && !btn.classList.contains('empty')) {
        btn.classList.toggle('collapsed', collapsed);
      }
    }
  }

  // 构建并渲染目录数据
  function refreshHeadings() {
    let els = getHeadings();
    headingData = els.map(function (el, idx) {
      return {
        level: parseInt(el.tagName[1]),
        text: getHeadingText(el),
        id: ensureId(el, idx),
        el: el
      };
    });
    renderToc();
    let panel = document.getElementById(PANEL_ID);
    if (headingData.length === 0 && panel && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
    }
  }

  // ─── 拖拽和缩放功能 ────────────────────────────────────────────────
  function enableDrag(panel, handle) {
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('.toc-btn')) return;
      dragging = true;
      let rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      let x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - ox));
      let y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - oy));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      let rect = panel.getBoundingClientRect();
      // 保存位置（可用 GM_setValue 或 localStorage）
      GM_setValue(POSITION_KEY, { left: rect.left, top: rect.top });
    });
  }
  function enableResize(panel) {
    let handle = document.getElementById('toc-resize-handle');
    if (!handle) return;
    let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
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
      GM_setValue(SIZE_KEY, { width: panel.style.width, height: panel.style.height });
    });
  }

  // ─── 滚动监听：高亮当前章节 ─────────────────────────────────────
  let lastActiveId = null, scrollFollowPaused = false, scrollPauseTimer = null;
  function setupScrollSpy() {
    let offset = 100;
    window.addEventListener('scroll', function () {
      let scrollY = window.scrollY + offset;
      let current = null;
      for (let i = headingData.length - 1; i >= 0; i--) {
        let el = document.getElementById(headingData[i].id);
        if (el && el.getBoundingClientRect().top + window.scrollY <= scrollY) {
          current = headingData[i].id;
          break;
        }
      }
      if (current === lastActiveId) return;
      lastActiveId = current;
      document.querySelectorAll('.toc-item').forEach(function (item) {
        item.classList.toggle('active', item.dataset.id === current);
      });
    }, { passive: true });
    // 初始触发一次
    setTimeout(function () {
      window.dispatchEvent(new Event('scroll'));
    }, 500);
  }

  // ─── 主题管理（暗黑模式切换）────────────────────────────────────
  function setTheme(mode, persist = true) {
    let panel = document.getElementById(PANEL_ID);
    let toggleBtn = document.getElementById('toc-theme-btn');
    if (!panel || !toggleBtn) return;
    let isDark;
    if (mode === 'auto') {
      isDark = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) || false;
    } else {
      isDark = (mode === 'dark');
    }
    panel.setAttribute('colorscheme', isDark ? 'dark' : 'light');
    toggleBtn.textContent = isDark ? '☀️' : '🌙';
    if (persist) GM_setValue(THEME_KEY, mode);
  }
  function cycleTheme() {
    let modes = ['auto', 'light', 'dark'];
    let current = GM_getValue(THEME_KEY, 'auto');
    let next = modes[(modes.indexOf(current) + 1) % modes.length];
    setTheme(next);
    showToast(next === 'auto' ? '主题：跟随系统' : next === 'light' ? '主题：浅色' : '主题：深色');
  }
  function initThemeListener() {
    if (!window.matchMedia) return;
    let mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', function () {
      if (GM_getValue(THEME_KEY, 'auto') === 'auto') {
        setTheme('auto', false);
      }
    });
  }

  // 简易提示框（可根据需要替换为更美观 UI）
  function showToast(msg) {
    console.log('[TOC Reader] ' + msg);
  }

  // ─── 初始化函数 ────────────────────────────────────────────────────
  function init() {
    if (document.getElementById(PANEL_ID)) return; // 避免重复
    // 禁用域名检查
    if (isDomainExcluded()) return;

    let panel = buildPanel();
    let toggle = buildToggleBtn();
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    // 恢复面板位置和大小（GM_setValue 存储）
    let savedPos = GM_getValue(POSITION_KEY, null);
    if (savedPos) {
      panel.style.left = savedPos.left + 'px';
      panel.style.top = savedPos.top + 'px';
      panel.style.right = 'auto';
    }
    let savedSize = GM_getValue(SIZE_KEY, null);
    if (savedSize) {
      if (savedSize.width) panel.style.width = savedSize.width;
      if (savedSize.height) panel.style.height = savedSize.height;
    }
    // 默认首次访问显示目录
    let siteKey = SITE_VISIBLE_KEY + location.hostname;
    let visible = GM_getValue(siteKey, null);
    if (visible === null) visible = true;
    if (!visible) {
      panel.classList.add('hidden');
      toggle.style.display = '';
    } else {
      toggle.style.display = 'none';
    }

    // 构建目录
    refreshHeadings();
    enableDrag(panel, document.getElementById('toc-drag-handle'));
    enableResize(panel);
    setupScrollSpy();
    setTheme(GM_getValue(THEME_KEY, 'auto'), false);
    initThemeListener();

    // 按钮绑定
    document.getElementById('toc-refresh-btn').addEventListener('click', refreshHeadings);
    document.getElementById('toc-collapse-btn').addEventListener('click', function () {
      let allCollapsed = document.querySelectorAll('.toc-children.collapsed').length > 0;
      document.querySelectorAll('.toc-children').forEach(function (el) {
        el.classList.toggle('collapsed', !allCollapsed);
      });
      document.querySelectorAll('.toc-collapse-btn').forEach(function (btn) {
        if (!btn.classList.contains('empty')) {
          btn.classList.toggle('collapsed', !allCollapsed);
        }
      });
    });
    document.getElementById('toc-theme-btn').addEventListener('click', cycleTheme);
    document.getElementById('toc-close-btn').addEventListener('click', function () {
      panel.classList.add('hidden');
      toggle.style.display = '';
      GM_setValue(siteKey, false);
    });
    // 双击头部也关闭
    let headerEl = document.getElementById('toc-drag-handle');
    headerEl.addEventListener('dblclick', function (e) {
      if (!e.target.closest('.toc-btn')) {
        panel.classList.add('hidden');
        toggle.style.display = '';
        GM_setValue(siteKey, false);
      }
    });
    // Toggle 按钮事件
    toggle.addEventListener('click', function () {
      if (toggle.classList.contains('was-dragged')) {
        toggle.classList.remove('was-dragged');
        return;
      }
      panel.classList.remove('hidden');
      toggle.style.display = 'none';
      GM_setValue(siteKey, true);
      refreshHeadings();
    });
    // 排除本站按钮
    document.getElementById('toc-exclude-btn').addEventListener('click', function () {
      addExcludedDomain(location.hostname);
      showToast('已禁用：' + location.hostname + '（刷新后生效）');
      panel.remove();
      toggle.remove();
    });
    // Toggle 按钮可拖拽
    enableToggleDrag(toggle);

    // SPA 支持：监听地址变化
    let lastUrl = location.href;
    new MutationObserver(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(refreshHeadings, 500);
      }
    }).observe(document.body, { childList: true, subtree: true });

    // （可选）监听内容容器变化，自动刷新目录
    let contentRoot = document.querySelector(getSiteConfig()?.contentSelector || 'body');
    if (contentRoot) {
      new MutationObserver(function(muts) {
        for (let m of muts) {
          if (m.addedNodes.length) {
            refreshHeadings();
            break;
          }
        }
      }).observe(contentRoot, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
