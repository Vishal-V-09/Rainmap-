
const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const rateLimit = require('express-rate-limit')
const { OAuth2Client } = require('google-auth-library')

const db = require('../db')
const { sendVerificationOtp } = require('../services/emailService')

const router = express.Router()

// ==========================================
// CONFIGURATION
// ==========================================

const SESSION_DURATION_DAYS = 7
const COOKIE_NAME = 'rainmap_session'

const OTP_EXPIRY_MINUTES = 10
const OTP_RESEND_SECONDS = 60
const OTP_MAX_ATTEMPTS = 5

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
}

// ==========================================
// RATE LIMITERS
// ==========================================

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many attempts. Please try again after 15 minutes.'
    }
})

const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many OTP requests. Please try again later.'
    }
})

// ==========================================
// HELPERS
// ==========================================

function hashToken(token) {
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex')
}

function hashOtp(email, otp) {
    const secret = process.env.OTP_SECRET

    if (!secret) {
        throw new Error('OTP_SECRET is missing from environment variables.')
    }

    return crypto
        .createHmac('sha256', secret)
        .update(`${email}:${otp}`)
        .digest('hex')
}

function generateOtp() {
    return crypto.randomInt(100000, 1000000).toString()
}


function publicUser(user) {
    return {
        id: user.id,
        name: user.full_name,
        email: user.email,
        phone: user.phone,
        profileImageUrl: user.profile_image_url || null,
        emailVerified: Boolean(user.email_verified),

        // Safe account capability flags
        hasPassword: Boolean(user.password_hash),
        hasGoogleLogin: Boolean(user.google_sub)
    }
}


async function createSession(userId, executor = db) {
    const sessionToken = crypto.randomBytes(32).toString('hex')
    const sessionTokenHash = hashToken(sessionToken)

    const expiresAt = new Date(
        Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
    )

    await executor.execute(
        `INSERT INTO user_sessions
        (user_id, session_token_hash, expires_at)
        VALUES (?, ?, ?)`,
        [userId, sessionTokenHash, expiresAt]
    )

    return sessionToken
}

function setSessionCookie(res, sessionToken) {
    res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
    })
}

function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, cookieOptions)
}

function validEmail(email) {
    return typeof email === 'string' &&
        email.length <= 255 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ==========================================
// REGISTER - SEND EMAIL OTP
// POST /api/auth/register
// ==========================================

router.post('/register', authLimiter, otpLimiter, async (req, res) => {
    try {
        const { fullName, email, phone, password } = req.body

        const cleanName =
            typeof fullName === 'string' ? fullName.trim() : ''

        const cleanEmail =
            typeof email === 'string' ? email.trim().toLowerCase() : ''

        const cleanPhone =
            typeof phone === 'string' ? phone.trim() : ''

        if (!cleanName || cleanName.length > 120) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid name.'
            })
        }

        if (!validEmail(cleanEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address.'
            })
        }

        if (!/^\+?[0-9]{7,20}$/.test(cleanPhone)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid phone number.'
            })
        }

        if (
            typeof password !== 'string' ||
            password.length < 8 ||
            Buffer.byteLength(password, 'utf8') > 72
        ) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters.'
            })
        }

        // Check whether email or phone is already registered.
        const [existingUsers] = await db.execute(
            `SELECT id FROM users
             WHERE email = ? OR phone = ?
             LIMIT 1`,
            [cleanEmail, cleanPhone]
        )

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'This email or phone number is already registered.'
            })
        }

        // Prevent rapid OTP resend.
        const [pendingRows] = await db.execute(
            `SELECT last_sent_at FROM pending_email_verifications
             WHERE email = ?
             LIMIT 1`,
            [cleanEmail]
        )

        if (pendingRows.length > 0) {
            const secondsSinceLastSend =
                (Date.now() - new Date(pendingRows[0].last_sent_at).getTime()) / 1000

            if (secondsSinceLastSend < OTP_RESEND_SECONDS) {
                return res.status(429).json({
                    success: false,
                    message: 'Please wait before requesting another OTP.',
                    retryAfter: Math.ceil(
                        OTP_RESEND_SECONDS - secondsSinceLastSend
                    )
                })
            }
        }

        const passwordHash = await bcrypt.hash(password, 12)
        const otp = generateOtp()
        const otpHash = hashOtp(cleanEmail, otp)

        const expiresAt = new Date(
            Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
        )

        await db.execute(
            `INSERT INTO pending_email_verifications
            (email, phone, full_name, password_hash, otp_hash,
             expires_at, attempts, last_sent_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, NOW())
            ON DUPLICATE KEY UPDATE
                phone = VALUES(phone),
                full_name = VALUES(full_name),
                password_hash = VALUES(password_hash),
                otp_hash = VALUES(otp_hash),
                expires_at = VALUES(expires_at),
                attempts = 0,
                last_sent_at = NOW()`,
            [
                cleanEmail,
                cleanPhone,
                cleanName,
                passwordHash,
                otpHash,
                expiresAt
            ]
        )

        try {
            await sendVerificationOtp(cleanEmail, otp, cleanName)
        } catch (emailError) {
            await db.execute(
                `DELETE FROM pending_email_verifications
                 WHERE email = ? AND otp_hash = ?`,
                [cleanEmail, otpHash]
            )

            throw emailError
        }

        return res.status(200).json({
            success: true,
            otpRequired: true,
            message: 'Verification code sent to your email.',
            expiresIn: OTP_EXPIRY_MINUTES * 60
        })

    } catch (error) {
        console.error('Registration error:', error.message)

        return res.status(500).json({
            success: false,
            message: 'Unable to start registration. Please try again.'
        })
    }
})

