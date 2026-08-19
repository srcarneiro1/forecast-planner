import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './planning.css'
import './brand.css'
import './unilog.css'
import './logo.css'
import './auth.css'
import './brand-final.css'
import './brand-logo-final.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
