/**
 * RagPilot embed loader.
 *
 * Usage on a third-party site:
 *   <script src="https://rag.umairamir.com/chatbot-embed.js" data-token="..." defer></script>
 *
 * The app origin is derived from this script's own src, so the same file works
 * on any deployment. An optional data-app-url="https://..." attribute overrides
 * it (e.g. when the script is served from a CDN on a different host).
 *
 * Injects an iframe that hosts the chat widget. The iframe is sized small
 * (just the bubble) until the visitor opens the chat, then grows to fit the
 * chat window. State is communicated via window.postMessage from the embed
 * page (frontend/src/components/chat/ChatWidget.tsx).
 */
(function () {
  if (window.__chatbotEmbedLoaded) return;
  window.__chatbotEmbedLoaded = true;

  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) {
      var src = all[i].src || '';
      if (src.indexOf('chatbot-embed.js') !== -1) { script = all[i]; break; }
    }
  }
  if (!script) return;

  var token = script.getAttribute('data-token');
  if (!token) {
    console.error('[chatbot-embed] data-token attribute is required');
    return;
  }

  var origin;
  try {
    var appUrl = script.getAttribute('data-app-url');
    origin = new URL(appUrl || script.src).origin;
  } catch (e) {
    console.error('[chatbot-embed] could not resolve script origin', e);
    return;
  }

  var parentUrl = '';
  try { parentUrl = window.location.href; } catch (e) {}

  var iframeUrl =
    origin + '/embed' +
    '?token=' + encodeURIComponent(token) +
    '&parentUrl=' + encodeURIComponent(parentUrl);

  var iframe = document.createElement('iframe');
  iframe.id = 'chatbot-embed-iframe';
  iframe.src = iframeUrl;
  iframe.title = 'Chat widget';
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.setAttribute('aria-label', 'Chat widget');

  var COLLAPSED = { width: '96px', height: '96px' };
  var EXPANDED_DESKTOP = { width: '420px', height: '640px' };
  var EXPANDED_MOBILE = { width: '100vw', height: '100vh' };

  function applyBaseStyle() {
    iframe.style.position = 'fixed';
    iframe.style.bottom = '0';
    iframe.style.right = '0';
    iframe.style.border = '0';
    iframe.style.background = 'transparent';
    iframe.style.colorScheme = 'normal';
    iframe.style.zIndex = '2147483647';
    iframe.style.transition = 'width 180ms ease, height 180ms ease';
    iframe.style.maxWidth = '100vw';
    iframe.style.maxHeight = '100vh';
  }

  var state = 'closed';
  function applySize() {
    var isMobile = window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
    var target = state === 'open'
      ? (isMobile ? EXPANDED_MOBILE : EXPANDED_DESKTOP)
      : COLLAPSED;
    iframe.style.width = target.width;
    iframe.style.height = target.height;
  }

  applyBaseStyle();
  applySize();

  function mount() {
    if (document.body) {
      document.body.appendChild(iframe);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(iframe);
      });
    }
  }
  mount();

  window.addEventListener('message', function (event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'chatbot:open') { state = 'open'; applySize(); }
    else if (data.type === 'chatbot:close') { state = 'closed'; applySize(); }
  });

  window.addEventListener('resize', applySize);
})();
