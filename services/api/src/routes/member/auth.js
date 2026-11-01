export function readBearerToken(req, _res, next) {
  const header = req.header('authorization');
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)\s*$/i) : null;
  req.memberAuth = match ? { token: match[1] } : null;
  return next();
}

