// Applies the saved theme before first paint so the page never flashes light
// then dark. Kept as a separate file rather than an inline <script> so the
// Content-Security-Policy can stay script-src 'self' without needing
// 'unsafe-inline' (see server.ts).
(function () {
  try {
    var theme = localStorage.getItem('theme') || 'dark';
    document.documentElement.classList.toggle('dark', theme !== 'light');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