// ==========================================
// VERIFY EMAIL OTP
// POST /api/auth/verify-otp
// ==========================================

router.post('/verify-otp', otpLimiter, async (req, res) => {
    let connection

    try {
        const email =
            typeof req.body.email === 'string'
                ? req.body.email.trim().toLowerCase()
                : ''

        const otp =
            typeof req.body.otp === 'string'
                ? req.body.otp.trim()
                : ''

        if (!validEmail(email) || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({
                success: false,
                message: 'Enter a valid email and six-digit OTP.'
            })
        }

        connection = await db.getConnection()
        await connection.beginTransaction()

        const [pendingRows] = await connection.execute(
            `SELECT *
             FROM pending_email_verifications
             WHERE email = ?
             LIMIT 1
             FOR UPDATE`,
            [email]
        )

        if (pendingRows.length === 0) {
            await connection.rollback()

            return res.status(400).json({
                success: false,
                message: 'No pending verification found. Please register again.'
            })
        }

        const pending = pendingRows[0]

        if (new Date(pending.expires_at).getTime() <= Date.now()) {
            await connection.execute(
                `DELETE FROM pending_email_verifications WHERE email = ?`,
                [email]
            )

            await connection.commit()

            return res.status(400).json({
                success: false,
                message: 'OTP expired. Please register again.'
            })
        }

        if (pending.attempts >= OTP_MAX_ATTEMPTS) {
            await connection.execute(
                `DELETE FROM pending_email_verifications WHERE email = ?`,
                [email]
            )

            await connection.commit()

            return res.status(429).json({
                success: false,
                message: 'Maximum attempts reached. Please register again.'
            })
        }

        const submittedHash = hashOtp(email, otp)

        const storedBuffer = Buffer.from(pending.otp_hash, 'hex')
        const submittedBuffer = Buffer.from(submittedHash, 'hex')

        const matches =
            storedBuffer.length === submittedBuffer.length &&
            crypto.timingSafeEqual(storedBuffer, submittedBuffer)

        if (!matches) {
            await connection.execute(
                `UPDATE pending_email_verifications
                 SET attempts = attempts + 1
                 WHERE email = ?`,
                [email]
            )

            await connection.commit()

            return res.status(400).json({
                success: false,
                message: `Incorrect OTP. ${OTP_MAX_ATTEMPTS - pending.attempts - 1} attempts remaining.`
            })
        }

        // Check for conflicts again before creating the account.
        const [existingUsers] = await connection.execute(
            `SELECT id FROM users
             WHERE email = ? OR phone = ?
             LIMIT 1`,
            [email, pending.phone]
        )

        if (existingUsers.length > 0) {
            await connection.execute(
                `DELETE FROM pending_email_verifications WHERE email = ?`,
                [email]
            )

            await connection.commit()

            return res.status(409).json({
                success: false,
                message: 'This email or phone number is already registered.'
            })
        }

        const [userResult] = await connection.execute(
            `INSERT INTO users
            (full_name, email, phone, password_hash, email_verified)
            VALUES (?, ?, ?, ?, 1)`,
            [
                pending.full_name,
                email,
                pending.phone,
                pending.password_hash
            ]
        )

        const userId = userResult.insertId

        await connection.execute(
            `INSERT INTO user_preferences (user_id)
             VALUES (?)`,
            [userId]
        )

        const sessionToken = await createSession(userId, connection)

        await connection.execute(
            `DELETE FROM pending_email_verifications
             WHERE email = ?`,
            [email]
        )

        await connection.commit()

        setSessionCookie(res, sessionToken)

        return res.status(201).json({
            success: true,
            message: 'Email verified and account created successfully!',
            user: {
                id: userId,
                fullName: pending.full_name,
                email,
                profileImageUrl: null,
                emailVerified: true
            }
        })

    } catch (error) {
        if (connection) {
            await connection.rollback()
        }

        console.error('OTP verification error:', error.message)

        return res.status(500).json({
            success: false,
            message: 'Unable to verify OTP. Please try again.'
        })

    } finally {
        if (connection) {
            connection.release()
        }
    }
})

