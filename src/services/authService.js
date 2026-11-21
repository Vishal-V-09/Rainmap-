
const API_BASE_URL =
    import.meta.env.VITE_API_URL || 'http://localhost:5000'

// Common API request handler
async function authRequest(endpoint, options = {}) {
    try {
        const response = await fetch(
            `${API_BASE_URL}/api/auth${endpoint}`,
            {
                ...options,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            }
        )

        const data = await response.json()

        if (!response.ok) {
            throw new Error(data.message || 'Authentication failed.')
        }

        return data

    } catch (error) {
        throw new Error(
            error.message || 'Unable to connect to RainMap server.'
        )
    }
}

// REGISTER
export function registerUser(userData) {
    return authRequest('/register', {
        method: 'POST',
        body: JSON.stringify(userData)
    })
}

// VERIFY EMAIL OTP
export function verifyOtp(otpData) {
    return authRequest('/verify-otp', {
        method: 'POST',
        body: JSON.stringify(otpData)
    })
}

// RESEND EMAIL OTP
export function resendOtp(otpData) {
    return authRequest('/resend-otp', {
        method: 'POST',
        body: JSON.stringify(otpData)
    })
}

// LOGIN
export function loginUser(credentials) {
    return authRequest('/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
    })
}

// GOOGLE SIGN-IN
export function googleLogin(credential) {
    return authRequest('/google', {
        method: 'POST',
        body: JSON.stringify({ credential })
    })
}
// GOOGLE RE-AUTHENTICATION FOR ACCOUNT DELETION
export function deleteAccountWithGoogle(credential) {
    return authRequest('/delete-account/google', {
        method: 'POST',
        body: JSON.stringify({ credential })
    })
}
// CHECK CURRENT SESSION
export function getCurrentUser() {
    return authRequest('/me', {
        method: 'GET'
    })
}

// LOGOUT
export function logoutUser() {
    return authRequest('/logout', {
        method: 'POST'
    })
}

// DELETE ACCOUNT
export function deleteAccount(password) {
    return authRequest('/delete-account', {
        method: 'DELETE',
        body: JSON.stringify({ password })
    })
}
