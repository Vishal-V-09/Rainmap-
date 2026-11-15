
const express = require('express')
const router = express.Router()
const db = require('../db')

const allowedCategories = [
    'Heavy Rain',
    'Light Rain',
    'No Rain',
    'Waterlogging'
]

// Submit a community rainfall report
router.post('/', async (req, res) => {
    try {
        const { category, description, latitude, longitude } = req.body

        // Validate category
        if (!allowedCategories.includes(category)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid report category.'
            })
        }

        // Validate GPS coordinates
        const lat = Number(latitude)
        const lng = Number(longitude)

        if (
            latitude === undefined ||
            longitude === undefined ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            lat < -90 || lat > 90 ||
            lng < -180 || lng > 180
        ) {
            return res.status(400).json({
                success: false,
                message: 'Valid GPS coordinates are required.'
            })
        }

        // Validate description
        const cleanDescription =
            typeof description === 'string'
                ? description.trim()
                : ''

        if (cleanDescription.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Description cannot exceed 500 characters.'
            })
        }

        // Save report in MySQL
        const [result] = await db.execute(
            `INSERT INTO community_reports
            (category, description, latitude, longitude)
            VALUES (?, ?, ?, ?)`,
            [
                category,
                cleanDescription || null,
                lat,
                lng
            ]
        )

        res.status(201).json({
            success: true,
            message: 'Community rainfall report submitted successfully!',
            reportId: result.insertId
        })

    } catch (error) {
        console.error('Report submission error:', error.message)

        res.status(500).json({
            success: false,
            message: 'Unable to submit rainfall report.'
        })
    }
})

// Fetch community rainfall reports
router.get('/', async (req, res) => {
    try {
        const [reports] = await db.execute(
            `SELECT id, category, description, latitude,
                    longitude, created_at
             FROM community_reports
             ORDER BY created_at DESC`
        )

        res.json({
            success: true,
            count: reports.length,
            reports
        })

    } catch (error) {
        console.error('Report fetching error:', error.message)

        res.status(500).json({
            success: false,
            message: 'Unable to fetch community reports.'
        })
    }
})

module.exports = router
