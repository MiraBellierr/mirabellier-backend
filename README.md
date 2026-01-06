# Miraiscute Backend

Express.js REST API server providing authentication, blog management, and media upload services for the Miraiscute platform.

## 🚀 Features

- **Blog API** - CRUD operations for blog posts
- **Media Uploads** - Image and video upload with automatic optimization
- **User Authentication** - Discord OAuth 2.0 integration
- **Database** - SQLite database with better-sqlite3
- **Image Processing** - Automatic WebP conversion and optimization with Sharp
- **Session Management** - Express sessions with Passport.js
- **CORS Enabled** - Cross-origin resource sharing for frontend integration
- **Compression** - Gzip compression for API responses
- **Performance Monitoring** - Server-Timing headers for request tracking

## 📁 Project Structure

```
miraiscute-backend/
├── app.js              # Main application entry point
├── database.sqlite3    # SQLite database file
├── lib/                # Core utilities and helpers
│   ├── db.js          # Database initialization and helpers
│   ├── uploads.js     # File upload handling and optimization
│   └── users.js       # User management and authentication
├── routes/            # API route handlers
│   ├── posts.js       # Blog post endpoints
│   ├── videos.js      # Video upload and management
│   ├── pics.js        # Picture gallery endpoints
│   ├── images.js      # Image serving endpoints
│   ├── auth.js        # Authentication endpoints
│   └── anime.js       # Anime database endpoints
├── images/            # Uploaded images storage
├── videos/            # Uploaded videos storage
└── package.json       # Dependencies and scripts
```

## 🛠️ Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 5
- **Database:** SQLite (better-sqlite3)
- **Authentication:** Passport.js + Discord Strategy
- **File Uploads:** Multer
- **Image Processing:** Sharp
- **Session Store:** Express Session
- **Compression:** Compression middleware

## 📦 Installation

```bash
cd miraiscute-backend
npm install
```

## 🔧 Environment Variables

Create a `.env` file in the `miraiscute-backend/` directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Discord OAuth Configuration
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_CALLBACK_URL=http://localhost:3000/auth/discord/callback

# Session Configuration
SESSION_SECRET=your_random_session_secret_here

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:5173
```

### Getting Discord OAuth Credentials

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Navigate to OAuth2 section
4. Copy Client ID and Client Secret
5. Add redirect URL: `http://localhost:3000/auth/discord/callback`

## 🚦 Running the Server

### Development Mode

```bash
npm run dev
```

Server runs with nodemon for auto-restart on file changes.

### Production Mode

```bash
npm start
```

Server will be available at `http://localhost:3000`

## 📝 Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start development server with nodemon |

## 🔌 API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/auth/discord` | Initiate Discord OAuth flow |
| `GET` | `/auth/discord/callback` | Discord OAuth callback |
| `GET` | `/auth/user` | Get current authenticated user |
| `POST` | `/auth/logout` | Logout user |
| `PUT` | `/auth/user` | Update user profile |

### Blog Posts

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/posts` | Get all posts | No |
| `GET` | `/posts/:id` | Get single post | No |
| `POST` | `/posts` | Create new post | Yes |
| `PUT` | `/posts/:id` | Update post | Yes |
| `DELETE` | `/posts/:id` | Delete post | Yes |
| `POST` | `/posts-img` | Upload post image | Yes |

### Videos

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/videos` | Get all videos | No |
| `GET` | `/videos/:id` | Get single video | No |
| `POST` | `/videos` | Upload video | Yes |
| `PUT` | `/videos/:id` | Update video | Yes |
| `DELETE` | `/videos/:id` | Delete video | Yes |

### Pictures

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/pics` | Get all pictures | No |
| `GET` | `/pics/:id` | Get single picture | No |
| `POST` | `/pics` | Upload picture | Yes |
| `PUT` | `/pics/:id` | Update picture | Yes |
| `DELETE` | `/pics/:id` | Delete picture | Yes |

### Static Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/images/:filename` | Serve image files |
| `GET` | `/videos/:filename` | Serve video files |

### Anime

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/anime` | Get anime list | No |
| `POST` | `/anime` | Add anime entry | Yes (Admin) |
| `PUT` | `/anime/:id` | Update anime | Yes (Admin) |
| `DELETE` | `/anime/:id` | Delete anime | Yes (Admin) |

## 🔐 Authentication

The API uses token-based authentication:

1. User authenticates via Discord OAuth
2. Server creates session and generates token
3. Token stored in frontend (localStorage)
4. Subsequent requests include token in `Authorization` header:
   ```
   Authorization: Bearer <token>
   ```

### Protected Routes

Protected endpoints require valid authentication token. If token is invalid or missing, the API returns `401 Unauthorized`.

## 📦 Database Schema

### Users Table

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  avatar TEXT,
  discord_id TEXT UNIQUE,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
)
```

