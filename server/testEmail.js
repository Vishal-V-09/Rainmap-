
require('dotenv').config()

const { sendVerificationOtp } = require('./services/emailService')

async function testEmail() {
    try {
        await sendVerificationOtp(
            process.env.SMTP_USER,
            '123456',
            'RainMap Test'
        )

        console.log('SUCCESS: RainMap test email sent!')
    } catch (error) {
        console.error('EMAIL TEST FAILED:', error.message)
    }
}

testEmail()
