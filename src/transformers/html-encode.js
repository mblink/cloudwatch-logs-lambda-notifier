import he from 'he';

export default logLine => Promise.resolve(he.encode(logLine));
