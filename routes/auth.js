module.exports = function registerAuthRoutes(app, deps) {
  const { createUser, makeToken, createSession, getUserByUsername, getUserById, getUserByToken, updateUserById, userPublic, authFromReq, imageUpload } = deps;

  app.post('/register', (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'username and password required' });
      if (getUserByUsername(username)) return res.status(409).json({ error: 'username taken' });
      const newUser = createUser(username, password);
      const token = makeToken();
      createSession(token, newUser.id);
      res.status(201).json({ token, user: userPublic(newUser) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'register failed' });
    }
  });

  app.post('/login', (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'username and password required' });
      const user = getUserByUsername(username);
      if (!user) return res.status(401).json({ error: 'invalid credentials' });
      const bcrypt = require('bcryptjs');
      if (!bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ error: 'invalid credentials' });
      const token = makeToken();
      createSession(token, user.id);
      res.json({ token, user: userPublic(user) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'login failed' });
    }
  });

  app.get('/me', (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      res.json(userPublic(user));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/user/:id', (req, res) => {
    try {
      const id = req.params.id;
      const user = getUserById(id);
      if (!user) return res.status(404).json({ error: 'not found' });
      res.json(userPublic(user));
    } catch (err) {
      console.error('GET /user/:id error', err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/logout', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth) return res.status(401).json({ error: 'unauthenticated' });
      const parts = auth.split(' ');
      if (parts.length !== 2) return res.status(401).json({ error: 'unauthenticated' });
      const token = parts[1];
      const { db } = require('../lib/db');
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'logout failed' });
    }
  });

  app.post('/me', imageUpload.single('avatar'), (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      const avatar = req.file ? `/images/${req.file.filename}` : (req.body && req.body.avatar ? req.body.avatar : undefined);
      const updated = updateUserById(user.id, { username: req.body.username, password: req.body.password, avatar });
      res.json(userPublic(updated));
    } catch (err) {
      console.error(err);
      if (err.message === 'username taken') return res.status(409).json({ error: 'username taken' });
      res.status(500).json({ error: 'update failed' });
    }
  });
};