// ==========================================
// RESEND OTP
// POST /api/auth/resend-otp
// ==========================================

router.post('/resend-otp', otpLimiter, async (req, res) => {
    try {
        const email =
            typeof req.body.email === 'string'
                ? req.body.email.trim().toLowerCase()
                : ''

        if (!validEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address.'
            })
        }

        const [rows] = await db.execute(
            `SELECT * FROM pending_email_verifications
             WHERE email = ?
             LIMIT 1`,
            [email]
        )

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No pending registration found.'
            })
        }

        const pending = rows[0]

        const secondsSinceLastSend =
            (Date.now() - new Date(pending.last_sent_at).getTime()) / 1000

        if (secondsSinceLastSend < OTP_RESEND_SECONDS) {
            return res.status(429).json({
                success: false,
                message: 'Please wait before requesting another OTP.',
                retryAfter: Math.ceil(
                    OTP_RESEND_SECONDS - secondsSinceLastSend
                )
            })
        }

        const otp = generateOtp()
        const otpHash = hashOtp(email, otp)

        const expiresAt = new Date(
            Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
        )

        await db.execute(
            `UPDATE pending_email_verifications
             SET otp_hash = ?,
                 expires_at = ?,
                 attempts = 0,
                 last_sent_at = NOW()
             WHERE email = ?`,
            [otpHash, expiresAt, email]
        )

        try {
            await sendVerificationOtp(email, otp, pending.full_name)
        } catch (emailError) {
            console.error('Resend email error:', emailError.message)

            return res.status(500).json({
                success: false,
                message: 'Unable to send a new OTP. Please try again later.'
            })
        }

        return res.json({
            success: true,
            message: 'A new verification code has been sent.',
            expiresIn: OTP_EXPIRY_MINUTES * 60
        })

    } catch (error) {
        console.error('Resend OTP error:', error.message)

        return res.status(500).json({
            success: false,
            message: 'Unable to resend OTP.'
        })
    }
})

// ==========================================
// LOGIN
// POST /api/auth/login
// ==========================================

