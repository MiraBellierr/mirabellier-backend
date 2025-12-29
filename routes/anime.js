const express = require('express')

module.exports = function (app, { db, authFromReq }) {
  const router = express.Router()

  
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare('SELECT id, title, url, img, ord FROM anime ORDER BY ord ASC').all()
      // Cache anime list for 10 minutes
      res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=1200');
      res.json(rows)
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Failed to fetch anime list' })
    }
  })

  
  router.post('/', express.json(), (req, res) => {
    try {
      const user = authFromReq(req)
      if (!user || user.discordId !== '548050617889980426') {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const list = Array.isArray(req.body) ? req.body : []
      const del = db.prepare('DELETE FROM anime')
      const ins = db.prepare('INSERT INTO anime (id, title, url, img, ord) VALUES (?, ?, ?, ?, ?)')
      const trx = db.transaction((items) => {
        del.run()
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          const id = it.id || `${Date.now()}-${i}`
          ins.run(id, it.title || '', it.url || '', it.img || '', i)
        }
      })

      trx(list)

      res.json({ ok: true })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Failed to update anime list' })
    }
  })

  
  router.delete('/:id', (req, res) => {
    try {
      const user = authFromReq(req)
      if (!user || user.discordId !== '548050617889980426') {
        return res.status(403).json({ error: 'Forbidden' })
      }
      const id = req.params.id
      db.prepare('DELETE FROM anime WHERE id = ?').run(id)
      res.json({ ok: true })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Failed to delete' })
    }
  })

  
  router.patch('/:id', express.json(), (req, res) => {
    try {
      const user = authFromReq(req)
      if (!user || user.username !== 'mira') {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const id = req.params.id
      const { title, url, img, ord } = req.body || {}

      
      const updates = []
      const params = []
      if (typeof title !== 'undefined') { updates.push('title = ?'); params.push(title) }
      if (typeof url !== 'undefined') { updates.push('url = ?'); params.push(url) }
      if (typeof img !== 'undefined') { updates.push('img = ?'); params.push(img) }
      if (typeof ord !== 'undefined') { updates.push('ord = ?'); params.push(ord) }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' })
      }

      params.push(id)
      const stmt = db.prepare(`UPDATE anime SET ${updates.join(', ')} WHERE id = ?`)
      const info = stmt.run(...params)
      if (info.changes === 0) return res.status(404).json({ error: 'Not found' })

      const row = db.prepare('SELECT id, title, url, img, ord FROM anime WHERE id = ?').get(id)
      res.json(row)
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Failed to update item' })
    }
  })

  app.use('/anime', router)
}
