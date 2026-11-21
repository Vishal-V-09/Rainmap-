
const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_APP_PASSWORD
    }
})

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char])
}

async function sendVerificationOtp(email, otp, fullName) {
    if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) {
        throw new Error('SMTP credentials are not configured.')
    }

    await transporter.sendMail({
        from: {
            name: 'RainMap Chennai',
            address: process.env.SMTP_USER
        },
        to: email,
        subject: 'Your RainMap Verification Code',
        text: `Hello ${fullName},

Your RainMap email verification code is ${otp}.

This code expires in 10 minutes.

If you did not request this, please ignore this email.

RainMap Chennai Team`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;background:#f8f5ff;border-radius:16px;">
                <h2 style="color:#8050c8;">🌧️ RainMap Chennai</h2>
                <p>Hello ${escapeHtml(fullName)},</p>
                <p>Use this code to verify your email address:</p>
                <div style="background:white;padding:20px;text-align:center;border-radius:12px;">
                    <h1 style="letter-spacing:8px;color:#8050c8;">${otp}</h1>
                </div>
                <p>This code expires in <strong>10 minutes</strong>.</p>
                <p style="color:#777;font-size:13px;">If you did not request this, please ignore this email.</p>
                <p>RainMap Chennai Team 💜</p>
            </div>
        `
    })
}

module.exports = { sendVerificationOtp }
