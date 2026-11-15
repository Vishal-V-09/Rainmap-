const express = require('express')
const cors = require('cors')
require('dotenv').config()

const db = require('./db')
const reportRoutes = require('./routes/reportRoutes')
const chatRoutes = require('./routes/chatRoutes')

const app = express()

// Middleware
app.use(cors())
app.use(express.json())
app.use('/api/reports', reportRoutes)
app.use('/api/chat', chatRoutes)

// Basic API test
app.get('/', (req, res) => {
    res.send('RainMap Backend is running!')
})

// MySQL connection test
app.get('/api/health', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 AS result')

        res.json({
            success: true,
            message: 'RainMap backend connected to MySQL successfully!',
            database: process.env.DB_NAME,
            test: rows[0].result
        })
    } catch (error) {
        console.error('Database connection error:', error.message)

        res.status(500).json({
            success: false,
            message: 'Database connection failed.'
        })
    }
})

// Start server
const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
    console.log(`RainMap backend running at http://localhost:${PORT}`)
})
