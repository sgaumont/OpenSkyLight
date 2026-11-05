import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { installTapFallback } from '@shared/tapFallback'
import './styles/global.css'

// a touch tap whose click Chromium drops still presses the button (OPE-16)
const buttonIn = (node: unknown): HTMLButtonElement | null =>
  node instanceof Element ? node.closest('button') : null
installTapFallback(document, (e) =>
  e.type === 'pointerup' ? buttonIn(document.elementFromPoint(e.clientX ?? 0, e.clientY ?? 0)) : buttonIn(e.target)
)

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
