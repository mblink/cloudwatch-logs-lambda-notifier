export default logLine => new Promise(resolve => {
  if (typeof logLine === 'object') {
    try { resolve(JSON.stringify(logLine, null, 2)); } catch (e) { resolve(logLine); }
  } else {
    resolve(logLine);
  }
});
