import { useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldBan,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  User,
  Zap
} from 'lucide-react'
import type { AppSnapshot, TwoFactorMethod } from '@shared/types'
import { validateTwoFactorCode } from '@shared/validation'
import { BrandMark } from '@/components/BrandMark'
import { Spinner } from '@/components/ui'
import { api } from '@/lib/api'

export function LoginPage({ snapshot }: { snapshot: AppSnapshot }) {
  const twoFactor = snapshot.auth.phase === 'two_factor'
  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark size={40} />
          <div>
            <div className="brand-name">VRCManagerX</div>
            <div className="brand-sub">Invite Manager</div>
          </div>
        </div>
        <h2 className="hero-title">
          Your <span>Ask Me</span> status, on autopilot.
        </h2>
        <p className="hero-sub">
          Automatically accept the people you trust and turn away the ones you don't, while everyone else stays your call.
        </p>
        <div className="hero-features">
          <div className="hero-feature">
            <div className="icon">
              <ShieldCheck size={17} />
            </div>
            <div>
              <strong>Whitelist</strong>
              <span>Trusted friends get an invite to your instance instantly.</span>
            </div>
          </div>
          <div className="hero-feature">
            <div className="icon">
              <ShieldBan size={17} />
            </div>
            <div>
              <strong>Blacklist</strong>
              <span>Unwanted requests are declined with your own message.</span>
            </div>
          </div>
          <div className="hero-feature">
            <div className="icon">
              <Zap size={17} />
            </div>
            <div>
              <strong>Real-time</strong>
              <span>Requests arrive through VRChat's live connection. No polling.</span>
            </div>
          </div>
        </div>
        <div className="hero-foot">
          VRCManagerX is an independent tool and is not affiliated with or endorsed by VRChat Inc.
        </div>
      </section>

      <section className="login-panel">{twoFactor ? <TwoFactorForm methods={snapshot.auth.twoFactorMethods ?? ['totp']} /> : <CredentialsForm snapshot={snapshot} />}</section>
    </div>
  )
}

function CredentialsForm({ snapshot }: { snapshot: AppSnapshot }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(snapshot.settings.app.rememberSession && snapshot.auth.secureStorageAvailable)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your VRChat username (or email) and password.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await api().login({ username: username.trim(), password, remember })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    // The password is not kept in the UI after a login attempt.
    setPassword('')
  }

  return (
    <div className="login-card">
      <div>
        <h1>Sign in to VRChat</h1>
        <p className="lead">Use your VRChat account to let VRCManagerX handle your invite requests.</p>
      </div>

      {snapshot.auth.notice && !error && (
        <div className="callout callout-warning">
          <TriangleAlert size={16} />
          <div>{snapshot.auth.notice}</div>
        </div>
      )}
      {error && (
        <div className="callout callout-danger" role="alert">
          <TriangleAlert size={16} />
          <div>{error}</div>
        </div>
      )}

      <form className="login-form" onSubmit={submit} noValidate>
        <label className="field">
          <span className="field-label">Username or email</span>
          <div className="input-wrap">
            <User size={16} />
            <input
              className="input"
              autoComplete="username"
              autoFocus
              value={username}
              maxLength={256}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="VRChat username or email"
            />
          </div>
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <div className="input-wrap">
            <Lock size={16} />
            <input
              className="input"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              maxLength={1024}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={{ paddingRight: 40 }}
            />
            <button type="button" className="btn btn-ghost btn-icon btn-sm input-suffix" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </label>
        <label className="checkbox" title={snapshot.auth.secureStorageAvailable ? undefined : 'Secure OS storage is not available on this system.'}>
          <input type="checkbox" checked={remember} disabled={!snapshot.auth.secureStorageAvailable} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this computer
        </label>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner size={16} /> : <LogIn size={16} />}
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <div className="security-note">
        <ShieldCheck size={16} />
        <div>
          Your password is sent only to VRChat (api.vrchat.cloud) over HTTPS and is never saved. If you stay signed in, only the session token
          is kept, encrypted with your Windows account.
        </div>
      </div>
    </div>
  )
}

const METHOD_INFO: Record<TwoFactorMethod, { title: string; text: string; icon: typeof Smartphone; placeholder: string }> = {
  totp: {
    title: 'Authenticator code',
    text: 'Open your authenticator app and enter the 6-digit code for VRChat.',
    icon: Smartphone,
    placeholder: '000000'
  },
  emailOtp: {
    title: 'Email code',
    text: 'VRChat sent a 6-digit code to the email address on your account.',
    icon: Mail,
    placeholder: '000000'
  },
  otp: {
    title: 'Recovery code',
    text: 'Enter one of the recovery codes you saved when enabling two-factor authentication.',
    icon: KeyRound,
    placeholder: 'abcd-1234'
  }
}

function TwoFactorForm({ methods }: { methods: TwoFactorMethod[] }) {
  const available: TwoFactorMethod[] = methods.includes('totp') && !methods.includes('otp') ? [...methods, 'otp'] : methods
  const [method, setMethod] = useState<TwoFactorMethod>(available[0] ?? 'totp')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const info = METHOD_INFO[method]
  const Icon = info.icon

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = validateTwoFactorCode(method, code)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    const result = await api().verify2fa({ method, code })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      setCode('')
    }
  }

  return (
    <div className="login-card">
      <button type="button" className="link-btn row" onClick={() => void api().cancel2fa()} style={{ width: 'fit-content' }}>
        <ArrowLeft size={15} /> Back to sign in
      </button>
      <div className="row" style={{ gap: 14 }}>
        <div className="modal-icon">
          <Icon size={19} />
        </div>
        <div>
          <h1 style={{ fontSize: 21 }}>Two-factor authentication</h1>
          <p className="lead" style={{ marginTop: 2 }}>
            {info.title}
          </p>
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {info.text}
      </p>
      {error && (
        <div className="callout callout-danger" role="alert">
          <TriangleAlert size={16} />
          <div>{error}</div>
        </div>
      )}
      <form className="login-form" onSubmit={submit}>
        <input
          className="input code-input"
          autoFocus
          inputMode={method === 'otp' ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          maxLength={method === 'otp' ? 9 : 7}
          value={code}
          placeholder={info.placeholder}
          aria-label={info.title}
          onChange={(e) => setCode(method === 'otp' ? e.target.value : e.target.value.replace(/[^\d]/g, ''))}
        />
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner size={16} /> : <ShieldCheck size={16} />}
          Verify
        </button>
      </form>
      {available.length > 1 && (
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          {available
            .filter((m) => m !== method)
            .map((m) => (
              <button
                key={m}
                type="button"
                className="link-btn"
                onClick={() => {
                  setMethod(m)
                  setCode('')
                  setError(null)
                }}
              >
                Use {METHOD_INFO[m].title.toLowerCase()} instead
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
