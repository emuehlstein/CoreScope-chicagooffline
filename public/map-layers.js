/**
 * map-layers.js — Chicago Offline custom basemap layer catalog
 *
 * Defines TILE_LAYERS: named basemap configs available for the layer picker.
 * Loaded before map.js and live.js so they can reference window.TILE_LAYERS.
 *
 * Layers are also configurable via /api/config (config.json → tiles.layers[]).
 * Server-provided layers are merged in after page load by roles.js.
 */

(function () {
  'use strict';

  // ── Built-in layer catalog ──────────────────────────────────────────────
  var BUILTIN_LAYERS = [
    {
      id:          'carto-dark',
      label:       'Dark (Carto)',
      url:         'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">Carto</a>',
      maxZoom:     19,
      dark:        true,   // used as default dark basemap
      light:       false,
    },
    {
      id:          'carto-light',
      label:       'Light (Carto)',
      url:         'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">Carto</a>',
      maxZoom:     19,
      dark:        false,
      light:       true,   // used as default light basemap
    },
    {
      id:          'osm',
      label:       'OpenStreetMap',
      url:         'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom:     19,
    },
    {
      id:          'esri-satellite',
      label:       'Satellite (Esri)',
      url:         'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      maxZoom:     19,
    },
    {
      id:          'esri-topo',
      label:       'Topo (Esri)',
      url:         'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri — Sources: Esri, HERE, Garmin, Intermap, USGS, NGA, EPA, USDA',
      maxZoom:     19,
    },
  ];

  // ── Chicago Offline hosted tilesets (mbtileserver on tiles.chicagooffline.com) ──
  // Tile URL pattern: https://tiles.chicagooffline.com/services/{name}/tiles/{z}/{x}/{y}.png
  // All are overlays — rendered on top of the active basemap at configurable opacity.
  var CHICAGOOFFLINE_LAYERS = [
    {
      id:          'co-hillshade-cook-dark',
      label:       'Hillshade Dark — Cook Co.',
      url:         'https://tiles.chicagooffline.com/services/cook-hillshade-dark-dsm/tiles/{z}/{x}/{y}.png',
      attribution: '© Chicago Offline — 3DEP/DSM Hillshade (z10-16)',
      maxZoom:     16,
      minZoom:     10,
      overlay:     true,
      opacity:     0.5,
    },
    {
      id:          'co-hillshade-3dep-dark',
      label:       'Hillshade Dark 3DEP — Cook Co.',
      url:         'https://tiles.chicagooffline.com/services/cook-hillshade-3dep-dark/tiles/{z}/{x}/{y}.png',
      attribution: '© Chicago Offline — USGS 3DEP 10m Hillshade (z9-17)',
      maxZoom:     17,
      minZoom:     9,
      overlay:     true,
      opacity:     0.5,
    },
    {
      id:          'co-hillshade-3dep-light',
      label:       'Hillshade Light 3DEP — Cook Co.',
      url:         'https://tiles.chicagooffline.com/services/cook-hillshade-3dep-light/tiles/{z}/{x}/{y}.png',
      attribution: '© Chicago Offline — USGS 3DEP 10m Hillshade (z9-17)',
      maxZoom:     17,
      minZoom:     9,
      overlay:     true,
      opacity:     0.4,
    },
  ];

  // Expose on window — roles.js / config merge will extend this
  window.TILE_LAYERS         = BUILTIN_LAYERS;
  window.CHICAGOOFFLINE_OVERLAYS = CHICAGOOFFLINE_LAYERS;

  // Helper: get default dark/light basemap URL (preserves backward compat with TILE_DARK/TILE_LIGHT)
  window.getDefaultTileUrl = function (dark) {
    var layers = window.TILE_LAYERS || BUILTIN_LAYERS;
    var key = dark ? 'dark' : 'light';
    var match = layers.find(function (l) { return l[key] === true; });
    return match ? match.url : (dark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
  };

  /**
   * buildLayerControl(map) — attach a Leaflet layer control with all basemaps + overlays.
   * Call after map is initialized.
   * Returns { baseLayers, overlayLayers, control, activeBasemap }
   */
  window.buildLayerControl = function (map, opts) {
    opts = opts || {};
    var isDark = opts.isDark !== undefined ? opts.isDark : (
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      (document.documentElement.getAttribute('data-theme') !== 'light' &&
       window.matchMedia('(prefers-color-scheme: dark)').matches)
    );

    var layers   = window.TILE_LAYERS || BUILTIN_LAYERS;
    var overlays = window.CHICAGOOFFLINE_OVERLAYS || [];

    // ── Build basemap objects ──
    var baseLayers = {};
    var activeBasemap = null;
    var savedBasemap = localStorage.getItem('co-basemap-id');

    layers.forEach(function (cfg) {
      if (cfg.overlay) return; // skip overlays in basemap group
      var l = L.tileLayer(cfg.url, {
        attribution: cfg.attribution || '',
        maxZoom:     cfg.maxZoom || 19,
        minZoom:     cfg.minZoom || 0,
        subdomains:  cfg.subdomains || 'abc',
      });
      baseLayers[cfg.label] = l;

      // Determine which layer to activate: saved > default dark/light
      var isDefault = isDark ? cfg.dark === true : cfg.light === true;
      if (savedBasemap ? cfg.id === savedBasemap : isDefault) {
        activeBasemap = l;
      }
    });

    // Fallback: first layer
    if (!activeBasemap) activeBasemap = Object.values(baseLayers)[0];
    activeBasemap.addTo(map);

    // ── Build overlay objects ──
    var overlayLayers = {};
    overlays.forEach(function (cfg) {
      var l = L.tileLayer(cfg.url, {
        attribution: cfg.attribution || '',
        maxZoom:     cfg.maxZoom || 19,
        minZoom:     cfg.minZoom || 0,
        opacity:     cfg.opacity !== undefined ? cfg.opacity : 0.5,
      });
      overlayLayers[cfg.label] = l;
    });

    // ── Attach Leaflet layer control ──
    var ctrl = L.control.layers(baseLayers, overlayLayers, {
      position:    opts.position || 'topright',
      collapsed:   opts.collapsed !== undefined ? opts.collapsed : true,
    }).addTo(map);

    // Persist basemap selection
    map.on('baselayerchange', function (e) {
      var chosen = layers.find(function (cfg) { return baseLayers[cfg.label] === e.layer; });
      if (chosen) localStorage.setItem('co-basemap-id', chosen.id);
    });

    return { baseLayers: baseLayers, overlayLayers: overlayLayers, control: ctrl, activeBasemap: activeBasemap };
  };

})();
