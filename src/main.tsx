import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ScenarioAnalysisFeature from './ScenarioAnalysisFeature'
import DashboardSelectableFeature from './DashboardSelectableFeature'
import CheckoutStepperFeature from './CheckoutStepperFeature'
import ForecastAccessGovernance from './ForecastAccessGovernance'
import ForecastMfaGate from './ForecastMfaGate'
import './planning.css'
import './brand.css'
import './unilog.css'
import './auth.css'
import './brand-logo-final.css'
import './parameters-polish.css'
import './checkout-input-polish.css'
import './layout-audit-fixes.css'
import './forecast-governance.css'
import './forecast-mfa.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ScenarioAnalysisFeature />
    <DashboardSelectableFeature />
    <CheckoutStepperFeature />
    <ForecastAccessGovernance />
    <ForecastMfaGate />
  </StrictMode>,
)
