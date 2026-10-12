(() => {
  // Run after the HTML is parsed. file:// cannot load the ES module graph,
  // so use the checked-in classic bundle for a double-click preview.
  const script = document.createElement('script');
  if (location.protocol === 'file:') {
    script.src = './assets/app.file.js';
  } else {
    script.type = 'module';
    script.src = './app.js';
  }
  document.head.append(script);
})();
