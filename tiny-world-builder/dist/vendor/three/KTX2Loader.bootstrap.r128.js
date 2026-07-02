import { KTX2Loader } from './jsm/loaders/KTX2Loader.js';

window.__tinyworldKTX2LoaderClass = KTX2Loader;
window.dispatchEvent(new CustomEvent('tinyworld:ktx2-loader-ready'));
