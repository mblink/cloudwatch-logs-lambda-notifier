import geoip from 'geoip-lite';

export default logLine => new Promise(resolve =>
  (Object.prototype.toString.call(logLine) === '[object Object]'
      && (Object.hasOwnProperty.call(logLine, 'forwarded-for-ip') || Object.hasOwnProperty.call(logLine, 'ip'))
    ? resolve(Object.assign(logLine, { geolocation: geoip.lookup(logLine['forwarded-for-ip'] || logLine.ip) }))
    : resolve(logLine)));
