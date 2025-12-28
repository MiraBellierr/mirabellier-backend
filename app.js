const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const passport = require('passport');

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(passport.initialize());

const { db } = require('./lib/db');
const users = require('./lib/users');
const uploads = require('./lib/uploads');

function authFromReq(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2) return null;
  const token = parts[1];
  return users.getUserByToken(token);
}

require('./routes/posts')(app, { db, getUserById: users.getUserById, userPublic: users.userPublic, authFromReq });
require('./routes/videos')(app, { db, getUserById: users.getUserById, userPublic: users.userPublic, authFromReq, videoUpload: uploads.videoUpload });
require('./routes/images')(app, { IMAGES_DIR: uploads.IMAGES_DIR });
require('./routes/auth')(app, {
  makeToken: users.makeToken,
  createSession: users.createSession,
  getUserByUsername: users.getUserByUsername,
  getUserById: users.getUserById,
  getUserByToken: users.getUserByToken,
  updateUserById: users.updateUserById,
  userPublic: users.userPublic,
  authFromReq,
  imageUpload: uploads.imageUpload,
  findOrCreateDiscordUser: users.findOrCreateDiscordUser,
});

require('./routes/anime')(app, { db, authFromReq });

app.use('/videos', express.static(uploads.VIDEOS_DIR));
app.use('/images', express.static(uploads.IMAGES_DIR));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});