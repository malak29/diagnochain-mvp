import React from 'react';
import { createRoot } from 'react-dom/client';
import { Buffer } from 'buffer';
import { Workbox } from 'workbox-window';

import App from './App';
import reportWebVitals from './reportWebVitals';

import './styles/globals.css';

if (typeof global === 'undefined') {
  window.global = window;
}

window.Buffer = Buffer;

if (!window.process) {
  window.process = { env: {} };
}

const initializeApp = async () => {
  try {
    console.log('🚀 Initializing DiagnoChain Application...');
    
    const container = document.getElementById('root');
    
    if (!container) {
      throw new Error('Root container not found');
    }
    
    const root = createRoot(container);
    
    const renderApp = () => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    };

    if (process.env.NODE_ENV === 'development') {
      const { worker } = await import('./mocks/browser');
      
      if (process.env.REACT_APP_ENABLE_MOCKS === 'true') {
        await worker.start({
          onUnhandledRequest: 'bypass',
          quiet: false
        });
        console.log('🔧 Mock Service Worker started');
      }
    }

    renderApp();
    
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      const wb = new Workbox('/service-worker.js');
      
      wb.addEventListener('installed', (event) => {
        if (event.isUpdate) {
          console.log('📱 New content available, please refresh.');
          
          if (window.confirm('New version available! Click OK to refresh and get the latest updates.')) {
            window.location.reload();
          }
        } else {
          console.log('📱 Content cached for offline use.');
        }
      });
      
      wb.addEventListener('waiting', (event) => {
        console.log('📱 New service worker is waiting to activate.');
        
        const showSkipWaitingPrompt = () => {
          if (window.confirm('New version ready! Click OK to activate it now.')) {
            wb.addEventListener('controlling', (event) => {
              window.location.reload();
            });
            
            wb.messageSkipWaiting();
          }
        };

        showSkipWaitingPrompt();
      });
      
      wb.addEventListener('controlling', (event) => {
        console.log('📱 New service worker is controlling the page.');
        window.location.reload();
      });
      
      wb.addEventListener('activated', (event) => {
        console.log('📱 Service worker activated.');
      });
      
      wb.register().then((registration) => {
        console.log('📱 Service Worker registered successfully:', registration);
      }).catch((error) => {
        console.error('📱 Service Worker registration failed:', error);
      });
    }

    if (process.env.NODE_ENV === 'production') {
      if (process.env.REACT_APP_SENTRY_DSN) {
        const Sentry = await import('@sentry/react');
        const { Integrations } = await import('@sentry/tracing');
        
        Sentry.init({
          dsn: process.env.REACT_APP_SENTRY_DSN,
          environment: process.env.NODE_ENV,
          integrations: [
            new Integrations.BrowserTracing(),
          ],
          tracesSampleRate: 0.1,
          beforeSend(event) {
            if (event.exception) {
              const error = event.exception.values[0];
              console.error('Error captured by Sentry:', error);
            }
            return event;
          }
        });
        
        console.log('📊 Sentry error reporting initialized');
      }

      if (process.env.REACT_APP_GA_MEASUREMENT_ID) {
        const script1 = document.createElement('script');
        script1.async = true;
        script1.src = `https://www.googletagmanager.com/gtag/js?id=${process.env.REACT_APP_GA_MEASUREMENT_ID}`;
        document.head.appendChild(script1);

        const script2 = document.createElement('script');
        script2.innerHTML = `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${process.env.REACT_APP_GA_MEASUREMENT_ID}', {
            page_title: document.title,
            page_location: window.location.href
          });
        `;
        document.head.appendChild(script2);
        
        console.log('📈 Google Analytics initialized');
      }
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    
    if (prefersReducedMotion.matches) {
      document.documentElement.classList.add('reduce-motion');
      console.log('♿ Reduced motion preferences detected and applied');
    }
    
    prefersReducedMotion.addListener((e) => {
      if (e.matches) {
        document.documentElement.classList.add('reduce-motion');
      } else {
        document.documentElement.classList.remove('reduce-motion');
      }
    });

    const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const savedTheme = localStorage.getItem('theme');
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDarkScheme.matches)) {
      document.documentElement.classList.add('dark');
    }
    
    prefersDarkScheme.addListener((e) => {
      if (!localStorage.getItem('theme')) {
        if (e.matches) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    });

    document.documentElement.setAttribute('lang', 'en');
    
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.content = 'DiagnoChain - Secure, decentralized healthcare data management powered by blockchain technology.';
    }
    
    const metaKeywords = document.createElement('meta');
    metaKeywords.name = 'keywords';
    metaKeywords.content = 'healthcare, blockchain, medical records, decentralized, privacy, security, ethereum, bitcoin';
    document.head.appendChild(metaKeywords);
    
    const metaAuthor = document.createElement('meta');
    metaAuthor.name = 'author';
    metaAuthor.content = 'DiagnoChain Team';
    document.head.appendChild(metaAuthor);

    const linkPreconnect1 = document.createElement('link');
    linkPreconnect1.rel = 'preconnect';
    linkPreconnect1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(linkPreconnect1);
    
    const linkPreconnect2 = document.createElement('link');
    linkPreconnect2.rel = 'preconnect';
    linkPreconnect2.href = 'https://fonts.gstatic.com';
    linkPreconnect2.crossOrigin = 'anonymous';
    document.head.appendChild(linkPreconnect2);

    if (process.env.NODE_ENV === 'production') {
      console.log = () => {};
      console.warn = () => {};
      console.info = () => {};
    }

    window.addEventListener('load', () => {
      console.log('🎉 DiagnoChain application loaded successfully');
      
      const loadTime = performance.now();
      console.log(`⚡ Load time: ${Math.round(loadTime)}ms`);
      
      if (window.gtag) {
        window.gtag('event', 'page_load_time', {
          event_category: 'Performance',
          value: Math.round(loadTime)
        });
      }
    });

    window.addEventListener('error', (event) => {
      console.error('Global error:', event.error);
      
      if (window.gtag) {
        window.gtag('event', 'exception', {
          description: event.error?.message || 'Unknown error',
          fatal: false
        });
      }
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled promise rejection:', event.reason);
      
      if (window.gtag) {
        window.gtag('event', 'exception', {
          description: event.reason?.message || 'Unhandled promise rejection',
          fatal: false
        });
      }
    });

    let isIdle = false;
    let idleTimer;
    
    const resetIdleTimer = () => {
      if (isIdle) {
        isIdle = false;
        console.log('👤 User became active');
      }
      
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        isIdle = true;
        console.log('💤 User idle detected');
        
        const event = new CustomEvent('userIdle', {
          detail: { timestamp: new Date().toISOString() }
        });
        window.dispatchEvent(event);
      }, 5 * 60 * 1000);
    };

    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(event => {
      document.addEventListener(event, resetIdleTimer, true);
    });

    resetIdleTimer();

    if ('navigator' in window && 'storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then(estimate => {
        const used = estimate.usage ? (estimate.usage / 1024 / 1024).toFixed(2) : 'Unknown';
        const quota = estimate.quota ? (estimate.quota / 1024 / 1024).toFixed(2) : 'Unknown';
        console.log(`💾 Storage: ${used}MB used of ${quota}MB available`);
      });
    }

    if ('connection' in navigator) {
      const connection = navigator.connection;
      console.log(`🌐 Network: ${connection.effectiveType} (${connection.downlink}Mbps)`);
      
      connection.addEventListener('change', () => {
        console.log(`🌐 Network changed: ${connection.effectiveType} (${connection.downlink}Mbps)`);
        
        const event = new CustomEvent('networkChange', {
          detail: {
            effectiveType: connection.effectiveType,
            downlink: connection.downlink,
            rtt: connection.rtt
          }
        });
        window.dispatchEvent(event);
      });
    }

    const performanceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'navigation') {
          console.log(`🚀 Navigation: ${entry.type} (${Math.round(entry.duration)}ms)`);
        } else if (entry.entryType === 'largest-contentful-paint') {
          console.log(`🎨 LCP: ${Math.round(entry.startTime)}ms`);
        } else if (entry.entryType === 'first-input') {
          console.log(`👆 FID: ${Math.round(entry.processingStart - entry.startTime)}ms`);
        } else if (entry.entryType === 'layout-shift') {
          console.log(`📐 CLS: ${entry.value}`);
        }
      }
    });
    
    if (PerformanceObserver.supportedEntryTypes.includes('navigation')) {
      performanceObserver.observe({ entryTypes: ['navigation'] });
    }
    if (PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
      performanceObserver.observe({ entryTypes: ['largest-contentful-paint'] });
    }
    if (PerformanceObserver.supportedEntryTypes.includes('first-input')) {
      performanceObserver.observe({ entryTypes: ['first-input'] });
    }
    if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
      performanceObserver.observe({ entryTypes: ['layout-shift'] });
    }

    console.log('✅ DiagnoChain initialization complete');

  } catch (error) {
    console.error('❌ Failed to initialize DiagnoChain application:', error);
    
    const container = document.getElementById('root');
    if (container) {
      container.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 2rem;
          text-align: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        ">
          <h1 style="color: #dc2626; font-size: 2rem; margin-bottom: 1rem;">
            Application Error
          </h1>
          <p style="color: #6b7280; font-size: 1rem; margin-bottom: 2rem; max-width: 500px;">
            We're sorry, but DiagnoChain failed to load properly. Please refresh the page or try again later.
          </p>
          <button 
            onclick="window.location.reload()" 
            style="
              background: #3b82f6;
              color: white;
              border: none;
              padding: 0.75rem 1.5rem;
              border-radius: 0.5rem;
              font-size: 1rem;
              cursor: pointer;
              transition: background-color 0.2s;
            "
            onmouseover="this.style.background='#2563eb'"
            onmouseout="this.style.background='#3b82f6'"
          >
            Refresh Page
          </button>
          <details style="margin-top: 2rem; text-align: left; max-width: 600px;">
            <summary style="cursor: pointer; color: #6b7280;">Technical Details</summary>
            <pre style="
              background: #f3f4f6;
              padding: 1rem;
              border-radius: 0.5rem;
              margin-top: 1rem;
              overflow-x: auto;
              font-size: 0.875rem;
              color: #374151;
            ">${error.stack || error.message}</pre>
          </details>
        </div>
      `;
    }
    
    if (window.gtag) {
      window.gtag('event', 'exception', {
        description: 'Application initialization failed',
        fatal: true
      });
    }
  }
};

initializeApp();

if (process.env.NODE_ENV === 'production') {
  reportWebVitals((metric) => {
    console.log(`📊 ${metric.name}:`, metric.value);
    
    if (window.gtag) {
      window.gtag('event', metric.name, {
        event_category: 'Web Vitals',
        value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
        event_label: metric.id,
        non_interaction: true,
      });
    }
  });
}