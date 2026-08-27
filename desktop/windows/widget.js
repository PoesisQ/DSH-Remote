// DS Harness 应用内状态小组件（由 DSHarness.exe 注入 WebView2）
// 设计语言：与 DSH 界面一致的中性灰（#2C2C2E 卡片 / #e8eaed 主文字），
// 苹果式排版：大字重数字 + 细字距 overline + 发丝分隔线 + 轻字重。
(function () {
  if (window.__dshStatusWidget) return;
  window.__dshStatusWidget = true;

  // DSH 官方配色（取自前端主题 token）
  var C = {
    card: 'rgba(44,44,46,.82)',
    hairline: 'rgba(255,255,255,.07)',
    primary: '#e8eaed',
    bright: '#f9fafb',
    muted: '#9aa0a6',
    faint: '#81858c',
    foot: '#61666b'
  };

  function makeEl(tag, styles, html) {
    var e = document.createElement(tag);
    for (var k in styles) {
      // CSSOM setProperty 只认 kebab-case：camelCase 键会静默失效。
      // 此前 borderRadius/boxShadow/fontSize/letterSpacing/backdropFilter
      // 全部被忽略——尖角、无阴影、字号相同、无毛玻璃的根因。统一转换。
      var prop = k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
      try { e.style.setProperty(prop, styles[k], 'important'); } catch (err) {}
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  var MAXZ = '2147483647';

  var pill = makeEl('div', {
    position: 'fixed', left: '14px', bottom: '64px', zIndex: MAXZ,
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '3px 2px', background: 'transparent', border: 'none',
    color: C.primary, fontWeight: '300', letterSpacing: '.2px',
    font: '14px/1.4 "Segoe UI","Microsoft YaHei",system-ui,sans-serif',
    textShadow: '0 1px 4px rgba(0,0,0,.55)',
    whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none'
  });
  pill.id = 'dsh-status-pill';

  var tip = makeEl('div', {
    position: 'fixed', left: '14px', bottom: '110px', zIndex: MAXZ,
    width: '300px', boxSizing: 'border-box', padding: '18px 18px 14px',
    borderRadius: '24px', background: C.card,
    backdropFilter: 'blur(32px) saturate(1.3)',
    webkitBackdropFilter: 'blur(32px) saturate(1.3)',
    border: '1px solid rgba(255,255,255,.08)',
    boxShadow: '0 20px 56px rgba(0,0,0,.5), 0 2px 10px rgba(0,0,0,.3)',
    color: C.primary, font: '13px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif',
    display: 'none', cursor: 'default', userSelect: 'none'
  });
  tip.id = 'dsh-status-tip';

  function waveIcon(per) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '17');
    svg.setAttribute('height', '9');
    svg.setAttribute('viewBox', '0 0 17 9');
    svg.style.setProperty('display', 'block', 'important');
    svg.style.setProperty('flex', 'none', 'important');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    var color = per === 'off' ? '#8b95f8' : '#f5b83d';
    var d = per === 'off'
      ? 'M0.5,4.5 C3,4.5 4.5,9 8.5,9 C12.5,9 14,4.5 16.5,4.5'
      : 'M0.5,4.5 C3,4.5 4.5,0 8.5,0 C12.5,0 14,4.5 16.5,4.5';
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    try {
      svg.animate(
        [{ opacity: '1' }, { opacity: '.55' }, { opacity: '1' }],
        { duration: 2600, iterations: Infinity, easing: 'ease-in-out' }
      );
    } catch (e) {}
    return svg;
  }

  function setPillState(html) {
    pill.innerHTML = '';
    pill.appendChild(makeEl('span', {}, html));
  }

  function ensureAttached() {
    if (!document.body) return;
    // 始终把自己移到 body 末尾：同 z-index 时后出现的元素胜出，
    // 防止 SPA 重渲染后在 DOM 顺序上盖过本组件（对话区渐变遮挡的来源之一）
    document.body.appendChild(pill);
    document.body.appendChild(tip);
  }
  ensureAttached();
  document.addEventListener('DOMContentLoaded', ensureAttached);
  if (document.readyState !== 'loading') ensureAttached();

  setPillState('正在连接…');

  // ---- 自适应定位 ----
  var theme = { font: null, fontSize: 0 };
  var sidebarWidth = 0;

  function deepElementFromPoint(x, y) {
    try {
      var el = document.elementFromPoint(x, y);
      if (el && el.tagName === 'IFRAME') {
        try {
          var doc = el.contentDocument;
          if (doc) {
            var r = el.getBoundingClientRect();
            var inner = doc.elementFromPoint(x - r.left, y - r.top);
            if (inner) return { el: inner, frame: el };
          }
        } catch (e2) {}
      }
      return { el: el, frame: null };
    } catch (e) { return { el: null, frame: null }; }
  }

  function absRect(el, frame) {
    var r = el.getBoundingClientRect();
    if (frame) {
      var fr = frame.getBoundingClientRect();
      return { left: fr.left + r.left, top: fr.top + r.top, width: r.width, height: r.height };
    }
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function sampleAncestors(fromEl) {
    var el = fromEl ? fromEl.parentElement : null;
    var guard = 0;
    while (el && guard < 10) {
      var r = el.getBoundingClientRect();
      try {
        var cs = getComputedStyle(el);
        if (!theme.font && cs.fontFamily) theme.font = cs.fontFamily;
        if (!theme.fontSize) {
          var fs = parseFloat(cs.fontSize);
          if (!isNaN(fs) && fs > 0) theme.fontSize = fs;
        }
      } catch (e) {}
      if (!sidebarWidth && r.left <= 2 && r.width >= 140 && r.width <= 460 && r.height >= 300) {
        sidebarWidth = r.width;
      }
      el = el.parentElement;
      guard++;
    }
  }

  function reposition() {
    try {
      var found = deepElementFromPoint(36, window.innerHeight - 16);
      var el = found.el;
      var guard = 0;
      while (el && guard < 6) {
        if (el === pill || el === tip) { el = el.parentElement; guard++; continue; }
        var r = el.getBoundingClientRect();
        if (r.width >= 16 && r.width <= 220 && r.height >= 16 && r.height <= 140) {
          var rr = absRect(el, found.frame);
          pill.style.setProperty('left', Math.round(rr.left) + 'px', 'important');
          pill.style.setProperty('bottom', Math.round(window.innerHeight - rr.top + 10) + 'px', 'important');
          sampleAncestors(el);
          if (theme.font) {
            pill.style.setProperty('font-family', theme.font, 'important');
            tip.style.setProperty('font-family', theme.font, 'important');
          }
          if (theme.fontSize) {
            pill.style.setProperty('font-size', Math.max(14, Math.round(theme.fontSize)) + 'px', 'important');
          }
          var maxW = sidebarWidth > 0 ? Math.max(220, sidebarWidth - Math.round(rr.left) - 14) : 220;
          var w = Math.min(300, maxW);
          tip.style.setProperty('width', w + 'px', 'important');
          return;
        }
        el = el.parentElement;
        guard++;
      }
    } catch (e) {}
    pill.style.setProperty('left', '14px', 'important');
    pill.style.setProperty('bottom', '64px', 'important');
    tip.style.setProperty('width', '220px', 'important');
  }

  window.addEventListener('resize', reposition);

  function positionTip() {
    try {
      var r = pill.getBoundingClientRect();
      var left = Math.max(8, Math.round(r.left));
      tip.style.setProperty('left', left + 'px', 'important');
      tip.style.setProperty('bottom', Math.round(window.innerHeight - r.top + 10) + 'px', 'important');
    } catch (e) {}
  }

  // ---- 渲染 ----
  var last = null;
  var pillAnimated = false;
  var tipAnim = null;

  function money(n) { return '¥' + Number(n).toFixed(2); }
  function tok(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function seg(text, size, color, weight) {
    return makeEl('span', {
      fontSize: size, color: color, fontWeight: weight || '400',
      letterSpacing: '.1px', fontVariantNumeric: 'tabular-nums'
    }, text);
  }

  function row(label, segs) {
    var r = makeEl('div', {
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      padding: '9px 0', borderBottom: '1px solid ' + C.hairline
    }, '');
    r.appendChild(makeEl('span', { fontSize: '12px', color: C.muted, letterSpacing: '.4px' }, label));
    var v = makeEl('span', { display: 'inline-flex', alignItems: 'baseline', gap: '5px' }, '');
    for (var i = 0; i < segs.length; i++) {
      v.appendChild(seg(segs[i][0], segs[i][1], segs[i][2], segs[i][3]));
    }
    r.appendChild(v);
    return r;
  }

  function renderPill(d) {
    ensureAttached();
    reposition();
    if (d.error) {
      pill.textContent = '用量暂不可用';
      pill.title = '无法读取最新余额和时段，请稍后重试';
      return;
    }
    var per = d.nowPeriod === 'off' ? 'off' : 'peak';
    var cost = d.totalCost != null ? money(d.totalCost) : '—';
    pill.innerHTML = '';
    pill.appendChild(waveIcon(per));
    pill.appendChild(makeEl('span', { fontSize: '12.5px', color: C.muted, letterSpacing: '.3px' }, '本次'));
    pill.appendChild(makeEl('span', { fontSize: '15px', fontWeight: '500', color: C.bright, letterSpacing: '.1px', fontVariantNumeric: 'tabular-nums' }, cost));
    if (d.balance != null && d.balance !== '') {
      pill.appendChild(makeEl('span', { opacity: '.35' }, '·'));
      pill.appendChild(makeEl('span', { fontSize: '12px', color: C.muted, letterSpacing: '.2px' }, '余额 ' + esc(d.balance)));
    }
    pill.title =
      (per === 'off' ? '空闲时段（谷时）00:30–08:30' : '高峰时段 08:30–00:30') +
      ' · 本次 ' + cost +
      (d.balance != null && d.balance !== '' ? ' · 余额 ' + esc(d.balance) : '') +
      ' —— 悬停查看详情';
    if (!pillAnimated) {
      pillAnimated = true;
      try {
        pill.animate(
          [{ opacity: '0', transform: 'translateY(6px)' }, { opacity: '1', transform: 'translateY(0)' }],
          { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }
        );
      } catch (e) {}
    }
  }

  function renderTip(d) {
    tip.innerHTML = '';
    if (d.error) {
      tip.appendChild(makeEl('div', { margin: '0 0 6px', color: C.bright, fontSize: '14px', fontWeight: '600', letterSpacing: '.3px' }, 'DSH 用量'));
      tip.appendChild(makeEl('div', { color: '#f87171' }, esc(d.error)));
      return;
    }
    var per = d.nowPeriod === 'off' ? 'off' : 'peak';
    var p = d.peak || {}, o = d.offpeak || {};

    var head = makeEl('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 0 10px', borderBottom: '1px solid ' + C.hairline, marginBottom: '4px' }, '');
    head.appendChild(waveIcon(per));
    head.appendChild(makeEl('span', { fontSize: '14px', fontWeight: '600', letterSpacing: '.3px', color: C.bright }, 'DSH 用量'));
    tip.appendChild(head);

    tip.appendChild(row('本次费用', [['本次', '12px', C.muted], [money(d.totalCost), '16px', C.bright, '500']]));
    tip.appendChild(row('当前时段', per === 'off'
      ? [['空闲', '13px', '#8b95f8', '500'], ['00:30 – 08:30', '11.5px', C.faint]]
      : [['高峰', '13px', '#f5b83d', '500'], ['08:30 – 00:30', '11.5px', C.faint]]));
    tip.appendChild(row('高峰费用', [[money(p.cost || 0), '13.5px', C.primary]]));
    tip.appendChild(row('空闲费用', [[money(o.cost || 0), '13.5px', C.primary]]));
    tip.appendChild(row('账户余额', [[d.balance != null && d.balance !== '' ? (esc(d.balance) + ' ' + esc(d.currency)) : '—', '15px', C.bright, '500']]));

    var foot = makeEl('div', { fontSize: '10.5px', letterSpacing: '.3px', marginTop: '12px', lineHeight: '1.8' }, '');
    foot.appendChild(seg('缓存 ', '10.5px', C.foot));
    foot.appendChild(seg(tok((p.hit || 0) + (o.hit || 0)), '10.5px', C.muted));
    foot.appendChild(seg(' · 未命中 ', '10.5px', C.foot));
    foot.appendChild(seg(tok((p.miss || 0) + (o.miss || 0)), '10.5px', C.muted));
    foot.appendChild(seg(' · 输出 ', '10.5px', C.foot));
    foot.appendChild(seg(tok((p.out || 0) + (o.out || 0)), '10.5px', C.muted));
    tip.appendChild(foot);
    tip.appendChild(makeEl('div', {
      fontSize: '10.5px', color: C.foot, letterSpacing: '.3px'
    }, esc(d.model || '') + ' · ' + esc(d.updatedAt || '') + ' · 费用为估算，以账单为准'));
  }

  function onData(d) {
    if (!d || typeof d !== 'object') return;
    if (Number.isFinite(d.sampledAt)) d.updatedAt = new Date(d.sampledAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' 北京时间';
    last = d;
    renderPill(d);
    renderTip(d);
  }

  pill.addEventListener('mouseenter', function () {
    if (!last) return;
    renderTip(last);
    positionTip();
    tip.style.setProperty('display', 'block', 'important');
    if (tipAnim) { try { tipAnim.cancel(); } catch (e) {} }
    try {
      tipAnim = tip.animate(
        [{ opacity: '0', transform: 'scale(.96) translateY(8px)' }, { opacity: '1', transform: 'scale(1) translateY(0)' }],
        { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }
      );
    } catch (e) {}
  });
  pill.addEventListener('mouseleave', function () {
    setTimeout(function () {
      if (tip.style.display === 'block' && !tip.matches(':hover')) {
        tip.style.setProperty('display', 'none', 'important');
      }
    }, 120);
  });
  tip.addEventListener('mouseenter', function () { tip.style.setProperty('display', 'block', 'important'); });
  tip.addEventListener('mouseleave', function () { tip.style.setProperty('display', 'none', 'important'); });

  // 桥接对象 window.chrome.webview 在文档创建时尚不可用，轮询等待（不设上限）
  var bridgeReady = false;
  function request() {
    try { window.chrome.webview.postMessage('getStatus'); } catch (e) {}
  }
  function tryBridge() {
    if (bridgeReady) return true;
    if (!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage)) return false;
    bridgeReady = true;
    setPillState('用量统计中…');
    window.chrome.webview.addEventListener('message', function (ev) { onData(ev.data); });
    try { window.chrome.webview.postMessage('widgetReady'); } catch (e) {}
    request();
    setInterval(request, 30000);
    return true;
  }
  var bridgeTimer = setInterval(function () {
    if (tryBridge()) clearInterval(bridgeTimer);
  }, 200);
  tryBridge();
})();
