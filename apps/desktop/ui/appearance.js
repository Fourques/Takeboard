// Native utility windows share the app's selected palette. No server configuration is read here.
try {
  const theme =
    window.__takeboardTheme ||
    document.documentElement.dataset.theme ||
    localStorage.getItem("takeboard.desktop.theme");
  document.documentElement.dataset.theme = ["noir", "light", "chroma"].includes(theme)
    ? theme
    : "chroma";
} catch {
  document.documentElement.dataset.theme = "chroma";
}
