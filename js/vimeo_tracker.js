/**
 * Reports where the student is in any Vimeo lecture video on this Moodle page
 * to Rennix (rennix-lti POST /lti/playback), so the LTI Tutor Bot can answer a
 * question asked "while paused at 2:45" from that moment of the lecture.
 *
 * Finds Vimeo iframes already on the page and any added later (e.g. the Tiles
 * course format loads section and activity content into pop-ups), attaches the
 * official Vimeo Player SDK to each, and reports on pause / seek / end right
 * away, and every 15s while playing. When the course has a Tutor Bot "video
 * panel" activity, each video also gets the Tutor Bot chat framed beside it
 * (video left, chat right), so a student can pause and ask in one place.
 * Course PDFs (a File resource's embedded PDF, including in Tiles pop-ups)
 * likewise open in the Rennix PDF viewer next to the Tutor Bot; the file is
 * fetched here, with Moodle's own access checks, and handed to the viewer.
 * Config comes from the page:
 * window.RennixPlaybackConfig = { endpoint, token, chatUrl, knowledgeCheckUrl,
 * pdfViewerUrl, dashboardUrl } (see classes/hook_callbacks.php).
 */
(function () {
  'use strict';
  var config = window.RennixPlaybackConfig;
  if (!config || !config.endpoint || !config.token || window.__rennixVimeoTracker) {
    return;
  }
  window.__rennixVimeoTracker = true;

  var SDK_URL = 'https://player.vimeo.com/api/player.js';
  var HEARTBEAT_SECONDS = 15;
  var attached = typeof WeakSet === 'function' ? new WeakSet() : null;
  var sdkPromise = null;

  function loadSdk() {
    if (window.Vimeo && window.Vimeo.Player) {
      return Promise.resolve(window.Vimeo);
    }
    if (!sdkPromise) {
      sdkPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = SDK_URL;
        s.async = true;
        s.onload = function () { resolve(window.Vimeo); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return sdkPromise;
  }

  function videoIdFrom(iframe) {
    var m = /player\.vimeo\.com\/video\/(\d+)/.exec(iframe.getAttribute('src') || '');
    return m ? m[1] : null;
  }

  function send(videoId, seconds, state) {
    var body = JSON.stringify({ token: config.token, videoRef: videoId, position: Math.max(0, seconds || 0), state: state });
    try {
      fetch(config.endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true, // lets the last "paused" report survive closing the pop-up / page
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).catch(function () { /* best-effort; the next event retries */ });
    } catch (e) { /* older browsers without keepalive: ignore */ }
  }

  // ---- Video left, Tutor Bot right ----
  var STYLE = '' +
    '.rennix-split{display:flex;gap:14px;align-items:stretch;margin:10px 0;width:100%;}' +
    '.rennix-split-video{flex:3 1 0;min-width:0;}' +
    '.rennix-split-chat{flex:2 1 0;min-width:300px;display:flex;flex-direction:column;' +
      'border:1px solid #dcdfe4;border-radius:6px;overflow:hidden;background:#fff;}' +
    '.rennix-split-chat iframe{flex:1;width:100%;min-height:420px;border:0;}' +
    '.rennix-split-ratio{position:relative;width:100%;padding-top:56.25%;}' +
    '.rennix-split-ratio > iframe{position:absolute;inset:0;width:100%;height:100%;}' +
    '@media (max-width:900px){.rennix-split{flex-direction:column;}.rennix-split-chat{min-width:0;}' +
      '.rennix-split-chat iframe{min-height:460px;}}' +
    '.rennix-kc{display:block;width:100%;height:260px;border:1px solid #dcdfe4;border-radius:6px;margin-top:12px;background:#fff;}' +
    '.rennix-pdf{display:block;width:100%;height:78vh;min-height:520px;border:1px solid #dcdfe4;border-radius:6px;background:#eef1f4;}' +
    '.rennix-dashboard{margin:0 0 22px;border:1px solid #dcdfe4;border-radius:8px;overflow:hidden;background:#f3f3f5;}' +
    '.rennix-dashboard-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;' +
      'padding:10px 14px;background:#fff;border-bottom:1px solid #e3e3e3;}' +
    '.rennix-dashboard-bar strong{font-size:1.05rem;}' +
    '.rennix-dashboard iframe{display:block;width:100%;height:900px;border:0;}' +
    '.rennix-dashboard-go{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:2px;border:0;' +
      'background:#0C0C82;color:#fff !important;font-weight:600;text-decoration:none !important;cursor:pointer;}' +
    // Tiles opens pages in a pop-up; give it room for both columns.
    '.modal-dialog:has(.rennix-split){max-width:min(1400px,96vw);}';

  function injectStyle() {
    if (document.getElementById('rennix-split-style')) {
      return;
    }
    var s = document.createElement('style');
    s.id = 'rennix-split-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // The element to move into the left column: the iframe's own responsive
  // wrapper when it has one (a box that only holds the player), else the
  // iframe wrapped in a 16:9 box so it keeps its shape.
  function videoBlockFor(iframe) {
    var parent = iframe.parentElement;
    if (parent && parent.children.length === 1 && parent !== document.body &&
        (parent.style.paddingTop || parent.style.aspectRatio || /ratio|embed|video|media/i.test(parent.className))) {
      return parent;
    }
    var box = document.createElement('div');
    box.className = 'rennix-split-ratio';
    iframe.parentNode.insertBefore(box, iframe);
    box.appendChild(iframe);
    return box;
  }

  function addChatPanel(iframe) {
    if (!config.chatUrl || iframe.closest('.rennix-split')) {
      return;
    }
    injectStyle();
    var block = videoBlockFor(iframe);
    var split = document.createElement('div');
    split.className = 'rennix-split';
    var left = document.createElement('div');
    left.className = 'rennix-split-video';
    var right = document.createElement('div');
    right.className = 'rennix-split-chat';
    var chat = document.createElement('iframe');
    chat.src = config.chatUrl;
    chat.title = 'Rennix Tutor Bot';
    chat.setAttribute('allow', 'clipboard-write');
    block.parentNode.insertBefore(split, block);
    left.appendChild(block);
    right.appendChild(chat);
    split.appendChild(left);
    split.appendChild(right);

    // Knowledge-check questions for this video, under the player.
    var videoId = videoIdFrom(iframe);
    if (config.knowledgeCheckUrl && videoId) {
      var kc = document.createElement('iframe');
      kc.className = 'rennix-kc';
      kc.title = 'Knowledge check';
      kc.src = config.knowledgeCheckUrl + '?video=' + encodeURIComponent(videoId);
      left.appendChild(kc);
    }
  }

  // ---- Course PDFs in the Rennix viewer, Tutor Bot on the right ----
  var pdfFrames = []; // [{ frame, url, title }]

  // A Moodle-hosted PDF shown by Moodle's resource/Tiles embed (object, embed or iframe).
  function pdfUrlFrom(el) {
    var raw = el.tagName === 'OBJECT' ? el.getAttribute('data') : el.getAttribute('src');
    if (!raw) {
      return null;
    }
    var url;
    try { url = new URL(raw, location.href); } catch (e) { return null; }
    var isPdf = /\.pdf$/i.test(url.pathname) || (el.getAttribute('type') || '').toLowerCase() === 'application/pdf';
    // Only this site's own files: those are the ones the student is allowed to fetch here.
    if (!isPdf || url.origin !== location.origin || url.pathname.indexOf('/pluginfile.php') === -1) {
      return null;
    }
    url.hash = '';
    return url.toString();
  }

  function pdfTitleFor(el) {
    // Moodle's resource embed carries the activity name as the frame's title.
    if (el.getAttribute('title')) {
      return el.getAttribute('title').trim().slice(0, 200);
    }
    var modal = el.closest('.modal');
    var heading = (modal && modal.querySelector('.modal-title')) ||
      document.querySelector('#page-header h1, .page-header-headings h1, #region-main h2');
    var text = heading ? heading.textContent.trim() : '';
    if (!text) {
      text = decodeURIComponent((pdfUrlFrom(el) || '').split('/').pop().replace(/\?.*$/, '')) || 'Document';
    }
    return text.slice(0, 200);
  }

  function addPdfPanel(el) {
    var url = pdfUrlFrom(el);
    if (!url || !config.pdfViewerUrl || !config.chatUrl || el.closest('.rennix-split') || el.__rennixPdf) {
      return;
    }
    el.__rennixPdf = true;
    injectStyle();
    var split = document.createElement('div');
    split.className = 'rennix-split';
    var left = document.createElement('div');
    left.className = 'rennix-split-video';
    var viewer = document.createElement('iframe');
    viewer.className = 'rennix-pdf';
    viewer.title = 'Document';
    viewer.src = config.pdfViewerUrl;
    left.appendChild(viewer);
    var right = document.createElement('div');
    right.className = 'rennix-split-chat';
    var chat = document.createElement('iframe');
    chat.src = config.chatUrl;
    chat.title = 'Rennix Tutor Bot';
    right.appendChild(chat);
    split.appendChild(left);
    split.appendChild(right);
    pdfFrames.push({ frame: viewer, url: url, title: pdfTitleFor(el) });
    el.parentNode.replaceChild(split, el);
  }

  // The framed viewer says it's ready; send it this PDF's bytes, to that frame's
  // origin only (it's the one we loaded from the configured Rennix service).
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'rennix-pdf-ready') {
      return;
    }
    for (var i = 0; i < pdfFrames.length; i++) {
      var entry = pdfFrames[i];
      if (entry.frame.contentWindow !== e.source) {
        continue;
      }
      var origin = e.origin;
      fetch(entry.url, { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.arrayBuffer(); })
        .then(function (bytes) {
          entry.frame.contentWindow.postMessage({ type: 'rennix-pdf-data', title: entry.title, bytes: bytes }, origin, [bytes]);
        })
        .catch(function () { /* the viewer keeps showing its own status message */ });
      return;
    }
  });

  // Framed Rennix pages report their content height (tutor-service's
  // FRAMED_EMBED_SCRIPT); size only the iframes we created, matched by source.
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'rennix-embed-height' || typeof e.data.height !== 'number') {
      return;
    }
    var frames = document.querySelectorAll('iframe.rennix-kc, .rennix-dashboard iframe');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = Math.max(160, Math.min(e.data.height + 4, 4000)) + 'px';
      }
    }
  });

  // ---- Rennix dashboard at the top of the course page ----
  function addDashboard() {
    if (!config.dashboardUrl || document.querySelector('.rennix-dashboard')) {
      return;
    }
    var main = document.querySelector('#region-main [role="main"]') || document.getElementById('region-main');
    var content = main && (main.querySelector('.course-content') || main.firstElementChild);
    if (!content) {
      return;
    }
    injectStyle();
    var section = document.createElement('section');
    section.className = 'rennix-dashboard';
    section.setAttribute('aria-label', 'Rennix dashboard');
    var bar = document.createElement('div');
    bar.className = 'rennix-dashboard-bar';
    var title = document.createElement('strong');
    title.textContent = 'Your Rennix dashboard';
    var go = document.createElement('a');
    go.className = 'rennix-dashboard-go';
    go.href = '#rennix-course-content';
    go.textContent = 'Go to course content ↓';
    go.addEventListener('click', function (ev) {
      var target = document.querySelector('ul.tiles, #multi_section_tiles, .course-content .section, .course-content');
      if (target) {
        ev.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    bar.appendChild(title);
    bar.appendChild(go);
    var frame = document.createElement('iframe');
    frame.src = config.dashboardUrl;
    frame.title = 'Rennix dashboard';
    section.appendChild(bar);
    section.appendChild(frame);
    content.parentNode.insertBefore(section, content);
    content.id = content.id || 'rennix-course-content';
  }
  addDashboard();

  // A Tutor Bot answer's source chip ("▶ For loops 14:05") asks to jump the
  // video there. Only honoured from a Tutor Bot iframe this script created,
  // and only for the player showing that same video.
  var players = [];
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'rennix-seek' || typeof e.data.seconds !== 'number' || !isFinite(e.data.seconds)) {
      return;
    }
    var chats = document.querySelectorAll('.rennix-split-chat iframe');
    var fromOurChat = false;
    for (var i = 0; i < chats.length; i++) {
      if (chats[i].contentWindow === e.source) {
        fromOurChat = true;
      }
    }
    if (!fromOurChat) {
      return;
    }
    for (var k = 0; k < players.length; k++) {
      if (String(e.data.video_id) === String(players[k].videoId)) {
        players[k].player.setCurrentTime(Math.max(0, e.data.seconds)).catch(function () { /* out of range */ });
        return;
      }
    }
  });

  function attach(iframe) {
    var videoId = videoIdFrom(iframe);
    if (!videoId || (attached && attached.has(iframe)) || iframe.__rennixTracked) {
      return;
    }
    if (attached) { attached.add(iframe); } else { iframe.__rennixTracked = true; }
    addChatPanel(iframe);
    loadSdk().then(function (Vimeo) {
      var player = new Vimeo.Player(iframe);
      players.push({ videoId: videoId, player: player });
      var lastSent = -Infinity;
      player.on('play', function (d) { lastSent = d.seconds; send(videoId, d.seconds, 'playing'); });
      player.on('pause', function (d) { lastSent = d.seconds; send(videoId, d.seconds, 'paused'); });
      player.on('seeked', function (d) {
        lastSent = d.seconds;
        player.getPaused().then(function (paused) { send(videoId, d.seconds, paused ? 'paused' : 'playing'); });
      });
      player.on('ended', function (d) { send(videoId, d.seconds, 'ended'); });
      player.on('timeupdate', function (d) {
        if (Math.abs(d.seconds - lastSent) >= HEARTBEAT_SECONDS) {
          lastSent = d.seconds;
          send(videoId, d.seconds, 'playing');
        }
      });
    }).catch(function () { /* SDK blocked (offline, CSP): tracking just stays off */ });
  }

  var PDF_SELECTOR = 'object[data], embed[src], iframe[src*="pluginfile.php"]';

  function consider(el) {
    if (el.tagName === 'IFRAME') {
      attach(el);
    }
    if (el.matches && el.matches(PDF_SELECTOR)) {
      addPdfPanel(el);
    }
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) {
      return;
    }
    consider(root);
    var frames = root.querySelectorAll('iframe[src*="player.vimeo.com/video/"]');
    for (var i = 0; i < frames.length; i++) {
      attach(frames[i]);
    }
    var docs = root.querySelectorAll(PDF_SELECTOR);
    for (var k = 0; k < docs.length; k++) {
      addPdfPanel(docs[k]);
    }
  }

  scan(document);
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'attributes') {
        consider(m.target); // an iframe/object whose src/data was set or changed after insertion
      }
      for (var j = 0; j < m.addedNodes.length; j++) {
        scan(m.addedNodes[j]);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data'] });
})();
