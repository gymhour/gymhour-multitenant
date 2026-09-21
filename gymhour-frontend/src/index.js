import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import 'react-toastify/dist/ReactToastify.css';
import { applyClientSetup } from './setup';
import { AuthProvider } from './context/AuthContext';
import PlatformApp from './platform/PlatformApp';

applyClientSetup();
const platformMode = process.env.REACT_APP_APP_MODE === 'platform';
if (platformMode) document.body.classList.add('platform-mode');

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      {platformMode
        ? <PlatformApp />
        : <AuthProvider><App /></AuthProvider>}
    </BrowserRouter>
  </React.StrictMode>
);
