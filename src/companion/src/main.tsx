import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { adoptTokenFromUrl } from './api/client'
import { registerServiceWorker } from './api/push'
import App from './App'
import './styles.css'

// pairing QR puts the token in the fragment; stash it before anything renders
adoptTokenFromUrl()
// phone notifications (only where the page is https, i.e. the Tailscale address)
registerServiceWorker()

// the companion follows the phone's own theme (the kiosk follows the sun)
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  document.documentElement.classList.toggle('dark', darkQuery.matches)
}
applyTheme()
darkQuery.addEventListener('change', applyTheme)

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
