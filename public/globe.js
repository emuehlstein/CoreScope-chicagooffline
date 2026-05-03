/**
 * globe.js — 3D Globe view for MeshCore network
 * Uses Cesium for 3D visualization of nodes and packet paths
 */

'use strict';

(function() {
  let viewer;
  let nodeEntities = new Map();
  let wsHandler;
  let statsDiv;

  // Initialize Cesium viewer
  function initViewer(container) {
    // Cesium Ion access token
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhZjMzYTczNS03YTlkLTRkOWItYjI1Zi02YjJhNjBmNjYxNjgiLCJpZCI6NDI2ODYzLCJpc3MiOiJodHRwczovL2lvbi5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3Nzc4NDY5NDl9.-m7FPQsB4syRZQn6mt2WZ7jffejFyk1twYRTBFe-7BA';

    // Create viewer with Cesium Ion imagery (Bing Maps satellite)
    viewer = new Cesium.Viewer(container, {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: true,
      infoBox: true,
      selectionIndicator: true,
    });

    // Ensure globe is visible
    viewer.scene.globe.show = true;
    viewer.scene.skyBox.show = true;
    viewer.scene.sun.show = true;
    viewer.scene.moon.show = false;

    console.log('[globe] Viewer created, globe.show:', viewer.scene.globe.show);

    // Set initial camera position to look at Earth from above Chicago
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-87.6298, 41.8781, 10000000), // Start far out
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO, // Look straight down
        roll: 0
      }
    });

    console.log('[globe] Camera positioned, distance:', Cesium.Cartesian3.magnitude(viewer.camera.position));

    // Fly closer after a short delay
    setTimeout(() => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-87.6298, 41.8781, 50000),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-45),
          roll: 0
        },
        duration: 3
      });
    }, 500);

    // Enable depth testing for better 3D visualization
    viewer.scene.globe.depthTestAgainstTerrain = true;

    console.log('[globe] Cesium viewer initialized');
  }

  // Fetch and display nodes
  async function loadNodes() {
    try {
      const response = await fetch('/api/nodes');
      const data = await response.json();
      
      // Handle both array and object responses
      const nodes = Array.isArray(data) ? data : (data.nodes || []);
      
      console.log(`[globe] Loaded ${nodes.length} nodes`);
      
      nodes.forEach(node => {
        if (node.lat && node.lon) {
          addNodeToGlobe(node);
        }
      });

      updateStats();
    } catch (err) {
      console.error('[globe] Failed to load nodes:', err);
    }
  }

  // Add a node marker to the globe
  function addNodeToGlobe(node) {
    const position = Cesium.Cartesian3.fromDegrees(node.lon, node.lat, 0);
    
    // Color based on activity (green = recent, amber = old, grey = inactive)
    const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt) : null;
    const ageMinutes = lastSeen ? (Date.now() - lastSeen.getTime()) / 60000 : Infinity;
    
    let color;
    if (ageMinutes < 60) {
      color = Cesium.Color.fromCssColorString('#39FF14'); // Mesh Green
    } else if (ageMinutes < 1440) {
      color = Cesium.Color.fromCssColorString('#FFB300'); // Beacon Amber
    } else {
      color = Cesium.Color.fromCssColorString('#6B7280'); // Grey
    }

    const entity = viewer.entities.add({
      id: `node-${node.id}`,
      position: position,
      point: {
        pixelSize: 12,
        color: color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      label: {
        text: node.name || node.id,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -15),
        show: false, // Only show on hover/click
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      description: `
        <div style="font-family: sans-serif;">
          <h3 style="margin: 0 0 10px 0;">${node.name || node.id}</h3>
          <p style="margin: 5px 0;"><strong>ID:</strong> ${node.id}</p>
          <p style="margin: 5px 0;"><strong>Location:</strong> ${node.lat.toFixed(6)}, ${node.lon.toFixed(6)}</p>
          <p style="margin: 5px 0;"><strong>Last Seen:</strong> ${lastSeen ? lastSeen.toLocaleString() : 'Never'}</p>
          ${node.hardwareModel ? `<p style="margin: 5px 0;"><strong>Hardware:</strong> ${node.hardwareModel}</p>` : ''}
        </div>
      `
    });

    nodeEntities.set(node.id, entity);
  }

  // Update node stats display
  function updateStats() {
    if (!statsDiv) return;
    
    const total = nodeEntities.size;
    const active = Array.from(nodeEntities.values()).filter(e => {
      const color = e.point.color.getValue();
      return color.equals(Cesium.Color.fromCssColorString('#39FF14'));
    }).length;

    statsDiv.innerHTML = `
      <span class="globe-stats-label">Nodes:</span>
      <span class="globe-stats-value">${total}</span>
      <span class="globe-stats-label" style="margin-left: 12px;">Active:</span>
      <span class="globe-stats-value">${active}</span>
    `;
  }

  // Update an existing node or add if new
  function updateNode(node) {
    if (!node.lat || !node.lon) return;
    
    const existing = nodeEntities.get(node.id);
    if (existing) {
      // Update existing node (color based on recent activity)
      existing.point.color = Cesium.Color.fromCssColorString('#39FF14'); // Mesh Green
      updateStats();
    } else {
      // Add new node
      addNodeToGlobe(node);
      updateStats();
    }
  }

  // Initialize the page
  function init(app, routeParam) {
    app.innerHTML = `
      <div id="globeContainer"></div>
      <div class="globe-stats" id="globeStats">Loading...</div>
    `;

    const container = document.getElementById('globeContainer');
    statsDiv = document.getElementById('globeStats');

    if (typeof Cesium === 'undefined') {
      app.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text);">Cesium library failed to load. Please refresh the page.</div>';
      console.error('[globe] Cesium library not loaded');
      return;
    }

    initViewer(container);
    loadNodes();

    // Set up WebSocket handler
    wsHandler = function (msg) {
      if (msg.type === 'node' && msg.node) {
        updateNode(msg.node);
      }
    };
    if (window.registerWSHandler) {
      registerWSHandler(wsHandler);
    }
  }

  // Cleanup when leaving the page
  function destroy() {
    if (viewer) {
      viewer.destroy();
      viewer = null;
    }
    nodeEntities.clear();
    if (wsHandler && window.unregisterWSHandler) {
      unregisterWSHandler(wsHandler);
      wsHandler = null;
    }
    statsDiv = null;
  }

  // Register the page
  registerPage('globe', {
    init: init,
    destroy: destroy
  });

})();
