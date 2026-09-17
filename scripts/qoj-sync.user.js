// ==UserScript==
// @name         XCPC Tracker QOJ Sync
// @namespace    https://github.com/mohaoz/xcpc-tracker
// @version      1.0.6
// @downloadURL  none
// @description  安装即允许 XCPC Tracker 主站通过浏览器读取 QOJ 主页做题状态；不导出 Cookie，不缓存结果。自动同步由站内开关控制。
// @match        https://mohaoz.github.io/xcpc-tracker/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_info
// @connect      qoj.ac
// @run-at       document-start
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  // Tampermonkey's sandbox window is a proxy, not MessageEvent.source.
  const pageWindow = unsafeWindow;
  const allowed = location.origin === 'https://mohaoz.github.io'
    ? location.pathname.startsWith('/xcpc-tracker/')
    : false; // DEV_ORIGIN_ALLOWLIST
  if (!allowed || pageWindow.top !== pageWindow) return;
  let active = null;
  let nextRequestAt = 0;
  const reply = (id, result, error) => pageWindow.postMessage({ protocol: 'xcpc-sync', version: 1,
    direction: 'response', request_id: id, result, error }, location.origin);
  const fail = (code, retryAfterMs) => ({ code, retry_after_ms: retryAfterMs || 0 });
  function parse(response, handle) {
    const url = new URL(response.finalUrl);
    if (url.origin !== 'https://qoj.ac') throw fail('PARSE_ERROR');
    if (url.pathname.startsWith('/login')) throw fail('AUTH_REQUIRED');
    if (response.status === 429) {
      const retry = /^retry-after:\s*(.+)$/im.exec(response.responseHeaders || '')?.[1]?.trim();
      const wait = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry || '') - Date.now();
      throw fail('RATE_LIMITED', Math.max(300000, Number.isFinite(wait) ? wait : 0));
    }
    if (response.status === 401) throw fail('AUTH_REQUIRED');
    if (response.status === 403 || /<title[^>]*>\s*(Just a moment|Attention Required)/i.test(response.responseText)) throw fail('CHALLENGE_REQUIRED');
    if (response.status === 404) throw fail('USER_NOT_FOUND');
    if (response.status !== 200) throw fail('NETWORK_ERROR');
    if (decodeURIComponent(url.pathname).replace(/\/$/, '') !== '/user/profile/' + handle) throw fail('PARSE_ERROR');
    const doc = new DOMParser().parseFromString(response.responseText, 'text/html');
    if (doc.querySelector('input[type="password"]')) throw fail('AUTH_REQUIRED');
    const headings = [...doc.querySelectorAll('.list-group-item-heading')];
    const accepted = headings.find(e => /Accepted problems|AC\s*[过過]的?题目|AC\s*過的?題目|通过的?题目|通過的?題目/i.test(e.textContent));
    const attempted = headings.find(e => /Tried problems|尝试过的?题目|嘗試過的?題目|已尝试|已嘗試/i.test(e.textContent));
    if (!accepted || !attempted || accepted === attempted) throw fail('PARSE_ERROR');
    function ids(heading) {
      const values = new Set();
      for (let node = heading.nextElementSibling; node && !node.matches('.list-group-item-heading'); node = node.nextElementSibling) {
        const links = [...node.querySelectorAll('a[href]')];
        if (node.matches('a[href]')) links.push(node);
        for (const link of links) {
          const match = link.getAttribute('href').match(/^\/?problem\/(\d+)(?:[/?#]|$)/);
          if (match) values.add(match[1]);
        }
      }
      // If a heading advertises a count, truncated/malformed content must fail closed.
      const count = /(?:共\s*|:\s*)(\d+)\s*(?:道|题|題|problems?\b|$)/i.exec(heading.textContent);
      if (count && Number(count[1]) !== values.size) throw fail('PARSE_ERROR');
      return values;
    }
    const solved = ids(accepted);
    return { provider: 'qoj', handle, fetched_at: new Date().toISOString(),
      snapshot: { scope: 'profile_visible', solved: [...solved], attempted: [...ids(attempted)].filter(id => !solved.has(id)) } };
  }
  pageWindow.addEventListener('message', event => {
    const m = event.data;
    if (event.source !== pageWindow || event.origin !== location.origin || !m || m.protocol !== 'xcpc-sync' || m.direction !== 'request') return;
    if (typeof m.request_id !== 'string' || m.request_id.length > 80) return;
    if (m.version !== 1) return reply(m.request_id, null, fail('UNSUPPORTED_VERSION'));
    if (m.method === 'hello') return reply(m.request_id, { version: 1, connected: true, script_version: GM_info.script.version, protocol_version: 1 });
    if (m.method === 'cancel') {
      if (active?.id === m.params?.request_id) active.cancel();
      return reply(m.request_id, { cancelled: true });
    }
    if (m.method !== 'syncMember' || m.params?.provider !== 'qoj' || typeof m.params.handle !== 'string' || !/^[^\s/?#\\]{1,100}$/.test(m.params.handle)) return reply(m.request_id, null, fail('INVALID_REQUEST'));
    if (active) return reply(m.request_id, null, fail('BUSY'));
    let request, timer, watchdog, done = false;
    const finish = (result, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(watchdog);
      nextRequestAt = Date.now() + 1500;
      active = null;
      reply(m.request_id, result, error);
    };
    active = { id: m.request_id, cancel() { finish(null, fail('CANCELLED')); request?.abort(); } };
    timer = setTimeout(() => {
      watchdog = setTimeout(() => { finish(null, fail('TIMEOUT')); request?.abort(); }, 22000);
      try {
        request = GM_xmlhttpRequest({ method: 'GET', url: 'https://qoj.ac/user/profile/' + encodeURIComponent(m.params.handle), anonymous: false, timeout: 20000,
          onload(response) { try { finish(parse(response, m.params.handle)); } catch (e) { finish(null, e?.code ? e : fail('PARSE_ERROR')); } },
          onerror() { finish(null, fail('NETWORK_ERROR')); },
          ontimeout() { finish(null, fail('TIMEOUT')); },
          onabort() { finish(null, fail('CANCELLED')); },
        });
      } catch { finish(null, fail('NETWORK_ERROR')); }
    }, Math.max(0, nextRequestAt - Date.now()));
  });
})();
