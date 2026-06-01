/** Admin API key gate for `/api/admin/*` routes. */
export function requireAdmin(req, res, next) {
  const key = req.header('x-admin-key');
  if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}
