/**
 * map-layers.js — Chicago Offline basemap helper
 *
 * Provides window.CO_BASEMAP with three modes:
 *   'carto'      — Carto dark/light (theme-aware)
 *   'satellite'  — Esri World Imagery
 *   'hillshade'  — Chicago Offline combined 3DEP+LiDAR 9x hillshade (theme-aware overlay on Carto)
 *
 * Usage (called from map.js after Leaflet map is created):
 *   window.CO_BASEMAP.init(map, isDark);      // attach initial tile layer
 *   window.CO_BASEMAP.setMode(mode);          // switch mode, updates tile layers
 *   window.CO_BASEMAP.onThemeChange(isDark);  // call when dark/light flips
 */

(function () {
  'use strict';

  var URLS = {
    cartoDark:   'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    cartoLight:  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    satellite:   'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    hillshadeDark:  'https://tiles.chicagooffline.com/services/cook-hillshade-combined-dark-9x/tiles/{z}/{x}/{y}.png',
    hillshadeLight: 'https://tiles.chicagooffline.com/services/cook-hillshade-combined-light-9x/tiles/{z}/{x}/{y}.png',
    hillshadeFallbackDark:  'https://tiles.chicagooffline.com/services/cook-hillshade-3dep-dark/tiles/{z}/{x}/{y}.png',
  };

  var ATTR = {
    carto:     '\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \u00a9 <a href="https://carto.com/">Carto</a>',
    satellite: 'Tiles \u00a9 Esri \u2014 Source: Esri, Maxar, Earthstar Geographics',
    hillshade: '\u00a9 Chicago Offline \u2014 3DEP+LiDAR Hillshade',
  };

  var HILLSHADE_OPACITY = 0.55;

  var _map       = null;
  var _isDark    = true;
  var _mode      = 'hillshade';  // 'carto' | 'satellite' | 'hillshade'
  var _baseLayer = null;     // the active base tile layer
  var _hillLayer = null;     // hillshade overlay (only when mode=hillshade)

  function _isDarkMode() { return _isDark; }

  // CARTO began requiring an API key in 2026-08 (upstream #1919 / #1926):
  // unauthenticated tiles still come back 200 but every one is stamped
  // "API KEY REQUIRED". map.js and live.js on this branch drive the basemap
  // through CO_BASEMAP instead of the upstream tile registry, so the key has to
  // be resolved HERE too — otherwise _getCartoKey() never fires on the surfaces
  // this deployment actually renders and the map quietly stays watermarked.
  //
  // Same convention as roles.js: MC_tileUrlById(id, fallback) applies both
  // `tiles.providers.carto.domain` and the `?key=` query param, and hands back
  // the fallback when the registry is missing or the carto provider is disabled.
  //
  // Resolved lazily on every call, never at parse time: index.html loads
  // map-layers.js (line ~67) BEFORE map-tile-providers.js (line ~194), and the
  // key itself only arrives with the async /api/config fetch.
  function _resolveCarto(id, fallback) {
    return (typeof window.MC_tileUrlById === 'function')
      ? window.MC_tileUrlById(id, fallback)
      : fallback;
  }

  function _cartoUrl() {
    return _isDarkMode()
      ? _resolveCarto('carto-dark',  URLS.cartoDark)
      : _resolveCarto('carto-light', URLS.cartoLight);
  }
  function _hillshadeUrl()  { return _isDarkMode() ? URLS.hillshadeDark : URLS.hillshadeLight; }

  function _removeLayers() {
    if (_baseLayer) { _map.removeLayer(_baseLayer); _baseLayer = null; }
    if (_hillLayer) { _map.removeLayer(_hillLayer); _hillLayer = null; }
  }

  function _applyMode() {
    if (!_map) return;
    _removeLayers();

    if (_mode === 'satellite') {
      _baseLayer = L.tileLayer(URLS.satellite, {
        attribution: ATTR.satellite,
        maxZoom: 19,
      }).addTo(_map);

    } else if (_mode === 'hillshade') {
      // Hillshade = Carto base + hillshade overlay
      _baseLayer = L.tileLayer(_cartoUrl(), {
        attribution: ATTR.carto,
        maxZoom: 19,
      }).addTo(_map);
      _hillLayer = L.tileLayer(_hillshadeUrl(), {
        attribution: ATTR.hillshade,
        maxZoom: 17,
        minZoom: 1,
        opacity: HILLSHADE_OPACITY,
      }).addTo(_map);

    } else {
      // carto (default)
      _baseLayer = L.tileLayer(_cartoUrl(), {
        attribution: ATTR.carto,
        maxZoom: 19,
      }).addTo(_map);
    }
  }

  function init(map, isDark, savedMode) {
    _map    = map;
    _isDark = !!isDark;
    _mode   = savedMode || localStorage.getItem('co-basemap-mode') || 'hillshade';
    _applyMode();
  }

  function setMode(mode) {
    if (mode === _mode) return;
    _mode = mode;
    try { localStorage.setItem('co-basemap-mode', mode); } catch (_) {}
    _applyMode();
  }

  function onThemeChange(isDark) {
    _isDark = !!isDark;
    if (_mode === 'satellite') return; // satellite is theme-agnostic
    if (_mode === 'hillshade') {
      // Update both base and overlay URLs
      if (_baseLayer) _baseLayer.setUrl(_cartoUrl());
      if (_hillLayer) _hillLayer.setUrl(_hillshadeUrl());
    } else {
      // carto — just swap the URL
      if (_baseLayer) _baseLayer.setUrl(_cartoUrl());
    }
  }

  function getMode() { return _mode; }

  function setHillshadeOpacity(val) {
    HILLSHADE_OPACITY = parseFloat(val) || 0.75;
    if (_hillLayer) _hillLayer.setOpacity(HILLSHADE_OPACITY);
    try { localStorage.setItem('co-hillshade-opacity', HILLSHADE_OPACITY); } catch (_) {}
  }

  function getHillshadeOpacity() { return HILLSHADE_OPACITY; }

  // Restore saved opacity
  try {
    var saved = parseFloat(localStorage.getItem('co-hillshade-opacity'));
    if (!isNaN(saved) && saved >= 0 && saved <= 1) HILLSHADE_OPACITY = saved;
  } catch (_) {}

  // The tile registry is rebuilt once /api/config lands (roles.js calls
  // MC_initTileRegistry(true), which dispatches this event). That normally
  // happens AFTER map.js/live.js have already called init(), so the first paint
  // is built from the keyless fallbacks. Re-point the Carto base layer when the
  // real config shows up, or the watermark would persist for the page lifetime.
  //
  // Only the base layer is Carto-derived: 'satellite' is Esri and the hillshade
  // overlay is served from tiles.chicagooffline.com — neither takes a key.
  window.addEventListener('mc-tile-provider-changed', function () {
    if (!_map || _mode === 'satellite') return;
    if (_baseLayer) _baseLayer.setUrl(_cartoUrl());
  });

  window.CO_BASEMAP = {
    init: init, setMode: setMode, onThemeChange: onThemeChange, getMode: getMode,
    setHillshadeOpacity: setHillshadeOpacity, getHillshadeOpacity: getHillshadeOpacity
  };

  // Keep TILE_DARK / TILE_LIGHT globals in sync for any code that still reads them
  window.TILE_DARK  = URLS.cartoDark;
  window.TILE_LIGHT = URLS.cartoLight;

})();
