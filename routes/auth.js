const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

module.exports = function registerAuthRoutes(app, deps) {
  const { makeToken, createSession, getUserByUsername, getUserById, getUserByToken, updateUserById, userPublic, authFromReq, imageUpload, findOrCreateDiscordUser } = deps;

  // Configure Discord Strategy
  passport.use(new DiscordStrategy({
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
      scope: ['identify']
    },
    function(accessToken, refreshToken, profile, cb) {
      try {
        // Find or create user based on Discord profile
        const user = findOrCreateDiscordUser(profile);
        return cb(null, user);
      } catch (err) {
        return cb(err);
      }
    }
  ));

  // Discord OAuth login
  app.get('/auth/discord', passport.authenticate('discord'));

  // Discord OAuth callback
  app.get('/auth/discord/callback', 
    passport.authenticate('discord', { session: false, failureRedirect: '/login' }),
    (req, res) => {
      try {
        const user = req.user;
        const token = makeToken();
        createSession(token, user.id);
        
        // Redirect to frontend with token
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
      } catch (err) {
        console.error(err);
        res.redirect('/login?error=auth_failed');
      }
    }
  );

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

  app.get('/user/by-username/:username', (req, res) => {
    try {
      const username = req.params.username;
      const user = getUserByUsername(username);
      if (!user) return res.status(404).json({ error: 'not found' });
      res.json(userPublic(user));
    } catch (err) {
      console.error('GET /user/by-username/:username error', err);
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

  app.post('/me', imageUpload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      const avatar = req.files?.avatar ? `/images/${req.files.avatar[0].filename}` : (req.body && req.body.avatar ? req.body.avatar : undefined);
      const banner = req.files?.banner ? `/images/${req.files.banner[0].filename}` : (req.body && req.body.banner ? req.body.banner : undefined);
      const updated = updateUserById(user.id, { 
        username: req.body.username,
        avatar,
        banner,
        bio: req.body.bio,
        location: req.body.location,
        website: req.body.website
      });
      res.json(userPublic(updated));
    } catch (err) {
      console.error(err);
      if (err.message === 'username taken') return res.status(409).json({ error: 'username taken' });
      res.status(500).json({ error: 'update failed' });
    }
  });

  app.get('/user/:id/stats', (req, res) => {
    try {
      const id = req.params.id;
      const user = getUserById(id);
      if (!user) return res.status(404).json({ error: 'not found' });
      
      const { db } = require('../lib/db');
      
      // Count posts by user
      const postsCount = db.prepare('SELECT COUNT(*) as count FROM posts WHERE userId = ?').get(id)?.count || 0;
      
      // Count likes from videos
      const videos = db.prepare('SELECT likes FROM videos').all();
      let likesCount = 0;
      videos.forEach(v => {
        if (v.likes) {
          try {
            const likesArr = JSON.parse(v.likes);
            if (Array.isArray(likesArr) && likesArr.includes(id)) {
              likesCount++;
            }
          } catch (e) {}
        }
      });
      
      // Count comments from videos
      const commentsCount = 0; // Comments not implemented yet in schema
      
      // Get recent posts
      const recentPosts = db.prepare('SELECT id, title, createdAt FROM posts WHERE userId = ? ORDER BY createdAt DESC LIMIT 5').all(id);
      
      res.json({
        postsCount,
        likesCount,
        commentsCount,
        recentPosts
      });
    } catch (err) {
      console.error('GET /user/:id/stats error', err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Server-side rendered profile page for social sharing
  app.get('/profile/:username', (req, res) => {
    try {
      const username = req.params.username;
      const user = getUserByUsername(username);
      if (!user) return res.status(404).send('User not found');

      const { db } = require('../lib/db');
      
      const escapeHtml = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      
      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      
      const title = `${escapeHtml(user.username)}'s Profile`;
      const description = user.bio || `Check out ${escapeHtml(user.username)}'s profile`;
      
      // Resolve avatar URL
      let avatarUrl = '';
      if (user.avatar) {
        if (/^https?:\/\//i.test(user.avatar)) avatarUrl = user.avatar;
        else if (user.avatar.startsWith('/')) avatarUrl = `${protocol}://${host}${user.avatar}`;
        else avatarUrl = `${protocol}://${host}/images/${user.avatar}`;
      }
      
      // Resolve banner URL
      let bannerUrl = '';
      if (user.banner) {
        if (/^https?:\/\//i.test(user.banner)) bannerUrl = user.banner;
        else if (user.banner.startsWith('/')) bannerUrl = `${protocol}://${host}${user.banner}`;
        else bannerUrl = `${protocol}://${host}/images/${user.banner}`;
      }
      
      // Use banner if available, otherwise use avatar, or default image
      const imageUrl = bannerUrl || avatarUrl || `${protocol}://${host}/background.jpg`;
      
      // Get stats
      const postsCount = db.prepare('SELECT COUNT(*) as count FROM posts WHERE userId = ?').get(user.id)?.count || 0;
      
      const spaPath = `/#/profile/${username}`;
      const requestPath = req.originalUrl || req.path || `/profile/${username}`;
      
      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="profile" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${protocol}://${host}${requestPath}" />
    <meta property="profile:username" content="${escapeHtml(user.username)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <link rel="canonical" href="${protocol}://${host}${spaPath}" />
    <script>setTimeout(()=>{window.location.href='${spaPath}'},100)</script>
  </head>
  <body>
  </body>
</html>`;
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      console.error('GET /u/:username error', err);
      res.status(500).send('Server error');
    }
  });
};
