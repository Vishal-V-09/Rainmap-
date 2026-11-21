
import { useState, useEffect, useRef } from 'react'
import {
    registerUser,
    loginUser,
    verifyOtp,
    resendOtp,
    googleLogin
} from './services/authService'
import {
    CloudRain,
    Eye,
    EyeOff,
    Mail,
    Lock,
    User,
    Phone,
    ArrowRight,
    ArrowLeft,
    ShieldCheck,
    Cloud,
} from 'lucide-react'
import './AuthPage.css'

export default function AuthPage({ onAuthenticated }) {
    const [mode, setMode] = useState('login')
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [showOtp, setShowOtp] = useState(false)
    const [notice, setNotice] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [resendCountdown, setResendCountdown] = useState(0)
    const googleButtonRef = useRef(null)

    const [form, setForm] = useState({
        name: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
        otp: '',
    })
    useEffect(() => {
        if (resendCountdown <= 0) return

        const timer = setTimeout(() => {
            setResendCountdown(previous => previous - 1)
        }, 1000)

        return () => clearTimeout(timer)
    }, [resendCountdown])

    const updateForm = (e) => {
        setForm(previous => ({
            ...previous,
            [e.target.name]: e.target.value
        }))
        setNotice('')
    }


    const handleSubmit = async (e) => {
        e.preventDefault()
        setNotice('')

        if (isSubmitting) return

        if (mode === 'signup') {
            if (form.password.length < 8) {
                setNotice('Password must contain at least 8 characters.')
                return
            }

            if (form.password !== form.confirmPassword) {
                setNotice('Your passwords do not match.')
                return
            }
        }

        try {
            setIsSubmitting(true)

            let response

            if (mode === 'signup') {
                response = await registerUser({
                    fullName: form.name,
                    email: form.email,
                    phone: form.phone.replace(/[^\d+]/g, ''),
                    password: form.password
                })

                if (response.success && response.otpRequired) {
                    setShowOtp(true)
                    setResendCountdown(60)
                    setForm(previous => ({ ...previous, otp: '' }))
                    setNotice(response.message)
                    return
                }
            } else {
                response = await loginUser({
                    email: form.email,
                    password: form.password
                })
            }

            if (response.success && response.user) {
                onAuthenticated?.(response.user)
            } else {
                setNotice(response.message || 'Authentication failed.')
            }

        } catch (error) {
            setNotice(error.message || 'Unable to connect to RainMap server.')
        } finally {
            setIsSubmitting(false)
        }
    }


    const handleOtpSubmit = async (e) => {
        e.preventDefault()
        setNotice('')

        if (form.otp.length !== 6) {
            setNotice('Please enter a valid 6-digit OTP.')
            return
        }

        if (isSubmitting) return

        try {
            setIsSubmitting(true)

            const response = await verifyOtp({
                email: form.email,
                otp: form.otp
            })

            if (response.success && response.user) {
                onAuthenticated?.(response.user)
            } else {
                setNotice(response.message || 'OTP verification failed.')
            }

        } catch (error) {
            setNotice(error.message || 'Unable to verify OTP.')
        } finally {
            setIsSubmitting(false)
        }
    }
    const handleResendOtp = async () => {
        if (resendCountdown > 0 || isSubmitting) return

        try {
            setIsSubmitting(true)
            setNotice('')

            const response = await resendOtp({
                email: form.email
            })

            if (response.success) {
                setResendCountdown(60)
                setForm(previous => ({ ...previous, otp: '' }))
                setNotice(response.message)
            }

        } catch (error) {
            setNotice(error.message || 'Unable to resend OTP.')
        } finally {
            setIsSubmitting(false)
        }
    }

    useEffect(() => {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
        console.log('Google Client ID loaded:', Boolean(clientId))
        console.log('Google Client ID:', clientId)

        if (!clientId || !googleButtonRef.current) {
            console.error('Google Client ID is missing.')
            return
        }

        const initializeGoogle = () => {
            if (!window.google?.accounts?.id || !googleButtonRef.current) {
                return
            }

            window.google.accounts.id.initialize({
                client_id: clientId,

                callback: async (googleResponse) => {
                    if (!googleResponse.credential) {
                        setNotice('Unable to receive Google credentials.')
                        return
                    }

                    try {
                        setIsSubmitting(true)
                        setNotice('')

                        const response = await googleLogin(
                            googleResponse.credential
                        )

                        if (response.success && response.user) {
                            onAuthenticated?.(response.user)
                        } else {
                            setNotice(response.message || 'Google sign-in failed.')
                        }

                    } catch (error) {
                        setNotice(error.message || 'Google sign-in failed.')
                    } finally {
                        setIsSubmitting(false)
                    }
                }
            })

            window.google.accounts.id.renderButton(
                googleButtonRef.current,
                {
                    theme: 'outline',
                    size: 'large',
                    shape: 'rectangular',
                    text: 'continue_with',
                    width: 320
                }
            )
        }

        const existingScript = document.getElementById('google-identity-script')

        if (window.google?.accounts?.id) {
            initializeGoogle()
        } else if (existingScript) {
            existingScript.addEventListener('load', initializeGoogle, { once: true })
        } else {
            const script = document.createElement('script')

            script.id = 'google-identity-script'
            script.src = 'https://accounts.google.com/gsi/client'
            script.async = true
            script.defer = true
            script.onload = initializeGoogle

            document.head.appendChild(script)
        }
    }, [onAuthenticated, showOtp])

    const switchMode = (nextMode) => {
        setMode(nextMode)
        setShowOtp(false)
        setNotice('')
    }

    return (
        <main className="auth-page">
            {/* Animated background */}
            <div className="auth-background">
                <div className="auth-cloud auth-cloud-one" />
                <div className="auth-cloud auth-cloud-two" />
                <div className="auth-cloud auth-cloud-three" />
                <div className="auth-rain rain-one" />
                <div className="auth-rain rain-two" />
                <div className="auth-rain rain-three" />
                <div className="auth-rain rain-four" />
                <div className="auth-rain rain-five" />
                <div className="auth-glow auth-glow-one" />
                <div className="auth-glow auth-glow-two" />
            </div>

            {/* Brand */}
            <header className="auth-header">
                <div className="auth-brand">
                    <div className="auth-brand-icon">
                        <CloudRain size={25} strokeWidth={2.2} />
                    </div>
                    <span>RainMap<span className="auth-brand-dot">.</span></span>
                </div>

                <div className="auth-header-note">
                    <span className="auth-live-dot" />
                    Your city. Your weather. Your safety.
                </div>
            </header>

            {/* Main content */}
            <section className="auth-layout">
                <div className="auth-intro">
                    <div className="auth-eyebrow">
                        <Cloud size={15} />
                        SMARTER RAINFALL AWARENESS
                    </div>

                    <h1>
                        Stay ahead
                        <br />
                        of the <span>rain.</span>
                    </h1>

                    <p className="auth-description">
                        Your city is always changing. Stay informed about rainfall,
                        discover safer routes, and make every journey smarter with RainMap.
                    </p>

                    <div className="auth-feature-list">
                        <div className="auth-feature">
                            <span className="auth-feature-icon">01</span>
                            <div>
                                <strong>Live rainfall insights</strong>
                                <p>Know what's happening around your location.</p>
                            </div>
                        </div>

                        <div className="auth-feature">
                            <span className="auth-feature-icon">02</span>
                            <div>
                                <strong>Rain-aware journeys</strong>
                                <p>Make informed decisions before you travel.</p>
                            </div>
                        </div>

                        <div className="auth-feature">
                            <span className="auth-feature-icon">03</span>
                            <div>
                                <strong>Community-powered updates</strong>
                                <p>Stay connected with local rainfall reports.</p>
                            </div>
                        </div>
                    </div>

                    <div className="auth-location-note">
                        <span className="auth-location-pulse" />
                        Built with Chennai in mind
                    </div>
                </div>

                {/* Authentication card */}
                <div className="auth-card">
                    {!showOtp ? (
                        <>
                            <div className="auth-card-top">
                                <div className="auth-card-symbol">
                                    {mode === 'login' ? (
                                        <Lock size={22} />
                                    ) : (
                                        <ShieldCheck size={23} />
                                    )}
                                </div>

                                <span className="auth-card-label">
                                    {mode === 'login' ? 'WELCOME BACK' : 'JOIN THE COMMUNITY'}
                                </span>
                            </div>

                            <h2>
                                {mode === 'login'
                                    ? 'Good to see you.'
                                    : 'Create your account.'}
                            </h2>

                            <p className="auth-card-subtitle">
                                {mode === 'login'
                                    ? 'Sign in to continue your RainMap experience.'
                                    : 'A smarter way to stay prepared starts here.'}
                            </p>

                            <div className="auth-mode-switch">
                                <button
                                    type="button"
                                    className={mode === 'login' ? 'active' : ''}
                                    onClick={() => switchMode('login')}
                                >
                                    Sign in
                                </button>

                                <button
                                    type="button"
                                    className={mode === 'signup' ? 'active' : ''}
                                    onClick={() => switchMode('signup')}
                                >
                                    Create account
                                </button>
                            </div>

                            <form className="auth-form" onSubmit={handleSubmit}>

                                <div className="auth-field">
                                    <label htmlFor="auth-email">Email address</label>
                                    <div className="auth-input-wrap">
                                        <Mail size={18} />
                                        <input
                                            id="auth-email"
                                            name="email"
                                            type="email"
                                            placeholder="you@example.com"
                                            value={form.email}
                                            onChange={updateForm}
                                            autoComplete="email"
                                            required
                                        />
                                    </div>
                                </div>
                                {mode === 'signup' && (
                                    <div className="auth-field">
                                        <label htmlFor="auth-name">Full name</label>
                                        <div className="auth-input-wrap">
                                            <User size={18} />
                                            <input
                                                id="auth-name"
                                                name="name"
                                                type="text"
                                                placeholder="Enter your full name"
                                                value={form.name}
                                                onChange={updateForm}
                                                autoComplete="name"
                                                required
                                            />
                                        </div>
                                    </div>
                                )}

                                {mode === 'signup' && (
                                    <div className="auth-field">
                                        <label htmlFor="auth-phone">Phone number</label>
                                        <div className="auth-input-wrap">
                                            <Phone size={18} />
                                            <input
                                                id="auth-phone"
                                                name="phone"
                                                type="tel"
                                                placeholder="+91 98765 43210"
                                                value={form.phone}
                                                onChange={updateForm}
                                                autoComplete="tel"
                                                required
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="auth-field">
                                    <div className="auth-label-row">
                                        <label htmlFor="auth-password">Password</label>
                                        {mode === 'login' && (
                                            <button
                                                type="button"
                                                className="auth-text-button"
                                                onClick={() =>
                                                    setNotice('Password recovery will be connected with the backend.')
                                                }
                                            >
                                                Forgot password?
                                            </button>
                                        )}
                                    </div>

                                    <div className="auth-input-wrap">
                                        <Lock size={18} />
                                        <input
                                            id="auth-password"
                                            name="password"
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="Enter your password"
                                            value={form.password}
                                            onChange={updateForm}
                                            autoComplete={
                                                mode === 'login' ? 'current-password' : 'new-password'
                                            }
                                            required
                                        />
                                        <button
                                            type="button"
                                            className="auth-eye-button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            aria-label="Toggle password visibility"
                                        >
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </div>

                                {mode === 'signup' && (
                                    <div className="auth-field">
                                        <label htmlFor="auth-confirm-password">
                                            Confirm password
                                        </label>
                                        <div className="auth-input-wrap">
                                            <Lock size={18} />
                                            <input
                                                id="auth-confirm-password"
                                                name="confirmPassword"
                                                type={showConfirmPassword ? 'text' : 'password'}
                                                placeholder="Re-enter your password"
                                                value={form.confirmPassword}
                                                onChange={updateForm}
                                                autoComplete="new-password"
                                                required
                                            />
                                            <button
                                                type="button"
                                                className="auth-eye-button"
                                                onClick={() =>
                                                    setShowConfirmPassword(!showConfirmPassword)
                                                }
                                                aria-label="Toggle confirm password visibility"
                                            >
                                                {showConfirmPassword ? (
                                                    <EyeOff size={18} />
                                                ) : (
                                                    <Eye size={18} />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {notice && <p className="auth-notice">{notice}</p>}

                                <button
                                    type="submit"
                                    className="auth-submit"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting
                                        ? 'Please wait...'
                                        : mode === 'login'
                                            ? 'Sign in to RainMap'
                                            : 'Create my account'}

                                    {!isSubmitting && <ArrowRight size={18} />}
                                </button>
                            </form>

                            <div className="auth-divider">
                                <span />
                                <p>OR CONTINUE WITH</p>
                                <span />
                            </div>

                            <div
                                className="auth-google-button"
                                ref={googleButtonRef}
                            ></div>

                            <p className="auth-terms">
                                Secure access to your RainMap account, wherever you go.
                            </p>
                        </>
                    ) : (
                        <div className="auth-otp-screen">
                            <button
                                type="button"
                                className="auth-back-button"
                                onClick={() => {
                                    setShowOtp(false)
                                    setNotice('')
                                }}
                            >
                                <ArrowLeft size={17} />
                                Back
                            </button>

                            <div className="auth-otp-icon">
                                <ShieldCheck size={30} />
                            </div>

                            <span className="auth-card-label">EMAIL VERIFICATION</span>
                            <h2>One more step.</h2>
                            <p className="auth-card-subtitle">
                                Enter the 6-digit verification code to continue.
                            </p>

                            <form onSubmit={handleOtpSubmit} className="auth-form">
                                <div className="auth-field">
                                    <label htmlFor="auth-otp">Verification code</label>
                                    <input
                                        id="auth-otp"
                                        className="auth-otp-input"
                                        name="otp"
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={6}
                                        placeholder="000000"
                                        value={form.otp}
                                        onChange={(e) => {
                                            const value = e.target.value.replace(/\D/g, '')
                                            setForm(previous => ({ ...previous, otp: value }))
                                            setNotice('')
                                        }}
                                        required
                                    />
                                </div>

                                {notice && <p className="auth-notice">{notice}</p>}

                                <button
                                    type="submit"
                                    className="auth-submit"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Verifying...' : 'Verify email'}
                                    {!isSubmitting && <ArrowRight size={18} />}
                                </button>
                                <div className="auth-resend-row">
                                    <span>Didn't receive the code?</span>

                                    <button
                                        type="button"
                                        className="auth-text-button"
                                        onClick={handleResendOtp}
                                        disabled={resendCountdown > 0 || isSubmitting}
                                    >
                                        {resendCountdown > 0
                                            ? `Resend in ${resendCountdown}s`
                                            : 'Resend OTP'}
                                    </button>
                                </div>
                            </form>

                            <p className="auth-terms">
                                Your verification code was sent to your registered email address.
                            </p>
                        </div>
                    )}
                </div>
            </section>

            <footer className="auth-footer">
                <span>© 2026 RainMap Chennai</span>
                <span>Designed for a rain-aware city <CloudRain size={14} /></span>
            </footer>
        </main>
    )
}