router.post('/login', authLimiter, async (req, res) => {
    try {
        const email =
            typeof req.body.email === 'string'
                ? req.body.email.trim().toLowerCase()
                : ''

        const { password } = req.body

        if (!validEmail(email) || typeof password !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            })
        }

        const [users] = await db.execute(
            `SELECT id, full_name, email, password_hash,
                    profile_image_url, email_verified, account_status
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        )

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            })
        }

        const user = users[0]

        if (user.account_status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'This account is currently unavailable.'
            })
        }

        if (!user.password_hash) {
            return res.status(401).json({
                success: false,
                message: 'Please use Google sign-in for this account.'
            })
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        )

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            })
        }

        if (!user.email_verified) {
            return res.status(403).json({
                success: false,
                message: 'Please verify your email before logging in.'
            })
        }

        const sessionToken = await createSession(user.id)

        setSessionCookie(res, sessionToken)

        return res.json({
            success: true,
            message: 'Login successful!',
            user: publicUser(user)
        })

    } catch (error) {
        console.error('Login error:', error.message)

        return res.status(500).json({
            success: false,
            message: 'Unable to log in. Please try again.'
        })
    }
})

// ==========================================
// GOOGLE SIGN-IN
// POST /api/auth/google
// ==========================================

router.post('/google', authLimiter, async (req, res) => {
    let connection

    try {
        const { credential } = req.body

        if (!GOOGLE_CLIENT_ID) {
            return res.status(500).json({
                success: false,
                message: 'Google sign-in is not configured on the server.'
            })
        }

        if (typeof credential !== 'string' || !credential) {
            return res.status(400).json({
                success: false,
                message: 'Google credential is required.'
            })
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        })

        const payload = ticket.getPayload()

        if (!payload || !payload.email || !payload.email_verified || !payload.sub) {
            return res.status(401).json({
                success: false,
                message: 'Google account email could not be verified.'
            })
        }

        const googleSub = payload.sub
        const email = payload.email.toLowerCase()
        const fullName = payload.name || 'RainMap User'
        const profileImageUrl = payload.picture || null

        connection = await db.getConnection()
        await connection.beginTransaction()

        let [users] = await connection.execute(
            `SELECT * FROM users
             WHERE google_sub = ?
             LIMIT 1`,
            [googleSub]
        )

        let user

        if (users.length > 0) {
            user = users[0]
        } else {
            // Link Google sign-in to an existing account with the same email.
            const [emailUsers] = await connection.execute(
                `SELECT * FROM users
                 WHERE email = ?
                 LIMIT 1`,
                [email]
            )

            if (emailUsers.length > 0) {
                user = emailUsers[0]

                if (user.google_sub && user.google_sub !== googleSub) {
                    await connection.rollback()

                    return res.status(409).json({
                        success: false,
                        message: 'This email is linked to another Google account.'
                    })
                }

                await connection.execute(
                    `UPDATE users
                     SET google_sub = ?,
                         email_verified = 1,
                         profile_image_url = COALESCE(?, profile_image_url)
                     WHERE id = ?`,
                    [googleSub, profileImageUrl, user.id]
                )
            } else {
                const [result] = await connection.execute(
                    `INSERT INTO users
                    (full_name, email, password_hash, profile_image_url,
                     email_verified, google_sub)
                    VALUES (?, ?, NULL, ?, 1, ?)`,
                    [fullName, email, profileImageUrl, googleSub]
                )

                const userId = result.insertId

                await connection.execute(
                    `INSERT INTO user_preferences (user_id)
                     VALUES (?)`,
                    [userId]
                )

                const [newUsers] = await connection.execute(
                    `SELECT * FROM users WHERE id = ?`,
                    [userId]
                )

                user = newUsers[0]
            }
        }

        if (user.account_status !== 'active') {
            await connection.rollback()

            return res.status(403).json({
                success: false,
                message: 'This account is currently unavailable.'
            })
        }

        const sessionToken = await createSession(user.id, connection)

        await connection.commit()

        setSessionCookie(res, sessionToken)

        return res.json({
            success: true,
            message: 'Google sign-in successful!',
            user: {
                ...publicUser(user),
                emailVerified: true,
                profileImageUrl: profileImageUrl || user.profile_image_url || null
            }
        })

    } catch (error) {
        if (connection) {
            await connection.rollback()
        }

        console.error('Google sign-in error:', error.message)

        return res.status(401).json({
            success: false,
            message: 'Google sign-in failed. Please try again.'
        })

    } finally {
        if (connection) {
            connection.release()
        }
    }
})

// ==========================================
// CHECK CURRENT SESSION
// GET /api/auth/me
// ==========================================

router.get('/me', async (req, res) => {
    try {
        const sessionToken = req.cookies?.[COOKIE_NAME]

        if (!sessionToken) {
            return res.status(401).json({
                success: false,
                message: 'You are not logged in.'
            })
        }

        const sessionTokenHash = hashToken(sessionToken)

        const [users] = await db.execute(
            `SELECT
                u.id,
                u.full_name,
u.email,
u.phone,
u.profile_image_url,
                u.email_verified,
                p.theme,
                p.notification_enabled,
                p.location_enabled
             FROM user_sessions s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN user_preferences p ON p.user_id = u.id
             WHERE s.session_token_hash = ?
               AND s.expires_at > NOW()
               AND u.account_status = 'active'
             LIMIT 1`,
            [sessionTokenHash]
        )

        if (users.length === 0) {
            clearSessionCookie(res)

            return res.status(401).json({
                success: false,
                message: 'Your session has expired. Please log in again.'
            })
        }

        const user = users[0]

        return res.json({
            success: true,
            user: {
                ...publicUser(user),
                preferences: {
                    theme: user.theme || 'purple',
                    notificationEnabled: Boolean(user.notification_enabled),
                    locationEnabled: Boolean(user.location_enabled)
                }
            }
        })

    } catch (error) {
        console.error('Session check error:', error.message)

        return res.status(500).json({
            success: false,
            message: 'Unable to verify your login.'
        })
    }
})

// ==========================================
// LOGOUT
// POST /api/auth/logout
// ==========================================

router.post('/logout', async (req, res) => {
    try {
        const sessionToken = req.cookies?.[COOKIE_NAME]

        if (sessionToken) {
            await db.execute(
                `DELETE FROM user_sessions
                 WHERE session_token_hash = ?`,
                [hashToken(sessionToken)]
            )
        }

        clearSessionCookie(res)

        return res.json({
            success: true,
            message: 'You have been logged out successfully.'
        })

    } catch (error) {
        console.error('Logout error:', error.message)

        return res.status(500).json({
            success: false,
            message: 'Unable to log out. Please try again.'
        })
    }
})

// ==========================================
// DELETE ACCOUNT
// DELETE /api/auth/delete-account
// ==========================================

router.delete('/delete-account', authLimiter, async (req, res) => {
    let connection

    try {
        const sessionToken = req.cookies?.[COOKIE_NAME]

        if (!sessionToken) {
            return res.status(401).json({
                success: false,
                message: 'Please log in before deleting your account.'
            })
        }

        const { password } = req.body || {}

        if (typeof password !== 'string' || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please enter your current password.'
            })
        }

        const sessionTokenHash = hashToken(sessionToken)

        connection = await db.getConnection()
        await connection.beginTransaction()

        // Find the active account using its current session.
        const [users] = await connection.execute(
            `SELECT u.id, u.password_hash
             FROM user_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.session_token_hash = ?
               AND s.expires_at > NOW()
               AND u.account_status = 'active'
             LIMIT 1
             FOR UPDATE`,
            [sessionTokenHash]
        )

        if (users.length === 0) {
            await connection.rollback()
            clearSessionCookie(res)

            return res.status(401).json({
                success: false,
                message: 'Your session has expired. Please log in again.'
            })
        }

        const user = users[0]

        // Google-only accounts do not have a password.
        if (!user.password_hash) {
            await connection.rollback()

            return res.status(400).json({
                success: false,
                message: 'This account does not have a password. Google account confirmation is required.'
            })
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        )

        if (!passwordMatches) {
            await connection.rollback()

            return res.status(401).json({
                success: false,
                message: 'Incorrect password. Account deletion cancelled.'
            })
        }

        // Soft-delete the account.
        await connection.execute(
            `UPDATE users
             SET account_status = 'deleted'
             WHERE id = ?`,
            [user.id]
        )

        // Invalidate every session belonging to this account.
        await connection.execute(
            `DELETE FROM user_sessions
             WHERE user_id = ?`,
            [user.id]
        )

        await connection.commit()

        clearSessionCookie(res)

        return res.json({
            success: true,
            message: 'Your RainMap account has been deleted successfully.'
        })

    } catch (error) {
        if (connection) {
            await connection.rollback()
        }

        console.error('Account deletion error:', error.message)

        return res.status(500).json({
            success: false,
            message: 'Unable to delete your account. Please try again.'
        })

    } finally {
        if (connection) {
            connection.release()
        }
    }
})


module.exports = router
