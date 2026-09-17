// Agents.mn WebChat widget loader.
//
// NOTE: this is a third-party script with full access to the DOM of every
// page in this app, including the login page. It is loaded from
// chat.agents.mn and is therefore trusted implicitly.
//
// Extracted from an inline <script> in index.html so the CSP can stay
// script-src 'self' https://chat.agents.mn rather than 'unsafe-inline'.
(function (w, d, s, o, f, js, fjs) {
  w[o] =
    w[o] ||
    function () {
      (w[o].q = w[o].q || []).push(arguments);
    };

  js = d.createElement(s);
  fjs = d.getElementsByTagName(s)[0];

  js.id = o;
  js.src = f;
  js.async = true;
  js.defer = true;

  fjs.parentNode.insertBefore(js, fjs);

  js.onload = function () {
    if (w.WebChat) {
      w.WebChat.init({
        url: 'https://chat.agents.mn/o/OeXh0hjz4uxU4moJ',
        base_url: 'https://chat.agents.mn',
        channel_id: 392
      });
    }
  };
})(
  window,
  document,
  'script',
  'webchat',
  'https://chat.agents.mn/js/webchat-widget.js'
);
