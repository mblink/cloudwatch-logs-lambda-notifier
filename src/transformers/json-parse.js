export default logLine => new Promise(resolve => {
  try { resolve(JSON.parse(logLine)); } catch (e) { resolve(logLine); }
});