### Posts Table

```sql
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  author_id TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  published BOOLEAN DEFAULT 0,
  FOREIGN KEY (author_id) REFERENCES users(id)
)
```

### Videos Table

```sql
CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  thumbnail TEXT,
  author_id TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (author_id) REFERENCES users(id)
)
```

### Pics Table

```sql
CREATE TABLE pics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  description TEXT,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  author_id TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (author_id) REFERENCES users(id)
)
```

## 🖼️ File Upload & Processing

### Image Uploads

- **Max Size:** 50MB
- **Accepted Formats:** JPEG, PNG, GIF, WebP
- **Processing:**
  - Automatic WebP conversion for JPEG/PNG
  - Optimization with Sharp (quality: 80%)
  - Preserved original format alongside WebP
- **Storage:** `/images/` directory

### Video Uploads

- **Max Size:** 50MB
- **Accepted Formats:** MP4, WebM, AVI, MOV
- **Storage:** `/videos/` directory
- **No automatic processing** (videos served as-is)

### Upload Example

```javascript
// Upload image
const formData = new FormData()
formData.append('image', file)

const response = await fetch('http://localhost:3000/posts-img', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: formData
})

const data = await response.json()
// { path: '/images/filename.jpg', webp: '/images/filename.webp' }
```

## ⚡ Performance Features

### Compression

All API responses are gzipped (except when explicitly disabled):
- Level 6 compression (balanced)
- Only compresses responses > 1KB
- Can be disabled with `x-no-compression` header

### Keep-Alive

HTTP Keep-Alive enabled for faster subsequent requests:
- Timeout: 5 seconds
- Max requests per connection: 100

### Caching Headers

Static files (images/videos) served with aggressive caching:
- Cache-Control: `public, max-age=31536000, immutable`
- Cached for 1 year (365 days)

### Server-Timing Headers

Every response includes timing information for performance monitoring:
```
Server-Timing: total;dur=123
```

## 🔧 Configuration

### Upload Limits

Edit in `lib/uploads.js`:

```javascript
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: IMAGES_DIR,
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
      cb(null, uniqueSuffix + path.extname(file.originalname))
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
})
```

### Database Initialization

Database is automatically created on first run. To manually initialize:

```javascript
const { db } = require('./lib/db')
// Database is ready to use
```

## 🐛 Troubleshooting

### Port Already in Use

Change the port in `.env`:
```env
PORT=5000
```

### Database Locked

SQLite may lock if multiple processes access it. Ensure only one server instance runs.

### File Upload Fails

- Check `images/` and `videos/` directories exist and are writable
- Verify file size is under 50MB limit
- Check disk space

### Discord OAuth Not Working

- Verify `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are correct
- Ensure callback URL matches Discord app settings
- Check `DISCORD_CALLBACK_URL` in `.env`

### CORS Issues

Add your frontend URL to CORS configuration in `app.js`:

```javascript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
```

## 📊 Monitoring & Logging

The server logs:
- All incoming requests (method, path, duration)
- Database queries (in development)
- Upload operations
- Authentication events
- Errors and stack traces

Check terminal output for real-time logs.

## 🔒 Security Considerations

- Use strong `SESSION_SECRET` in production
- Keep Discord credentials secure (never commit `.env`)
- Validate and sanitize all user inputs
- Use HTTPS in production
- Implement rate limiting for production use
- Regularly update dependencies

## 🚀 Production Deployment

1. Set `NODE_ENV=production`
2. Use a process manager (PM2, systemd)
3. Set up reverse proxy (nginx, Apache)
4. Enable HTTPS
5. Configure firewall rules
6. Set up automated backups for database
7. Monitor disk space for uploads

### PM2 Example

```bash
pm2 start app.js --name miraiscute-api
pm2 save
pm2 startup
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Open Pull Request

## 📄 License

This project is private and proprietary.

## 📚 Additional Resources

- [Express.js Documentation](https://expressjs.com/)
- [Passport.js Documentation](http://www.passportjs.org/)
- [Better-SQLite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [Sharp Documentation](https://sharp.pixelplumbing.com/)
- [Discord OAuth2 Documentation](https://discord.com/developers/docs/topics/oauth2)
