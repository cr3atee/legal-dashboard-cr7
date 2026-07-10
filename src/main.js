import 'gridstack/dist/gridstack.min.css';
import 'leaflet/dist/leaflet.css';

import './styles/main.css';
import { initApp } from './app.js';
import { initGlobalLoader } from './components/GlobalLoader.js';

initGlobalLoader();
initApp();
