import { useState } from 'react'

const API_BASE = 'https://api.panaderoapp.com/api'

function Login({ onLogin }) {
  const [email, setEmail] = useState('fedeamurin@gmail.com')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'No se pudo iniciar sesión.')
      onLogin(payload.user)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <header className="login-brand">
          <strong>Panadero</strong>
          <small>Facturación inteligente</small>
        </header>
        <div className="login-copy">
          <span>Acceso privado a Panadero</span>
          <h1>Iniciar sesión</h1>
          <p>Ingresá con tu cuenta de Panadero para administrar Mercado Libre y ARCA.</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label>
            <span>Correo electrónico</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            <span>Contraseña</span>
            <div className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus />
              <button type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? 'Ocultar' : 'Ver'}</button>
            </div>
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="login-submit" type="submit" disabled={loading}>{loading ? 'Ingresando…' : 'Ingresar a Panadero'}</button>
        </form>
        <footer>Sesión protegida · Mercado Libre y ARCA permanecen conectados dentro de Panadero</footer>
      </section>
    </main>
  )
}

export default Login
