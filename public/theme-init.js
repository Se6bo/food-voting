/**
 * Setzt die Theme-Klasse noch vor dem ersten Paint, damit es beim Laden nicht
 * kurz hell aufblitzt. Bewusst eine eigene Datei statt eines Inline-Skripts:
 * so bleibt die Content-Security-Policy bei "script-src 'self'" ohne
 * 'unsafe-inline' oder Hash-Pflege.
 */
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {
    // localStorage kann blockiert sein - dann bleibt es beim hellen Standard.
  }
})();
